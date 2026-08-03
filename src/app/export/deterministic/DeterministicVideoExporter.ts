/**
 * PHASE 7.7 — Deterministic video exporter (main thread orchestration).
 *
 * THE CORE CONTRACT: the exported timeline is AUTHORED, never observed.
 * Frame i carries timestamp `i * frameDurationUs`. N frames at F fps is exactly
 * N/F seconds of video no matter how long the export actually took. This is the
 * root-cause fix for the realtime MediaRecorder engine, where MediaRecorder
 * stamped frames by wall clock and any frame slower than the frame interval
 * permanently stretched the file (5s requested -> 14s exported).
 *
 * Because the timeline is decoupled from the wall clock, encoding is free to run
 * as fast as the hardware allows rather than being pinned to realtime.
 */

import type {
  DeterministicExportDiagnostics,
  DeterministicExportResult,
  DeterministicLivenessProbe,
  DeterministicProgress,
  DeterministicQuality,
  WorkerOutbound,
} from './types';

export interface DeterministicVideoExportInput {
  /** The live WebGL presentation canvas, already resized to export dimensions. */
  readonly sourceCanvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /** Authoritative timeline length. Loop Lock has already been resolved upstream. */
  readonly durationMs: number;
  readonly quality: DeterministicQuality;
  readonly renderFrame: (elapsedSeconds: number, frameIndex: number) => void | Promise<void>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: DeterministicProgress) => void;
}

/** Frames allowed in flight before the render loop yields to the encoder. */
const MAX_FRAMES_IN_FLIGHT = 4;
/** Keyframe every 2 seconds: good seeking without inflating the file. */
const KEYFRAME_INTERVAL_SECONDS = 2;

/**
 * Linear pixel-rate bitrate scaling.
 *
 * The recording profiles used sqrt scaling, which assumes natural video where
 * detail per pixel falls as resolution rises. BlendCraft content is the
 * opposite: large-area, low-detail, high-temporal-change gradients whose bit
 * cost tracks pixel rate almost linearly. Sqrt scaling silently starved 60fps
 * and 4K exports.
 */
export function resolveDeterministicBitrate(
  quality: DeterministicQuality,
  width: number,
  height: number,
  fps: number,
): number {
  const baseline1080p30: Record<DeterministicQuality, number> = {
    standard: 10_000_000,
    high: 16_000_000,
    ultra: 24_000_000,
  };
  const pixelRate = Math.max(1, width * height * fps);
  const baselinePixelRate = 1920 * 1080 * 30;
  const scaled = baseline1080p30[quality] * (pixelRate / baselinePixelRate);
  const clamped = Math.max(4_000_000, Math.min(120_000_000, scaled));
  return Math.round(clamped / 100_000) * 100_000;
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  return reason instanceof Error
    ? reason
    : new DOMException(String(reason ?? 'Video export cancelled.'), 'AbortError');
}

/**
 * Cheap perceptual signature of the current canvas contents.
 *
 * Guards the classic WebGL capture failure mode where every exported frame is
 * identical or blank because the backing store was empty when the VideoFrame
 * was constructed. Downsampling to 8x8 makes this microseconds per sample, so
 * it is safe to run on a handful of frames during a real export.
 */
function createSignatureSampler(): { sample: (canvas: HTMLCanvasElement) => string; dispose: () => void } {
  const probe = document.createElement('canvas');
  probe.width = 8;
  probe.height = 8;
  const context = probe.getContext('2d', { alpha: false, willReadFrequently: true });
  return {
    sample: (canvas: HTMLCanvasElement) => {
      if (!context) return 'unavailable';
      context.clearRect(0, 0, 8, 8);
      context.drawImage(canvas, 0, 0, 8, 8);
      const { data } = context.getImageData(0, 0, 8, 8);
      let signature = '';
      for (let index = 0; index < data.length; index += 4) {
        // Quantise to 16 luminance buckets: tolerant of codec-irrelevant noise,
        // still sensitive to real motion.
        const luma = (data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
        signature += Math.min(15, Math.floor(luma / 16)).toString(16);
      }
      return signature;
    },
    dispose: () => {
      probe.width = 1;
      probe.height = 1;
    },
  };
}

function evaluateLiveness(
  indices: readonly number[],
  signatures: readonly string[],
  totalFrames: number,
): DeterministicLivenessProbe {
  const distinct = new Set(signatures.filter((value) => value !== 'unavailable'));
  const distinctSignatures = distinct.size;

  if (signatures.length === 0 || distinct.size === 0) {
    return {
      sampledFrameIndices: indices,
      signatures,
      distinctSignatures,
      passed: true,
      reason: 'Liveness sampling unavailable in this host; capture was not verified.',
    };
  }
  const blank = Array.from(distinct).every((value) => /^0*$/.test(value));
  if (blank) {
    return {
      sampledFrameIndices: indices,
      signatures,
      distinctSignatures,
      passed: false,
      reason: 'Every sampled export frame was blank. The canvas backing store was empty at capture time.',
    };
  }
  // A single-frame export, or genuinely static artwork, legitimately yields one
  // signature. Only flag stalled capture when motion was actually expected.
  if (distinctSignatures === 1 && totalFrames > 1 && signatures.length > 1) {
    return {
      sampledFrameIndices: indices,
      signatures,
      distinctSignatures,
      passed: true,
      reason: 'All sampled frames were identical. Expected for static compositions; investigate if the artwork is animated.',
    };
  }
  return { sampledFrameIndices: indices, signatures, distinctSignatures, passed: true };
}

export async function exportDeterministicVideo(
  input: DeterministicVideoExportInput,
): Promise<DeterministicExportResult> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    throw new Error('This browser does not support the WebCodecs export pipeline.');
  }
  if (input.signal?.aborted) throw abortError(input.signal);

  const fps = Math.max(1, Math.round(input.fps));
  const totalFrames = Math.max(1, Math.round((input.durationMs / 1000) * fps));
  const frameDurationUs = Math.round(1_000_000 / fps);
  const keyFrameInterval = Math.max(1, fps * KEYFRAME_INTERVAL_SECONDS);
  const bitrate = resolveDeterministicBitrate(input.quality, input.width, input.height, fps);
  const wallClockStartedAt = performance.now();

  const worker = new Worker(new URL('./deterministicEncoder.worker.ts', import.meta.url), { type: 'module' });
  const sampler = createSignatureSampler();

  // Sample the first, a middle and the last frame for capture liveness.
  const probeIndices = totalFrames > 2
    ? [0, Math.floor(totalFrames / 2), totalFrames - 1]
    : [0];
  const probeSignatures: string[] = [];

  let renderMs = 0;
  let frameCaptureMs = 0;
  let framesInFlight = 0;
  let renderedFrames = 0;
  let encodedFrames = 0;
  let maxQueueSize = 0;
  let encodeMs = 0;
  let selectionLabel = 'unknown';
  let selectionCodecString = 'unknown';
  let selectionAcceleration = 'unknown';
  let releaseSlot: (() => void) | null = null;
  let fatalError: Error | null = null;
  let rejectRun: ((error: Error) => void) | null = null;

  const failRun = (error: Error) => {
    fatalError ??= error;
    releaseSlot?.();
    releaseSlot = null;
    rejectRun?.(error);
  };

  const onAbort = () => {
    worker.postMessage({ type: 'cancel' });
    failRun(abortError(input.signal));
  };
  input.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const ready = new Promise<void>((resolve, reject) => {
      const handler = (event: MessageEvent<WorkerOutbound>) => {
        const message = event.data;
        if (message.type === 'ready') {
          selectionLabel = message.selection.codecLabel;
          selectionCodecString = message.selection.codecString;
          selectionAcceleration = message.selection.hardwareAcceleration;
          worker.removeEventListener('message', handler);
          resolve();
        } else if (message.type === 'error') {
          worker.removeEventListener('message', handler);
          reject(new Error(message.message));
        }
      };
      worker.addEventListener('message', handler);
      worker.onerror = (event) => reject(new Error(event.message || 'The video encode worker failed to start.'));
    });

    const completion = new Promise<{ buffer: ArrayBuffer; mimeType: string }>((resolve, reject) => {
      rejectRun = reject;
      worker.addEventListener('message', (event: MessageEvent<WorkerOutbound>) => {
        const message = event.data;
        if (message.type === 'accepted') {
          framesInFlight = Math.max(0, framesInFlight - 1);
          maxQueueSize = Math.max(maxQueueSize, message.queueSize);
          releaseSlot?.();
          releaseSlot = null;
          return;
        }
        if (message.type === 'encoded') {
          // Encoder output count only; the render loop owns progress reporting.
          encodedFrames = message.encodedFrames;
          return;
        }
        if (message.type === 'complete') {
          encodedFrames = message.encodedFrames;
          maxQueueSize = Math.max(maxQueueSize, message.maxQueueSize);
          encodeMs = message.encodeMs;
          resolve({ buffer: message.buffer, mimeType: message.mimeType });
          return;
        }
        if (message.type === 'cancelled') {
          failRun(abortError(input.signal));
          return;
        }
        if (message.type === 'error') failRun(new Error(message.message));
      });
    });

    input.onProgress?.({
      phase: 'preparing',
      frame: 0,
      totalFrames,
      percent: 1,
      label: 'Configuring hardware video encoder…',
    });

    worker.postMessage({
      type: 'init',
      width: input.width,
      height: input.height,
      fps,
      bitrate,
      totalFrames,
    });
    await ready;
    if (input.signal?.aborted) throw abortError(input.signal);

    input.onProgress?.({
      phase: 'encoding',
      frame: 0,
      totalFrames,
      percent: 4,
      label: `Encoding with ${selectionLabel}…`,
    });

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      if (fatalError) throw fatalError;
      if (input.signal?.aborted) throw abortError(input.signal);

      // ---- Render -------------------------------------------------------
      // The timeline position is derived purely from the frame index, so the
      // rendered content is identical on every machine and every run.
      const renderStartedAt = performance.now();
      // PHASE 7.7b DIAGNOSTIC WATCHDOG: probes proved the encoder and the
      // capture path are both fast (single-digit ms). If a real export still
      // stalls, the only remaining suspect is renderFrame() itself — the real
      // renderAtTime() call with shaders/masks/post-FX, not a synthetic clear.
      // A hung await here previously produced ZERO signal: no log, no error,
      // just a frozen progress bar. This makes a stall loud and diagnosable
      // instead of silent.
      let renderWatchdogFired = false;
      const renderWatchdog = window.setTimeout(() => {
        renderWatchdogFired = true;
        console.warn(
          `[BLENDCRAFT Video Export] renderFrame(${frameIndex}) has not resolved after 3000 ms. `
          + `If this is the only warning you ever see, the render call itself is hung — `
          + `most likely inside renderAtTime(), waitForMaskTextures(), or a video-layer seek.`,
        );
      }, 3_000);
      try {
        await input.renderFrame(frameIndex / fps, frameIndex);
      } finally {
        window.clearTimeout(renderWatchdog);
      }
      const renderFrameMs = performance.now() - renderStartedAt;
      renderMs += renderFrameMs;
      if (renderWatchdogFired) {
        console.warn(`[BLENDCRAFT Video Export] renderFrame(${frameIndex}) eventually resolved after ${renderFrameMs.toFixed(0)} ms.`);
      }
      // First few frames and every 25th thereafter, so a real export prints a
      // visible heartbeat in the console rather than going quiet for a minute.
      if (frameIndex < 3 || frameIndex % 25 === 0) {
        console.info(`[BLENDCRAFT Video Export] frame ${frameIndex}/${totalFrames} rendered in ${renderFrameMs.toFixed(1)} ms`);
      }

      if (fatalError) throw fatalError;
      if (input.signal?.aborted) throw abortError(input.signal);

      // ---- Capture ------------------------------------------------------
      const captureStartedAt = performance.now();
      if (probeIndices.indexOf(frameIndex) !== -1) {
        probeSignatures.push(sampler.sample(input.sourceCanvas));
      }
      // Constructing a VideoFrame from the canvas implicitly flushes its current
      // contents, so no gl.finish() stall is needed. The renderer runs with
      // preserveDrawingBuffer:true, so the backing store is guaranteed populated.
      const frame = new VideoFrame(input.sourceCanvas, {
        // Derived from the index rather than accumulated, so the rounding error
        // in frameDurationUs can never compound across a long export.
        timestamp: Math.round((frameIndex * 1_000_000) / fps),
        duration: frameDurationUs,
        alpha: 'discard',
      });
      frameCaptureMs += performance.now() - captureStartedAt;

      framesInFlight += 1;
      worker.postMessage(
        { type: 'frame', index: frameIndex, frame, keyFrame: frameIndex % keyFrameInterval === 0 },
        [frame],
      );

      // PHASE 7.7a: progress is driven by frames SUBMITTED, not by encoder
      // output. The encoder holds frames in its lookahead buffer, so reporting
      // only encoded chunks made the UI sit frozen at "1/150" while the pipeline
      // was in fact working. Submitted frames are the honest measure of progress.
      renderedFrames = frameIndex + 1;
      input.onProgress?.({
        phase: 'encoding',
        frame: renderedFrames,
        totalFrames,
        percent: 4 + (renderedFrames / totalFrames) * 86,
        label: `Rendering frame ${renderedFrames}/${totalFrames} · encoded ${encodedFrames}`,
      });

      // ---- Backpressure -------------------------------------------------
      // Without this the render loop outruns the encoder and the worker piles up
      // uncompressed 1080p frames in GPU memory until the tab stalls.
      if (framesInFlight >= MAX_FRAMES_IN_FLIGHT) {
        await new Promise<void>((resolve) => { releaseSlot = resolve; });
      }
    }

    if (fatalError) throw fatalError;
    input.onProgress?.({
      phase: 'finalizing',
      frame: totalFrames,
      totalFrames,
      percent: 91,
      label: 'Flushing encoder and writing container…',
    });

    worker.postMessage({ type: 'finish' });
    const { buffer, mimeType } = await completion;

    const blob = new Blob([buffer], { type: mimeType });
    if (blob.size <= 0) throw new Error('The video encoder produced an empty file.');
    if (encodedFrames !== totalFrames) {
      throw new Error(
        `Deterministic frame certification failed: expected ${totalFrames} encoded frames, received ${encodedFrames}.`,
      );
    }

    const liveness = evaluateLiveness(probeIndices, probeSignatures, totalFrames);
    if (!liveness.passed) throw new Error(liveness.reason ?? 'Export capture liveness certification failed.');

    const timelineDurationMs = (totalFrames / fps) * 1000;
    const wallClockMs = performance.now() - wallClockStartedAt;

    const diagnostics: DeterministicExportDiagnostics = {
      engine: 'deterministic-webcodecs',
      codecLabel: selectionLabel === 'VP8' ? 'VP8' : 'VP9',
      codecString: selectionCodecString,
      hardwareAcceleration: selectionAcceleration,
      width: input.width,
      height: input.height,
      fps,
      bitrate,
      renderedFrames,
      encodedFrames,
      totalFrames,
      timelineDurationMs,
      wallClockMs,
      renderMs,
      frameCaptureMs,
      encodeAndMuxMs: encodeMs,
      realtimeFactor: timelineDurationMs / Math.max(1, wallClockMs),
      maxEncodeQueueSize: maxQueueSize,
      blobBytes: blob.size,
      actualBitsPerSecond: Math.round((blob.size * 8) / Math.max(0.001, timelineDurationMs / 1000)),
      livenessProbe: liveness,
    };

    return { blob, mimeType, diagnostics };
  } finally {
    input.signal?.removeEventListener('abort', onAbort);
    sampler.dispose();
    worker.terminate();
  }
}
