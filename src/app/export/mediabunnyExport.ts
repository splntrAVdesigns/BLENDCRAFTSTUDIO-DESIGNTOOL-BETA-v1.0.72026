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
 * - `CanvasSource.add()` is awaited — genuine backpressure. The previous
 *   code polled `encoder.encodeQueueSize` against hand-tuned watermark
 *   tables per resolution/codec/hardware combination to approximate this.
 *   Mediabunny gives it for free.
 * - `canEncodeVideo()` / `getFirstEncodableVideoCodec()` replace a
 *   hand-built AVC profile × level negotiation table (AVC_LEVEL_TABLE)
 *   that had to be manually extended every time a new rejection surfaced
 *   (e.g. the avc1.42001f Baseline-profile rejection bug).
 * - Actively maintained by the same author as the two deprecated
 *   packages this replaces; zero dependencies of its own.
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
  /** Called once the real encoder config Mediabunny negotiated is known —
   *  useful for diagnostics (which hardware/software path actually ran). */
  onEncoderConfig?: (info: { codec: string; hardwareAcceleration?: string }) => void;
}

export interface MediabunnyEncodeResult {
  blob: Blob;
  container: MediabunnyContainer;
  mimeType: string;
  /** Wall-clock time spent inside drawFrame across all frames, ms. */
  renderMs: number;
  /** Wall-clock time spent awaiting CanvasSource.add() across all frames, ms.
   *  This is the real encode + backpressure cost — the honest replacement
   *  for the old "queueWaitMs" watermark-drain metric. */
  encodeMs: number;
  /** Wall-clock time spent inside output.finalize(), ms. */
  finalizeMs: number;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

/**
 * A genuine macrotask yield (not a microtask). Awaiting only
 * microtask-resolving promises in a loop — which is what a bare
 * `await CanvasSource.add()` does — never gives the browser a chance to
 * paint or process input, because the JS event loop drains every pending
 * microtask before it's willing to run a macrotask (paint, timer, click
 * handling). A render+encode loop with no periodic macrotask yield can run
 * to completion with the tab looking completely frozen: progress state
 * updates internally, but the DOM never repaints, and Cancel Export clicks
 * never get processed, until something external forces a task-queue
 * boundary (backgrounding/foregrounding the tab, opening devtools).
 * `CanvasSource.add()`'s real backpressure controls how far ahead of the
 * encoder rendering gets — it does not, by itself, guarantee the browser
 * ever gets to breathe.
 */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Keeps a minimal, no-op requestAnimationFrame loop alive for the duration
 * of an export. The export UI deliberately pauses the real preview render
 * loop while exporting ("Preview paused during render"), which means
 * nothing in the tab drives rAF at all during export. Chromium's internal
 * WebCodecs scheduling — particularly encoder flush / mux finalize work —
 * can stall waiting on compositor activity that's simply never being
 * requested, which reads exactly like a frozen tab that only unsticks when
 * something external (a tab switch, opening devtools) forces a compositor
 * tick. This project has hit variants of this exact rAF-starvation failure
 * mode before (see: will-change:transform suppressing WebGL rAF globally).
 * The loop does nothing but re-request itself; it exists purely to keep
 * the compositor pipeline alive through the whole encode + finalize pass.
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

  try {
    // Iframe hardware-encoder instability (Figma Make host): hardware H.264 has
    // crashed the GPU process mid-encode in this environment, and Chromium
    // blocklists the encoder for the rest of the session afterward — every
    // later probe then fails too. Prefer software first inside iframes;
    // standalone tabs keep no-preference first for speed. This is a real,
    // previously-diagnosed bug — not a defensive guess.
    const hardwareAcceleration = isIframeEnvironment() ? 'prefer-software' : 'no-preference';

    // 'quality' puts the encoder on its slowest, most exhaustive speed preset —
    // a real cost worth paying for genuine hardware encode, where it's still
    // fast, but punishing for software encode, where it can turn a 150-frame
    // pass into minutes. VP9 (WebM) essentially never has a hardware encoder in
    // Chrome regardless of the hint above, so it always gets 'realtime'. H.264
    // gets 'realtime' too whenever software has been explicitly requested
    // (the iframe case) — otherwise 'quality', since real hardware H.264 is
    // common and the extra quality is cheap there.
    const preferredSoftware = hardwareAcceleration === 'prefer-software';
    const latencyMode: 'quality' | 'realtime' =
      container === 'webm' || preferredSoftware ? 'realtime' : 'quality';

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
        });
      },
    });
    output.addVideoTrack(videoSource, { frameRate: fps });
    await output.start();

    const frameDurationSeconds = 1 / fps;
    let renderMs = 0;
    let encodeMs = 0;

    for (let i = 0; i < totalFrames; i++) {
      throwIfAborted(signal);
      const t = i / fps;

      const renderStart = performance.now();
      await drawFrame(i, t);
      renderMs += performance.now() - renderStart;

      throwIfAborted(signal);
      const encodeStart = performance.now();
      await videoSource.add(t, frameDurationSeconds);
      encodeMs += performance.now() - encodeStart;

      // Real macrotask yield, every frame — see yieldToBrowser() doc comment
      // above. This is what keeps the tab from appearing frozen during a
      // 150+ frame render+encode pass: without it, progress-bar state updates
      // happen but never paint, and Cancel Export clicks queue up unprocessed
      // until something external forces a task-queue boundary.
      await yieldToBrowser();

      if (i % Math.max(1, Math.floor(totalFrames / 20)) === 0 || i === totalFrames - 1) {
        onProgress?.(5 + ((i + 1) / totalFrames) * 85, `Frame ${i + 1}/${totalFrames}`);
      }
    }

    throwIfAborted(signal);
    onProgress?.(92, `Finalizing ${container.toUpperCase()} container...`);
    const finalizeStart = performance.now();
    await output.finalize();
    const finalizeMs = performance.now() - finalizeStart;

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
  }
}
