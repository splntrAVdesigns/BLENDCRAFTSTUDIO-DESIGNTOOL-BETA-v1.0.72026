import { validateRecordingBlob } from './RecordingBlobValidator';
import { createConfiguredRecorder, selectRecordingCodec } from './RecordingCodecPolicy';
import { RECORDING_PRODUCTION_TIMESLICE_MS } from './RecordingLivenessPolicy';
import { createRecordingQualityCertification } from './RecordingQualityCertification';
import { RecordingFrameCompositor, type RecordingPixelFrame } from './RecordingFrameCompositor';
import { publishRecordingFrames } from './RecordingFramePublisher';
import { estimateRecordingBytes } from './RecordingProfiles';
import { RecordingSessionController } from './RecordingSessionController';
import { createCleanupDiagnostics } from './RecordingRecovery';
import type {
  RecordingCanvasHandle,
  RecordingCaptureMode,
  RecordingCodecSelection,
  RecordingDiagnostics,
  RecordingLivenessDiagnostics,
  RecordingProfile,
  RecordingProgress,
  RecordingSessionResult,
} from './types';

interface CanvasCaptureTrack extends MediaStreamTrack {
  requestFrame?: () => void;
}

export interface RecordingExportEngineInput {
  readonly sourceCanvas: HTMLCanvasElement;
  readonly profile: RecordingProfile;
  readonly durationMs: number;
  readonly renderFrame: (elapsedSeconds: number, frameIndex: number) => void | Promise<void>;
  readonly readFramePixels?: () => RecordingPixelFrame | null;
  readonly compositeFrame?: (
    sourceCanvas: HTMLCanvasElement,
    outputContext: CanvasRenderingContext2D,
    outputCanvas: HTMLCanvasElement,
  ) => void | Promise<void>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: RecordingProgress) => void;
  readonly mediaRecorderCtor?: typeof MediaRecorder;
  readonly createCanvas?: () => HTMLCanvasElement;
  readonly now?: () => number;
}

export function createRecordingCanvas(
  width: number,
  height: number,
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): RecordingCanvasHandle {
  const canvas = createCanvas();
  canvas.width = width;
  canvas.height = height;
  // Some embedded Chromium hosts do not advance captureStream() for a fully
  // detached canvas. Keep the recording surface attached but far outside the
  // viewport; never use display:none because that can suspend frame capture.
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${width}px`,
    height: `${height}px`,
    opacity: '0.001',
    pointerEvents: 'none',
    zIndex: '-1',
  });
  if (typeof document !== 'undefined' && document.body && !canvas.isConnected) {
    document.body.appendChild(canvas);
  }
  const context = canvas.getContext('2d', {
    alpha: false,
    desynchronized: false,
    willReadFrequently: false,
  });
  if (!context) throw new Error('Unable to create the recording canvas 2D context.');
  context.imageSmoothingEnabled = false;
  return {
    canvas,
    context,
    dispose: () => {
      canvas.width = 1;
      canvas.height = 1;
      canvas.remove();
    },
  };
}

function stopTracks(stream?: MediaStream): number {
  let stopped = 0;
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
      stopped += 1;
    } catch {
      // Best-effort cleanup.
    }
  });
  return stopped;
}

async function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  return reason instanceof Error ? reason : new DOMException(String(reason ?? 'Recording cancelled.'), 'AbortError');
}

function createCaptureStream(
  canvas: HTMLCanvasElement,
  fps: number,
  mode: RecordingCaptureMode,
): { stream: MediaStream; track: CanvasCaptureTrack } {
  const stream = mode === 'manual-request-frame' ? canvas.captureStream(0) : canvas.captureStream(fps);
  const track = stream.getVideoTracks()[0] as CanvasCaptureTrack | undefined;
  if (!track) {
    stopTracks(stream);
    throw new Error(`Capture mode ${mode} did not provide a video track.`);
  }
  try { track.contentHint = 'detail'; } catch { /* Optional browser hint. */ }
  if (mode === 'manual-request-frame' && typeof track.requestFrame !== 'function') {
    stopTracks(stream);
    throw new Error('Manual requestFrame capture is not available in this host.');
  }
  return { stream, track };
}

async function compositeCurrentFrame(
  input: RecordingExportEngineInput,
  output: RecordingCanvasHandle,
  compositor: RecordingFrameCompositor,
): Promise<{ source: 'gpu-readback' | 'canvas'; sourceWidth: number; sourceHeight: number; exactResolution: boolean }> {
  output.context.clearRect(0, 0, output.canvas.width, output.canvas.height);
  if (input.compositeFrame) {
    await input.compositeFrame(input.sourceCanvas, output.context, output.canvas);
    return {
      source: 'canvas',
      sourceWidth: input.sourceCanvas.width,
      sourceHeight: input.sourceCanvas.height,
      exactResolution: input.sourceCanvas.width === output.canvas.width && input.sourceCanvas.height === output.canvas.height,
    };
  }
  return compositor.composite({
    sourceCanvas: input.sourceCanvas,
    outputCanvas: output.canvas,
    outputContext: output.context,
    readFramePixels: input.readFramePixels,
  });
}

export class RecordingExportEngine {
  async record(input: RecordingExportEngineInput): Promise<RecordingSessionResult> {
    const controller = new RecordingSessionController();
    const recorderCtor = input.mediaRecorderCtor ?? (typeof MediaRecorder === 'undefined' ? undefined : MediaRecorder);
    const preferredCodec = selectRecordingCodec(recorderCtor);
    if (!recorderCtor) throw new Error('MediaRecorder is unavailable.');
    if (typeof input.sourceCanvas.captureStream !== 'function') throw new Error('Canvas captureStream() is unavailable.');
    if (input.signal?.aborted) throw abortError(input.signal);
    if (input.durationMs <= 0 || input.durationMs > input.profile.maxDurationMs) {
      throw new Error(`Recording duration must be between 1 ms and ${input.profile.maxDurationMs} ms.`);
    }
    const estimatedBytes = estimateRecordingBytes(input.profile.videoBitsPerSecond, input.durationMs);
    if (estimatedBytes > input.profile.maxEstimatedBytes) throw new Error('Estimated recording size exceeds the profile safety limit.');

    controller.transition('preparing');
    const now = input.now ?? (() => performance.now());
    const output = createRecordingCanvas(input.profile.width, input.profile.height, input.createCanvas);
    let stream: MediaStream | undefined;
    let recorder: MediaRecorder | undefined;
    let captureTrack: CanvasCaptureTrack | undefined;
    let captureMode: RecordingCaptureMode | undefined;
    let liveness: RecordingLivenessDiagnostics | undefined;
    let selectedCodecLabel: RecordingCodecSelection['codecLabel'] | undefined;
    let codecFallbackIndex: number | undefined;
    let qualityCertification: RecordingDiagnostics['qualityCertification'];
    let cancellationStartedAt: number | undefined;
    const compositor = new RecordingFrameCompositor();
    let frameSource: 'gpu-readback' | 'canvas' | undefined;
    let sourceWidth: number | undefined;
    let sourceHeight: number | undefined;
    let exactResolution: boolean | undefined;
    let publishedFrameCount = 0;
    let lateFrameCount = 0;
    let maxFrameLatenessMs = 0;
    let averageFrameLatenessMs = 0;
    let estimatedDuplicateCaptures = 0;
    let measuredRecordingDurationMs: number | undefined;
    let durationDriftMs: number | undefined;
    let chunkCount = 0;
    let accumulatedBytes = 0;
    let startedAtMs: number | undefined;
    let stoppedAtMs: number | undefined;
    let cleanupCompleted = false;
    let cleanupDiagnostics = createCleanupDiagnostics({
      recorderStopped: false,
      streamTracksStopped: 0,
      recordingCanvasDisposed: false,
      compositorDisposed: false,
    });
    const chunks: Blob[] = [];

    const diagnostics = (): RecordingDiagnostics => ({
      state: controller.state,
      selectedMimeType: recorder?.mimeType || preferredCodec.mimeType,
      outputWidth: input.profile.width,
      outputHeight: input.profile.height,
      fps: input.profile.fps,
      targetBitrate: input.profile.videoBitsPerSecond,
      actualBitrate: qualityCertification?.actualBitsPerSecond,
      codecLabel: selectedCodecLabel,
      codecFallbackIndex,
      captureMode,
      liveness,
      dataTimesliceMs: RECORDING_PRODUCTION_TIMESLICE_MS,
      publishedFrameCount,
      chunkCount,
      accumulatedBytes,
      recorderState: recorder?.state,
      startedAtMs,
      stoppedAtMs,
      finalizationDurationMs: stoppedAtMs === undefined ? undefined : Math.max(0, now() - stoppedAtMs),
      cancellationDurationMs: cancellationStartedAt === undefined ? undefined : Math.max(0, now() - cancellationStartedAt),
      frameSource,
      sourceWidth,
      sourceHeight,
      exactResolution,
      lateFrameCount,
      maxFrameLatenessMs,
      averageFrameLatenessMs,
      estimatedDuplicateCaptures,
      expectedDurationMs: input.durationMs,
      measuredRecordingDurationMs,
      durationDriftMs,
      qualityCertification,
      cleanup: cleanupDiagnostics,
    });

    const cleanup = () => {
      if (cleanupCompleted) return cleanupDiagnostics;
      cleanupCompleted = true;
      const cleanupStartedAt = now();
      const warnings: string[] = [];
      const activeRecorder = recorder;
      let recorderStopped = !activeRecorder || activeRecorder.state === 'inactive';
      if (!recorderStopped && activeRecorder) {
        try {
          activeRecorder.stop();
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : 'Recorder stop failed during cleanup.');
        }
        recorderStopped = activeRecorder.state === 'inactive';
      }
      const streamTracksStopped = stopTracks(stream);
      try { compositor.dispose(); } catch { warnings.push('Frame compositor disposal failed.'); }
      try { output.dispose(); } catch { warnings.push('Recording canvas disposal failed.'); }
      cleanupDiagnostics = createCleanupDiagnostics({
        recorderStopped,
        streamTracksStopped,
        recordingCanvasDisposed: true,
        compositorDisposed: true,
        cleanupDurationMs: Math.max(0, now() - cleanupStartedAt),
        warnings,
      });
      return cleanupDiagnostics;
    };

    try {
      input.onProgress?.({
        state: controller.state,
        publishedFrameCount: 0,
        totalFrames: Math.max(1, Math.round(input.durationMs / 1000 * input.profile.fps)),
        elapsedMs: 0,
        label: 'Preparing production recorder…',
      });

      // Phase 7.3E.6B recovery: use the broadly-supported automatic stream path
      // directly. The prior short liveness probe incorrectly rejected hosts that
      // emit data only on stop, and requestFrame() was a false-positive in Figma.
      captureMode = 'automatic-fps';
      const capture = createCaptureStream(output.canvas, input.profile.fps, captureMode);
      stream = capture.stream;
      captureTrack = capture.track;
      const configured = createConfiguredRecorder(
        recorderCtor,
        stream,
        input.profile.videoBitsPerSecond,
      );
      recorder = configured.recorder;
      selectedCodecLabel = configured.codec.codecLabel;
      codecFallbackIndex = configured.fallbackIndex;
      liveness = { passed: true, attemptCount: 1, probeDurationMs: 0, probeBytes: 0, failures: [] };

      // Publish an exact frame before MediaRecorder starts so the stream track is
      // already live when Chromium binds the encoder.
      await input.renderFrame(0, 0);
      const bootstrapComposite = await compositeCurrentFrame(input, output, compositor);
      frameSource = bootstrapComposite.source;
      sourceWidth = bootstrapComposite.sourceWidth;
      sourceHeight = bootstrapComposite.sourceHeight;
      exactResolution = bootstrapComposite.exactResolution;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const recorderStopped = new Promise<void>((resolve, reject) => {
        if (!recorder) return reject(new Error('MediaRecorder was not created.'));
        recorder.ondataavailable = (event) => {
          if (event.data.size <= 0) return;
          chunks.push(event.data);
          chunkCount += 1;
          accumulatedBytes += event.data.size;
        };
        recorder.onerror = () => reject(new Error('MediaRecorder failed during recording.'));
        recorder.onstop = () => resolve();
      });

      const onAbort = () => {
        cancellationStartedAt ??= now();
        if (controller.state === 'preparing' || controller.state === 'recording' || controller.state === 'stopping' || controller.state === 'finalizing') {
          controller.transition('cancelled');
        }
        input.onProgress?.({
          state: 'cancelled',
          publishedFrameCount,
          totalFrames: Math.max(1, Math.round(input.durationMs / 1000 * input.profile.fps)),
          elapsedMs: Math.max(0, now() - (startedAtMs ?? now())),
          label: 'Cancelling export…',
        });
        if (recorder?.state === 'recording' || recorder?.state === 'paused') {
          try { recorder.requestData(); } catch { /* Optional host operation. */ }
          try { recorder.stop(); } catch { /* Best-effort stop. */ }
        }
        stopTracks(stream);
      };
      input.signal?.addEventListener('abort', onAbort, { once: true });

      try {
        recorder.start(RECORDING_PRODUCTION_TIMESLICE_MS);
        startedAtMs = now();
        controller.transition('recording');
        input.onProgress?.({
          state: controller.state,
          publishedFrameCount: 0,
          totalFrames: Math.max(1, Math.round(input.durationMs / 1000 * input.profile.fps)),
          elapsedMs: 0,
          label: `Recording video (${captureMode === 'automatic-fps' ? 'automatic capture' : 'manual capture'})…`,
        });

        const frameResult = await publishRecordingFrames({
          fps: input.profile.fps,
          durationMs: input.durationMs,
          signal: input.signal,
          requestCapturedFrame: captureMode === 'manual-request-frame' ? () => captureTrack?.requestFrame?.() : undefined,
          renderFrame: async (elapsedSeconds, frameIndex) => {
            await input.renderFrame(elapsedSeconds, frameIndex);
            if (input.signal?.aborted) throw abortError(input.signal);
            const compositeResult = await compositeCurrentFrame(input, output, compositor);
            frameSource = compositeResult.source;
            sourceWidth = compositeResult.sourceWidth;
            sourceHeight = compositeResult.sourceHeight;
            exactResolution = compositeResult.exactResolution;
            if (!exactResolution) {
              throw new Error(
                `Export frame resolution mismatch: expected ${output.canvas.width}×${output.canvas.height}, `
                + `received ${sourceWidth}×${sourceHeight}.`,
              );
            }
          },
          onFrame: (frame, totalFrames, elapsedMs) => {
            publishedFrameCount = frame;
            input.onProgress?.({
              state: controller.state,
              publishedFrameCount: frame,
              totalFrames,
              elapsedMs,
              label: `Recording frame ${frame}/${totalFrames}…`,
            });
          },
          now,
        });
        publishedFrameCount = frameResult.publishedFrames;
        lateFrameCount = frameResult.lateFrameCount;
        maxFrameLatenessMs = frameResult.maxFrameLatenessMs;
        averageFrameLatenessMs = frameResult.averageFrameLatenessMs;
        estimatedDuplicateCaptures = frameResult.estimatedDuplicateCaptures;
        if (input.signal?.aborted) throw abortError(input.signal);
        controller.transition('stopping');
        input.onProgress?.({
          state: controller.state,
          publishedFrameCount,
          totalFrames: frameResult.totalFrames,
          elapsedMs: input.durationMs,
          label: 'Stopping recorder…',
        });
        // Keep the final rendered frame visible until the requested wall-clock
        // duration is fully represented by the automatic capture stream. Never
        // stop early: Loop Lock may extend duration, but export may not trim it.
        const targetStopAtMs = (startedAtMs ?? now()) + input.durationMs + Math.ceil(1000 / input.profile.fps);
        const remainingHoldMs = Math.max(0, targetStopAtMs - now());
        if (remainingHoldMs > 0) await wait(remainingHoldMs);
        if (recorder.state === 'recording') {
          try { recorder.requestData(); } catch { /* Optional host operation. */ }
          await wait(Math.max(50, Math.ceil(1000 / input.profile.fps)));
          recorder.stop();
        }
        await waitWithTimeout(recorderStopped, 5_000, 'MediaRecorder finalization');
        stoppedAtMs = now();
        measuredRecordingDurationMs = startedAtMs === undefined ? undefined : Math.max(0, stoppedAtMs - startedAtMs);
        durationDriftMs = measuredRecordingDurationMs === undefined ? undefined : measuredRecordingDurationMs - input.durationMs;
        controller.transition('finalizing');
        input.onProgress?.({
          state: controller.state,
          publishedFrameCount,
          totalFrames: frameResult.totalFrames,
          elapsedMs: input.durationMs,
          label: 'Finalizing video…',
        });
        const finalMimeType = recorder.mimeType || configured.codec.mimeType;
        const blob = new Blob(chunks, { type: finalMimeType });
        validateRecordingBlob({ blob, mimeType: finalMimeType, chunkCount, publishedFrameCount });
        qualityCertification = createRecordingQualityCertification({
          blobBytes: blob.size,
          durationMs: input.durationMs,
          targetBitsPerSecond: input.profile.videoBitsPerSecond,
          quality: input.profile.quality,
          chunkCount,
          publishedFrameCount,
          totalFrameCount: frameResult.totalFrames,
        });
        controller.transition('restoring');
        cleanup();
        controller.transition('completed');
        return { blob, mimeType: finalMimeType, diagnostics: diagnostics() };
      } finally {
        input.signal?.removeEventListener('abort', onAbort);
      }
    } catch (error) {
      if (input.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        if (controller.state !== 'cancelled' && controller.state !== 'restoring') {
          if (controller.state === 'preparing' || controller.state === 'recording' || controller.state === 'stopping' || controller.state === 'finalizing') controller.transition('cancelled');
        }
        throw abortError(input.signal);
      }
      if (controller.state !== 'failed') {
        if (controller.state === 'preparing' || controller.state === 'recording' || controller.state === 'stopping' || controller.state === 'finalizing' || controller.state === 'restoring') {
          controller.transition('failed');
        }
      }
      throw error;
    } finally {
      cleanup();
    }
  }
}
