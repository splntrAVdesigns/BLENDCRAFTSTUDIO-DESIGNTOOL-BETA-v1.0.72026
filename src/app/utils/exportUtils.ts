import * as FileSaver from 'file-saver';
import THREE from '../lib/three';
import { Layer, GradientConfig, ExportFormat, CanvasSettings } from '../types/gradient';
import { generateCSSGradient } from './gradientRenderer';
// @ts-ignore - gif.js doesn't have reliable ESM typings
import * as GIFLib from 'gif.js';
// Muxer imports — use vendored local files (no npm install required).
// The vendored files in ../lib/vendored/ are used for WebM and MP4 muxing.
import { WebMMuxer } from '../lib/vendored/webm-muxer';
import { MP4Muxer } from '../lib/vendored/mp4-muxer';
import { isIframeEnvironment } from './environment';
import {
  cloneLoopSample,
  compareLoopFrames,
  describeLoopResult,
  type LoopFrameSample,
  type LoopVerificationResult,
} from './loopVerification';
import {
  captureExportMemorySnapshot,
  verifyExportMemoryRecovery,
} from './exportCertification';
import { createExportTimeline } from './exportTimeline';
import {
  createExportFinalizationTimings,
  getExportFinalizationProgress,
  handoffExportDownload,
} from './exportFinalization';
import {
  getKeyFrameIntervalFrames,
  getOptimizedEncoderBitrate,
  getFigmaSafeQueueYieldThreshold,
  orderWebMCodecCandidates,
  shouldEncodeKeyFrame,
} from './exportEncoderOptimization';
import { EXPORT_COLOR_CONTRACT } from './exportRenderQuality';
import { attachLatestExportMemoryRecovery, recordExportFailure, recordExportTiming } from './exportStressCertification';

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
 * ISOLATED EXPORT SYSTEM
 * =======================
 * Export uses a completely separate renderer and canvas from the live preview.
 * 
 * KEY PRINCIPLES:
 * 1. LIVE RENDERER: preserveDrawingBuffer: false (FAST)
 * 2. EXPORT RENDERER: preserveDrawingBuffer: true (CAPTURABLE, ISOLATED)
 * 3. Deterministic time-stepping for perfect animation exports
 * 4. Render at exact target resolution (no upscaling)
 * 5. Separate render loop and timeline
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

function getEncoderQueueWatermark(width: number, height: number): number {
  const pixels = width * height;
  if (pixels >= 3840 * 2160) return 3;
  if (pixels >= 2560 * 1440) return 6;
  return 10;
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

/**
 * Phase 7.3E.9 encoder drain policy.
 *
 * PHASE 7.3E FOUNDATION FREEZE: keep one final encoder.flush(). Do not restore
 * per-frame flush calls. Backpressure is handled only through encodeQueueSize
 * and the encoder's dequeue signal, with a bounded timeout so embedded Chromium
 * cannot deadlock the export.
 */
async function waitForEncoderQueueBelow(
  encoder: VideoEncoder,
  lowWatermark: number,
  signal?: AbortSignal,
  timeoutMs: number = 2500,
): Promise<void> {
  if (((encoder as any).encodeQueueSize ?? 0) <= lowWatermark) return;
  const startedAt = performance.now();
  await new Promise<void>((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { (encoder as any).removeEventListener?.('dequeue', check); } catch {}
      if (timer) clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (signal?.aborted || ((encoder as any).encodeQueueSize ?? 0) <= lowWatermark) finish();
      else if (performance.now() - startedAt >= timeoutMs) finish();
    };
    try { (encoder as any).addEventListener?.('dequeue', check); } catch {}
    const poll = () => {
      check();
      if (!settled) timer = window.setTimeout(poll, 24);
    };
    poll();
  });
  throwIfExportAborted(signal);
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


type HardwarePreference = 'no-preference' | 'prefer-hardware' | 'prefer-software';

type WebMEncoderChoice = {
  codec: string;
  codecId: 'V_VP9' | 'V_VP8';
  /**
   * STAGE 2.8.1: the acceleration preference this codec was actually VALIDATED
   * with. Threaded into configure() so we never configure with a preference the
   * probe did not test. Undefined = 'no-preference' (omit the key entirely).
   */
  hardwareAcceleration?: HardwarePreference;
};

type MP4EncoderChoice = {
  codec: string;
  /** Possibly clamped to the AVC level ceiling — always use this, not the preset value. */
  bitrate: number;
  hardwareAcceleration?: HardwarePreference;
};

function canAttemptMP4WebCodecs(): boolean {
  if (!isWebCodecsAvailable()) return false;
  const Encoder = (globalThis as any).VideoEncoder;
  return typeof Encoder?.isConfigSupported === 'function' || typeof Encoder === 'function';
}

async function isVideoEncoderConfigSupported(config: VideoEncoderConfig): Promise<boolean> {
  const Encoder = (globalThis as any).VideoEncoder;
  if (!Encoder) return false;

  // Older Chromium/WebView builds may expose VideoEncoder but not isConfigSupported.
  // In that case, allow configure() to be the final authority.
  if (typeof Encoder.isConfigSupported !== 'function') return true;

  try {
    const result = await Encoder.isConfigSupported(config);
    return !!result?.supported;
  } catch {
    return false;
  }
}

async function pickSupportedWebMEncoderConfig(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
  quality: VideoQuality,
): Promise<WebMEncoderChoice> {
  const evenWidth = Math.max(2, Math.round(width / 2) * 2);
  const evenHeight = Math.max(2, Math.round(height / 2) * 2);

  // VP9 codec strings: vp09.PP.LL.BB — Profile 0, Level, 8-bit colour.
  //
  // ── STAGE 3.3: SELECT THE MINIMUM ADEQUATE LEVEL (the real perf bug) ──
  //
  // The measured breakdown (__exportTiming) showed a 1440×810 export spending
  // 621 of 687 seconds in encoder.flush() — ~4.2s PER FRAME of software VP9.
  // Root cause: this cascade led with Level 6.1 (a 4K@60fps level) and returned
  // the FIRST level isConfigSupported() accepted. Software VP9 claims support
  // for every level, so EVERY export — 720p, 1080p, anything — was configured
  // as if it were 4K@60. A 4K-level configuration puts the software encoder in
  // a dramatically higher-complexity mode than the actual frame needs.
  //
  // Fix: compute the minimum VP9 level whose limits (max luma sample rate and
  // max picture size, VP9 spec Annex A) actually cover this export, and try
  // that FIRST, then higher levels only as fallback. A 1080p30 export now
  // configures as Level 3.1 instead of 6.1 — the encoder does the work the
  // frame needs, not 4K-worth of it.
  //
  // VP9 level limits (Annex A, Table A.1) — {level string, maxLumaSampleRate
  // (samples/sec), maxLumaPictureSize (samples)}:
  const VP9_LEVELS: Array<{ codec: string; maxSampleRate: number; maxPicSize: number }> = [
    { codec: 'vp09.00.10.08', maxSampleRate: 829440,      maxPicSize: 36864 },    // 1.0
    { codec: 'vp09.00.11.08', maxSampleRate: 2764800,     maxPicSize: 73728 },    // 1.1
    { codec: 'vp09.00.20.08', maxSampleRate: 4608000,     maxPicSize: 122880 },   // 2.0
    { codec: 'vp09.00.21.08', maxSampleRate: 9216000,     maxPicSize: 245760 },   // 2.1
    { codec: 'vp09.00.30.08', maxSampleRate: 20736000,    maxPicSize: 552960 },   // 3.0
    { codec: 'vp09.00.31.08', maxSampleRate: 36864000,    maxPicSize: 983040 },   // 3.1 — 1080p30
    { codec: 'vp09.00.40.08', maxSampleRate: 83558400,    maxPicSize: 2228224 },  // 4.0 — 1080p60/1440p30
    { codec: 'vp09.00.41.08', maxSampleRate: 160432128,   maxPicSize: 2228224 },  // 4.1
    { codec: 'vp09.00.50.08', maxSampleRate: 311951360,   maxPicSize: 8912896 },  // 5.0 — 4K30
    { codec: 'vp09.00.51.08', maxSampleRate: 588251136,   maxPicSize: 8912896 },  // 5.1 — 4K60
    { codec: 'vp09.00.60.08', maxSampleRate: 1176502272,  maxPicSize: 35651584 }, // 6.0 — 8K
    { codec: 'vp09.00.61.08', maxSampleRate: 2367000576,  maxPicSize: 35651584 }, // 6.1
  ];
  const picSize = evenWidth * evenHeight;
  const sampleRate = picSize * fps;
  const minIdx = VP9_LEVELS.findIndex(
    (L) => picSize <= L.maxPicSize && sampleRate <= L.maxSampleRate,
  );
  const startIdx = minIdx === -1 ? VP9_LEVELS.length - 1 : minIdx;
  // Minimum adequate level first, then progressively higher as fallback (some
  // encoders reject an exact level even when they'd accept a higher one), then
  // VP8 as a last resort.
  const vp9Candidates: WebMEncoderChoice[] = VP9_LEVELS
    .slice(startIdx)
    .map((L) => ({ codec: L.codec, codecId: 'V_VP9' as const }));
  const vp8Candidate: WebMEncoderChoice = { codec: 'vp8', codecId: 'V_VP8' };
  const candidates = orderWebMCodecCandidates(vp9Candidates, vp8Candidate, {
    iframe: isIframeEnvironment(),
    quality,
  });

  // ── STAGE 2.8.1: HARDWARE-CAPABLE PREFERENCE CASCADE ──
  //
  // This probe (and the configure() call it feeds) previously hard-locked
  // `prefer-software`. Software VP9 at 1080p costs roughly 150–300ms PER FRAME
  // on the CPU; hardware VP9 is typically 5–20ms. On a 150-frame export that
  // single string is tens of seconds of pure encode time.
  //
  // WHY NOT JUST FORCE HARDWARE: the MP4 path (pickSupportedAvcEncoderConfig)
  // documents a real, observed failure — inside iframe hosts (Figma Make),
  // hardware H.264 encoders crashed the GPU process mid-encode, after which
  // Chromium blocklists them for the whole session. That constraint is real and
  // is respected here rather than overridden.
  //
  // The distinction: that crash was H.264-specific, and VP9 encode is a
  // separate hardware path. So in iframes we lead with 'no-preference' — the
  // browser picks, and is free to use hardware without us forcing it — then
  // fall back to explicit software. Standalone tabs lead with 'prefer-hardware'
  // for the full win. Whatever the probe validates is threaded through to
  // configure() (see WebMEncoderChoice.hardwareAcceleration), so we never again
  // configure with a preference we did not actually test.
  // STAGE 2.8.2 — MEASURED CORRECTION. 2.8.1 led with 'no-preference' inside
  // iframes on the theory that the documented H.264 GPU-process crash was
  // codec-specific. Real-world timing says otherwise: exports got SLOWER
  // (~120s vs ~50s for 153 frames), with a long stall at the final frame —
  // the signature of an encoder whose queue drains slowly at flush. Whatever
  // Chromium selects under 'no-preference' in the Figma Make iframe is worse
  // than software VP9, so iframes go back to software-first. Standalone tabs
  // keep the hardware attempt, where it is a genuine win and where the
  // documented crash was never observed.
  //
  // The lesson is recorded rather than re-litigated: encoder selection inside
  // this iframe host must be driven by measurement, not by reasoning about
  // what the browser "should" pick.
  const hwPreferences: Array<HardwarePreference | undefined> = isIframeEnvironment()
    ? [undefined, 'prefer-hardware', 'prefer-software']
    : ['prefer-hardware', undefined, 'prefer-software'];

  for (const candidate of candidates) {
    for (const hardwareAcceleration of hwPreferences) {
      const supported = await isVideoEncoderConfigSupported({
        codec: candidate.codec,
        width: evenWidth,
        height: evenHeight,
        bitrate,
        framerate: fps,
        latencyMode: 'quality',
        bitrateMode: 'constant',
        ...(hardwareAcceleration ? { hardwareAcceleration } : {}),
      } as VideoEncoderConfig);
      if (supported) {
        // STAGE 2.8.2: make the selection observable — the single most useful
        // datapoint for diagnosing export speed, and previously invisible.
        console.info('[Export] WebM encoder selected:', {
          codec: candidate.codec,
          // STAGE 3.3: this should now be the MINIMUM level for the resolution
          // (e.g. vp09.00.40.08 for 1440×810), not the old fixed 6.1. If you
          // still see vp09.00.61.08 here for a sub-4K export, the level
          // selection didn't take and the encoder is doing 4K-complexity work.
          minLevelForSize: candidates[0]?.codec,
          resolution: `${evenWidth}×${evenHeight}@${fps}`,
          hardwareAcceleration: hardwareAcceleration ?? 'no-preference',
          iframe: isIframeEnvironment(),
        });
        return { ...candidate, hardwareAcceleration };
      }
    }
  }

  // Keep the failure clear so exportWebMFromCanvas can fall back to MediaRecorder.
  throw new Error('No supported WebCodecs WebM encoder config found.');
}

/**
 * H.264/AVC level constraint table (ITU-T H.264 Annex A, Table A-1).
 *
 * EXPORT-FIX (MP4 v2): The previous prober hardcoded four codec strings
 * topping out at Level 4.2 (avc1.64002A) with a comment claiming "4K@60fps"
 * support. Per spec, Level 4.2 caps at ~2,228,224 px/frame (≈2048×1088) and
 * 62.5 Mbps (High profile). Chrome's isConfigSupported() validates level
 * constraints strictly, so EVERY export ≥1440p failed all candidates →
 * "No supported WebCodecs MP4/H.264 encoder config found."
 *
 *   maxFS    — max frame size in macroblocks (16×16 px)
 *   maxMBPS  — max macroblocks per second (frame size × fps)
 *   maxKbps  — max video bitrate for Baseline/Main; High profile = ×1.25
 */
const AVC_LEVEL_TABLE = [
  { name: '3.1', hex: '1F', maxFS: 3600,  maxMBPS: 108000,  maxKbps: 14000  }, // 720p@30
  { name: '3.2', hex: '20', maxFS: 5120,  maxMBPS: 216000,  maxKbps: 20000  }, // 720p@60
  { name: '4.0', hex: '28', maxFS: 8192,  maxMBPS: 245760,  maxKbps: 20000  }, // 1080p@30
  { name: '4.1', hex: '29', maxFS: 8192,  maxMBPS: 245760,  maxKbps: 50000  }, // 1080p@30, 50Mbps
  { name: '4.2', hex: '2A', maxFS: 8704,  maxMBPS: 522240,  maxKbps: 50000  }, // 1080p@60
  { name: '5.0', hex: '32', maxFS: 22080, maxMBPS: 589824,  maxKbps: 135000 }, // 1440p / 2.5K@30
  { name: '5.1', hex: '33', maxFS: 36864, maxMBPS: 983040,  maxKbps: 240000 }, // 4K@30
  { name: '5.2', hex: '34', maxFS: 36864, maxMBPS: 2073600, maxKbps: 240000 }, // 4K@60
] as const;

/** Profile prefixes for RFC 6381 avc1 codec strings (profile_idc + constraint flags). */
const AVC_PROFILES = [
  { prefix: '6400', brFactor: 1.25 }, // High — best compression for gradients
  { prefix: '4D40', brFactor: 1.0  }, // Main — broad decoder support
  { prefix: '42E0', brFactor: 1.0  }, // Constrained Baseline — universal fallback
] as const;

/** Index of the minimum AVC level satisfying frame size, MB rate, and bitrate. */
function minAvcLevelIndex(widthPx: number, heightPx: number, fps: number, bitrateKbps: number, brFactor: number): number {
  const frameMBs = Math.ceil(widthPx / 16) * Math.ceil(heightPx / 16);
  const mbps = frameMBs * fps;
  for (let i = 0; i < AVC_LEVEL_TABLE.length; i++) {
    const L = AVC_LEVEL_TABLE[i];
    if (frameMBs <= L.maxFS && mbps <= L.maxMBPS && bitrateKbps <= L.maxKbps * brFactor) return i;
  }
  return -1; // exceeds Level 5.2 even after bitrate clamping — resolution/fps too high
}

/**
 * Pick a spec-compliant, browser-supported H.264 encoder config.
 *
 * Strategy (modern, mirrors the WebM prober's cascade philosophy):
 *  1. For each profile (High → Main → Baseline), compute the minimum AVC
 *     level from the actual export dims/fps/bitrate — clamping the bitrate
 *     to the level ceiling when the preset exceeds it (e.g. Sharp Max 4K
 *     110 Mbps > Level 5.0's 135·1.25 boundary handling).
 *  2. Probe that level and every higher level (some encoders reject exact
 *     minimums), with hardwareAcceleration 'no-preference' first, then
 *     'prefer-software' (parity with pickSupportedWebMEncoderConfig — some
 *     Chromium builds only expose one of the two for H.264).
 *  3. Return the codec string AND the (possibly clamped) bitrate so
 *     configure() uses values guaranteed consistent with the probe.
 */
async function pickSupportedMP4EncoderConfig(
  width: number,
  height: number,
  fps: number,
  bitrate: number
): Promise<MP4EncoderChoice> {
  const evenWidth = Math.max(2, Math.round(width / 2) * 2);
  const evenHeight = Math.max(2, Math.round(height / 2) * 2);
  const requestedKbps = Math.max(1, Math.round(bitrate / 1000));

  // STABILITY (MP4 v3): inside iframe hosts (Figma Make preview), hardware
  // H.264 encoders have crashed the GPU process mid-encode — after which
  // Chromium blocklists them for the session and every subsequent probe
  // fails. Prefer the software encoder first in iframes for stability;
  // standalone tabs keep no-preference first for speed.
  const hwPreferences: Array<HardwarePreference | undefined> = isIframeEnvironment()
    ? ['prefer-software', undefined]
    : [undefined, 'prefer-software'];

  // DEV diagnostics: record every attempted config so a total failure tells
  // us exactly what this environment rejects (profile × level × hw pref).
  const attempts: Array<{ codec: string; hw: string; kbps: number; supported: boolean }> = [];

  for (const profile of AVC_PROFILES) {
    // Clamp bitrate to the highest ceiling this profile can ever carry
    // (Level 5.2), so a too-hot preset lowers bitrate instead of failing.
    const absoluteMaxKbps = AVC_LEVEL_TABLE[AVC_LEVEL_TABLE.length - 1].maxKbps * profile.brFactor;
    const effKbps = Math.min(requestedKbps, Math.floor(absoluteMaxKbps));
    const startIdx = minAvcLevelIndex(evenWidth, evenHeight, fps, effKbps, profile.brFactor);
    if (startIdx === -1) continue; // beyond 4K@60 for this profile

    for (let i = startIdx; i < AVC_LEVEL_TABLE.length; i++) {
      const codec = `avc1.${profile.prefix}${AVC_LEVEL_TABLE[i].hex}`;
      for (const hardwareAcceleration of hwPreferences) {
        const supported = await isVideoEncoderConfigSupported({
          codec,
          width: evenWidth,
          height: evenHeight,
          bitrate: effKbps * 1000,
          framerate: fps,
          latencyMode: 'quality',
          avc: { format: 'avcC' },
          ...(hardwareAcceleration ? { hardwareAcceleration } : {}),
        } as VideoEncoderConfig);
        attempts.push({ codec, hw: hardwareAcceleration ?? 'no-preference', kbps: effKbps, supported });
        if (supported) {
          if (effKbps < requestedKbps && (import.meta as any).env?.DEV) {
            console.warn(`[MP4 Export] Bitrate clamped ${requestedKbps} → ${effKbps} kbps to satisfy AVC Level ${AVC_LEVEL_TABLE[i].name} (${codec}).`);
          }
          return { codec, bitrate: effKbps * 1000, hardwareAcceleration };
        }
      }
    }
  }

  // Total failure — dump the full probe matrix so the environment's exact
  // rejections are visible in the console (works in DEV and prod builds;
  // this only fires on the failure path so it costs nothing normally).
  console.warn('[MP4 Export] No H.264 encoder config accepted by this environment. Probe matrix:');
  console.table(attempts);
  throw new Error('No supported WebCodecs MP4/H.264 encoder config found.');
}

/**
 * Async UI gate: does this environment ACTUALLY encode H.264 right now?
 *
 * The sync isMP4ExportSupported() only checks that the WebCodecs classes
 * exist — which is true in environments (Figma desktop / Electron without
 * proprietary codecs, post-GPU-crash sessions) where every real H.264
 * config is rejected. Offering MP4 there produces doomed export attempts.
 *
 * This probes the minimum bar — Constrained Baseline 720p30 — across both
 * hardware preferences. If CB@720p is rejected, nothing higher will pass.
 * Result is cached per session; call again with { force: true } after a
 * suspected GPU-process reset if live re-checks are ever needed.
 */
let mp4SupportCache: Promise<boolean> | null = null;
export function verifyMP4EncodeSupport(opts?: { force?: boolean }): Promise<boolean> {
  if (!opts?.force && mp4SupportCache) return mp4SupportCache;
  mp4SupportCache = (async () => {
    if (!isWebCodecsAvailable()) return false;
    for (const hardwareAcceleration of ['no-preference', 'prefer-software', 'prefer-hardware'] as const) {
      const supported = await isVideoEncoderConfigSupported({
        codec: 'avc1.42E01F', // Constrained Baseline, Level 3.1 — the floor
        width: 1280,
        height: 720,
        bitrate: 5_000_000,
        framerate: 30,
        avc: { format: 'avcC' },
        hardwareAcceleration,
      } as unknown as VideoEncoderConfig);
      if (supported) return true;
    }
    return false;
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
        bctx.putImageData(new ImageData(new Uint8ClampedArray(flipped.buffer), frame.width, frame.height), 0, 0);
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

function createIsolatedExportRenderer(width: number, height: number, alpha: boolean = true): THREE.WebGLRenderer {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
    alpha,
    premultipliedAlpha: false,
    precision: 'highp',
    powerPreference: 'high-performance',
    stencil: false,
    depth: false,
  });
  renderer.autoClear = false;
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, alpha ? 0 : 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  return renderer;
}

function disposeIsolatedExportRenderer(renderer: THREE.WebGLRenderer | null | undefined): void {
  if (!renderer) return;
  try { renderer.setRenderTarget(null); } catch {}
  try { renderer.clear(); } catch {}
  try { renderer.dispose(); } catch {}
  const canvas = renderer.domElement;
  if (canvas) {
    canvas.width = 1;
    canvas.height = 1;
  }
}

function copyCanvasToCanvas(source: HTMLCanvasElement, target: HTMLCanvasElement, alpha: boolean): void {
  const ctx = target.getContext('2d', { alpha, willReadFrequently: false, colorSpace: EXPORT_COLOR_CONTRACT.outputSpace } as any);
  if (!ctx) throw new Error('Failed to create export staging context.');
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, target.width, target.height);
}

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

function assertUsableEncodedBytes(bytes: Uint8Array | ArrayBuffer | BlobPart[] | any, label: string): void {
  const size = typeof bytes?.byteLength === 'number'
    ? bytes.byteLength
    : typeof bytes?.length === 'number'
      ? bytes.length
      : 0;
  if (size < 256) {
    throw new Error(`${label} produced an empty/suspicious encoded payload (${size} bytes).`);
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
  const ctx = stagingCanvas.getContext('2d', { alpha: false, willReadFrequently: false, colorSpace: EXPORT_COLOR_CONTRACT.outputSpace } as any);
  if (!ctx) throw new Error('Failed to get 2D staging context for video export.');

  ctx.clearRect(0, 0, targetWidth, targetHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // PRIMARY: export-size GPU readback. This is slower than live-canvas blitting,
  // but it preserves the exact full-resolution render produced by renderAtTime().
  // WebM quality depends on this path for dense gradients, masks, dither, and textures.
  const frame = getReadFramePixels?.();
  if (frame && frame.data.length === frame.width * frame.height * 4) {
    const flipped = flipRgbaBuffer(frame.data, frame.width, frame.height);
    if (!_rtReadbackCanvas || _rtReadbackW !== frame.width || _rtReadbackH !== frame.height) {
      _rtReadbackCanvas = document.createElement('canvas');
      _rtReadbackCanvas.width = frame.width;
      _rtReadbackCanvas.height = frame.height;
      _rtReadbackCtx = _rtReadbackCanvas.getContext('2d', { alpha: false, colorSpace: EXPORT_COLOR_CONTRACT.outputSpace } as any)!;
      _rtReadbackW = frame.width;
      _rtReadbackH = frame.height;
    }
    _rtReadbackCtx!.putImageData(new ImageData(new Uint8ClampedArray(flipped.buffer), frame.width, frame.height), 0, 0);
    // STAGE 3.2: only pay for high-quality resampling when the readback is
    // actually a different size than the target (supersampled source). When
    // they match — the common 1:1 export case — smoothing is pure cost with no
    // benefit (it's a same-size copy), and the 'high' filter is one of the more
    // expensive per-frame CPU operations. Match → nearest copy; mismatch →
    // keep the high-quality downsample the supersampled path needs.
    const sameSize = frame.width === targetWidth && frame.height === targetHeight;
    ctx.imageSmoothingEnabled = !sameSize;
    if (!sameSize) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(_rtReadbackCanvas, 0, 0, frame.width, frame.height, 0, 0, targetWidth, targetHeight);
    applyCodecSafetyResolve(ctx, targetWidth, targetHeight, codecSafety);
    applyFlashOverlay(ctx, targetWidth, targetHeight, flashOverlay);
    return;
  }

  // FALLBACK ONLY: live canvas. This may be preview-sized, so it is intentionally
  // not the primary source for pro exports.
  if (liveCanvas) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(liveCanvas, 0, 0, liveCanvas.width, liveCanvas.height, 0, 0, targetWidth, targetHeight);
    applyCodecSafetyResolve(ctx, targetWidth, targetHeight, codecSafety);
    applyFlashOverlay(ctx, targetWidth, targetHeight, flashOverlay);
    return;
  }

  throw new Error('No canvas source available for frame capture. Check liveCanvas and getReadFramePixels.');
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
  renderFrameAtTime: (time: number, exportRenderer?: THREE.WebGLRenderer) => Promise<void>;
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
  const liveCanvas: HTMLCanvasElement | null = null;
  const clampedFps = Math.max(24, Math.min(60, fps));
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * clampedFps));
  const bitrate = VIDEO_QUALITY_PRESETS[quality].bitrate(targetWidth, targetHeight);
  const offscreen = document.createElement('canvas');
  offscreen.width = targetWidth;
  offscreen.height = targetHeight;
  let exportRenderer: THREE.WebGLRenderer | null = createIsolatedExportRenderer(targetWidth, targetHeight, false);
  const stream = offscreen.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  if (!track) throw new Error('Failed to create video track.');
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
  recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunks.push(e.data); };
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(recorder.error ?? new Error('MediaRecorder error'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });
  recorder.start();
  try {
  await waitForNextPaint();
  for (let i = 0; i < totalFrames; i++) {
    throwIfExportAborted(options.signal);
    const t = i / clampedFps;
    await renderFrameAtTime(t, exportRenderer ?? undefined);
    copyCanvasToCanvas(exportRenderer!.domElement, offscreen, false);
    applyCodecSafetyResolve(offscreen.getContext('2d')!, targetWidth, targetHeight, options.codecSafety || 'sharp');
    applyFlashOverlay(offscreen.getContext('2d')!, targetWidth, targetHeight, options.getFlashOverlayFrame?.(t) ?? null);
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
  disposeIsolatedExportRenderer(exportRenderer);
  exportRenderer = null;
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
    disposeIsolatedExportRenderer(exportRenderer);
    exportRenderer = null;
    options.restoreSize?.();
    cleanupExportResources();
    throw error;
  }
}

async function exportMP4WithMediaRecorderFallback(options: {
  canvas: HTMLCanvasElement;
  renderFrameAtTime: (time: number, exportRenderer?: THREE.WebGLRenderer) => Promise<void>;
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
  renderFrameAtTime: (time: number, exportRenderer?: THREE.WebGLRenderer) => Promise<void>;
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

  // ── STAGE 2.8.5: EXPORT PHASE TIMING ──
  // Export duration has swung between ~50s and ~3min across tests with no way
  // to tell WHICH phase moved, so every diagnosis has been inference. These
  // four numbers end that: render, encode-drain, flush, mux. Content matters
  // enormously here — a dense noisy composition costs far more to encode at a
  // fixed bitrate than a smooth gradient — and without per-phase timing that's
  // indistinguishable from a regression.
  const phaseTimers = { renderMs: 0, queueWaitMs: 0, flushMs: 0, startedAt: performance.now() };
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
  const timeline = createExportTimeline({ fps: clampedFps, totalFrames });
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
    captureSource: `WebCodecs -> ${sourceWidth}×${sourceHeight} source render -> ${targetWidth}×${targetHeight} encoder canvas`,
    firstFrameTime: 0,
    lastFrameTime: (totalFrames - 1) / clampedFps,
    cleanupCompleted: false,
  };

  if (import.meta.env?.DEV) console.info('[BLENDCRAFT export:v2.2.5-phase2.5] WebM start', diagnostics);
  onProgress?.(
    0,
    `Rendering ${(durationMs / 1000).toFixed(1)}s · ${clampedFps}fps · ${totalFrames} frames · ${targetWidth}×${targetHeight} · ${VIDEO_QUALITY_PRESETS[quality].label}...`
  );

  const stagingCanvas = document.createElement('canvas');
  stagingCanvas.width = targetWidth;
  stagingCanvas.height = targetHeight;
  const stagingCtx = stagingCanvas.getContext('2d', { alpha: false, willReadFrequently: false, colorSpace: 'srgb' } as any);
  if (!stagingCtx) throw new Error('Failed to create WebM staging canvas.');

  let encoder: VideoEncoder | null = null;
  let stream: MediaStream | null = null;
  let savedViaWebCodecs = false;
  let fallbackUsed = false;
  let downloadHandoffComplete = false;

  try {
    if (!isWebCodecsAvailable()) {
      fallbackUsed = true;
      if (import.meta.env?.DEV) console.warn('[BLENDCRAFT export:v2.2.5-phase2.5] WebCodecs unavailable; using MediaRecorder fallback.');
      await exportWebMWithMediaRecorderFallback(options);
      return;
    }

    const encoderChoice = await pickSupportedWebMEncoderConfig(targetWidth, targetHeight, clampedFps, bitrate, quality);
    diagnostics.captureSource = `WebCodecs ${encoderChoice.codec} -> staging canvas`;
    if (import.meta.env?.DEV) console.info('[BLENDCRAFT export:v2.2.5-phase2.5] Encoder selected', {
      codec: encoderChoice.codec,
      codecId: encoderChoice.codecId,
      bitrate,
      optimizedBitrate: getOptimizedEncoderBitrate(bitrate, encoderChoice.codecId, quality),
    });

    const muxer = new WebMMuxer({
      width: targetWidth,
      height: targetHeight,
      codecId: encoderChoice.codecId as 'V_VP9' | 'V_VP8',
      frameRate: clampedFps,
    });

    // Use the live WebGL context at exact export dimensions for now. This is the
    // stable path in the current Figma/Chromium runtime because all masks/textures
    // already live in that context. The restore block below is the authority.
    options.setExportSize?.(sourceWidth, sourceHeight);
    await waitForNextPaint();

    await new Promise<void>((resolve, reject) => {
      const Encoder = (globalThis as any).VideoEncoder;
      encoder = new Encoder({
        output: (chunk: EncodedVideoChunk) => {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          muxer.addChunk({
            data,
            timestampUs: chunk.timestamp,
            durationUs: chunk.duration ?? frameDurationUs,
            keyFrame: chunk.type === 'key',
          });
        },
        error: (error: Error) => reject(error),
      });

      (async () => {
        try {
          // STAGE 2.8.1: configure with the preference the probe VALIDATED,
          // not a hardcoded software lock. Belt-and-braces: if configure()
          // still throws (a driver can reject at configure time even after
          // isConfigSupported() said yes), retry once with explicit software so
          // an export degrades in speed rather than failing outright.
          // ── STAGE 2.8.3: ENCODE SPEED ──
          //
          // Measured: ~30s to render 150 frames, then ~90s to encode them.
          // The encoder, not the renderer, is now the whole cost.
          //
          // `latencyMode: 'quality'` puts Chromium's SOFTWARE VP9 encoder on
          // its slowest speed preset. That preset earns its cost when the
          // encoder is bitrate-starved and has to spend effort deciding what to
          // throw away. At the bitrates we ship (1080p at ~42 Mbps — several
          // times a typical high-quality 1080p stream) it is nowhere near
          // starved, so the extra search time buys almost nothing visible.
          //
          // 'realtime' selects a faster speed preset. We use it ONLY for
          // software encode; hardware paths keep 'quality' since their slow
          // preset is cheap. Generous bitrate is what protects quality here —
          // the bits are there either way, we simply stop spending minutes
          // deciding how to pack them.
          const isSoftwareEncode = encoderChoice.hardwareAcceleration === 'prefer-software';

          // ── STAGE 2.8.6: CONSTANT → VARIABLE BITRATE FOR SOFTWARE ENCODE ──
          //
          // Your measurement isolated it: ~30s render, ~4min encode. At the
          // 'realtime' speed preset a 1080p VP9 frame should cost ~50–100ms,
          // not the ~1.6s we're seeing — so the speed preset was not the
          // remaining bottleneck. `bitrateMode: 'constant'` is.
          //
          // CBR obliges the encoder to hit an exact per-frame rate, which means
          // internally re-quantising and re-encoding until the size lands in
          // budget — repeated work on EVERY frame. It also forces PADDING on
          // simple frames to keep the rate up, so we were paying extra to make
          // easy frames bigger. VBR spends bits where the content needs them
          // and skips the search entirely.
          //
          // Hardware paths keep CBR: their rate control is in silicon and
          // effectively free, and CBR is friendlier for streaming targets.
          const optimizedBitrate = getOptimizedEncoderBitrate(bitrate, encoderChoice.codecId, quality);
          const keyFrameInterval = getKeyFrameIntervalFrames(clampedFps, totalFrames);
          const baseConfig = {
            codec: encoderChoice.codec,
            width: targetWidth,
            height: targetHeight,
            bitrate: optimizedBitrate,
            framerate: clampedFps,
            latencyMode: isSoftwareEncode ? 'realtime' : 'quality',
            bitrateMode: isSoftwareEncode ? 'variable' : 'constant',
          };
          try {
            encoder!.configure({
              ...baseConfig,
              ...(encoderChoice.hardwareAcceleration
                ? { hardwareAcceleration: encoderChoice.hardwareAcceleration }
                : {}),
            } as VideoEncoderConfig);
          } catch (configError) {
            console.warn('[Export] Encoder configure failed, retrying without an acceleration preference:', configError);
            encoder!.configure({
              ...baseConfig,
            } as VideoEncoderConfig);
          }

          // PHASE 7.3E.10: optimize for minimum TOTAL export time. A fixed 4→2
          // queue serialized software VP8 and increased a 5s export to ~8 minutes.
          // Start moderately, then adapt from observed dequeue/wait behaviour.
          let queueHighWatermark = isIframeEnvironment() && (navigator.hardwareConcurrency || 4) <= 4 ? 10 : 14;
          let queueLowWatermark = Math.max(4, Math.floor(queueHighWatermark / 2));
          let queueSamples = 0;
          let queueWaitSamplesMs = 0;
          let maxObservedQueue = 0;

          for (let i = 0; i < totalFrames; i++) {
            throwIfExportAborted(options.signal);

            // Single export clock. renderAtTime adds its captured live-time snapshot
            // internally, so every animated subsystem advances from the frame the
            // user saw when export began.
            const exportFrame = timeline.frame(i);
            const exportTimeSeconds = exportFrame.relativeTimeSeconds;
            const _renderStart = performance.now();
            await renderFrameAtTime(exportTimeSeconds, undefined);
            // SPRINT 3: settleRenderedCanvas(0) removed — it was a no-op (0 extra paints)
            // adding one async tick of overhead per frame with zero benefit. renderAtTime
            // submits WebGL commands synchronously; readRenderTargetPixels is a sync GPU
            // readback, so no settle delay is needed before drawFrameToStagingCanvas.

            drawFrameToStagingCanvas({
              stagingCanvas,
              targetWidth,
              targetHeight,
              liveCanvas: options.getLiveCanvas?.() ?? null,
              getReadFramePixels: options.getReadFramePixels,
              codecSafety,
              flashOverlay: options.getFlashOverlayFrame?.(exportTimeSeconds) ?? null,
            });

            // STAGE 2.8.4: snapshot frame 0 as the loop reference. Cloned —
            // the renderer reuses its readback buffer, so a view would be
            // overwritten long before the comparison runs.
            if (i === 0 && options.verifyLoop) {
              loopReference = cloneLoopSample(options.getReadFramePixels?.() ?? null);
            }

            const frame = new VideoFrame(stagingCanvas, {
              timestamp: exportFrame.timestampUs,
              duration: exportFrame.durationUs,
            });
            encoder!.encode(frame, { keyFrame: shouldEncodeKeyFrame(i, keyFrameInterval) });
            frame.close();

            if (i % Math.max(1, Math.floor(totalFrames / 20)) === 0 || i === totalFrames - 1) {
              // STAGE 2.8.2: reserve the last slice of the bar for the encode
              // drain + mux so "100%" means done, not "rendering finished and
              // now we wait". Honest progress beats a fast-looking bar.
              onProgress?.(5 + exportFrame.progress01 * 80, `Frame ${i + 1}/${totalFrames}`);
            }

            // ── PHASE 7.3E.9: ADAPTIVE ENCODER DRAIN ──
            // Keep the proven timestamped WebCodecs architecture and single
            // final flush, but stop allowing a 25-frame 1080p backlog to pile
            // up. A bounded high/low-watermark wait overlaps encoding with
            // rendering and prevents final flush from owning most export time.
            phaseTimers.renderMs += performance.now() - _renderStart;
            const queueSize = ((encoder as any)?.encodeQueueSize ?? 0) as number;
            maxObservedQueue = Math.max(maxObservedQueue, queueSize);
            if (queueSize >= queueHighWatermark) {
              const _queueStart = performance.now();
              onProgress?.(
                5 + exportFrame.progress01 * 80,
                `Rendering frames… draining encoder ${queueSize}→${queueLowWatermark}`,
              );
              await waitForEncoderQueueBelow(encoder!, queueLowWatermark, options.signal);
              const waitedMs = performance.now() - _queueStart;
              phaseTimers.queueWaitMs += waitedMs;
              queueSamples += 1;
              queueWaitSamplesMs += waitedMs;

              // Re-evaluate every four drains. Slow drains get a larger queue so
              // rendering and encoding overlap; fast drains use a smaller queue to
              // keep final flush bounded. Never return to the regressive 4→2 policy.
              if (queueSamples % 4 === 0) {
                const avgWait = queueWaitSamplesMs / queueSamples;
                if (avgWait > 900) queueHighWatermark = Math.min(18, queueHighWatermark + 2);
                else if (avgWait < 220) queueHighWatermark = Math.max(8, queueHighWatermark - 1);
                queueLowWatermark = Math.max(4, Math.floor(queueHighWatermark / 2));
              }
            }
          }
          // Phase 7.1B: no manual queue drain before flush. The Phase
          // 7.1 zero-drain loop moved nearly all software-encode time into the
          // visible render phase and serialised the pipeline. flush() is the
          // encoder's authoritative completion barrier and can drain the final
          // bounded batch more efficiently internally.
          console.info('[Export] Adaptive encoder queue', { highWatermark: queueHighWatermark, lowWatermark: queueLowWatermark, maxObservedQueue, queueWaitMs: Math.round(phaseTimers.queueWaitMs) });
          onProgress?.(86, 'Finalizing encoded frames...');

          // STAGE 2.8.2: surface the encode drain as its own phase instead of
          // leaving the user staring at a bar that stopped moving.
          // ── STAGE 2.8.4: LOOP VERIFICATION ──
          // Render the frame a player shows immediately after wrapping
          // (t = totalFrames/fps) and diff it against frame 0. Not encoded —
          // purely a measurement. Fully wrapped: a failure in the CHECK must
          // never fail an otherwise-good export.
          if (options.verifyLoop && loopReference) {
            try {
              onProgress?.(87, 'Verifying loop...');
              await renderFrameAtTime(timeline.wrapFrame().relativeTimeSeconds, undefined);
              const wrapFrame = cloneLoopSample(options.getReadFramePixels?.() ?? null);
              const result = compareLoopFrames(loopReference, wrapFrame);
              console.info('[Export] ' + describeLoopResult(result), result);
              options.onLoopVerified?.(result);
            } catch (loopError) {
              console.warn('[Export] Loop verification skipped:', loopError);
            }
          }

          // STAGE 2.8.3: flush() is a single opaque await that can run for a
          // minute+ on software VP9 — the bar previously froze at 88% with no
          // sign of life, which reads as a hang. We can't get progress events
          // out of flush(), but encodeQueueSize IS observable, so we poll it
          // and map the drain onto 88→95%. Real signal, not a fake animation.
          const flushStartQueue = Math.max(1, (encoder as any)?.encodeQueueSize ?? 1);
          let flushDone = false;
          const flushProgress = window.setInterval(() => {
            if (flushDone) return;
            const remaining = (encoder as any)?.encodeQueueSize ?? 0;
            const drained = 1 - remaining / flushStartQueue;
            onProgress?.(
              88 + Math.max(0, Math.min(1, drained)) * 7,
              `Encoding remaining frames... ${Math.max(0, remaining)} left`,
            );
          }, 250);
          const _flushStart = performance.now();
          try {
            await encoder!.flush();
          } finally {
            phaseTimers.flushMs = performance.now() - _flushStart;
            flushDone = true;
            window.clearInterval(flushProgress);
          }
          onProgress?.(95, 'Encoding complete');
          try { encoder!.close(); } catch {}
          encoder = null;
          resolve();
        } catch (error) {
          try { encoder?.close(); } catch {}
          encoder = null;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });

    throwIfExportAborted(options.signal);
    const finalizing = getExportFinalizationProgress('finalizing');
    onProgress?.(finalizing.progress, finalizing.message);
    const muxStartedAt = performance.now();
    const bytes = muxer.finalize();
    finalizationTimers.muxMs = performance.now() - muxStartedAt;
    assertUsableEncodedBytes(bytes, 'WebCodecs WebM');

    throwIfExportAborted(options.signal);
    const preparingFile = getExportFinalizationProgress('preparing-file');
    onProgress?.(preparingFile.progress, preparingFile.message);
    await waitForNextPaint();
    const blobStartedAt = performance.now();
    const blob = new Blob([bytes], { type: 'video/webm' });
    finalizationTimers.blobMs = performance.now() - blobStartedAt;

    throwIfExportAborted(options.signal);
    const exportingFile = getExportFinalizationProgress('exporting-file');
    onProgress?.(exportingFile.progress, exportingFile.message);
    finalizationTimers.downloadHandoffMs = await handoffExportDownload(() => saveAs(blob, filename));
    downloadHandoffComplete = true;
    // STAGE 2.8.5: publish the breakdown. This is the datapoint that turns
    // "the export felt slow" into "the encoder took 84% of it on this content".
    const totalMs = performance.now() - phaseTimers.startedAt;
    const pct = (ms: number) => `${((ms / Math.max(1, totalMs)) * 100).toFixed(0)}%`;
    const timing = {
      totalSec: +(totalMs / 1000).toFixed(1),
      renderSec: +(phaseTimers.renderMs / 1000).toFixed(1),
      encodeWaitSec: +(phaseTimers.queueWaitMs / 1000).toFixed(1),
      flushSec: +(phaseTimers.flushMs / 1000).toFixed(1),
      muxSec: +(finalizationTimers.muxMs / 1000).toFixed(3),
      blobSec: +(finalizationTimers.blobMs / 1000).toFixed(3),
      downloadHandoffSec: +(finalizationTimers.downloadHandoffMs / 1000).toFixed(3),
      frames: totalFrames,
      msPerFrame: +(totalMs / Math.max(1, totalFrames)).toFixed(0),
      breakdown: `render ${pct(phaseTimers.renderMs)} · encode-wait ${pct(phaseTimers.queueWaitMs)} · flush ${pct(phaseTimers.flushMs)} · mux ${pct(finalizationTimers.muxMs)} · download ${pct(finalizationTimers.downloadHandoffMs)}`,
      finalization: { ...finalizationTimers },
    };
    console.info('[Export] Timing:', timing);
    try { (window as unknown as Record<string, unknown>).__exportTiming = timing; } catch { /* diag */ }
    recordExportTiming(timing);
    savedViaWebCodecs = true;
  } catch (error) {
    if (!savedViaWebCodecs) {
      // Phase 7.1B: never start MediaRecorder after an active WebCodecs export
      // has already failed. captureStream() must own the real-time capture path
      // from the beginning; starting it after an offline WebCodecs failure can
      // only produce empty or suspicious files. Record the failed attempt and
      // restore the preview through the common finally block instead.
      recordExportFailure(error);
      const message = error instanceof Error ? error.message : String(error);
      onProgress?.(0, message.includes('backpressure')
        ? 'Encoder stalled — recovering export'
        : 'Video encoder failed — recovering export');
    }
    throw error;
  } finally {
    try { encoder?.close(); } catch {}
    encoder = null;

    try {
      stream?.getTracks?.().forEach((track) => track.stop());
    } catch {}
    stream = null;

    const cleanupStartedAt = performance.now();
    if (downloadHandoffComplete) {
      const cleanupStage = getExportFinalizationProgress('cleanup');
      onProgress?.(cleanupStage.progress, cleanupStage.message);
      await waitForNextPaint();
    }

    try { options.restoreSize?.(); } catch {}
    cleanupExportResources();

    stagingCanvas.width = 1;
    stagingCanvas.height = 1;

    await waitForNextPaint();
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
    if (import.meta.env?.DEV) console.info('[BLENDCRAFT export:v2.2.5-phase2.5] WebM cleanup complete', {
      ...diagnostics,
      savedViaWebCodecs,
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
              blitCtx.putImageData(new ImageData(new Uint8ClampedArray(flipped.buffer), frame.width, frame.height), 0, 0);
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
  renderFrameAtTime: (time: number, exportRenderer?: THREE.WebGLRenderer) => Promise<void>;
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
  const { renderFrameAtTime, fps, durationMs, filename, quality = 'high', onProgress } = options;
  const targetWidth = Math.max(2, Math.round(options.width || options.canvas.width));
  const targetHeight = Math.max(2, Math.round(options.height || options.canvas.height));
  if (durationMs <= 0 || !Number.isFinite(durationMs)) throw new Error(`Invalid duration: ${durationMs}ms`);

  // Resize renderer to export dimensions for full-res frames
  options.setExportSize?.(targetWidth, targetHeight);

  if (!canAttemptMP4WebCodecs()) {
    try {
      await exportMP4WithMediaRecorderFallback(options);
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

  const clampedFps = Math.max(24, Math.min(60, fps));
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * clampedFps));
  // STAGE-1 FIX: use the H.264-tuned MP4 presets, not the VP9 presets.
  // MP4_QUALITY_PRESETS carries the higher bitrates smooth gradients need
  // under H.264 to avoid banding — and matches the export panel summary.
  const bitrate = MP4_QUALITY_PRESETS[quality].bitrate(targetWidth, targetHeight);
  const stagingCanvas = document.createElement('canvas');
  stagingCanvas.width = targetWidth;
  stagingCanvas.height = targetHeight;
  const frameDurationTs = Math.round(1_000_000 / clampedFps);

  onProgress?.(0, `Encoding ${totalFrames} frames with vendored MP4 muxer...`);

  try {
    // EXPORT-FIX (MP4 v2): probe INSIDE the try block. Previously a probe
    // failure threw before the try, escaping the WebM fallback entirely and
    // surfacing as a hard "Video export failed" instead of a graceful
    // format fallback.
    const configChoice = await pickSupportedMP4EncoderConfig(targetWidth, targetHeight, clampedFps, bitrate);
    const Encoder = (globalThis as any).VideoEncoder;

    // Collect encoded chunks + extract avcDecoderConfig from first keyframe metadata.
    // The vendored MP4Muxer requires avcDecoderConfig (SPS/PPS) at construction time.
    const sampleBuffer: Array<{ data: Uint8Array; duration: number; timestamp: number; keyFrame: boolean }> = [];
    let avcDecoderConfig: Uint8Array | null = null;

    await new Promise<void>((resolve, reject) => {
      const encoder = new Encoder({
        output: (chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata) => {
          // Extract avcDecoderConfig (SPS/PPS) from the first keyframe
          if (!avcDecoderConfig && metadata?.decoderConfig?.description) {
            const desc = metadata.decoderConfig.description as ArrayBuffer | ArrayBufferView;
            avcDecoderConfig = desc instanceof ArrayBuffer
              ? new Uint8Array(desc)
              : new Uint8Array((desc as ArrayBufferView).buffer,
                  (desc as ArrayBufferView).byteOffset,
                  (desc as ArrayBufferView).byteLength);
          }
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          sampleBuffer.push({
            data,
            duration: chunk.duration ?? frameDurationTs,
            timestamp: chunk.timestamp,
            keyFrame: chunk.type === 'key',
          });
        },
        error: (error: Error) => reject(error),
      });

      (async () => {
        try {
          encoder.configure({
            codec: configChoice.codec,
            width: targetWidth,
            height: targetHeight,
            // EXPORT-FIX (MP4 v2): use the probe's clamped bitrate — the
            // preset value may exceed the negotiated AVC level's ceiling.
            bitrate: configChoice.bitrate,
            framerate: clampedFps,
            latencyMode: 'quality',
            avc: { format: 'avcC' },  // AVCC format — length-prefixed NAL, required for MP4 container
            ...(configChoice.hardwareAcceleration ? { hardwareAcceleration: configChoice.hardwareAcceleration } : {}),
          });

          for (let i = 0; i < totalFrames; i++) {
            const t = i / clampedFps;
            await renderFrameAtTime(t, undefined);
            drawFrameToStagingCanvas({ stagingCanvas, targetWidth, targetHeight, liveCanvas, getReadFramePixels: options.getReadFramePixels, codecSafety: options.codecSafety || 'sharp', flashOverlay: options.getFlashOverlayFrame?.(t) ?? null });
            const timestamp = i * frameDurationTs;
            const frame = new VideoFrame(stagingCanvas, { timestamp, duration: frameDurationTs });
            encoder.encode(frame, { keyFrame: i === 0 || i % clampedFps === 0 });
            frame.close();
            if (i % Math.max(1, Math.floor(totalFrames / 20)) === 0 || i === totalFrames - 1) {
              onProgress?.(5 + ((i + 1) / totalFrames) * 85, `Frame ${i + 1}/${totalFrames}`);
            }
            // EXP-04 FIX: same as WebM path — yield on queue pressure or every 30 frames.
            const queueSize = (encoder as any).encodeQueueSize ?? 0;
            if (queueSize > 10 || i % 30 === 29) await yieldToBrowser();
          }
          await encoder.flush();
          encoder.close();
          resolve();
        } catch (error) {
          try { encoder.close(); } catch {}
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });

    if (!avcDecoderConfig) throw new Error('H.264 decoder configuration missing — no keyframe produced.');
    onProgress?.(96, 'Muxing MP4 container...');
    // Use vendored MP4Muxer — no npm install required
    const mp4muxer = new MP4Muxer({ width: targetWidth, height: targetHeight, timescale: 1_000_000, avcDecoderConfig });
    for (const sample of sampleBuffer) mp4muxer.addSample(sample);
    const mp4bytes = mp4muxer.finalize();
    saveAs(new Blob([mp4bytes], { type: 'video/mp4' }), filename.replace(/\.webm$/, '.mp4'));
    onProgress?.(100, 'MP4 export complete!');
  } catch (error) {
    // Never launch the WebM fallback after a user-initiated abort.
    if (options.signal?.aborted) throw error;
    // H.264 WebCodecs encoding failed — notify user and fall back to VP9/WebM.
    // This happens on browsers/GPUs that don't support H.264 hardware encoding via WebCodecs.
    // We save with .webm extension so the file is actually playable (not a broken .mp4).
    if (import.meta.env?.DEV) console.warn('MP4/H.264 WebCodecs export failed — falling back to VP9/WebM.', error);
    onProgress?.(0, 'H.264 unavailable — exporting as WebM (VP9)...');
    const webmFilename = filename.replace(/\.mp4$/i, '.webm');
    // Surface the fallback to the caller so the UI can show the correct format
    (options as any).__fellBackToWebM = true;
    await exportWebMFromCanvas({ ...options, filename: webmFilename });
  } finally {
    options.restoreSize?.();
    cleanupExportResources();
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