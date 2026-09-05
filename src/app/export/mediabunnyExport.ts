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
import {
  certifyExportTimeline,
  type ExportTimelineCertificationResult,
  type ExportTimelineFrameCertification,
  type RenderedTimelineFrameState,
} from '../utils/exportTimelineCertification';

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
  drawFrame: (frameIndex: number, timeSeconds: number) => Promise<RenderedTimelineFrameState | void> | RenderedTimelineFrameState | void;
  /** Maximum seconds between keyframes. Mediabunny defaults to 2s if omitted. */
  keyFrameIntervalSeconds?: number;
  signal?: AbortSignal;
  onProgress?: (progress: number, message?: string) => void;
  /** Called once Mediabunny supplies the active browser encoder config. */
  onEncoderConfig?: (info: {
    codec: string;
    hardwareAcceleration?: string;
    width: number;
    height: number;
    latencyMode?: 'quality' | 'realtime';
    policy: 'browser-default' | 'webm-realtime';
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
  /** Frame-by-frame proof that render and CanvasSource consumed one timeline. */
  timelineCertification: ExportTimelineCertificationResult;
}

const OBSOLETE_H264_PERFORMANCE_PREFIX = 'blendcraft:h264-encoder-performance:v2';
let obsoleteH264HistoryCleared = false;

/** Remove Phase 7.3F.5's preference-driving history once, without touching any
 * other saved project or application state. Encoder timings remain reported in
 * __exportTiming but never choose a production encoder configuration. */
export function clearObsoleteH264PerformanceHistory(): void {
  if (obsoleteH264HistoryCleared) return;
  obsoleteH264HistoryCleared = true;
  try {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(OBSOLETE_H264_PERFORMANCE_PREFIX))
      .forEach((key) => localStorage.removeItem(key));
  } catch {
    // Storage can be disabled. Encoder construction must remain available.
  }
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
    if (container === 'mp4') clearObsoleteH264PerformanceHistory();

    const reportEncoderConfig = (
      policy: 'browser-default' | 'webm-realtime',
      config: { codec?: string; hardwareAcceleration?: string; width?: number; height?: number; latencyMode?: 'quality' | 'realtime' },
    ) => {
      onEncoderConfig?.({
        codec: config.codec ?? mediaCodecFor(container),
        hardwareAcceleration: config.hardwareAcceleration,
        width: config.width ?? stagingCanvas.width,
        height: config.height ?? stagingCanvas.height,
        latencyMode: config.latencyMode,
        policy,
      });
    };

    // MP4 mirrors Visual Mood Labs' known-good construction exactly: codec and
    // bitrate are the only encoder-policy inputs. No hardwareAcceleration or
    // latencyMode preference is supplied, so the browser selects its stable
    // quality implementation. WebM retains its established realtime policy.
    const videoSource = container === 'mp4'
      ? new CanvasSource(stagingCanvas, {
          codec: 'avc',
          bitrate,
          onEncoderConfig: (config) => reportEncoderConfig('browser-default', config),
        })
      : new CanvasSource(stagingCanvas, {
          codec: 'vp9',
          bitrate,
          keyFrameInterval: options.keyFrameIntervalSeconds ?? 2,
          latencyMode: 'realtime',
          onEncoderConfig: (config) => reportEncoderConfig('webm-realtime', config),
        });
    output.addVideoTrack(videoSource, { frameRate: fps });
    await output.start();

    const frameDurationSeconds = 1 / fps;
    let renderMs = 0;
    let encodeMs = 0;
    const timelineFrames: ExportTimelineFrameCertification[] = [];

    const progressStep = Math.max(1, Math.floor(totalFrames / 20));

    await runFrameLoopViaRAF({
      totalFrames,
      fps,
      signal,
      onFrame: async (i, t) => {
        const renderStart = performance.now();
        const rendered = await drawFrame(i, t);
        renderMs += performance.now() - renderStart;

        throwIfAborted(signal);
        const encodeStart = performance.now();

        // Deterministic offline timing is retained even though capture now uses
        // the same CanvasSource contract as Visual Mood Labs. Awaiting add()
        // is the encoder/writer backpressure barrier for every frame.
        await videoSource.add(t, frameDurationSeconds);

        timelineFrames.push({
          frameIndex: i,
          requestedTimestamp: t,
          renderedDeterministicTime: rendered?.renderedDeterministicTime ?? t,
          encodedTimestamp: t,
          encodedDuration: frameDurationSeconds,
          layers: rendered?.layers ?? [],
        });

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

    const timelineCertification = certifyExportTimeline(timelineFrames, fps, totalFrames);
    if (!timelineCertification.passed) {
      console.error('[BLENDCRAFT export] Timeline certification failed:', timelineCertification);
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
      timelineCertification,
    };
  } finally {
    stopKeepAlive();
    wakeLock.release();
  }
}
