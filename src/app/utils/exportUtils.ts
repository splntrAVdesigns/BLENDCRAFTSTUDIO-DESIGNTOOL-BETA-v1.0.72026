import * as FileSaver from 'file-saver';
import THREE from '../lib/three';
import { Layer, GradientConfig, ExportFormat, CanvasSettings } from '../types/gradient';
import { generateCSSGradient } from './gradientRenderer';
// @ts-ignore - gif.js doesn't have reliable ESM typings
import * as GIFLib from 'gif.js';
// Video encode: Mediabunny-based engine. Replaces the previously vendored
// hand-rolled mp4-muxer.ts / webm-muxer.ts forks — both packages were
// formally deprecated by their own author in favor of Mediabunny, which
// unifies MP4 + WebM under one API and provides real backpressure via
// CanvasSource.add() instead of manual encodeQueueSize polling.
import { encodeVideoWithMediabunny, canEncodeContainer } from '../export/mediabunnyExport';
import {
  captureExportFrameSample,
  compareExportFrameSamples,
  verifyExportedFrameFidelity,
  type ExportFrameSample,
} from '../export/exportFrameFidelity';
import {
  compareLoopFrames,
  describeLoopResult,
  type LoopFrameSample,
  type LoopVerificationResult,
} from './loopVerification';
import {
  captureExportMemorySnapshot,
  verifyExportMemoryRecovery,
  verifyExportedArtifactDuration,
} from './exportCertification';
import {
  createExportFinalizationTimings,
  getExportFinalizationProgress,
  handoffExportDownload,
} from './exportFinalization';
import { EXPORT_COLOR_CONTRACT } from './exportRenderQuality';
import { attachLatestExportMemoryRecovery, recordExportFailure, recordExportTiming } from './exportStressCertification';
import type { RenderedTimelineFrameState } from './exportTimelineCertification';

type DeterministicVideoFrameRenderer = (
  time: number,
  exportRenderer?: THREE.WebGLRenderer,
) => Promise<RenderedTimelineFrameState | void>;

function getGIFConstructor(): any {
  const moduleAny = GIFLib as any;
  const globalAny = globalThis as any;

  const valuesToInspect = [
    moduleAny,
    moduleAny?.default,
    moduleAny?.GIF,
    moduleAny?.default?.default,
    moduleAny?.default?.GIF,
    moduleAny?.GIF?.default,
    globalAny?.GIF,
    globalAny?.window?.GIF,
  ];

  for (const value of valuesToInspect) {
    if (!value) continue;
    if (typeof value === 'function' && typeof value.prototype?.addFrame === 'function') {
      return value;
    }
    if (typeof value === 'object') {
      for (const nested of Object.values(value)) {
        if (typeof nested === 'function' && typeof (nested as any).prototype?.addFrame === 'function') {
          return nested;
        }
      }
    }
  }

  throw new Error(`GIF encoder constructor unavailable (module keys: ${Object.keys(moduleAny || {}).join(', ') || 'none'})`);
}
const saveAs = FileSaver.saveAs || (FileSaver as any).default?.saveAs || (FileSaver as any);

/**
 * AUTHORITATIVE PRESENTATION-CAPTURE SYSTEM
 * =========================================
 * Deterministic frames render through the live Three.js renderer at export
 * resolution, then the final presentation canvas is copied to a dedicated
 * encoder staging canvas.
 * 
 * KEY PRINCIPLES:
 * 1. Preview and export share one render graph and color contract
 * 2. Presentation canvas is the display-referred sRGB authority
 * 3. Deterministic time-stepping preserves exact animation timing
 * 4. Dedicated staging canvas isolates encoder ownership
 * 5. Raw framebuffer bytes remain compatibility fallback only
 */

export type ProgressCallback = (progress: number, message?: string) => void;

/**
 * Deterministic frame renderer callback
 * Called by export functions to render at specific time values (in seconds)
 * Optional exportRenderer parameter for isolated high-quality rendering
 */
export type DeterministicRenderCallback = (
  time: number,
  exportRenderer?: THREE.WebGLRenderer
) => Promise<void>;

/**
 * Export resolution presets
 */
export interface ExportPreset {
  label: string;
  width: number;
  height: number;
}

export const PNG_PRESETS: ExportPreset[] = [
  { label: '1080p', width: 1920, height: 1080 },
  { label: '1440p', width: 2560, height: 1440 },
  { label: '2160p (4K)', width: 3840, height: 2160 },
  { label: 'Square 1080', width: 1080, height: 1080 },
  { label: 'Custom', width: 0, height: 0 },
];

export const WEBM_PRESETS: ExportPreset[] = [
  { label: '1080p', width: 1920, height: 1080 },
  { label: '1440p', width: 2560, height: 1440 },
  { label: '2160p (4K)', width: 3840, height: 2160 },
];

export type VideoQuality = 'standard' | 'high' | 'ultra' | 'max' | 'sharpMax';

/**
 * Maps quality tier to keyframe interval. Two rounds of shortening the
 * default (2s -> 1s, see mediabunnyEncodeShared.ts) measurably reduced but
 * did not eliminate P-frame softening on dense, high-frequency,
 * continuously-warping content — confirmed via the app's own
 * verifyExportedFrameFidelity() check (maximumChannelError well above a
 * clean-compression baseline on real exports). "High" (the default tier,
 * and what's been tested) keeps the 1s interval. Higher tiers now actually
 * buy meaningfully different encode behavior instead of just a bitrate bump
 * — "Sharp Max" goes fully intra (a keyframe every single frame), which
 * removes inter-frame prediction error entirely at the cost of a much
 * larger file. This is the direct, available-today lever for content this
 * demanding, ahead of any further architecture work.
 */
export function keyFrameIntervalSecondsForQuality(quality: VideoQuality, fps: number): number {
  const safeFps = Math.max(1, fps);
  switch (quality) {
    case 'standard': return 1.5;
    case 'high': return 1;
    case 'ultra': return 0.5;
    case 'max': return 3 / safeFps;
    case 'sharpMax': return 1 / safeFps; // every frame is a keyframe
    default: return 1;
  }
}

/**
 * WebM/VP9 only (see buildCanvasSourceConfig's doc comment for the full
 * rationale). 'realtime' stays the default for standard/high — unchanged,
 * fast-preview behavior. Any tier that also pushes keyFrameIntervalSeconds
 * down toward full-intra needs 'quality' mode instead: forcing a
 * simple/fast rate-control mode into an all-keyframe pattern at a very
 * high bitrate is the likely cause of a real, reproduced failure (WebM +
 * Sharp Max stuck at 8/150 rendered frames for 2+ minutes, never
 * recovered — not the page-visibility stall pattern seen elsewhere, this
 * was genuinely stuck/slow encoder work).
 */
export function latencyModeForQuality(quality: VideoQuality): 'quality' | 'realtime' {
  switch (quality) {
    case 'ultra':
    case 'max':
    case 'sharpMax':
      return 'quality';
    default:
      return 'realtime';
  }
}

export interface VideoQualityConfig {
  label: string;
  bitrate: (width: number, height: number) => number;
}
export interface ExportFlashOverlayFrame {
  opacity: number;
  color: string;
  position: string;
}


export const VIDEO_QUALITY_PRESETS: Record<VideoQuality, VideoQualityConfig> = {
  // ── STAGE 2.8.6: BITRATE LADDER RECALIBRATED ──
  //
  // These were set very high (1080p "High" = 42 Mbps) to protect against
  // BANDING, which is the real failure mode for smooth gradients and a
  // legitimate concern — so this is a trim, not a collapse. 24 Mbps for 1080p
  // VP9 is still roughly 2–3× what a high-quality 1080p delivery uses, and VP9
  // is ~30–50% more efficient per bit than H.264, so the headroom against
  // banding remains large.
  //
  // The point is encoder WORK: every bit the encoder is told to produce is work
  // it has to do, and combined with the CBR→VBR change below this is the second
  // half of the encode-time fix. If you see banding in flat gradient regions
  // after this, say so — the honest response is to raise 'high' back toward the
  // low 30s rather than to argue the numbers.
  standard: {
    label: 'Standard / Fast Preview',
    bitrate: (w, h) => {
      if (w >= 3840) return 24_000_000; // 4K preview
      if (w >= 2560) return 16_000_000; // 1440p preview
      return 12_000_000; // 1080p preview
    },
  },
  high: {
    label: 'High / Balanced',
    bitrate: (w, h) => {
      if (w >= 3840) return 52_000_000; // 4K dense gradients
      if (w >= 2560) return 34_000_000; // 1440p dense gradients
      return 24_000_000; // 1080p dense gradients
    },
  },
  ultra: {
    label: 'Max Quality',
    bitrate: (w, h) => {
      if (w >= 3840) return 90_000_000;
      if (w >= 2560) return 58_000_000;
      return 42_000_000;
    },
  },
  max: {
    label: 'Max Quality',
    bitrate: (w, h) => {
      if (w >= 3840) return 180_000_000;
      if (w >= 2560) return 120_000_000;
      return 90_000_000;
    },
  },
  sharpMax: {
    label: 'Sharp Max / Master Slow',
    bitrate: (w, h) => {
      if (w >= 3840) return 220_000_000;
      if (w >= 2560) return 150_000_000;
      return 110_000_000;
    },
  },
};

function getWebMSourceScale(quality: VideoQuality): number {
  // Export v3 Sprint 3:
  // Render dense shader compositions slightly larger than the delivery frame,
  // then downsample into the encoder canvas. This mirrors the clean PNG path and
  // removes a lot of jagged procedural edges before VP9's 4:2:0 compression.
  switch (quality) {
    case 'standard': return 1.0;
    case 'high': return 1.25;
    case 'ultra': return 1.5;
    case 'max': return 1.75;
    case 'sharpMax': return 2.0;
    default: return 1.25;
  }
}


/**
 * Create isolated export renderer for high-quality exports
 * CRITICAL: Only export renderer has preserveDrawingBuffer: true
 * 
 * @param width - Export width in pixels
 * @param height - Export height in pixels
 * @param pixelRatio - Pixel ratio for high-DPI exports (default: 1)
 * @returns Export renderer, canvas, and cleanup function
 */
export function createExportRenderer(
  width: number,
  height: number,
  pixelRatio: number = 1
): { renderer: THREE.WebGLRenderer; canvas: HTMLCanvasElement; cleanup: () => void } {
  // Validate dimensions
  if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`Invalid export dimensions: ${width}x${height}. Must be positive finite numbers.`);
  }

  // Create offscreen canvas at exact target size
  const exportCanvas = document.createElement('canvas');

  // CRITICAL: Set canvas dimensions BEFORE creating renderer to ensure correct size
  exportCanvas.width = width * pixelRatio;
  exportCanvas.height = height * pixelRatio;

  // Create export renderer with preserveDrawingBuffer: true
  const exportRenderer = new THREE.WebGLRenderer({
    canvas: exportCanvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true, // CRITICAL: Enable reliable capture (EXPORT ONLY)
    powerPreference: 'high-performance',
  });

  // Set exact export size (this configures Three.js viewport, not canvas size)
  exportRenderer.setPixelRatio(pixelRatio);
  exportRenderer.setSize(width, height, false);
  exportRenderer.setClearColor(0x000000, 0); // Transparent

  // Verify canvas size matches expected dimensions
  const actualWidth = exportCanvas.width;
  const actualHeight = exportCanvas.height;
  const expectedWidth = width * pixelRatio;
  const expectedHeight = height * pixelRatio;

  if (actualWidth !== expectedWidth || actualHeight !== expectedHeight) {
    if (import.meta.env?.DEV) console.warn(
      `Export canvas size mismatch! Expected ${expectedWidth}x${expectedHeight}, got ${actualWidth}x${actualHeight}`
    );
  }

  const cleanup = () => {
    exportRenderer.dispose();
    // Explicitly clear canvas to free memory
    exportCanvas.width = 1;
    exportCanvas.height = 1;
  };

  return { renderer: exportRenderer, canvas: exportCanvas, cleanup };
}

/**
 * Pick best WebM MIME type based on browser support
 */
export function pickBestVideoMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') {
    return null;
  }
  
  // Prefer VP8 first for broader playback compatibility in browser and desktop players.
  const candidates = [
    'video/webm; codecs=vp9',
    'video/webm; codecs=vp8',
    'video/webm',
  ];
  
  for (const mimeType of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  
  return null;
}

/**
 * Check if video export is supported in the current browser
 */


function throwIfExportAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Export cancelled', 'AbortError');
  }
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function yieldToBrowser(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function settleRenderedCanvas(extraPaints: number = 2): Promise<void> {
  for (let i = 0; i < extraPaints; i++) {
    await waitForNextPaint();
  }
}

/**
 * Pick best MP4/H.264 MIME type.
 * Returns null if the browser can't encode MP4 natively.
 */
export function pickBestMP4MimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  // Prioritize H.264 High Profile (better compression for smooth gradient animation)
  const candidates = [
    'video/mp4; codecs=avc1.64002A',  // H.264 High 4.2 — 4K@60fps
    'video/mp4; codecs=avc1.640028',  // H.264 High 4.0 — 4K@30fps / 1440p
    'video/mp4; codecs=avc1.4d401f',  // H.264 Main 3.1 — 1080p
    'video/mp4; codecs=avc1.42E01E',  // H.264 Baseline — legacy
    'video/mp4; codecs=avc1',
    'video/mp4',
    'video/webm; codecs=vp9',         // last resort
    'video/webm; codecs=vp8',
    'video/webm',
  ];
  for (const mt of candidates) {
    if (MediaRecorder.isTypeSupported(mt)) return mt;
  }
  return null;
}

export function isMP4ExportSupported(): boolean {
  return canAttemptMP4WebCodecs() || !!pickBestMP4MimeType();
}

export function isVideoExportSupported(): boolean {
  if (typeof window === 'undefined') return false;
  
  // Check for MediaRecorder API
  if (!window.MediaRecorder) return false;
  
  // Check for canvas.captureStream
  const canvas = document.createElement('canvas');
  if (!canvas.captureStream) return false;
  
  // Check for WebM support
  if (!pickBestVideoMimeType()) return false;
  
  return true;
}

function isWebCodecsAvailable(): boolean {
  const g = globalThis as any;
  return (
    typeof g.VideoEncoder !== 'undefined' &&
    typeof g.VideoFrame !== 'undefined' &&
    typeof g.EncodedVideoChunk !== 'undefined'
  );
}


function canAttemptMP4WebCodecs(): boolean {
  if (!isWebCodecsAvailable()) return false;
  const Encoder = (globalThis as any).VideoEncoder;
  return typeof Encoder?.isConfigSupported === 'function' || typeof Encoder === 'function';
}

let mp4SupportCache: Promise<boolean> | null = null;
/**
 * UI capability gate for the MP4 format option. Delegates to the same
 * Mediabunny canEncodeVideo() probe the real encode path uses
 * (canEncodeContainer in mediabunnyExport.ts) — previously this ran an
 * independent, much narrower hand-rolled WebCodecs probe (a single exact
 * config: avc1.42E01F Constrained Baseline @ 1280x720, 5 Mbps) that could
 * report false negatives on environments where that ONE specific
 * profile/level/resolution combination was rejected even though H.264 was
 * genuinely encodable — which blocked the MP4 option in the UI while the
 * real encode-time check would have succeeded. One source of truth now.
 */
export function verifyMP4EncodeSupport(opts?: { force?: boolean }): Promise<boolean> {
  if (!opts?.force && mp4SupportCache) return mp4SupportCache;
  mp4SupportCache = (async () => {
    if (!isWebCodecsAvailable()) return false;
    // Representative 1080p30 probe — matches the default export summary
    // shown before the user picks a resolution. The real export re-probes
    // at the actual target width/height/fps immediately before encoding.
    return canEncodeContainer('mp4', 1920, 1080, 30);
  })();
  return mp4SupportCache;
}

/**
/**
 * Export PNG at exact target size.
 *
 * ARCH-07 PATCH: Replaced the slow CPU readback path (read 33MB Uint8Array from GPU,
 * manually walk every pixel to flip Y, putImageData) with a fast drawImage path.
 *
 * OLD path for 4K: GPU -> 33MB Uint8Array -> manual Y-flip loop -> putImageData -> drawImage
 *   Total: ~300-600ms of CPU time just for pixel manipulation on 4K.
 *
 * NEW path: drawImage(liveCanvas) directly, letting the GPU compositor handle the
 * blit and scale in one operation. Identical to how video export captures frames.
 * For 4K this drops the capture step from ~500ms to ~5ms.
 *
 * The RT fallback (getReadFramePixels) is retained for edge cases where the live
 * canvas is unavailable or returns blank.
 */
export async function exportPNGAtSize(
  renderFrameAtTime: DeterministicRenderCallback,
  width: number,
  height: number,
  filename: string,
  onProgress?: ProgressCallback,
  captureTime: number = 0,
  getReadFramePixels?: () => { data: Uint8Array; width: number; height: number } | null,
  getLiveCanvas?: () => HTMLCanvasElement | null,
  setExportSize?: (width: number, height: number) => void,
  restoreSize?: () => void
): Promise<void> {
  if (!renderFrameAtTime) throw new Error('renderFrameAtTime is required');

  const targetWidth = Math.max(2, Math.round(width));
  const targetHeight = Math.max(2, Math.round(height));
  // Phase 7.3E.8: resolve curved shader geometry from a supersampled source.
  // 2x is reserved for <=1080p targets where it gives the largest visible gain
  // without creating an unsafe 8K intermediate for 4K exports.
  const supersampleScale = targetWidth * targetHeight <= 1920 * 1080 ? 2 : 1;
  const renderWidth = Math.max(targetWidth, Math.round(targetWidth * supersampleScale / 2) * 2);
  const renderHeight = Math.max(targetHeight, Math.round(targetHeight * supersampleScale / 2) * 2);
  onProgress?.(0, 'Preparing PNG export...');

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = targetWidth;
  exportCanvas.height = targetHeight;
  const ctx = exportCanvas.getContext('2d', { alpha: true, willReadFrequently: false });
  if (!ctx) throw new Error('Failed to create PNG export canvas.');

  const initialLiveCanvas = getLiveCanvas?.();
  // PHASE 7.3E.10 PNG CONTINUITY: when the current high-DPR drawing buffer already
  // contains at least the requested delivery pixels, capture it directly. This avoids
  // resizing the visible renderer (the source of the remaining gradient position shift)
  // while retaining supersampling from the editor's existing high-resolution buffer.
  const useCurrentDrawingBuffer = Boolean(
    initialLiveCanvas &&
    initialLiveCanvas.width >= targetWidth &&
    initialLiveCanvas.height >= targetHeight
  );
  const sourceRenderWidth = useCurrentDrawingBuffer ? initialLiveCanvas!.width : renderWidth;
  const sourceRenderHeight = useCurrentDrawingBuffer ? initialLiveCanvas!.height : renderHeight;

  try {
    onProgress?.(20, `Rendering ${sourceRenderWidth}×${sourceRenderHeight} fidelity source...`);
    if (!useCurrentDrawingBuffer) {
      setExportSize?.(sourceRenderWidth, sourceRenderHeight);
      await waitForNextPaint();
    }
    await renderFrameAtTime(captureTime, undefined);
    await settleRenderedCanvas(2);
    // Re-render the same deterministic time after shader targets and texture
    // samplers have settled at export resolution. This prevents the first
    // resized frame from carrying preview-resolution grain/post-FX state.
    await renderFrameAtTime(captureTime, undefined);
    await settleRenderedCanvas(1);

    onProgress?.(62, 'Capturing PNG frame...');
    const liveCanvas = getLiveCanvas?.();
    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.imageSmoothingEnabled = false;

    let captured = false;

    // Phase 7.3E.6B color-fidelity recovery: the visible WebGL canvas is the
    // authoritative display-referred sRGB result. It already includes Three.js
    // output conversion and exactly matches what the user sees. Feeding raw FBO
    // bytes through putImageData can apply the wrong transfer interpretation and
    // was the source of the washed-out PNG regression.
    if (liveCanvas && liveCanvas.width > 1 && liveCanvas.height > 1) {
      const sourceIsCertified = liveCanvas.width === sourceRenderWidth && liveCanvas.height === sourceRenderHeight;
      if (!sourceIsCertified) {
        throw new Error(
          `PNG source resolution mismatch: expected ${sourceRenderWidth}×${sourceRenderHeight}, ` +
          `received ${liveCanvas.width}×${liveCanvas.height}.`,
        );
      }
      ctx.clearRect(0, 0, targetWidth, targetHeight);
      ctx.imageSmoothingEnabled = sourceRenderWidth !== targetWidth || sourceRenderHeight !== targetHeight;
      if (ctx.imageSmoothingEnabled) ctx.imageSmoothingQuality = 'high';
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(liveCanvas, 0, 0, sourceRenderWidth, sourceRenderHeight, 0, 0, targetWidth, targetHeight);
      ctx.globalCompositeOperation = 'source-over';
      captured = !isCanvasMostlyBlank(exportCanvas);
    }

    // GPU readback remains a last-resort fallback only when the presentation
    // canvas is unavailable. It is no longer allowed to override a valid live
    // canvas capture.
    if (!captured) {
      const frame = getReadFramePixels?.();
      if (frame && frame.data.length === frame.width * frame.height * 4) {
        const flipped = flipRgbaBuffer(frame.data, frame.width, frame.height);
        const bitmapCanvas = document.createElement('canvas');
        bitmapCanvas.width = frame.width;
        bitmapCanvas.height = frame.height;
        const bctx = bitmapCanvas.getContext('2d', { alpha: true })!;
        bctx.putImageData(new ImageData(toImageDataArray(flipped), frame.width, frame.height), 0, 0);
        ctx.clearRect(0, 0, targetWidth, targetHeight);
        if (frame.width !== sourceRenderWidth || frame.height !== sourceRenderHeight) {
          throw new Error(
            `PNG fallback resolution mismatch: expected ${sourceRenderWidth}×${sourceRenderHeight}, ` +
            `received ${frame.width}×${frame.height}.`,
          );
        }
        ctx.imageSmoothingEnabled = supersampleScale > 1;
        if (supersampleScale > 1) ctx.imageSmoothingQuality = 'high';
        ctx.globalCompositeOperation = 'copy';
        ctx.drawImage(bitmapCanvas, 0, 0, sourceRenderWidth, sourceRenderHeight, 0, 0, targetWidth, targetHeight);
        ctx.globalCompositeOperation = 'source-over';
        captured = !isCanvasMostlyBlank(exportCanvas);
        bitmapCanvas.width = 1;
        bitmapCanvas.height = 1;
      }
    }

    if (!captured) {
      throw new Error('PNG capture failed: no rendered frame available.');
    }
  } finally {
    if (!useCurrentDrawingBuffer) {
      restoreSize?.();
      await waitForNextPaint();
    }
  }

  onProgress?.(80, 'Encoding PNG...');
  const blob = await new Promise<Blob | null>((resolve) =>
    exportCanvas.toBlob(resolve, 'image/png')
  );
  exportCanvas.width = 1;
  exportCanvas.height = 1;
  if (!blob) throw new Error('PNG encoding failed.');

  onProgress?.(95, 'Saving PNG...');
  saveAs(blob, filename);
  onProgress?.(100, 'PNG export complete!');
}

/**
 * Cleanup export resources - call after export completes to free memory
 * CRITICAL: Prevents memory leaks during long sessions with multiple exports
 */

function isCanvasMostlyBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || canvas.width < 2 || canvas.height < 2) return true;
  const w = Math.min(64, canvas.width);
  const h = Math.min(64, canvas.height);
  const sample = ctx.getImageData(0, 0, w, h).data;
  let active = 0;
  for (let i = 0; i < sample.length; i += 4) {
    if (sample[i + 3] > 2 || sample[i] > 2 || sample[i + 1] > 2 || sample[i + 2] > 2) {
      active++;
      if (active > 8) return false;
    }
  }
  return true;
}

// v2.2.5 export-session staging cache.
// These are module-scoped on purpose so repeated WebM frame readbacks do not
// allocate a new canvas/context per frame. cleanupExportResources() always
// shrinks/nulls them after export, abort, or fallback.
let _rtReadbackCanvas: HTMLCanvasElement | null = null;
let _rtReadbackCtx: CanvasRenderingContext2D | null = null;
let _rtReadbackW = 0;
let _rtReadbackH = 0;


// STAGE 3.2: reuse one flip buffer across frames. The vertical flip (WebGL
// readback is bottom-up) previously allocated a fresh width×height×4 buffer
// EVERY frame — ~8MB at 1080p, 150 frames = ~1.2GB of pure GC churn during an
// export. A single reused buffer removes that entirely; the flip work itself is
// unchanged.
let _flipBuf: Uint8Array | null = null;
function toImageDataArray(source: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  const result = new Uint8ClampedArray(new ArrayBuffer(source.byteLength));
  result.set(source);
  return result;
}

function flipRgbaBuffer(source: Uint8Array, width: number, height: number): Uint8Array {
  const rowBytes = width * 4;
  const expected = rowBytes * height;
  if (!source || source.length < expected) {
    throw new Error(`Invalid RGBA readback buffer: expected ${expected} bytes, got ${source?.length ?? 0}`);
  }

  if (!_flipBuf || _flipBuf.length !== expected) {
    _flipBuf = new Uint8Array(expected);
  }
  const flipped = _flipBuf;
  for (let y = 0; y < height; y++) {
    const srcStart = (height - 1 - y) * rowBytes;
    const dstStart = y * rowBytes;
    flipped.set(source.subarray(srcStart, srcStart + rowBytes), dstStart);
  }
  return flipped;
}

function assertUsableVideoBlob(blob: Blob, label: string): void {
  // A valid 5s 1080p WebM should be much larger, but keep the threshold tiny so
  // extremely simple scenes still pass while 0-byte/empty container failures are caught.
  if (!blob || blob.size < 256) {
    throw new Error(`${label} produced an empty/suspicious video file (${blob?.size ?? 0} bytes).`);
  }
}

function assertEncoderResolution(
  info: { width: number; height: number } | null,
  expectedWidth: number,
  expectedHeight: number,
  label: string,
): void {
  if (!info) throw new Error(`${label} did not report its active encoder configuration.`);
  if (info.width !== expectedWidth || info.height !== expectedHeight) {
    throw new Error(
      `${label} encoder resolution mismatch: expected ${expectedWidth}x${expectedHeight}, ` +
      `received ${info.width}x${info.height}.`,
    );
  }
}

export function cleanupExportResources(): void {
  _flipBuf = null;
  if (_rtReadbackCanvas) {
    _rtReadbackCanvas.width = 1;
    _rtReadbackCanvas.height = 1;
    _rtReadbackCanvas = null;
    _rtReadbackCtx = null;
    _rtReadbackW = 0;
    _rtReadbackH = 0;
  }
}

function drawFrameToStagingCanvas(params: {
  stagingCanvas: HTMLCanvasElement;
  targetWidth: number;
  targetHeight: number;
  liveCanvas: HTMLCanvasElement | null;
  getReadFramePixels?: () => { data: Uint8Array; width: number; height: number } | null;
  codecSafety?: 'sharp' | 'balanced' | 'smooth';
  flashOverlay?: ExportFlashOverlayFrame | null;
}): void {
  const { stagingCanvas, targetWidth, targetHeight, liveCanvas, getReadFramePixels, codecSafety = 'sharp', flashOverlay } = params;
  const ctx = stagingCanvas.getContext('2d', { alpha: false, willReadFrequently: false, colorSpace: EXPORT_COLOR_CONTRACT.outputSpace } as any) as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Failed to get 2D staging context for video export.');

  ctx.clearRect(0, 0, targetWidth, targetHeight);
  // AUTHORITATIVE PRIMARY SOURCE: the presentation canvas is the final,
  // display-referred sRGB image produced by Three.js. This is the same capture
  // contract used by Visual Mood Labs and by BLENDCRAFT's corrected PNG path.
  // It avoids reinterpreting raw render-target bytes through ImageData.
  if (liveCanvas && liveCanvas.width > 1 && liveCanvas.height > 1) {
    const sameSize = liveCanvas.width === targetWidth && liveCanvas.height === targetHeight;
    ctx.imageSmoothingEnabled = !sameSize;
    if (!sameSize) ctx.imageSmoothingQuality = 'high';
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(liveCanvas, 0, 0, liveCanvas.width, liveCanvas.height, 0, 0, targetWidth, targetHeight);
    ctx.globalCompositeOperation = 'source-over';
    applyCodecSafetyResolve(ctx, targetWidth, targetHeight, codecSafety);
    applyFlashOverlay(ctx, targetWidth, targetHeight, flashOverlay);
    return;
  }

  // Last-resort compatibility fallback for hosts where the presentation
  // canvas cannot be obtained. Production WebCodecs exports must normally
  // take the branch above.
  const frame = getReadFramePixels?.();
  if (frame && frame.data.length === frame.width * frame.height * 4) {
    const flipped = flipRgbaBuffer(frame.data, frame.width, frame.height);
    if (!_rtReadbackCanvas || _rtReadbackW !== frame.width || _rtReadbackH !== frame.height) {
      _rtReadbackCanvas = document.createElement('canvas');
      _rtReadbackCanvas.width = frame.width;
      _rtReadbackCanvas.height = frame.height;
      _rtReadbackCtx = _rtReadbackCanvas.getContext('2d', { alpha: false, colorSpace: EXPORT_COLOR_CONTRACT.outputSpace } as any) as CanvasRenderingContext2D | null;
      _rtReadbackW = frame.width;
      _rtReadbackH = frame.height;
    }
    if (!_rtReadbackCtx) throw new Error('Failed to create raw-readback compatibility canvas.');
    _rtReadbackCtx.putImageData(new ImageData(toImageDataArray(flipped), frame.width, frame.height), 0, 0);
    const sameSize = frame.width === targetWidth && frame.height === targetHeight;
    ctx.imageSmoothingEnabled = !sameSize;
    if (!sameSize) ctx.imageSmoothingQuality = 'high';
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(_rtReadbackCanvas, 0, 0, frame.width, frame.height, 0, 0, targetWidth, targetHeight);
    ctx.globalCompositeOperation = 'source-over';
    applyCodecSafetyResolve(ctx, targetWidth, targetHeight, codecSafety);
    applyFlashOverlay(ctx, targetWidth, targetHeight, flashOverlay);
    return;
  }

  throw new Error('No canvas source available for frame capture. Check liveCanvas and getReadFramePixels.');
}

function captureCanvasLoopSample(canvas: HTMLCanvasElement): LoopFrameSample | null {
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!ctx || canvas.width <= 0 || canvas.height <= 0) return null;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    data: new Uint8Array(image.data),
    width: image.width,
    height: image.height,
  };
}

function applyFlashOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  overlay?: ExportFlashOverlayFrame | null
): void {
  if (!overlay || overlay.opacity <= 0.001) return;
  const alpha = Math.max(0, Math.min(1, overlay.opacity));
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = overlay.color || '#ffffff';
  const pos = overlay.position || 'full';
  if (pos === 'topbottom') {
    ctx.fillRect(0, 0, width, height * 0.5);
    ctx.fillRect(0, height * 0.5, width, height * 0.5);
  } else if (pos === 'sides') {
    ctx.fillRect(0, 0, width * 0.5, height);
    ctx.fillRect(width * 0.5, 0, width * 0.5, height);
  } else if (pos === 'corners' || pos === 'cornersAlt') {
    const r = Math.max(width, height) * 0.35;
    const corners: Array<[number, number]> = [[0,0],[width,0],[width,height],[0,height]];
    for (const [x, y] of corners) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, overlay.color || '#ffffff');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    }
  } else {
    const g = ctx.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.55);
    g.addColorStop(0, overlay.color || '#ffffff');
    g.addColorStop(0.55, overlay.color || '#ffffff');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

function applyCodecSafetyResolve(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mode: 'sharp' | 'balanced' | 'smooth'
): void {
  if (mode === 'sharp') return;
  const alpha = mode === 'smooth' ? 0.18 : 0.08;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Tiny self-blit resolve. It damps codec-ringing on extreme dither while keeping
  // shape edges intact. Disabled by default via mode='sharp'.
  ctx.drawImage(ctx.canvas, -0.35, 0, width, height);
  ctx.drawImage(ctx.canvas, 0.35, 0, width, height);
  ctx.restore();
}

async function exportWebMWithMediaRecorderFallback(options: {
  canvas: HTMLCanvasElement;
  renderFrameAtTime: DeterministicVideoFrameRenderer;
  fps: number;
  durationMs: number;
  filename: string;
  quality?: VideoQuality;
  width?: number;
  height?: number;
  getLiveCanvas?: () => HTMLCanvasElement | null;
  getReadFramePixels?: () => { data: Uint8Array; width: number; height: number } | null;
  setExportSize?: (width: number, height: number) => void;
  restoreSize?: () => void;
  codecSafety?: 'sharp' | 'balanced' | 'smooth';
  getFlashOverlayFrame?: (time: number) => ExportFlashOverlayFrame | null;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}): Promise<void> {
  throwIfExportAborted(options.signal);
  const { renderFrameAtTime, fps, durationMs, filename, quality = 'high', onProgress } = options;
  const targetWidth = Math.max(2, Math.round(options.width || options.canvas.width));
  const targetHeight = Math.max(2, Math.round(options.height || options.canvas.height));
  const mimeType = pickBestVideoMimeType();
  if (!mimeType) throw new Error('WebM not supported. Try Chrome or Firefox.');
  const liveCanvas = options.getLiveCanvas?.() ?? options.canvas;
  const clampedFps = Math.max(24, Math.min(60, fps));
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * clampedFps));
  const bitrate = VIDEO_QUALITY_PRESETS[quality].bitrate(targetWidth, targetHeight);
  const offscreen = document.createElement('canvas');
  offscreen.width = targetWidth;
  offscreen.height = targetHeight;
  options.setExportSize?.(targetWidth, targetHeight);
  const stream = offscreen.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  if (!track) throw new Error('Failed to create video track.');
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
  recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunks.push(e.data); };
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = (event) => reject((event as ErrorEvent).error ?? new Error('MediaRecorder error'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });
  recorder.start();
  try {
  await waitForNextPaint();
  for (let i = 0; i < totalFrames; i++) {
    throwIfExportAborted(options.signal);
    const t = i / clampedFps;
    await renderFrameAtTime(t, undefined);
    drawFrameToStagingCanvas({
      stagingCanvas: offscreen,
      targetWidth,
      targetHeight,
      liveCanvas,
      getReadFramePixels: options.getReadFramePixels,
      codecSafety: options.codecSafety || 'sharp',
      flashOverlay: options.getFlashOverlayFrame?.(t) ?? null,
    });
    track.requestFrame?.();
    if (i % Math.max(1, Math.floor(totalFrames / 20)) === 0 || i === totalFrames - 1) {
      onProgress?.(5 + ((i + 1) / totalFrames) * 85, `Frame ${i + 1}/${totalFrames}`);
    }
  }
  onProgress?.(92, 'Finalizing...');
  await settleRenderedCanvas(1);
  throwIfExportAborted(options.signal);
  recorder.stop();
  const blob = await stopped;
  assertUsableVideoBlob(blob, 'MediaRecorder WebM fallback');
  stream.getTracks().forEach(t => t.stop());
  options.restoreSize?.();
  const preparingFile = getExportFinalizationProgress('preparing-file');
  onProgress?.(preparingFile.progress, preparingFile.message);
  await waitForNextPaint();
  const exportingFile = getExportFinalizationProgress('exporting-file');
  onProgress?.(exportingFile.progress, exportingFile.message);
  await handoffExportDownload(() => saveAs(blob, filename));
  const cleanupStage = getExportFinalizationProgress('cleanup');
  onProgress?.(cleanupStage.progress, cleanupStage.message);
  cleanupExportResources();
  await waitForNextPaint();
  const completeStage = getExportFinalizationProgress('complete');
  onProgress?.(completeStage.progress, completeStage.message);
  } catch (error) {
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch {}
    stream.getTracks().forEach(t => t.stop());
    options.restoreSize?.();
    cleanupExportResources();
    throw error;
  }
}

async function exportMP4WithMediaRecorderFallback(options: {
  canvas: HTMLCanvasElement;
  renderFrameAtTime: DeterministicVideoFrameRenderer;
  fps: number;
  durationMs: number;
  filename: string;
  quality?: VideoQuality;
  width?: number;
  height?: number;
  getLiveCanvas?: () => HTMLCanvasElement | null;
  getReadFramePixels?: () => { data: Uint8Array; width: number; height: number } | null;
  setExportSize?: (width: number, height: number) => void;
  restoreSize?: () => void;
  codecSafety?: 'sharp' | 'balanced' | 'smooth';
  getFlashOverlayFrame?: (time: number) => ExportFlashOverlayFrame | null;
  onProgress?: ProgressCallback;
}): Promise<void> {
  const mimeType = pickBestMP4MimeType();
  if (!mimeType) throw new Error('No video encoder available. Try Chrome, Edge, or Safari.');
  const outputFilename = mimeType.startsWith('video/mp4') ? options.filename.replace(/\.webm$/, '.mp4') : options.filename.replace(/\.mp4$/, '.webm');
  await exportWebMWithMediaRecorderFallback({ ...options, filename: outputFilename });
}

/**
 * PHASE 7.3E FOUNDATION FREEZE (7.3E.9)
 * --------------------------------------
 * This timestamped WebCodecs path is the production WebM authority. Preserve:
 * explicit frame timestamps/durations, deterministic renderAtTime sampling,
 * one final encoder.flush(), WebM muxing, cancellation, and MediaRecorder only
 * as a capability fallback. Future work must be incremental and must not route
 * normal WebM export back through real-time captureStream recording.
 */
export async function exportWebMFromCanvas(options: {
  canvas: HTMLCanvasElement;
  renderFrameAtTime: DeterministicVideoFrameRenderer;
  fps: number;
  durationMs: number;
  filename: string;
  quality?: VideoQuality;
  width?: number;
  height?: number;
  getLiveCanvas?: () => HTMLCanvasElement | null;
  getReadFramePixels?: () => { data: Uint8Array; width: number; height: number } | null;
  setExportSize?: (width: number, height: number) => void;
  restoreSize?: () => void;
  codecSafety?: 'sharp' | 'balanced' | 'smooth';
  getFlashOverlayFrame?: (time: number) => ExportFlashOverlayFrame | null;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
  /**
   * STAGE 2.8.4: when loop lock is on, render one extra frame at the wrap
   * point and pixel-diff it against frame 0 — turning "this should loop" into
   * a measured number. Reported via onLoopVerified.
   */
  verifyLoop?: boolean;
  onLoopVerified?: (result: LoopVerificationResult) => void;
}): Promise<void> {
  throwIfExportAborted(options.signal);
  const memoryBaseline = captureExportMemorySnapshot();

  const {
    renderFrameAtTime,
    fps,
    durationMs,
    filename,
    quality = 'high',
    onProgress,
  } = options;

  // STAGE 2.8.4: frame-0 reference for the loop check (see loopVerification.ts).
  let loopReference: LoopFrameSample | null = null;
  let encodedFrameReference: ExportFrameSample | null = null;

  const phaseTimers = { renderMs: 0, encodeMs: 0, finalizeMs: 0, startedAt: performance.now() };
  const finalizationTimers = createExportFinalizationTimings();

  const targetWidth = Math.max(2, Math.round(options.width || options.canvas.width));
  const targetHeight = Math.max(2, Math.round(options.height || options.canvas.height));
  const sourceScale = getWebMSourceScale(quality);
  const sourceWidth = Math.max(targetWidth, Math.round((targetWidth * sourceScale) / 2) * 2);
  const sourceHeight = Math.max(targetHeight, Math.round((targetHeight * sourceScale) / 2) * 2);
  if (durationMs <= 0 || !Number.isFinite(durationMs)) {
    throw new Error(`Invalid duration: ${durationMs}ms`);
  }

  const clampedFps = Math.max(24, Math.min(60, Math.round(fps || 30)));
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * clampedFps));
  const bitrate = VIDEO_QUALITY_PRESETS[quality].bitrate(targetWidth, targetHeight);
  const codecSafety = quality === 'standard' ? (options.codecSafety || 'smooth') : 'sharp';

  const diagnostics = {
    fps: clampedFps,
    durationMs,
    totalFrames,
    width: targetWidth,
    height: targetHeight,
    sourceWidth,
    sourceHeight,
    bitrate,
    quality,
    captureSource: `live WebGL canvas -> ${targetWidth}\u00d7${targetHeight} sRGB staging canvas -> Mediabunny CanvasSource`,
    firstFrameTime: 0,
    lastFrameTime: (totalFrames - 1) / clampedFps,
    cleanupCompleted: false,
  };

  if (import.meta.env?.DEV) console.info('[BLENDCRAFT export:mediabunny] WebM start', diagnostics);
  onProgress?.(
    0,
    `Preparing ${(durationMs / 1000).toFixed(1)}s \u00b7 ${clampedFps}fps \u00b7 ${totalFrames} frames \u00b7 ${targetWidth}\u00d7${targetHeight} \u00b7 ${VIDEO_QUALITY_PRESETS[quality].label}...`
  );

  const stagingCanvas = document.createElement('canvas');
  stagingCanvas.width = targetWidth;
  stagingCanvas.height = targetHeight;

  let fallbackUsed = false;
  let downloadHandoffComplete = false;
  let encoderConfigInfo: {
    codec: string;
    hardwareAcceleration?: string;
    width: number;
    height: number;
    latencyMode?: 'quality' | 'realtime';
    policy: string;
  } | null = null;

  try {
    if (!isWebCodecsAvailable()) {
      fallbackUsed = true;
      if (import.meta.env?.DEV) console.warn('[BLENDCRAFT export:mediabunny] WebCodecs unavailable; using MediaRecorder fallback.');
      await exportWebMWithMediaRecorderFallback(options);
      return;
    }

    const encodable = await canEncodeContainer('webm', targetWidth, targetHeight, clampedFps);
    if (!encodable) {
      fallbackUsed = true;
      if (import.meta.env?.DEV) console.warn('[BLENDCRAFT export:mediabunny] WebM/VP9 not encodable in this environment; using MediaRecorder fallback.');
      await exportWebMWithMediaRecorderFallback(options);
      return;
    }

    // Use the live WebGL context at exact export dimensions for now. This is the
    // stable path in the current Figma/Chromium runtime because all masks/textures
    // already live in that context. The restore block below is the authority.
    options.setExportSize?.(sourceWidth, sourceHeight);
    await waitForNextPaint();

    const result = await encodeVideoWithMediabunny({
      stagingCanvas,
      width: targetWidth,
      height: targetHeight,
      fps: clampedFps,
      totalFrames,
      bitrate,
      container: 'webm',
      keyFrameIntervalSeconds: keyFrameIntervalSecondsForQuality(quality, clampedFps),
      latencyMode: latencyModeForQuality(quality),
      signal: options.signal,
      onProgress,
      onEncoderConfig: (info) => { encoderConfigInfo = info; },
      drawFrame: async (i, t) => {
        const renderedTimeline = await renderFrameAtTime(t, undefined);
        const liveCanvas = options.getLiveCanvas?.() ?? null;
        const presentationReference = i === 0 && liveCanvas
          ? captureExportFrameSample(liveCanvas)
          : null;

        drawFrameToStagingCanvas({
          stagingCanvas,
          targetWidth,
          targetHeight,
          liveCanvas,
          getReadFramePixels: options.getReadFramePixels,
          codecSafety,
          flashOverlay: options.getFlashOverlayFrame?.(t) ?? null,
        });

        // Snapshot the exact canvas sent to CanvasSource. Loop certification
        // now measures the production video input instead of a separate raw
        // framebuffer path with different color semantics.
        if (i === 0 && options.verifyLoop) {
          loopReference = captureCanvasLoopSample(stagingCanvas);
        }
        if (i === 0) {
          encodedFrameReference = captureExportFrameSample(stagingCanvas);
          if (presentationReference && encodedFrameReference) {
            const captureFidelity = compareExportFrameSamples(presentationReference, encodedFrameReference);
            try { (window as unknown as Record<string, unknown>).__blendcraftLastCaptureFidelity = captureFidelity; } catch { /* diagnostics only */ }
            if (!captureFidelity.passed) {
              console.warn('[Export] Presentation-to-staging color drift detected:', captureFidelity);
            }
          }
        }
        return renderedTimeline;
      },
    });

    phaseTimers.renderMs = result.renderMs;
    phaseTimers.encodeMs = result.encodeMs;
    phaseTimers.finalizeMs = result.finalizeMs;
    assertEncoderResolution(encoderConfigInfo, targetWidth, targetHeight, 'WebM export');

    if (import.meta.env?.DEV && encoderConfigInfo) {
      console.info('[BLENDCRAFT export:mediabunny] Encoder config', encoderConfigInfo);
    }

    // Loop verification: render one extra frame at the wrap point and
    // pixel-diff it against the frame-0 reference captured above.
    if (options.verifyLoop && loopReference) {
      try {
        onProgress?.(93, 'Verifying loop...');
        const wrapTimeSeconds = totalFrames / clampedFps;
        await renderFrameAtTime(wrapTimeSeconds, undefined);
        drawFrameToStagingCanvas({
          stagingCanvas,
          targetWidth,
          targetHeight,
          liveCanvas: options.getLiveCanvas?.() ?? null,
          getReadFramePixels: options.getReadFramePixels,
          codecSafety,
          flashOverlay: options.getFlashOverlayFrame?.(wrapTimeSeconds) ?? null,
        });
        const wrapFrame = captureCanvasLoopSample(stagingCanvas);
        const loopResult = compareLoopFrames(loopReference, wrapFrame);
        console.info('[Export] ' + describeLoopResult(loopResult), loopResult);
        options.onLoopVerified?.(loopResult);
      } catch (loopError) {
        console.warn('[Export] Loop verification skipped:', loopError);
      }
    }

    throwIfExportAborted(options.signal);
    const preparingFile = getExportFinalizationProgress('preparing-file');
    onProgress?.(preparingFile.progress, preparingFile.message);
    await waitForNextPaint();
    const blobStartedAt = performance.now();
    const blob = result.blob;
    finalizationTimers.blobMs = performance.now() - blobStartedAt;
    finalizationTimers.encoderDrainAndMuxMs = phaseTimers.finalizeMs;

    // Verify the ACTUAL exported file's duration, not just the numbers fed
    // into the encoder — closes a false-PASS risk where a certification step
    // trusted its own planned input instead of the real artifact.
    const durationCheck = await verifyExportedArtifactDuration(
      blob,
      durationMs,
      clampedFps,
      targetWidth,
      targetHeight,
    );
    if (durationCheck.checked && !durationCheck.withinTolerance) {
      console.warn('[Export] Exported WebM duration mismatch:', durationCheck);
    }
    if (durationCheck.checked && durationCheck.resolutionMatches === false) {
      console.error('[Export] Exported WebM resolution mismatch:', durationCheck);
    }

    const frameFidelity = await verifyExportedFrameFidelity(blob, encodedFrameReference);
    if (!frameFidelity.checked) {
      console.warn('[Export] WebM decoded-frame fidelity check unavailable:', frameFidelity.reason);
    } else if (!frameFidelity.passed) {
      console.warn('[Export] WebM decoded frame differs from the CanvasSource input:', frameFidelity);
    } else if (import.meta.env?.DEV) {
      console.info('[Export] WebM decoded-frame fidelity verified:', frameFidelity);
    }
    try { (window as unknown as Record<string, unknown>).__blendcraftLastFrameFidelity = frameFidelity; } catch { /* diagnostics only */ }

    throwIfExportAborted(options.signal);
    const exportingFile = getExportFinalizationProgress('exporting-file');
    onProgress?.(exportingFile.progress, exportingFile.message);
    finalizationTimers.downloadHandoffMs = await handoffExportDownload(() => saveAs(blob, filename));
    downloadHandoffComplete = true;

    const totalMs = performance.now() - phaseTimers.startedAt;
    const pct = (ms: number) => `${((ms / Math.max(1, totalMs)) * 100).toFixed(0)}%`;
    const timing = {
      totalSec: +(totalMs / 1000).toFixed(1),
      renderSec: +(phaseTimers.renderMs / 1000).toFixed(1),
      encodeWaitSec: +(phaseTimers.encodeMs / 1000).toFixed(1),
      flushSec: 0,
      muxSec: 0,
      encoderDrainAndMuxSec: +(finalizationTimers.encoderDrainAndMuxMs / 1000).toFixed(3),
      blobSec: +(finalizationTimers.blobMs / 1000).toFixed(3),
      downloadHandoffSec: +(finalizationTimers.downloadHandoffMs / 1000).toFixed(3),
      frames: totalFrames,
      msPerFrame: +(totalMs / Math.max(1, totalFrames)).toFixed(0),
      breakdown: `render ${pct(phaseTimers.renderMs)} \u00b7 encode ${pct(phaseTimers.encodeMs)} \u00b7 encoder drain + mux ${pct(phaseTimers.finalizeMs)} \u00b7 blob ${pct(finalizationTimers.blobMs)} \u00b7 download ${pct(finalizationTimers.downloadHandoffMs)}`,
      encoderPolicy: (encoderConfigInfo as { policy: string } | null)?.policy,
      finalization: { ...finalizationTimers },
      artifactDuration: durationCheck,
      frameFidelity,
      timelineCertification: result.timelineCertification,
    };
    console.info('[Export] Timing:', timing);
    try { (window as unknown as Record<string, unknown>).__exportTiming = timing; } catch { /* diag */ }
    try { (window as unknown as Record<string, unknown>).__blendcraftLastTimelineCertification = result.timelineCertification; } catch { /* diagnostics only */ }
    recordExportTiming(timing);
  } catch (error) {
    if (!fallbackUsed) {
      recordExportFailure(error);
      const message = error instanceof Error ? error.message : String(error);
      onProgress?.(0, `Video encoder failed \u2014 recovering export${message ? `: ${message}` : ''}`);
    }
    throw error;
  } finally {
    try { options.restoreSize?.(); } catch {}
    cleanupExportResources();

    stagingCanvas.width = 1;
    stagingCanvas.height = 1;

    const cleanupStartedAt = performance.now();
    if (downloadHandoffComplete) {
      const cleanupStage = getExportFinalizationProgress('cleanup');
      onProgress?.(cleanupStage.progress, cleanupStage.message);
      await waitForNextPaint();
    }
    await waitForNextPaint();
    await new Promise<void>((resolve) => {
      const ric = (globalThis as any).requestIdleCallback as undefined | ((cb: () => void, opts?: { timeout: number }) => number);
      if (ric) ric(() => resolve(), { timeout: 250 });
      else setTimeout(resolve, 50);
    });
    finalizationTimers.cleanupMs = performance.now() - cleanupStartedAt;
    const memoryRecovery = verifyExportMemoryRecovery(memoryBaseline, captureExportMemorySnapshot());
    attachLatestExportMemoryRecovery(memoryRecovery);
    diagnostics.cleanupCompleted = true;
    try {
      (window as unknown as Record<string, unknown>).__blendcraftExportMemoryRecovery = memoryRecovery;
    } catch { /* diagnostics only */ }
    if (memoryRecovery.supported && !memoryRecovery.withinLimit) {
      console.warn('[Export] Retained heap exceeded the 15% recovery target:', memoryRecovery);
    }
    if (import.meta.env?.DEV) console.info('[BLENDCRAFT export:mediabunny] WebM cleanup complete', {
      ...diagnostics,
      fallbackUsed,
      memoryRecovery,
    });
  }

  // Success is only reported after cleanup/restore is complete.
  if (downloadHandoffComplete) {
    const completeStage = getExportFinalizationProgress('complete');
    onProgress?.(completeStage.progress, completeStage.message);
  }
}


export async function exportGIFFromCanvas(options: {
  canvas: HTMLCanvasElement;
  renderFrameAtTime: (time: number) => Promise<void>;
  fps: number;
  durationMs: number;
  filename: string;
  quality?: 'low' | 'medium' | 'high' | 'ultra';
  onProgress?: ProgressCallback;
}): Promise<void> {
  const { canvas, renderFrameAtTime, fps, durationMs, filename, quality = 'high', onProgress } = options;

  if (durationMs <= 0 || !Number.isFinite(durationMs)) {
    throw new Error(`Invalid duration: ${durationMs}ms`);
  }

  const GIFConstructor = getGIFConstructor();

  onProgress?.(0, 'Initializing GIF encoder...');

  const clampedFps = Math.max(5, Math.min(15, fps)); // GIF cap: 15fps max

  // FIX GIF crash: hard cap resolution at 720p. GIF encoding keeps ALL frames in RAM
  // simultaneously (gif.js architecture). At 1920x1080, 90 frames = 712MB raw + encoded data
  // = 1.4GB+ total, which crashes the browser tab. 720p = 316MB for 90 frames — manageable.
  // The cap applies to the canvas source; the export canvas is scaled down if needed.
  const GIF_MAX_DIMENSION = 1280; // 720p landscape or 720p portrait
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  const scale = Math.min(1, GIF_MAX_DIMENSION / Math.max(canvasWidth, canvasHeight));
  const gifWidth = Math.round(canvasWidth * scale);
  const gifHeight = Math.round(canvasHeight * scale);

  if (scale < 1) {
    onProgress?.(1, `GIF resolution capped at ${gifWidth}×${gifHeight} (RAM limit)`);
  }

  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * clampedFps));
  const frameDelay = 1000 / clampedFps;
  const gifQuality = mapGIFQuality(quality);

  // FIX GIF crash: workers:0 runs encoding synchronously on the main thread.
  // This is slower than workers:1/2 but is 100% reliable — no web worker spawn,
  // no CORS issues, no silent worker failure. The 90s timeout handles any stall.
  const gif = new GIFConstructor({
    workers: 0,
    quality: gifQuality,
    width: gifWidth,
    height: gifHeight,
    workerScript: '/gif.worker.js',
  });

  if (totalFrames > 300) {
    if (import.meta.env?.DEV) console.warn(`GIF export: ${totalFrames} frames may produce a large file.`);
  }

  // ─── Intermediary 2D canvas ───────────────────────────────────────────────
  // Same fix as WebM: WebGL preserveDrawingBuffer:false means pixel content
  // may be undefined by the time gif.addFrame reads the canvas. Blit to a 2D
  // canvas first so gif.js always gets stable, non-cleared pixel data.
  // Scale to GIF dimensions (may be downscaled from canvas for RAM safety)
  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = gifWidth;
  offscreenCanvas.height = gifHeight;
  const offscreenCtx = offscreenCanvas.getContext('2d');
  if (!offscreenCtx) {
    throw new Error('Failed to create 2D intermediary context for GIF capture.');
  }
  offscreenCtx.imageSmoothingEnabled = true;
  offscreenCtx.imageSmoothingQuality = 'high';

  return new Promise<void>(async (resolve, reject) => {
    // FIX GIF hang: abort after 90s if workers never respond (silent failure).
    const ENCODE_TIMEOUT_MS = 90_000;
    let encodeTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      try { (gif as any).abort?.(); } catch {}
      reject(new Error('GIF encoding timed out. Try a shorter duration or lower FPS.'));
    }, ENCODE_TIMEOUT_MS);
    const clearTimer = () => { if (encodeTimer) { clearTimeout(encodeTimer); encodeTimer = null; } };

    gif.on('progress', (p: number) => {
      onProgress?.(55 + p * 40, `Encoding GIF: ${Math.round(p * 100)}%`);
    });

    gif.on('finished', (blob: Blob) => {
      clearTimer();
      if (import.meta.env?.DEV && blob.size < 1000) console.warn(`GIF blob suspiciously small (${blob.size} bytes).`);
      onProgress?.(96, 'Saving...');
      saveAs(blob, filename);
      onProgress?.(100, 'GIF export complete!');
      resolve();
    });

    gif.on('error', (error: Error) => {
      clearTimer();
      reject(new Error('GIF encoding failed: ' + error.message));
    });

    try {
      onProgress?.(2, `Rendering ${totalFrames} frames at ${canvas.width}×${canvas.height}...`);

      for (let i = 0; i < totalFrames; i++) {
        const t = i / clampedFps;

        // Render via live renderer
        await renderFrameAtTime(t);

        // EXP-03+05 FIX: removed settleRenderedCanvas(1) and sleep(1) inside the frame loop.
        // settleRenderedCanvas adds an extra rAF per frame (unnecessary — renderFrameAtTime
        // already awaits the render). sleep(1) was "for GIF worker scheduling" but the worker
        // runs on a separate thread and doesn't need a main-thread sleep before addFrame.
        // Net saving: ~2+ unnecessary waits per frame = ~300ms saved on a 5s/15fps export.
        offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
        offscreenCtx.drawImage(canvas, 0, 0);

        gif.addFrame(offscreenCanvas, { copy: true, delay: frameDelay });

        if (i % 5 === 0 || i === totalFrames - 1) {
          onProgress?.(5 + ((i + 1) / totalFrames) * 50, `Frame ${i + 1}/${totalFrames}`);
        }

        // Yield every 10 frames to keep UI responsive (replaces per-frame sleep).
        if (i % 10 === 9) await yieldToBrowser();
      }

      onProgress?.(55, 'Rendering GIF...');
      gif.render();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Export as PNG (legacy wrapper for backward compatibility)
 */
export async function exportAsPNG(
  canvas: HTMLCanvasElement,
  filename: string = 'gradient.png',
  customWidth?: number,
  customHeight?: number
): Promise<void> {
  await settleRenderedCanvas(2);

  return new Promise((resolve, reject) => {
    try {
      let exportCanvas = canvas;

      if (
        customWidth &&
        customHeight &&
        (customWidth !== canvas.width || customHeight !== canvas.height)
      ) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = customWidth;
        tempCanvas.height = customHeight;
        const ctx = tempCanvas.getContext('2d');

        if (!ctx) {
          reject(new Error('Failed to create 2D context for resizing'));
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
          canvas,
          0,
          0,
          canvas.width,
          canvas.height,
          0,
          0,
          customWidth,
          customHeight
        );
        exportCanvas = tempCanvas;
      }

      exportCanvas.toBlob((blob) => {
        if (blob) {
          saveAs(blob, filename);
          resolve();
        } else {
          reject(new Error('Failed to create PNG blob'));
        }
      }, 'image/png');
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Export as SVG (raster image embedded in SVG)
 * HONEST LABEL: This is a raster PNG embedded in SVG wrapper
 */
export async function exportAsSVG(
  canvas: HTMLCanvasElement,
  layers: Layer[],
  filename: string = 'gradient.svg'
): Promise<void> {
  try {
    await settleRenderedCanvas(2);

    const dataURL = canvas.toDataURL('image/png');
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${canvas.width}" height="${canvas.height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <!-- Raster image export (WebGL gradients cannot be vectorized) -->
  <image width="${canvas.width}" height="${canvas.height}" xlink:href="${dataURL}"/>
</svg>`;

    const blob = new Blob([svg], { type: 'image/svg+xml' });
    saveAs(blob, filename);
  } catch (error) {
    throw new Error('Failed to export SVG: ' + (error as Error).message);
  }
}

/**
 * Generate CSS gradient code with validation
 * ONLY supports: linear, radial, conic
 * Everything else returns error message
 */
export function generateCSSCode(layers: Layer[]): { code: string; supported: boolean; message?: string } {
  if (layers.length === 0) {
    return {
      code: '',
      supported: false,
      message: 'No layers to export',
    };
  }

  const visibleLayer = layers.find(l => l.visible) || layers[0];
  const gradient = visibleLayer.gradient;
  const cssCompatibleTypes = ['linear', 'radial', 'conic'];

  if (!gradient) {
    return {
      code: '',
      supported: false,
      message: 'The selected layer is media-based and has no CSS gradient specification.',
    };
  }

  if (!cssCompatibleTypes.includes(gradient.type)) {
    return {
      code: `/* Blendcraft Studio CSS gradient spec export */
/* Layer: ${visibleLayer.name} */
/* Not supported: ${gradient.type} gradient */
/* CSS can only recreate linear, radial, and conic gradients. */
/* Textures, masks, animation timing, shader FX, and blend-stack interactions are not included. */
/* Export PNG, WebM, or GIF for full-fidelity output. */`,
      supported: false,
      message: `${gradient.type} is shader-based. CSS export is gradient-spec only and cannot reproduce textures, FX, or animation.`,
    };
  }

  const css = generateCSSGradient(gradient);
  const formattedCSS = `/* Blendcraft Studio CSS gradient spec export */
/* Layer: ${visibleLayer.name} */
/* Includes native CSS gradient syntax only. */
/* Does NOT include textures, masks, shader effects, blend stacks, or animation timing. */
.gradient {
  background: ${css};
  width: 100%;
  height: 100%;
}`;

  return {
    code: formattedCSS,
    supported: true,
    message: 'CSS export is gradient-spec only. It does not recreate textures, FX, masks, or animation.',
  };
}

/**
 * Extract GLSL shader code for current gradient
 * Returns fragment shader + uniforms only (lightweight, reusable)
 */
export function extractShaderCode(layer: Layer): { code: string; uniforms: string } {
  const gradient = layer.gradient;
  if (!gradient) throw new Error('Shader export requires a gradient layer.');
  
  // Generate uniforms block
  const uniforms = `// Uniforms
uniform vec2 resolution;
uniform float time;
uniform vec2 center;
uniform float angle;
uniform float scale;
uniform float intensity;
${gradient.colors.map((c, i) => `uniform vec3 color${i}; // ${c.color}`).join('\n')}
${gradient.colors.map((c, i) => `uniform float position${i}; // ${(c.position * 100).toFixed(1)}%`).join('\n')}
`;
  
  // Fragment shader template (simplified for demonstration)
  const fragmentShader = `// Fragment Shader - ${gradient.type} Gradient
precision highp float;

varying vec2 vUv;

${uniforms}

void main() {
  vec2 uv = vUv;
  
  // Gradient type: ${gradient.type}
  // Add your gradient calculation logic here
  // This is a template - the actual shader is more complex
  
  float t = 0.5; // Gradient position (0.0 to 1.0)
  
  // Color interpolation
  vec3 finalColor = color0;
  
  gl_FragColor = vec4(finalColor, 1.0);
}
`;
  
  return {
    code: fragmentShader,
    uniforms: uniforms,
  };
}

/**
 * Copy CSS gradient code to clipboard
 */
export async function copyCSSToClipboard(layers: Layer[]): Promise<void> {
  try {
    const result = generateCSSCode(layers);
    
    if (!result.supported) {
      throw new Error(result.message || 'CSS export not supported for this gradient type');
    }
    
    await navigator.clipboard.writeText(result.code);
  } catch (error) {
    throw new Error('Failed to copy CSS: ' + (error as Error).message);
  }
}

/**
 * Copy GLSL shader code to clipboard
 */
export async function copyShaderToClipboard(layer: Layer): Promise<void> {
  try {
    const { code, uniforms } = extractShaderCode(layer);
    const fullCode = `${uniforms}\n\n${code}`;
    
    await navigator.clipboard.writeText(fullCode);
  } catch (error) {
    throw new Error('Failed to copy shader code: ' + (error as Error).message);
  }
}

/**
 * Map UI quality setting to GIF.js quality parameter
 * GIF.js quality scale: 1-20 (1 = best/slowest, 20 = fast/lower quality)
 */
function mapGIFQuality(uiQuality: 'low' | 'medium' | 'high' | 'ultra'): number {
  switch (uiQuality) {
    case 'ultra': return 1;   // Maximum quality (slowest encoding)
    case 'high': return 5;    // High quality
    case 'medium': return 10; // Balanced (default)
    case 'low': return 15;    // Fast encoding
    default: return 10;
  }
}

/**
 * Export GIF at exact target resolution — unified with the working exportGIFFromCanvas architecture.
 *
 * PATCHED EXP-01: Added `const GIFConstructor = getGIFConstructor()` — was referencing
 *   the undefined `GIF` and `GIFConstructor` variables, throwing ReferenceError immediately.
 *
 * PATCHED EXP-02: Replaced isolated-renderer + direct WebGL canvas with the live canvas +
 *   2D offscreen blit pattern. gif.js reads pixels synchronously; passing the raw WebGL
 *   canvas meant GPU readback hadn't completed, producing blank frames. Blitting to a 2D
 *   canvas first (same fix as exportGIFFromCanvas) guarantees stable pixel data.
 *
 * PATCHED EXP-05: Removed sleep(1) per frame — the GIF worker runs on a separate thread
 *   and doesn't need a main-thread sleep before addFrame. Also removed settleRenderedCanvas
 *   inside the frame loop; one settle before render is sufficient.
 */
export async function exportGIFDeterministic(options: {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  filename: string;
  quality: 'low' | 'medium' | 'high' | 'ultra';
  renderFrameAtTime: DeterministicRenderCallback;
  getLiveCanvas?: () => HTMLCanvasElement | null;
  getReadFramePixels?: () => { data: Uint8Array; width: number; height: number } | null;
  onProgress?: ProgressCallback;
}): Promise<void> {
  const { width, height, fps, durationMs, filename, quality, renderFrameAtTime, onProgress } = options;

  if (!renderFrameAtTime) throw new Error('renderFrameAtTime callback is required for GIF export');
  if (durationMs <= 0 || !Number.isFinite(durationMs)) {
    throw new Error(`Invalid duration: ${durationMs}ms. Must be positive finite number.`);
  }

  // EXP-01 FIX: call getGIFConstructor() in this scope — was previously referencing
  // undefined module-level `GIF` and `GIFConstructor` variables.
  const GIFConstructor = getGIFConstructor();

  onProgress?.(0, 'Initializing GIF encoder...');

  const clampedFps = Math.max(5, Math.min(30, fps));
  const totalFrames = Math.max(1, Math.ceil((durationMs / 1000) * clampedFps));
  const frameDelay = 1000 / clampedFps;
  const gifQuality = mapGIFQuality(quality);

  if (totalFrames > 300) {
    if (import.meta.env?.DEV) console.warn(`GIF export: ${totalFrames} frames may be large.`);
  }

  // FIX GIF crash: hard cap at 720p (same as exportGIFFromCanvas) + workers:0 reliability
  const GIF_MAX_DIM = 1280;
  const gifScale = Math.min(1, GIF_MAX_DIM / Math.max(width, height));
  const gifW = Math.round(width * gifScale);
  const gifH = Math.round(height * gifScale);
  if (gifScale < 1) {
    onProgress?.(1, `GIF resolution capped at ${gifW}×${gifH} (RAM limit)`);
  }

  const gif = new GIFConstructor({
    workers: 0,
    quality: gifQuality,
    width: gifW,
    height: gifH,
    workerScript: '/gif.worker.js',
  });

  // EXP-02 FIX: resolve the live canvas for blitting — same approach as exportGIFFromCanvas.
  // gif.js reads pixels synchronously on addFrame(); passing a WebGL canvas directly means
  // the GPU blit may not be flushed. We blit to a 2D canvas first, which is always CPU-readable.
  const liveCanvas: HTMLCanvasElement | null =
    options.getLiveCanvas?.() ||
    (window as any).__blendcraftLiveCanvas ||
    document.querySelector('canvas[data-blendcraft-live]') ||
    document.querySelector('canvas');

  // Pre-allocate the 2D blit canvas once — reused each frame to avoid GC pressure.
  // Scale blit canvas to GIF dimensions (may be smaller than export dims for RAM safety)
  const blitCanvas = document.createElement('canvas');
  blitCanvas.width = gifW;
  blitCanvas.height = gifH;
  const blitCtx = blitCanvas.getContext('2d', { alpha: false, willReadFrequently: false })!;
  blitCtx.imageSmoothingEnabled = true;
  blitCtx.imageSmoothingQuality = 'high';

    return new Promise<void>(async (resolve, reject) => {
    // FIX GIF hang: abort after 90s if workers never respond.
    const ENCODE_TIMEOUT_MS = 90_000;
    let encodeTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      try { (gif as any).abort?.(); } catch {}
      reject(new Error('GIF encoding timed out. Try a shorter duration or lower FPS.'));
    }, ENCODE_TIMEOUT_MS);
    const clearTimer = () => { if (encodeTimer) { clearTimeout(encodeTimer); encodeTimer = null; } };

    gif.on('progress', (p: number) => {
      onProgress?.(55 + p * 40, `Encoding GIF: ${Math.round(p * 100)}%`);
    });

    gif.on('finished', (blob: Blob) => {
      clearTimer();
      if (import.meta.env?.DEV && blob.size < 1000) console.warn(`GIF blob suspiciously small (${blob.size} bytes).`);
      onProgress?.(96, 'Saving...');
      saveAs(blob, filename);
      onProgress?.(100, 'GIF export complete!');
      resolve();
    });

    gif.on('error', (error: Error) => {
      clearTimer();
      reject(new Error('GIF encoding failed: ' + error.message));
    });

    (async () => {
      try {
        onProgress?.(2, `Rendering ${totalFrames} frames at ${width}×${height}...`);

        for (let i = 0; i < totalFrames; i++) {
          const t = i / clampedFps;

          // Render frame via live renderer (same path as video export)
          await renderFrameAtTime(t, undefined);

          // EXP-02 FIX: blit WebGL → 2D canvas before addFrame.
          // EXP-05 FIX: no sleep(1) or settleRenderedCanvas inside the loop —
          // the live canvas is already stable after renderFrameAtTime resolves.
          blitCtx.clearRect(0, 0, gifW, gifH);
          if (liveCanvas) {
            blitCtx.drawImage(liveCanvas, 0, 0, liveCanvas.width, liveCanvas.height, 0, 0, gifW, gifH);
          } else {
            // Fallback: read from GPU render target and flip Y
            const frame = options.getReadFramePixels?.();
            if (frame && frame.data.length === frame.width * frame.height * 4) {
              const flipped = flipRgbaBuffer(frame.data, frame.width, frame.height);
              blitCtx.putImageData(new ImageData(toImageDataArray(flipped), frame.width, frame.height), 0, 0);
            }
          }

          gif.addFrame(blitCanvas, { copy: true, delay: frameDelay });

          if (i % 5 === 0 || i === totalFrames - 1) {
            onProgress?.(5 + ((i + 1) / totalFrames) * 50, `Frame ${i + 1}/${totalFrames}`);
          }

          // Yield every 10 frames to keep the page responsive without excess overhead.
          // EXP-05: replaces the previous per-frame sleep(1) — 10x less yielding.
          if (i % 10 === 9) await yieldToBrowser();
        }

        onProgress?.(55, 'Encoding GIF...');
        gif.render();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}

/**
 * Export as GIF using gif.js with deterministic frame capture (LEGACY WRAPPER)
 * Provided for backward compatibility - prefer exportGIFDeterministic for new code
 */
export async function exportAsGIF(
  canvas: HTMLCanvasElement,
  duration: number = 3000,
  fps: number = 30,
  filename: string = 'gradient.gif',
  onProgress?: ProgressCallback,
  onRenderFrame?: DeterministicRenderCallback,
  quality: 'low' | 'medium' | 'high' | 'ultra' = 'high'
): Promise<void> {
  // If no render callback, this is legacy usage - throw error
  if (!onRenderFrame) {
    throw new Error('exportAsGIF requires renderFrameAtTime callback. Use exportGIFDeterministic instead.');
  }
  
  // Forward to deterministic export
  return exportGIFDeterministic({
    width: canvas.width,
    height: canvas.height,
    fps,
    durationMs: duration,
    filename,
    quality,
    renderFrameAtTime: onRenderFrame,
    onProgress
  });
}

/**
 * Export as WebM video (legacy wrapper)
 */
export async function exportAsWebM(
  canvas: HTMLCanvasElement,
  duration: number = 5000,
  fps: number = 30,
  filename: string = 'gradient.webm',
  onProgress?: ProgressCallback,
  onRenderFrame?: DeterministicRenderCallback
): Promise<void> {
  if (!onRenderFrame) {
    throw new Error('exportAsWebM requires a deterministic renderFrameAtTime callback.');
  }
  return exportWebMFromCanvas({
    canvas,
    renderFrameAtTime: onRenderFrame,
    fps,
    durationMs: duration,
    filename,
    quality: 'high',
    width: canvas.width,
    height: canvas.height,
    getLiveCanvas: () => canvas,
    onProgress,
  });
}

/**
 * Export MP4 video using the same isolated-renderer frame pipeline as WebM.
 * Uses native MediaRecorder with H.264/MP4 if supported (Chrome, Safari, Edge),
 * falls back to VP9/WebM with .mp4 extension if not.
 *
 * Caller must call api.pauseAnimation?.() before and api.resumeAnimation?.() after.
 */
export async function exportMP4FromCanvas(options: {
  canvas: HTMLCanvasElement;
  renderFrameAtTime: DeterministicVideoFrameRenderer;
  fps: number;
  durationMs: number;
  filename: string;
  quality?: VideoQuality;
  width?: number;
  height?: number;
  getLiveCanvas?: () => HTMLCanvasElement | null;
  getReadFramePixels?: () => { data: Uint8Array; width: number; height: number } | null;
  setExportSize?: (w: number, h: number) => void;
  restoreSize?: () => void;
  codecSafety?: 'sharp' | 'balanced' | 'smooth';
  getFlashOverlayFrame?: (time: number) => ExportFlashOverlayFrame | null;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}): Promise<void> {
  throwIfExportAborted(options.signal);
  const exportStartedAt = performance.now();
  const { renderFrameAtTime, fps, durationMs, filename, quality = 'high', onProgress } = options;
  const targetWidth = Math.max(2, Math.round(options.width || options.canvas.width));
  const targetHeight = Math.max(2, Math.round(options.height || options.canvas.height));
  if (durationMs <= 0 || !Number.isFinite(durationMs)) throw new Error(`Invalid duration: ${durationMs}ms`);

  const clampedFps = Math.max(24, Math.min(60, fps));
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * clampedFps));
  // MP4_QUALITY_PRESETS carries the higher bitrates smooth gradients need
  // under H.264 to avoid banding — and matches the export panel summary.
  const bitrate = MP4_QUALITY_PRESETS[quality].bitrate(targetWidth, targetHeight);

  // Resize renderer to export dimensions for full-res frames
  options.setExportSize?.(targetWidth, targetHeight);

  if (!isWebCodecsAvailable()) {
    try {
      await exportMP4WithMediaRecorderFallback(options);
    } finally {
      options.restoreSize?.();
    }
    return;
  }

  // MP4-primary policy: probe H.264 capability BEFORE committing to a full
  // render pass. Mediabunny's canEncodeVideo() queries the browser's real
  // WebCodecs support directly, replacing a hand-rolled AVC profile x level
  // negotiation table that had to be manually extended every time a new
  // rejection surfaced (e.g. the avc1.42001f Baseline-profile bug).
  const h264Encodable = await canEncodeContainer('mp4', targetWidth, targetHeight, clampedFps);
  if (!h264Encodable) {
    if (import.meta.env?.DEV) console.warn('[BLENDCRAFT export:mediabunny] H.264 not encodable in this environment — falling back to WebM (VP9).');
    onProgress?.(0, 'H.264 unavailable — exporting as WebM (VP9)...');
    const webmFilename = filename.replace(/\.mp4$/i, '.webm');
    (options as any).__fellBackToWebM = true;
    try {
      await exportWebMFromCanvas({ ...options, filename: webmFilename });
    } finally {
      options.restoreSize?.();
    }
    return;
  }

  const liveCanvas: HTMLCanvasElement | null =
    options.getLiveCanvas?.() ||
    (window as any).__blendcraftLiveCanvas ||
    document.querySelector('canvas[data-blendcraft-live]') ||
    document.querySelector('canvas');

  const stagingCanvas = document.createElement('canvas');
  stagingCanvas.width = targetWidth;
  stagingCanvas.height = targetHeight;

  onProgress?.(0, `Encoding ${totalFrames} frames (MP4/H.264)...`);
  let encodedFrameReference: ExportFrameSample | null = null;
  let cleanupMs = 0;
  let encoderConfigInfo: {
    codec: string;
    hardwareAcceleration?: string;
    width: number;
    height: number;
    latencyMode?: 'quality' | 'realtime';
    policy: string;
  } | null = null;

  try {
    const result = await encodeVideoWithMediabunny({
      stagingCanvas,
      width: targetWidth,
      height: targetHeight,
      fps: clampedFps,
      totalFrames,
      bitrate,
      container: 'mp4',
      keyFrameIntervalSeconds: keyFrameIntervalSecondsForQuality(quality, clampedFps),
      latencyMode: latencyModeForQuality(quality),
      signal: options.signal,
      onProgress,
      onEncoderConfig: (info) => { encoderConfigInfo = info; },
      drawFrame: async (i, t) => {
        const renderedTimeline = await renderFrameAtTime(t, undefined);
        const presentationReference = i === 0 && liveCanvas
          ? captureExportFrameSample(liveCanvas)
          : null;
        drawFrameToStagingCanvas({
          stagingCanvas,
          targetWidth,
          targetHeight,
          liveCanvas,
          getReadFramePixels: options.getReadFramePixels,
          codecSafety: options.codecSafety || 'sharp',
          flashOverlay: options.getFlashOverlayFrame?.(t) ?? null,
        });
        if (i === 0) {
          encodedFrameReference = captureExportFrameSample(stagingCanvas);
          if (presentationReference && encodedFrameReference) {
            const captureFidelity = compareExportFrameSamples(presentationReference, encodedFrameReference);
            try { (window as unknown as Record<string, unknown>).__blendcraftLastCaptureFidelity = captureFidelity; } catch { /* diagnostics only */ }
            if (!captureFidelity.passed) {
              console.warn('[Export] Presentation-to-staging color drift detected:', captureFidelity);
            }
          }
        }
        return renderedTimeline;
      },
    });

    assertUsableVideoBlob(result.blob, 'MP4 export');
    assertEncoderResolution(encoderConfigInfo, targetWidth, targetHeight, 'MP4 export');

    // Delivery is the production-critical path. Hand the completed artifact to
    // the browser before running nonessential duration/fidelity self-decodes.
    const preparingFile = getExportFinalizationProgress('preparing-file');
    onProgress?.(preparingFile.progress, preparingFile.message);
    await waitForNextPaint();
    const downloadHandoffMs = await handoffExportDownload(
      () => saveAs(result.blob, filename.replace(/\.webm$/, '.mp4')),
    );
    const deliveredAt = performance.now();
    onProgress?.(100, 'MP4 export complete!');

    // Diagnostics intentionally run after download handoff and do not block the
    // user's file. Each stage is measured independently and published when the
    // checks complete so a future stall has an exact owner.
    void (async () => {
      const durationStartedAt = performance.now();
      const durationCheck = await verifyExportedArtifactDuration(
        result.blob,
        durationMs,
        clampedFps,
        targetWidth,
        targetHeight,
      );
      const durationCheckMs = performance.now() - durationStartedAt;
      if (durationCheck.checked && !durationCheck.withinTolerance) {
        console.warn('[Export] Exported MP4 duration mismatch:', durationCheck);
      }
      if (durationCheck.checked && durationCheck.resolutionMatches === false) {
        console.error('[Export] Exported MP4 resolution mismatch:', durationCheck);
      }

      const fidelityStartedAt = performance.now();
      const frameFidelity = await verifyExportedFrameFidelity(result.blob, encodedFrameReference);
      const fidelityCheckMs = performance.now() - fidelityStartedAt;
      if (!frameFidelity.checked) {
        console.warn('[Export] MP4 decoded-frame fidelity check unavailable:', frameFidelity.reason);
      } else if (!frameFidelity.passed) {
        console.warn('[Export] MP4 decoded frame differs from the CanvasSource input:', frameFidelity);
      } else if (import.meta.env?.DEV) {
        console.info('[Export] MP4 decoded-frame fidelity verified:', frameFidelity);
      }
      try { (window as unknown as Record<string, unknown>).__blendcraftLastFrameFidelity = frameFidelity; } catch { /* diagnostics only */ }

      const deliveryMs = deliveredAt - exportStartedAt;
      const timing = {
        totalSec: +(deliveryMs / 1000).toFixed(1),
        renderSec: +(result.renderMs / 1000).toFixed(1),
        encodeWaitSec: +(result.encodeMs / 1000).toFixed(1),
        flushSec: 0,
        muxSec: 0,
        encoderDrainAndMuxSec: +(result.finalizeMs / 1000).toFixed(3),
        blobSec: 0,
        downloadHandoffSec: +(downloadHandoffMs / 1000).toFixed(3),
        durationCheckSec: +(durationCheckMs / 1000).toFixed(3),
        fidelityCheckSec: +(fidelityCheckMs / 1000).toFixed(3),
        cleanupSec: +(cleanupMs / 1000).toFixed(3),
        frames: totalFrames,
        msPerFrame: +(deliveryMs / Math.max(1, totalFrames)).toFixed(0),
        encoderPolicy: (encoderConfigInfo as { policy: string } | null)?.policy,
        encoderConfig: encoderConfigInfo,
        artifactDuration: durationCheck,
        frameFidelity,
        timelineCertification: result.timelineCertification,
      };
      console.info('[Export] MP4 timing:', timing);
      try { (window as unknown as Record<string, unknown>).__exportTiming = timing; } catch { /* diagnostics only */ }
      try { (window as unknown as Record<string, unknown>).__blendcraftLastTimelineCertification = result.timelineCertification; } catch { /* diagnostics only */ }
      recordExportTiming(timing);
    })().catch((error) => {
      console.warn('[Export] Non-blocking MP4 verification failed:', error);
    });
  } catch (error) {
    // Never launch the WebM fallback after a user-initiated abort.
    if (options.signal?.aborted) throw error;
    // H.264 encode failed mid-pass (rare once the capability probe above has
    // passed, but a driver can still reject at encode time) — fall back to
    // VP9/WebM and save with .webm so the file is actually playable.
    if (import.meta.env?.DEV) console.warn('MP4/H.264 Mediabunny export failed mid-encode — falling back to VP9/WebM.', error);
    onProgress?.(0, 'H.264 encode failed — exporting as WebM (VP9)...');
    const webmFilename = filename.replace(/\.mp4$/i, '.webm');
    (options as any).__fellBackToWebM = true;
    await exportWebMFromCanvas({ ...options, filename: webmFilename });
  } finally {
    const cleanupStartedAt = performance.now();
    try {
      options.restoreSize?.();
    } finally {
      cleanupExportResources();
      stagingCanvas.width = 1;
      stagingCanvas.height = 1;
      cleanupMs = performance.now() - cleanupStartedAt;
    }
  }
}



/**
 * MP4-specific quality presets — tuned for H.264 High Profile delivery.
 *
 * GEN-03 PATCH: MP4 is the industry-standard professional delivery format.
 * These bitrates target a content type (motion graphics / gradient animation)
 * that compresses well with H.264 due to smooth, organic movement.
 *
 * Reference points:
 *   YouTube 4K recommended: 35–68 Mbps
 *   Vimeo 4K: 50–100 Mbps
 *   ProRes 4422 HQ 4K @ 24fps: ~743 Mbps (uncompressed reference)
 *
 * For smooth gradient animation (low spatial complexity, high temporal coherence),
 * 30–60 Mbps at 4K is perceptually lossless — banding and block artifacts at
 * lower bitrates are visible on smooth gradients because every macroblock matters.
 */
export const MP4_QUALITY_PRESETS: Record<VideoQuality, VideoQualityConfig> = {
  standard: {
    label: 'Standard (H.264)',
    bitrate: (w) => {
      if (w >= 3840) return 35_000_000;   // 4K:    35 Mbps — YouTube/Vimeo streaming minimum
      if (w >= 2560) return 22_000_000;   // 1440p: 22 Mbps
      return 16_000_000;                  // 1080p: 16 Mbps — broadcast delivery standard
    },
  },
  high: {
    label: 'High (H.264)',
    bitrate: (w) => {
      if (w >= 3840) return 50_000_000;   // 4K:    50 Mbps — Vimeo Pro / DCI delivery
      if (w >= 2560) return 32_000_000;   // 1440p: 32 Mbps
      return 24_000_000;                  // 1080p: 24 Mbps — film festival standard
    },
  },
  ultra: {
    label: 'Ultra (H.264 High Profile)',
    bitrate: (w) => {
      if (w >= 3840) return 68_000_000;   // 4K:    68 Mbps — YouTube Max / archival
      if (w >= 2560) return 42_000_000;   // 1440p: 42 Mbps
      return 30_000_000;                  // 1080p: 30 Mbps — perceptually lossless gradient
    },
  },
  max: {
    label: 'Max Quality (H.264 High Profile)',
    bitrate: (w) => {
      if (w >= 3840) return 90_000_000;
      if (w >= 2560) return 56_000_000;
      return 42_000_000;
    },
  },
  sharpMax: {
    label: 'Sharp Max (H.264 High Profile)',
    bitrate: (w) => {
      if (w >= 3840) return 110_000_000;
      if (w >= 2560) return 72_000_000;
      return 54_000_000;
    },
  },
};

/**
 * Export as MP4 — industry-standard H.264 High Profile delivery.
 *
 * GEN-03 PATCH: Was throwing unconditionally ("MP4 export is deprecated").
 * Now delegates to exportMP4FromCanvas with professional configuration:
 *   - H.264 High Profile codec selection based on output dimensions
 *   - MP4-specific quality presets (higher bitrates than WebM defaults)
 *   - AVCC format (required for MP4 container — length-prefixed NAL units)
 *   - setExportSize/restoreSize to render at full target resolution
 *   - Graceful H.264 → VP9/WebM fallback when hardware encoder unavailable
 *
 * MP4 is preferred for: social media delivery, client hand-off, NLE import
 * (Premiere, Final Cut, DaVinci), portfolio sites, and broadcast workflows.
 */
export async function exportAsMP4(
  canvas: HTMLCanvasElement,
  duration: number = 5000,
  fps: number = 60,
  filename: string = 'gradient.mp4',
  onProgress?: ProgressCallback,
  onRenderFrame?: DeterministicRenderCallback,
  quality: VideoQuality = 'high',
  options?: {
    width?: number;
    height?: number;
    getLiveCanvas?: () => HTMLCanvasElement | null;
    getReadFramePixels?: () => { data: Uint8Array; width: number; height: number } | null;
    setExportSize?: (w: number, h: number) => void;
    restoreSize?: () => void;
  }
): Promise<void> {
  if (!onRenderFrame) {
    throw new Error('exportAsMP4 requires a renderFrameAtTime callback. Pass it as the 6th argument.');
  }

  const targetWidth  = options?.width  || canvas.width;
  const targetHeight = options?.height || canvas.height;

  // EXPORT-FIX (MP4 v2): codec negotiation now lives inside
  // exportMP4FromCanvas (spec-driven AVC level ladder) — the legacy
  // pickMP4CodecProfile mapped 4K to Level 4.0/4.2 strings that the AVC
  // spec caps at ~1080p, which is what broke MP4 export above 1080p.
  onProgress?.(0, `Preparing MP4 at ${targetWidth}×${targetHeight}...`);

  return exportMP4FromCanvas({
    canvas,
    renderFrameAtTime: onRenderFrame,
    fps,
    durationMs: duration,
    filename: filename.endsWith('.mp4') ? filename : filename + '.mp4',
    quality,
    width:  targetWidth,
    height: targetHeight,
    getLiveCanvas:      options?.getLiveCanvas,
    getReadFramePixels: options?.getReadFramePixels,
    setExportSize:      options?.setExportSize,
    restoreSize:        options?.restoreSize,
    onProgress,
  });
}

/**
 * Batch export multiple formats using deterministic export architecture
 * UPDATED: Now uses isolated export renderers for PNG/GIF/WebM
 */
/**
 * Batch export multiple formats using deterministic export architecture.
 * Uses exportWebMFromCanvas for WebM (full-resolution, setExportSize/restoreSize pipeline).
 */
export async function batchExport(
  renderFrameAtTime: DeterministicRenderCallback,
  layers: Layer[],
  canvasSettings: CanvasSettings,
  formats: ExportFormat[],
  baseFilename: string = 'gradient',
  onProgress?: ProgressCallback,
  // EXP-06: added to support full-res pipeline in batch context
  exportOptions?: {
    getLiveCanvas?: () => HTMLCanvasElement | null;
    getReadFramePixels?: () => { data: Uint8Array; width: number; height: number } | null;
    setExportSize?: (w: number, h: number) => void;
    restoreSize?: () => void;
    canvas?: HTMLCanvasElement;
  }
): Promise<void> {
  const totalFormats = formats.length;
  let completedFormats = 0;

  for (const format of formats) {
    try {
      const progress = (completedFormats / totalFormats) * 100;
      onProgress?.(progress, `Exporting ${format.toUpperCase()}...`);

      const filename = `${baseFilename}.${format}`;

      switch (format) {
        case 'png':
          await exportPNGAtSize(
            renderFrameAtTime,
            canvasSettings.width,
            canvasSettings.height,
            filename,
            (p, msg) => {
              onProgress?.((completedFormats / totalFormats) * 100 + (p / totalFormats), msg);
            },
            0,
            exportOptions?.getReadFramePixels
          );
          break;

        case 'svg': {
          const { renderer: svgRenderer, canvas: svgCanvas, cleanup: svgCleanup } = createExportRenderer(
            canvasSettings.width,
            canvasSettings.height,
            1
          );
          try {
            await renderFrameAtTime(0, svgRenderer);
            await exportAsSVG(svgCanvas, layers, filename);
          } finally {
            svgCleanup();
          }
          break;
        }

        case 'css': {
          const result = generateCSSCode(layers);
          if (result.supported) {
            saveAs(new Blob([result.code], { type: 'text/css' }), `${baseFilename}.css`);
          }
          break;
        }

        case 'gif':
          // EXP-06: use unified exportGIFDeterministic (now shares working architecture)
          await exportGIFDeterministic({
            width: canvasSettings.width,
            height: canvasSettings.height,
            fps: 15,
            durationMs: 3000,
            filename,
            quality: 'high',
            renderFrameAtTime,
            getLiveCanvas: exportOptions?.getLiveCanvas,
            getReadFramePixels: exportOptions?.getReadFramePixels,
            onProgress: (p, msg) => {
              onProgress?.((completedFormats / totalFormats) * 100 + (p / totalFormats), msg);
            },
          });
          break;


        case 'webm': {
          // SPRINT 3: batchExport WebM uses exportWebMFromCanvas (setExportSize/restoreSize pipeline).
          // Guard against null canvas — a blank 0×0 fallback would silently produce a black video.
          const batchCanvas = exportOptions?.canvas;
          if (!batchCanvas) {
            throw new Error(
              'batchExport WebM requires exportOptions.canvas. ' +
              'Pass the live HTMLCanvasElement from renderApiRef.getCanvas().'
            );
          }
          await exportWebMFromCanvas({
            canvas: batchCanvas,
            renderFrameAtTime,
            fps: 60,
            durationMs: 5000,
            filename,
            quality: 'high',
            width: canvasSettings.width,
            height: canvasSettings.height,
            getLiveCanvas: exportOptions?.getLiveCanvas,
            getReadFramePixels: exportOptions?.getReadFramePixels,
            setExportSize: exportOptions?.setExportSize,
            restoreSize: exportOptions?.restoreSize,
            onProgress: (p, msg) => {
              onProgress?.((completedFormats / totalFormats) * 100 + (p / totalFormats), msg);
            },
          });
          break;
        }

        default:
          if (import.meta.env?.DEV) console.warn(`Unsupported format: ${format}`);
      }

      completedFormats++;
    } catch (error) {
      if (import.meta.env?.DEV) console.error(`Failed to export ${format}:`, error);
      throw new Error(`Failed to export ${format}: ` + (error as Error).message);
    }
  }

  onProgress?.(100, 'Batch export complete!');
}
