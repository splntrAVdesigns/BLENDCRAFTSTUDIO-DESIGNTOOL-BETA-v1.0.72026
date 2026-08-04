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

import { DeterministicEncoderSession } from './DeterministicEncoderSession';
import type {
  DeterministicExportDiagnostics,
  DeterministicExportResult,
  DeterministicLivenessProbe,
  DeterministicProgress,
  DeterministicQuality,
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

/** Max encoder queue depth before the render loop yields. */
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

  const sampler = createSignatureSampler();

  // Sample the first, a middle and the last frame for capture liveness.
  const probeIndices = totalFrames > 2
    ? [0, Math.floor(totalFrames / 2), totalFrames - 1]
    : [0];
  const probeSignatures: string[] = [];

  let renderMs = 0;
  let frameCaptureMs = 0;
  let encodeSubmitMs = 0;
  let renderedFrames = 0;

  input.onProgress?.({
    phase: 'preparing',
    frame: 0,
    totalFrames,
    percent: 1,
    label: 'Configuring video encoder…',
  });

  // PHASE 7.7c: encoder runs on THIS thread, deliberately. See
  // DeterministicEncoderSession for the measured reason — transferring
  // GPU-backed VideoFrames to a worker forced a cross-process readback per
  // frame and cost ~300x.
  const session = await DeterministicEncoderSession.create({
    width: input.width,
    height: input.height,
    fps,
    bitrate,
  });

  try {
    if (input.signal?.aborted) throw abortError(input.signal);
    console.info(
      `[BLENDCRAFT Video Export] encoder ready: ${session.selection.codecLabel} `
      + `(${session.selection.codecString}) @ ${(bitrate / 1_000_000).toFixed(1)} Mbps, main-thread`,
    );

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      if (input.signal?.aborted) throw abortError(input.signal);

      // ---- Render -------------------------------------------------------
      const renderStartedAt = performance.now();
      await input.renderFrame(frameIndex / fps, frameIndex);
      const renderFrameMs = performance.now() - renderStartedAt;
      renderMs += renderFrameMs;

      if (input.signal?.aborted) throw abortError(input.signal);

      // ---- Capture ------------------------------------------------------
      const captureStartedAt = performance.now();
      if (probeIndices.indexOf(frameIndex) !== -1) {
        probeSignatures.push(sampler.sample(input.sourceCanvas));
      }
      const frame = new VideoFrame(input.sourceCanvas, {
        // Derived from the index rather than accumulated, so rounding error can
        // never compound across a long export.
        timestamp: Math.round((frameIndex * 1_000_000) / fps),
        duration: frameDurationUs,
        alpha: 'discard',
      });
      const captureFrameMs = performance.now() - captureStartedAt;
      frameCaptureMs += captureFrameMs;

      // ---- Encode (same thread, frame never leaves this context) ---------
      const submitMs = session.encode(frame, frameIndex % keyFrameInterval === 0);
      encodeSubmitMs += submitMs;

      renderedFrames = frameIndex + 1;

      if (frameIndex < 3 || frameIndex % 25 === 0) {
        console.info(
          `[BLENDCRAFT Video Export] frame ${frameIndex}/${totalFrames} — `
          + `render ${renderFrameMs.toFixed(1)}ms · capture ${captureFrameMs.toFixed(1)}ms · `
          + `encode-submit ${submitMs.toFixed(1)}ms · queue ${session.queueSize}`,
        );
      }

      input.onProgress?.({
        phase: 'encoding',
        frame: renderedFrames,
        totalFrames,
        percent: 4 + (renderedFrames / totalFrames) * 86,
        label: `Rendering frame ${renderedFrames}/${totalFrames} · encoded ${session.encodedFrameCount}`,
      });

      // ---- Backpressure --------------------------------------------------
      // Bounds encoder queue depth so GPU memory stays flat, and yields to the
      // event loop so cancellation and progress paint remain responsive.
      if (session.queueSize >= MAX_FRAMES_IN_FLIGHT) {
        await session.waitForQueue(MAX_FRAMES_IN_FLIGHT);
      } else if (frameIndex % 4 === 0) {
        // `await` alone only drains microtasks, which is not enough to let the
        // Cancel button's click handler or a progress repaint run. Since the
        // encoder now shares this thread, yield a real macrotask periodically
        // or the UI would appear frozen for the whole export.
        await new Promise<void>((resolve) => { window.setTimeout(resolve, 0); });
      }
    }

    if (input.signal?.aborted) throw abortError(input.signal);
    input.onProgress?.({
      phase: 'finalizing',
      frame: totalFrames,
      totalFrames,
      percent: 91,
      label: 'Flushing encoder and writing container…',
    });

    const finished = await session.finish();
    // Copy into a standalone ArrayBuffer so the Blob owns exactly these bytes
    // and does not retain the muxer's backing allocation.
    const outputBuffer = new ArrayBuffer(finished.bytes.byteLength);
    new Uint8Array(outputBuffer).set(finished.bytes);
    const blob = new Blob([outputBuffer], { type: finished.mimeType });
    if (blob.size <= 0) throw new Error('The video encoder produced an empty file.');
    if (finished.encodedFrames !== totalFrames) {
      throw new Error(
        `Deterministic frame certification failed: expected ${totalFrames} encoded frames, `
        + `received ${finished.encodedFrames}.`,
      );
    }

    const liveness = evaluateLiveness(probeIndices, probeSignatures, totalFrames);
    if (!liveness.passed) throw new Error(liveness.reason ?? 'Export capture liveness certification failed.');

    const timelineDurationMs = (totalFrames / fps) * 1000;
    const wallClockMs = performance.now() - wallClockStartedAt;

    const diagnostics: DeterministicExportDiagnostics = {
      engine: 'deterministic-webcodecs',
      codecLabel: session.selection.codecLabel,
      codecString: session.selection.codecString,
      hardwareAcceleration: session.selection.hardwareAcceleration,
      width: input.width,
      height: input.height,
      fps,
      bitrate,
      renderedFrames,
      encodedFrames: finished.encodedFrames,
      totalFrames,
      timelineDurationMs,
      wallClockMs,
      renderMs,
      frameCaptureMs,
      encodeAndMuxMs: finished.encodeMs,
      realtimeFactor: timelineDurationMs / Math.max(1, wallClockMs),
      maxEncodeQueueSize: session.maxQueueSize,
      blobBytes: blob.size,
      actualBitsPerSecond: Math.round((blob.size * 8) / Math.max(0.001, timelineDurationMs / 1000)),
      livenessProbe: liveness,
    };

    console.info(
      `[BLENDCRAFT Video Export] timing — render ${renderMs.toFixed(0)}ms · `
      + `capture ${frameCaptureMs.toFixed(0)}ms · encode-submit ${encodeSubmitMs.toFixed(0)}ms · `
      + `total ${wallClockMs.toFixed(0)}ms`,
    );

    return { blob, mimeType: finished.mimeType, diagnostics };
  } catch (error) {
    session.dispose();
    throw error;
  } finally {
    sampler.dispose();
  }
}
