/**
 * mediabunnyExport.ts — core video encode engine (Mediabunny-based)
 * ===================================================================
 *
 * Replaces the previous hand-rolled WebCodecs + vendored-muxer pipeline
 * (src/app/lib/vendored/mp4-muxer.ts, webm-muxer.ts — both forks of
 * packages the upstream author deprecated in favor of Mediabunny).
 *
 * This module owns exactly one job: given a canvas that gets redrawn on
 * demand and a frame count, produce a real MP4 or WebM Blob. It knows
 * nothing about BlendCraft's render pipeline, export UI, or duration
 * planning — that orchestration stays in exportUtils.ts / ExportPanel.tsx,
 * which call this module with a `drawFrame` callback.
 *
 * Why Mediabunny instead of hand-rolled VideoEncoder + muxer:
 * - `CanvasSource.add()` is awaited — genuine backpressure. The
 *   previous code polled `encoder.encodeQueueSize` against hand-tuned
 *   watermark tables per resolution/codec/hardware combination to
 *   approximate this. Mediabunny gives it for free.
 * - `canEncodeVideo()` / `getFirstEncodableVideoCodec()` replace a
 *   hand-built AVC profile × level negotiation table (AVC_LEVEL_TABLE)
 *   that had to be manually extended every time a new rejection surfaced
 *   (e.g. the avc1.42001f Baseline-profile rejection bug).
 * - Actively maintained by the same author as the two deprecated
 *   packages this replaces; zero dependencies of its own.
 *
 * Uses Mediabunny's `CanvasSource`, matching the proven Visual Mood Labs
 * export contract. The caller draws the authoritative presentation canvas
 * into one fixed staging canvas, then this module asks CanvasSource to capture
 * that canvas at an explicit deterministic timestamp and duration.
 */

import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  CanvasSource,
  canEncodeVideo,
  type VideoCodec,
} from 'mediabunny';
import { isIframeEnvironment } from '../utils/environment';

export type MediabunnyContainer = 'mp4' | 'webm';

export interface MediabunnyEncodeOptions {
  /** Canvas Mediabunny reads pixels from on each add() call. Caller is
   *  responsible for drawing the correct frame content into it before
   *  calling drawFrame's returned/awaited step — see drawFrame below. */
  stagingCanvas: HTMLCanvasElement;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  /** Target bitrate in bits/sec. */
  bitrate: number;
  container: MediabunnyContainer;
  /**
   * Called once per frame, before that frame is captured. Must render the
   * scene and draw the result onto `stagingCanvas` (synchronously or via
   * the returned promise) before resolving.
   */
  drawFrame: (frameIndex: number, timeSeconds: number) => Promise<void> | void;
  /** Maximum seconds between keyframes. Mediabunny defaults to 2s if omitted. */
  keyFrameIntervalSeconds?: number;
  signal?: AbortSignal;
  onProgress?: (progress: number, message?: string) => void;
  /** Called once Mediabunny supplies the active encoder config. The browser's
   *  hardwareAcceleration value remains a preference hint, not proof of the
   *  underlying implementation; policy decisions use measured throughput. */
  onEncoderConfig?: (info: {
    codec: string;
    hardwareAcceleration?: string;
    width: number;
    height: number;
    latencyMode: 'quality' | 'realtime';
    policy: 'iframe-software' | 'hardware-first' | 'software-fallback' | 'measured-software-fallback' | 'realtime-default';
  }) => void;
}

export interface MediabunnyEncodeResult {
  blob: Blob;
  container: MediabunnyContainer;
  mimeType: string;
  /** Wall-clock time spent inside drawFrame across all frames, ms. */
  renderMs: number;
  /** Wall-clock time spent awaiting CanvasSource.add() across all
   *  frames, ms. This is the real encode + backpressure cost — the honest
   *  replacement for the old "queueWaitMs" watermark-drain metric. */
  encodeMs: number;
  /** Public Mediabunny completion boundary: encoder drain + mux/target finalize.
   *  These cannot be safely split without depending on private internals. */
  finalizeMs: number;
}

interface EncoderPolicy {
  hardwareAcceleration: 'no-preference' | 'prefer-hardware' | 'prefer-software';
  latencyMode: 'quality' | 'realtime';
  policy: 'iframe-software' | 'hardware-first' | 'software-fallback' | 'measured-software-fallback' | 'realtime-default';
}

interface H264PerformanceHistory {
  hardware?: { totalEncoderMsPerFrame: number; sampledAt: number };
  software?: { totalEncoderMsPerFrame: number; sampledAt: number };
}

const H264_PERFORMANCE_PREFIX = 'blendcraft:h264-encoder-performance:v2';
const H264_PERFORMANCE_TTL_MS = 24 * 60 * 60 * 1000;

function h264PerformanceKey(width: number, height: number, fps: number, bitrate: number): string {
  return `${H264_PERFORMANCE_PREFIX}:${width}x${height}:${fps}:${bitrate}`;
}

function readH264Performance(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): H264PerformanceHistory {
  try {
    const raw = localStorage.getItem(h264PerformanceKey(width, height, fps, bitrate));
    return raw ? JSON.parse(raw) as H264PerformanceHistory : {};
  } catch {
    return {};
  }
}

function recordH264Performance(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
  policy: EncoderPolicy['policy'],
  totalEncoderMsPerFrame: number,
): void {
  if (!Number.isFinite(totalEncoderMsPerFrame) || totalEncoderMsPerFrame <= 0 || policy === 'iframe-software') return;
  try {
    const history = readH264Performance(width, height, fps, bitrate);
    const sample = { totalEncoderMsPerFrame, sampledAt: Date.now() };
    if (policy === 'hardware-first') history.hardware = sample;
    if (policy === 'software-fallback' || policy === 'measured-software-fallback') history.software = sample;
    localStorage.setItem(h264PerformanceKey(width, height, fps, bitrate), JSON.stringify(history));
  } catch {
    // Storage may be disabled; the explicit capability fallback still applies.
  }
}

function shouldUseMeasuredSoftwareFallback(history: H264PerformanceHistory, fps: number): boolean {
  const hardware = history.hardware;
  if (!hardware || Date.now() - hardware.sampledAt > H264_PERFORMANCE_TTL_MS) return false;
  const slowThresholdMs = Math.max(50, (1000 / fps) * 1.5);
  if (hardware.totalEncoderMsPerFrame <= slowThresholdMs) return false;

  const software = history.software;
  if (!software || Date.now() - software.sampledAt > H264_PERFORMANCE_TTL_MS) return true;
  return software.totalEncoderMsPerFrame < hardware.totalEncoderMsPerFrame * 0.9;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

/**
 * Runs the render+encode pass as a genuine `requestAnimationFrame` loop —
 * each frame's work happens inside a real rAF callback, which schedules the
 * next frame's rAF callback only once that frame's async work resolves.
 *
 * This replaces a plain `for` loop with a `setTimeout`-based yield between
 * iterations, which turned out to be a materially weaker signal to
 * Chromium than genuine rAF-paced work: the frame production loop in
 * Visual Mood Lab's proven-stable architecture (Mediabunny + WebCodecs,
 * documented in `video-export-architecture.md` §4) is *itself* a real rAF
 * loop, not a for-loop with a decorative rAF running alongside it — "own
 * requestAnimationFrame loop... each tick → draw, await add(), repeat."
 * Driving the actual frame work through rAF, rather than merely pinging an
 * empty rAF callback in parallel, is the structural difference worth
 * testing directly against BlendCraft's finalize-stage stall.
 */
function runFrameLoopViaRAF(params: {
  totalFrames: number;
  fps: number;
  signal?: AbortSignal;
  onFrame: (frameIndex: number, timeSeconds: number) => Promise<void>;
}): Promise<void> {
  const { totalFrames, fps, signal, onFrame } = params;
  return new Promise<void>((resolve, reject) => {
    let rafHandle: number | null = null;
    let cancelled = false;

    const stop = () => {
      cancelled = true;
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    };

    const onAbort = () => {
      stop();
      reject(new DOMException('Export cancelled.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const step = (i: number) => {
      if (cancelled) return;
      if (signal?.aborted) { onAbort(); return; }

      if (i >= totalFrames) {
        signal?.removeEventListener('abort', onAbort);
        resolve();
        return;
      }

      const t = i / fps;
      onFrame(i, t)
        .then(() => {
          if (cancelled) return;
          rafHandle = requestAnimationFrame(() => step(i + 1));
        })
        .catch((error) => {
          signal?.removeEventListener('abort', onAbort);
          stop();
          reject(error);
        });
    };

    rafHandle = requestAnimationFrame(() => step(0));
  });
}

/**
 * Keeps a minimal, no-op requestAnimationFrame loop alive during
 * `output.finalize()` specifically — the one phase of the export that has
 * no per-frame work of its own to ride on. The frame production loop above
 * is now genuinely rAF-paced end to end, so this is only needed for the
 * single-await finalize tail where nothing else is ticking the compositor.
 */
function startCompositorKeepAlive(): () => void {
  let handle: number | null = null;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    if (handle !== null) cancelAnimationFrame(handle);
  };
}

/**
 * Acquires a Screen Wake Lock for the duration of encode + finalize.
 *
 * Traced the actual stall into Mediabunny's own source: `output.finalize()`
 * calls into `flushAndClose()`, which does `await this.encoder.flush()` —
 * a call straight into the browser's native VideoEncoder, not JS code
 * Mediabunny controls (Mediabunny's own source even carries a comment citing
 * a specific Chromium bug it already works around at that exact call site).
 * A no-op rAF loop can't fix a stall inside the browser's own media
 * pipeline — flush()'s completion isn't driven by anything JS scheduling
 * touches. But the symptom (genuinely stuck, not slow — confirmed by
 * waiting 1 minute vs 5 minutes making no difference, only opening devtools
 * unsticking it either way) matches Chromium's idle/backgrounding
 * throttling being lifted, which devtools attachment is known to do
 * incidentally. Wake Lock is the real API for "don't throttle this tab
 * because it looks idle" — the actual intended fix for this class of
 * problem, not a workaround bolted on from the outside.
 */
async function acquireExportWakeLock(): Promise<{ release: () => void }> {
  const nav = navigator as Navigator & {
    wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
  };
  if (!nav.wakeLock) return { release: () => {} };
  try {
    const sentinel = await nav.wakeLock.request('screen');
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) console.info('[BLENDCRAFT export:mediabunny] Screen Wake Lock acquired for export.');
    return { release: () => { sentinel.release().catch(() => {}); } };
  } catch (error) {
    // Wake Lock can be refused (no user activation, permissions policy,
    // low battery on some platforms) — export should proceed regardless,
    // just without this mitigation.
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) console.warn('[BLENDCRAFT export:mediabunny] Screen Wake Lock unavailable:', error);
    return { release: () => {} };
  }
}

function mediaCodecFor(container: MediabunnyContainer): VideoCodec {
  return container === 'mp4' ? 'avc' : 'vp9';
}

/**
 * Capability probe: can this browser actually encode the given
 * container/codec/resolution/framerate combination right now? Replaces the
 * hand-rolled AVC level-table walk and the WebM VP9/VP8 candidate probing —
 * Mediabunny's canEncodeVideo() queries the browser's real WebCodecs support
 * directly instead of guessing from a static table.
 */
export async function canEncodeContainer(
  container: MediabunnyContainer,
  width: number,
  height: number,
  fps: number,
): Promise<boolean> {
  try {
    return await canEncodeVideo(mediaCodecFor(container), {
      width,
      height,
      framerate: fps,
    } as never);
  } catch {
    return false;
  }
}

async function resolveEncoderPolicy(
  container: MediabunnyContainer,
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<EncoderPolicy> {
  if (isIframeEnvironment()) {
    return {
      hardwareAcceleration: 'prefer-software',
      latencyMode: 'realtime',
      policy: 'iframe-software',
    };
  }

  if (container === 'mp4') {
    const performanceHistory = readH264Performance(width, height, fps, bitrate);
    if (shouldUseMeasuredSoftwareFallback(performanceHistory, fps)) {
      return {
        hardwareAcceleration: 'prefer-software',
        latencyMode: 'realtime',
        policy: 'measured-software-fallback',
      };
    }

    const hardwareSupported = await canEncodeVideo('avc', {
      width,
      height,
      bitrate,
      hardwareAcceleration: 'prefer-hardware',
    }).catch(() => false);

    if (hardwareSupported) {
      return {
        hardwareAcceleration: 'prefer-hardware',
        // Realtime bounds internal frame reordering and avoids a large native
        // queue being deferred until finalize. Bitrate remains quality-owned.
        latencyMode: 'realtime',
        policy: 'hardware-first',
      };
    }

    return {
      hardwareAcceleration: 'prefer-software',
      latencyMode: 'realtime',
      policy: 'software-fallback',
    };
  }

  return {
    hardwareAcceleration: 'no-preference',
    latencyMode: 'realtime',
    policy: 'realtime-default',
  };
}

/**
 * Core Mediabunny encode pass. Container-agnostic — MP4 and WebM take the
 * identical code path, differing only in which OutputFormat/codec gets
 * selected. This symmetry is itself a simplification: the previous code had
 * two largely-parallel ~250-line implementations (exportMP4FromCanvas,
 * exportWebMFromCanvas) that had independently drifted in behavior.
 */
export async function encodeVideoWithMediabunny(
  options: MediabunnyEncodeOptions,
): Promise<MediabunnyEncodeResult> {
  const {
    stagingCanvas,
    width,
    height,
    fps,
    totalFrames,
    bitrate,
    container,
    drawFrame,
    signal,
    onProgress,
    onEncoderConfig,
  } = options;

  throwIfAborted(signal);
  if (totalFrames <= 0) throw new Error(`totalFrames must be positive (got ${totalFrames}).`);
  if (stagingCanvas.width !== width || stagingCanvas.height !== height) {
    throw new Error(
      `stagingCanvas is ${stagingCanvas.width}\u00d7${stagingCanvas.height} but encode was requested at ${width}\u00d7${height} — caller must size the canvas before calling.`
    );
  }

  const format = container === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat();
  const target = new BufferTarget();
  const output = new Output({ format, target });

  // Keeps the compositor pumping through the entire encode + finalize pass
  // — see startCompositorKeepAlive() doc comment. Started before any
  // encoder work begins, stopped unconditionally in the finally block below
  // (success, thrown error, or abort all need it torn down).
  const stopKeepAlive = startCompositorKeepAlive();
  const wakeLock = await acquireExportWakeLock();

  try {
    // Iframe hardware-encoder instability (Figma Make host): hardware H.264 has
    // crashed the GPU process mid-encode in this environment, and Chromium
    // blocklists the encoder for the rest of the session afterward — every
    // later probe then fails too. Prefer software first inside iframes;
    // standalone tabs explicitly probe hardware H.264, then use realtime
    // software only when that hardware configuration is unavailable.
    const encoderPolicy = await resolveEncoderPolicy(container, width, height, fps, bitrate);
    const { hardwareAcceleration, latencyMode } = encoderPolicy;

    const videoSource = new CanvasSource(stagingCanvas, {
      codec: mediaCodecFor(container),
      bitrate,
      hardwareAcceleration,
      keyFrameInterval: options.keyFrameIntervalSeconds ?? 2,
      latencyMode,
      onEncoderConfig: (config) => {
        onEncoderConfig?.({
          codec: (config as { codec?: string }).codec ?? mediaCodecFor(container),
          hardwareAcceleration: (config as { hardwareAcceleration?: string }).hardwareAcceleration,
          width: (config as { width?: number }).width ?? stagingCanvas.width,
          height: (config as { height?: number }).height ?? stagingCanvas.height,
          latencyMode,
          policy: encoderPolicy.policy,
        });
      },
    });
    output.addVideoTrack(videoSource, { frameRate: fps });
    await output.start();

    const frameDurationSeconds = 1 / fps;
    let renderMs = 0;
    let encodeMs = 0;

    const progressStep = Math.max(1, Math.floor(totalFrames / 20));

    await runFrameLoopViaRAF({
      totalFrames,
      fps,
      signal,
      onFrame: async (i, t) => {
        const renderStart = performance.now();
        await drawFrame(i, t);
        renderMs += performance.now() - renderStart;

        throwIfAborted(signal);
        const encodeStart = performance.now();

        // Deterministic offline timing is retained even though capture now uses
        // the same CanvasSource contract as Visual Mood Labs. Awaiting add()
        // is the encoder/writer backpressure barrier for every frame.
        await videoSource.add(t, frameDurationSeconds);

        encodeMs += performance.now() - encodeStart;

        if (i % progressStep === 0 || i === totalFrames - 1) {
          onProgress?.(5 + ((i + 1) / totalFrames) * 85, `Frame ${i + 1}/${totalFrames}`);
        }
      },
    });

    throwIfAborted(signal);
    // Match Visual Mood Labs exactly: after the last awaited CanvasSource.add,
    // let the public Output API own source drain, encoder flush, mux closure,
    // and target finalization. Do not call source.close() or inspect private
    // Mediabunny promises.
    onProgress?.(91, `Draining encoder and finalizing ${container.toUpperCase()}...`);
    const finalizeStart = performance.now();
    await output.finalize();
    const finalizeMs = performance.now() - finalizeStart;

    if (container === 'mp4') {
      recordH264Performance(
        width,
        height,
        fps,
        bitrate,
        encoderPolicy.policy,
        (encodeMs + finalizeMs) / Math.max(1, totalFrames),
      );
    }

    const buffer = target.buffer;
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
      throw new Error(`Mediabunny finalized without producing an output buffer (${container}).`);
    }

    const mimeType = container === 'mp4' ? 'video/mp4' : 'video/webm';
    return {
      blob: new Blob([buffer], { type: mimeType }),
      container,
      mimeType,
      renderMs,
      encodeMs,
      finalizeMs,
    };
  } finally {
    stopKeepAlive();
    wakeLock.release();
  }
}
