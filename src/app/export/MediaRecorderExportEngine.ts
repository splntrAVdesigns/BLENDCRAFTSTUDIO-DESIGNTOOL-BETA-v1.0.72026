import { assertValidExportBlob } from './ExportBlobValidation.ts';
import { detectMediaRecorderCapability } from './MediaRecorderCapability.ts';

export interface MediaRecorderExportEngineInput {
  readonly canvas: HTMLCanvasElement;
  readonly fps: number;
  readonly durationMs: number;
  readonly videoBitsPerSecond?: number;
  readonly signal?: AbortSignal;
  readonly onStarted?: (requestCapturedFrame?: () => void) => void;
  readonly onElapsed?: (elapsedMs: number) => void;
  /**
   * Optional external completion boundary. Phase 7.3D uses the render
   * scheduler promise so the recorder stops only after the final scheduled
   * renderer sample has settled. When omitted, durationMs owns stopping.
   */
  readonly stopWhen?: Promise<unknown>;
  readonly recorderCtor?: typeof MediaRecorder;
  readonly now?: () => number;
  readonly setTimer?: typeof setTimeout;
  readonly clearTimer?: typeof clearTimeout;
}

export class MediaRecorderExportEngine {
  async record(input: MediaRecorderExportEngineInput): Promise<Blob> {
    const recorderCtor = input.recorderCtor ?? (typeof MediaRecorder === 'undefined' ? undefined : MediaRecorder);
    const capability = detectMediaRecorderCapability(recorderCtor);
    if (!capability.supported || !capability.mimeType || !recorderCtor) {
      throw new Error(capability.reason ?? 'MediaRecorder is unavailable.');
    }
    if (typeof input.canvas.captureStream !== 'function') throw new Error('Canvas captureStream() is unavailable.');
    if (input.signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');

    // Prefer manual frame capture when supported. This prevents the browser
    // from sampling the WebGL canvas between deterministic renders, which was
    // producing stale/duplicate frames and visibly choppy motion in Figma.
    const manualStream = input.canvas.captureStream(0);
    const videoTrack = manualStream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
    const canRequestFrame = typeof videoTrack?.requestFrame === 'function';
    const stream = canRequestFrame ? manualStream : input.canvas.captureStream(Math.max(1, input.fps));
    if (!canRequestFrame) manualStream.getTracks().forEach((track) => track.stop());
    const requestCapturedFrame = canRequestFrame ? () => videoTrack.requestFrame?.() : undefined;
    const chunks: BlobPart[] = [];
    const recorder = new recorderCtor(stream, {
      mimeType: capability.mimeType,
      videoBitsPerSecond: input.videoBitsPerSecond,
    });
    const now = input.now ?? (() => performance.now());
    const setTimer = input.setTimer ?? setTimeout;
    const clearTimer = input.clearTimer ?? clearTimeout;
    const startedAt = now();
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    let progressTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        let promiseSettled = false;
        const settleResolve = (value: Blob) => {
          if (promiseSettled) return;
          promiseSettled = true;
          resolve(value);
        };
        const settleReject = (error: unknown) => {
          if (promiseSettled) return;
          promiseSettled = true;
          reject(error);
        };
        const cleanupListeners = () => input.signal?.removeEventListener('abort', onAbort);
        const stopSafely = () => {
          if (recorder.state === 'recording') {
            try { recorder.requestData(); } catch { /* host may not support explicit chunk requests */ }
          }
          if (recorder.state !== 'inactive') recorder.stop();
        };
        const publishElapsed = () => {
          input.onElapsed?.(Math.min(input.durationMs, now() - startedAt));
          if (recorder.state !== 'inactive') progressTimer = setTimer(publishElapsed, 100);
        };
        let cancellationError: DOMException | null = null;
        const onAbort = () => {
          // Do not reject before MediaRecorder has emitted `stop`. Restoring the
          // WebGL renderer while its capture track is still active can race an
          // in-flight render and reset the Figma preview.
          cancellationError = new DOMException(String(input.signal?.reason ?? 'Export cancelled.'), 'AbortError');
          stopSafely();
        };
        recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
        recorder.onerror = () => {
          cleanupListeners();
          settleReject(new Error('MediaRecorder failed during recording.'));
        };
        recorder.onstop = () => {
          cleanupListeners();
          if (cancellationError) {
            settleReject(cancellationError);
            return;
          }
          if (chunks.length === 0) {
            settleReject(new Error('MediaRecorder produced no video chunks in this host. Use the frame-accurate export backend.'));
            return;
          }
          const result = new Blob(chunks, { type: recorder.mimeType || capability.mimeType || 'video/webm' });
          try {
            assertValidExportBlob({ blob: result, expectedMimePrefix: 'video/webm', recorderState: recorder.state });
            settleResolve(result);
          } catch (error) {
            settleReject(error);
          }
        };
        input.signal?.addEventListener('abort', onAbort, { once: true });
        recorder.start();
        // Capture the already-prepared frame zero before the scheduler advances.
        requestCapturedFrame?.();
        input.onStarted?.(requestCapturedFrame);
        publishElapsed();

        if (input.stopWhen) {
          void input.stopWhen.then(
            () => stopSafely(),
            (error) => {
              stopSafely();
              settleReject(error);
            },
          );
        } else {
          stopTimer = setTimer(stopSafely, Math.max(0, input.durationMs));
        }
      });
      return blob;
    } finally {
      if (stopTimer !== undefined) clearTimer(stopTimer);
      if (progressTimer !== undefined) clearTimer(progressTimer);
      stream.getTracks().forEach((track) => track.stop());
    }
  }
}
