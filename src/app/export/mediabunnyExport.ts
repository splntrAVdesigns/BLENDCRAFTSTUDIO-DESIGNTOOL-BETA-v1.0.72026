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
} from 'mediabunny';
import {
  certifyExportTimeline,
  type ExportTimelineCertificationResult,
  type ExportTimelineFrameCertification,
  type RenderedTimelineFrameState,
} from '../utils/exportTimelineCertification';
import {
  buildCanvasSourceConfig,
  mediaCodecFor,
  type MediabunnyContainer,
} from './mediabunnyEncodeShared';

export type { MediabunnyContainer };

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
  /** Maximum seconds between keyframes. Defaults to
   *  DEFAULT_KEYFRAME_INTERVAL_SECONDS (mediabunnyEncodeShared.ts) if omitted,
   *  applied identically for MP4 and WebM by both encode paths. */
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
 * Thrown only when the worker-based encode path fails during its own setup,
 * before any frame has been submitted to it. The public dispatcher
 * (`encodeVideoWithMediabunny`) treats this specific error as safe to fall
 * back from — nothing has happened yet that a retry on the main thread
 * would duplicate or conflict with. Any other error from the worker path
 * (i.e. anything after `handleInit` succeeds) propagates as a real failure,
 * exactly like a main-thread encode error would — silently restarting an
 * export that's already partway through would waste the user's time and
 * could double-submit work.
 */
class WorkerEncodeInitError extends Error {}

/** Diagnostic only — see the call sites in both encode paths. Shared so the
 *  threshold and message can't drift between the two paths. */
function verifyEncodedBitrate(params: {
  buffer: ArrayBuffer;
  requestedBitrate: number;
  totalFrames: number;
  fps: number;
  width: number;
  height: number;
  container: MediabunnyContainer;
}): void {
  const { buffer, requestedBitrate, totalFrames, fps, width, height, container } = params;
  const actualDurationSeconds = totalFrames / fps;
  const actualBitrate = actualDurationSeconds > 0
    ? Math.round((buffer.byteLength * 8) / actualDurationSeconds)
    : 0;
  if (actualBitrate > 0 && actualBitrate < requestedBitrate * 0.85) {
    console.warn(
      `[BLENDCRAFT export] Encoded bitrate (${(actualBitrate / 1_000_000).toFixed(1)} Mbps) is ` +
      `notably below the requested quality bitrate (${(requestedBitrate / 1_000_000).toFixed(1)} Mbps) for ` +
      `this ${container.toUpperCase()} export. This can be a legitimately simple scene compressing ` +
      `well, or the browser's hardware encoder silently capping throughput below what was requested.`,
      { requestedBitrate, actualBitrate, width, height, container },
    );
  }
}

/** Feature detection for the worker-based encode path. All three of these
 *  ship together in every browser that supports WebCodecs via Mediabunny in
 *  the first place, so this is expected to be true almost everywhere the
 *  app already works — this is a defensive check, not an expected fallback
 *  trigger in practice. */
export function isWorkerEncodeSupported(): boolean {
  return typeof Worker !== 'undefined'
    && typeof OffscreenCanvas !== 'undefined'
    && typeof createImageBitmap === 'function';
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
 * Keeps a minimal, no-op tick alive during `output.finalize()` specifically
 * — the one phase of the export that has no per-frame work of its own to
 * ride on. The frame production loop above is genuinely rAF-paced end to
 * end, so this is only needed for the single-await finalize tail where
 * nothing else is ticking.
 *
 * Uses setInterval, not requestAnimationFrame. Confirmed against Chromium's
 * own background-tab documentation: rAF callbacks are not invoked at all
 * while a page is hidden — not throttled, simply never fired. A rAF-based
 * keep-alive here does nothing during exactly the scenario ("user switched
 * windows while finalize() was pending") it exists to cover. setInterval
 * continues to fire even in a hidden tab (clamped to ~1/sec after
 * prolonged backgrounding, per Chromium's budget-based timer throttling),
 * which is what actually keeps this tail phase making progress.
 */
function startCompositorKeepAlive(): () => void {
  let stopped = false;
  const intervalId = setInterval(() => {
    if (stopped) clearInterval(intervalId);
  }, 200);
  return () => {
    stopped = true;
    clearInterval(intervalId);
  };
}

/**
 * Plays one genuinely audible (not silent, not muted) low-level tone for the
 * duration of encode + finalize. This is the actual Chromium mechanism that
 * exempts a tab from background timer/rAF throttling — confirmed via
 * Chromium's own background-tab throttling documentation: "Applications
 * playing audio are considered foreground and aren't throttled," and
 * explicitly, "Silent audio streams do not grant exemptions." Screen Wake
 * Lock (see acquireExportWakeLock below) does not cover this: Wake Lock is
 * released automatically the moment the tab is hidden, which is exactly the
 * scenario this needs to survive.
 *
 * Gain is set just above Chromium's "IsAudible" detection floor and the
 * frequency is set low (near the bottom of human hearing) specifically to
 * minimize how noticeable this is, while still being a real non-zero signal
 * the browser's audio pipeline classifies as active playback. Started from
 * the same call stack as the user's Export click (via encodeVideoWithMediabunny),
 * satisfying the autoplay-gesture requirement for AudioContext.
 */
async function acquireExportAudibleKeepAlive(): Promise<{ release: () => void }> {
  try {
    const AudioContextCtor = (window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    }).AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return { release: () => {} };

    const ctx = new AudioContextCtor();
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.008; // ~-42dBFS: well above Chromium's audibility floor, quiet in practice
    oscillator.frequency.value = 20; // bottom edge of human hearing
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();

    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
      console.info('[BLENDCRAFT export:mediabunny] Audible keep-alive active (background-tab throttling exemption).');
    }

    return {
      release: () => {
        try { oscillator.stop(); } catch { /* already stopped */ }
        try { oscillator.disconnect(); } catch { /* already disconnected */ }
        try { gain.disconnect(); } catch { /* already disconnected */ }
        ctx.close().catch(() => {});
      },
    };
  } catch (error) {
    // Autoplay policy can still refuse this in some contexts (e.g. no user
    // activation reachable, permissions policy). Export must proceed
    // regardless — this is a mitigation, not a requirement.
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
      console.warn('[BLENDCRAFT export:mediabunny] Audible keep-alive unavailable:', error);
    }
    return { release: () => {} };
  }
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
 * Core Mediabunny encode pass, running entirely on the main thread.
 * Container-agnostic — MP4 and WebM take the identical code path, differing
 * only in which OutputFormat/codec gets selected. This symmetry is itself a
 * simplification: the previous code had two largely-parallel ~250-line
 * implementations (exportMP4FromCanvas, exportWebMFromCanvas) that had
 * independently drifted in behavior.
 *
 * This is the original, proven implementation — kept as-is and used as the
 * automatic fallback when the worker-based path (see
 * `encodeVideoWithMediabunnyViaWorker` below) isn't available, or fails
 * during its own setup before any frames were submitted. It is also still
 * the path actually used for encode/finalize when the worker path is
 * unsupported, so it must keep working on its own.
 */
export async function encodeVideoWithMediabunnyMainThread(
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
  const encoderProgress = {
    phase: 'encoding', submittedFrames: 0, outputPackets: 0,
    lastPacketTimestamp: null as number | null,
    finalizationElapsedSec: 0, secondsSinceLastPacket: 0,
    packets: [] as Array<{ timestamp: number; duration: number }>,
  };
  let lastPacketAt = performance.now();
  let finalizationTimer: ReturnType<typeof setInterval> | undefined;
  // Public encoded-output evidence, kept separate from frame-submission records.
  (globalThis as typeof globalThis & { __blendcraftEncoderProgress?: typeof encoderProgress })
    .__blendcraftEncoderProgress = encoderProgress;
  const onEncodedPacket = (packet: { timestamp: number; duration: number }) => {
    encoderProgress.outputPackets++;
    encoderProgress.lastPacketTimestamp = packet.timestamp;
    encoderProgress.packets.push({ timestamp: packet.timestamp, duration: packet.duration });
    lastPacketAt = performance.now();
  };
  const wakeLock = await acquireExportWakeLock();
  // See acquireExportAudibleKeepAlive() doc comment: this is the mitigation
  // that actually survives the user switching windows/tabs mid-export,
  // which Wake Lock does not (Wake Lock auto-releases the instant the page
  // is hidden). Kept alongside Wake Lock rather than replacing it — Wake
  // Lock still earns its keep for the (still visible, unattended) long-idle
  // case by preventing the OS from dimming/sleeping the display.
  const audibleKeepAlive = await acquireExportAudibleKeepAlive();

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

    // Shared with the worker-based path (mediabunnyEncodeShared.ts) so the
    // two encode paths cannot drift. This also fixes a real bug: the MP4
    // branch here previously never applied `options.keyFrameIntervalSeconds`
    // at all (only WebM read it), always silently falling back to
    // Mediabunny's internal 2s default regardless of what was requested.
    const videoSource = new CanvasSource(stagingCanvas, buildCanvasSourceConfig({
      container,
      bitrate,
      keyFrameIntervalSeconds: options.keyFrameIntervalSeconds,
      onEncodedPacket,
      onEncoderConfig: (config) =>
        reportEncoderConfig(container === 'mp4' ? 'browser-default' : 'webm-realtime', config),
    }));
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

        encoderProgress.submittedFrames = i + 1;
        timelineFrames.push({
          frameIndex: i,
          requestedTimestamp: t,
          renderedDeterministicTime: rendered?.renderedDeterministicTime ?? Number.NaN,
          encodedTimestamp: t,
          encodedDuration: frameDurationSeconds,
          layers: rendered?.layers ?? [],
          motion: rendered?.motion ?? [],
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
    encoderProgress.phase = 'finalizing';
    const reportFinalization = () => {
      const now = performance.now();
      encoderProgress.finalizationElapsedSec = (now - finalizeStart) / 1000;
      encoderProgress.secondsSinceLastPacket = (now - lastPacketAt) / 1000;
      onProgress?.(91,
        `Finalizing ${container.toUpperCase()} · ${Math.floor(encoderProgress.finalizationElapsedSec)}s elapsed`);
    };
    finalizationTimer = setInterval(reportFinalization, 1000);
    await output.finalize();
    const finalizeMs = performance.now() - finalizeStart;
    clearInterval(finalizationTimer);
    finalizationTimer = undefined;
    encoderProgress.finalizationElapsedSec = finalizeMs / 1000;
    encoderProgress.phase = 'completed';
    console.info('[BLENDCRAFT encoder output]', encoderProgress);

    const timelineCertification = certifyExportTimeline(timelineFrames, fps, totalFrames);
    if (!timelineCertification.passed) {
      console.error('[BLENDCRAFT export] Timeline certification failed:', timelineCertification);
    }

    const buffer = target.buffer;
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
      throw new Error(`Mediabunny finalized without producing an output buffer (${container}).`);
    }

    // Diagnostic only — some Chromium hardware H.264 encoders silently cap
    // actual throughput well below a requested bitrate rather than erroring,
    // which would look identical to a correct export (no thrown error, valid
    // file) but quietly undershoot the "Quality" setting the user picked.
    // Logged, not enforced: a legitimate reason for undershoot is that a
    // simple/flat scene compresses far below its bitrate ceiling.
    verifyEncodedBitrate({ buffer, requestedBitrate: bitrate, totalFrames, fps, width, height, container });

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
    if (finalizationTimer !== undefined) clearInterval(finalizationTimer);
    if (encoderProgress.phase !== 'completed') encoderProgress.phase = signal?.aborted ? 'cancelled' : 'failed';
    stopKeepAlive();
    audibleKeepAlive.release();
    wakeLock.release();
  }
}

/**
 * Same render+encode contract as the main-thread path above, except the
 * `CanvasSource`/`VideoEncoder`/`Output.finalize()` machinery runs inside a
 * dedicated Worker (`mediabunnyEncodeWorker.ts`) instead of on the main
 * thread. See that file's header comment for the full rationale — in short,
 * this is the fix for the stall that survived both the rAF→setInterval swap
 * and the audible-tab keep-alive: those mitigations kept the main thread's
 * own timers alive, but `output.finalize()` itself still runs on the main
 * thread in that path, and the stall persisted through window-switch tests
 * even with both mitigations active. Moving finalize into a Worker removes
 * it from the main document's page-visibility-gated execution entirely.
 *
 * WebGL rendering is untouched — `drawFrame` still runs on the main thread
 * exactly as before, paced by the same `runFrameLoopViaRAF`. Only the
 * already-rendered pixels are handed off, once per frame, as a transferred
 * `ImageBitmap`.
 */
async function encodeVideoWithMediabunnyViaWorker(
  options: MediabunnyEncodeOptions,
): Promise<MediabunnyEncodeResult> {
  const {
    stagingCanvas, width, height, fps, totalFrames, bitrate, container,
    drawFrame, signal, onProgress, onEncoderConfig, keyFrameIntervalSeconds,
  } = options;

  throwIfAborted(signal);
  if (totalFrames <= 0) throw new Error(`totalFrames must be positive (got ${totalFrames}).`);
  if (stagingCanvas.width !== width || stagingCanvas.height !== height) {
    throw new Error(
      `stagingCanvas is ${stagingCanvas.width}\u00d7${stagingCanvas.height} but encode was requested at ${width}\u00d7${height} — caller must size the canvas before calling.`
    );
  }
  if (container === 'mp4') clearObsoleteH264PerformanceHistory();

  const worker = new Worker(new URL('./mediabunnyEncodeWorker.ts', import.meta.url), { type: 'module' });
  const wakeLock = await acquireExportWakeLock();
  const audibleKeepAlive = await acquireExportAudibleKeepAlive();

  const teardown = () => {
    worker.terminate();
    wakeLock.release();
    audibleKeepAlive.release();
  };

  // Init handshake happens before any frame is rendered or sent. A failure
  // here throws WorkerEncodeInitError, which the public dispatcher below
  // treats as safe to fall back from onto the main-thread path.
  await new Promise<void>((resolve, reject) => {
    const onMessage = (event: MessageEvent<{ type: string; message?: string; stage?: string }>) => {
      const msg = event.data;
      if (msg.type === 'ready') {
        worker.removeEventListener('message', onMessage);
        resolve();
      } else if (msg.type === 'error') {
        worker.removeEventListener('message', onMessage);
        reject(new WorkerEncodeInitError(`Worker init failed at stage "${msg.stage}": ${msg.message}`));
      }
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', (event) => {
      worker.removeEventListener('message', onMessage);
      reject(new WorkerEncodeInitError(`Worker failed to start: ${event.message || 'unknown error'}`));
    }, { once: true });
    worker.postMessage({ type: 'init', container, width, height, fps, bitrate, keyFrameIntervalSeconds });
  }).catch((error) => {
    teardown();
    throw error;
  });

  // Past this point, frames may be submitted — any failure propagates as a
  // genuine encode failure rather than triggering a silent restart.
  const stopKeepAlive = startCompositorKeepAlive();
  let renderMs = 0;
  let encodeMs = 0;
  const timelineFrames: ExportTimelineFrameCertification[] = [];
  const frameDurationSeconds = 1 / fps;
  const progressStep = Math.max(1, Math.floor(totalFrames / 20));

  const pendingAcks = new Map<number, { resolve: () => void; reject: (error: unknown) => void }>();

  const persistentHandler = (event: MessageEvent<{
    type: string; frameIndex?: number; message?: string; stage?: string;
    config?: { codec?: string; hardwareAcceleration?: string; width?: number; height?: number; latencyMode?: 'quality' | 'realtime' };
  }>) => {
    const msg = event.data;
    if (msg.type === 'frame-ack' && msg.frameIndex !== undefined) {
      const pending = pendingAcks.get(msg.frameIndex);
      if (pending) { pendingAcks.delete(msg.frameIndex); pending.resolve(); }
    } else if (msg.type === 'encoder-config' && msg.config) {
      onEncoderConfig?.({
        codec: msg.config.codec ?? mediaCodecFor(container),
        hardwareAcceleration: msg.config.hardwareAcceleration,
        width: msg.config.width ?? width,
        height: msg.config.height ?? height,
        latencyMode: msg.config.latencyMode,
        policy: container === 'mp4' ? 'browser-default' : 'webm-realtime',
      });
    } else if (msg.type === 'error') {
      const error = new Error(`Worker encode failed at stage "${msg.stage}": ${msg.message}`);
      // Reject whatever frame is currently in flight, if any — frames are
      // submitted and acked strictly one at a time (genuine backpressure),
      // so there is at most one pending entry to fail here.
      for (const [, pending] of pendingAcks) pending.reject(error);
      pendingAcks.clear();
    }
  };
  worker.addEventListener('message', persistentHandler);

  try {
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

        // colorSpaceConversion: 'none' is required here — see the color
        // contract note in mediabunnyEncodeWorker.ts's file header. This
        // must match the worker's OffscreenCanvas 2D context colorSpace.
        const bitmap = await createImageBitmap(stagingCanvas, { colorSpaceConversion: 'none' });
        await new Promise<void>((resolve, reject) => {
          pendingAcks.set(i, { resolve, reject });
          worker.postMessage(
            { type: 'frame', frameIndex: i, timestamp: t, duration: frameDurationSeconds, bitmap },
            [bitmap],
          );
        });

        timelineFrames.push({
          frameIndex: i,
          requestedTimestamp: t,
          renderedDeterministicTime: rendered?.renderedDeterministicTime ?? Number.NaN,
          encodedTimestamp: t,
          encodedDuration: frameDurationSeconds,
          layers: rendered?.layers ?? [],
          motion: rendered?.motion ?? [],
        });

        encodeMs += performance.now() - encodeStart;

        if (i % progressStep === 0 || i === totalFrames - 1) {
          onProgress?.(5 + ((i + 1) / totalFrames) * 85, `Frame ${i + 1}/${totalFrames}`);
        }
      },
    });

    throwIfAborted(signal);
    onProgress?.(91, `Draining encoder and finalizing ${container.toUpperCase()}...`);
    const finalizeStart = performance.now();
    const finalizeTimer = setInterval(() => {
      const elapsed = (performance.now() - finalizeStart) / 1000;
      onProgress?.(91, `Finalizing ${container.toUpperCase()} · ${Math.floor(elapsed)}s elapsed`);
    }, 1000);

    const { buffer, outputPackets } = await new Promise<{ buffer: ArrayBuffer; outputPackets: number }>((resolve, reject) => {
      const onResult = (event: MessageEvent<{ type: string; buffer?: ArrayBuffer; outputPackets?: number; message?: string }>) => {
        const msg = event.data;
        if (msg.type === 'result' && msg.buffer) {
          worker.removeEventListener('message', onResult);
          resolve({ buffer: msg.buffer, outputPackets: msg.outputPackets ?? 0 });
        } else if (msg.type === 'error') {
          worker.removeEventListener('message', onResult);
          reject(new Error(`Worker finalize failed: ${msg.message}`));
        }
      };
      worker.addEventListener('message', onResult);
      worker.postMessage({ type: 'finalize' });
    });
    clearInterval(finalizeTimer);
    const finalizeMs = performance.now() - finalizeStart;

    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
      throw new Error(`Worker finalized without producing an output buffer (${container}).`);
    }

    const timelineCertification = certifyExportTimeline(timelineFrames, fps, totalFrames);
    if (!timelineCertification.passed) {
      console.error('[BLENDCRAFT export] Timeline certification failed:', timelineCertification);
    }

    verifyEncodedBitrate({ buffer, requestedBitrate: bitrate, totalFrames, fps, width, height, container });
    console.info('[BLENDCRAFT encoder output:worker]', { outputPackets, container, finalizeMs });

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
    worker.removeEventListener('message', persistentHandler);
    stopKeepAlive();
    teardown();
  }
}

/**
 * Public entry point. Tries the worker-based encode path first (immune to
 * the main document's page-visibility throttling that was causing the
 * "must switch windows to unstick" stall); falls back automatically to the
 * original main-thread path if the worker path isn't supported in this
 * browser, or fails during its own setup before any frame was submitted.
 * A failure *after* frames have been submitted propagates as a real error
 * instead of silently retrying — see WorkerEncodeInitError's doc comment.
 */
export async function encodeVideoWithMediabunny(
  options: MediabunnyEncodeOptions,
): Promise<MediabunnyEncodeResult> {
  if (isWorkerEncodeSupported()) {
    try {
      return await encodeVideoWithMediabunnyViaWorker(options);
    } catch (error) {
      if (error instanceof WorkerEncodeInitError) {
        if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
          console.warn('[BLENDCRAFT export:mediabunny] Worker encode path unavailable, falling back to main thread:', error);
        }
        // fall through to main-thread path below
      } else {
        throw error;
      }
    }
  }
  return encodeVideoWithMediabunnyMainThread(options);
}
