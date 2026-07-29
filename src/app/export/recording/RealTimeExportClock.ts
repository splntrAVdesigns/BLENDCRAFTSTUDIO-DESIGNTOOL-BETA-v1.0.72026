export interface RealTimeExportClockInput {
  readonly fps: number;
  readonly durationMs: number;
  readonly startFrameIndex?: number;
  readonly signal?: AbortSignal;
  readonly onTick: (elapsedSeconds: number, frameIndex: number, totalFrames: number) => void | Promise<void>;
  readonly onProgress?: (publishedFrames: number, totalFrames: number, elapsedMs: number) => void;
  readonly now?: () => number;
  readonly requestAnimationFrameFn?: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrameFn?: (handle: number) => void;
  readonly setTimeoutFn?: typeof setTimeout;
  readonly clearTimeoutFn?: typeof clearTimeout;
}

export interface RealTimeExportClockResult {
  readonly totalFrames: number;
  readonly publishedFrames: number;
  readonly lateFrameCount: number;
  readonly maxFrameLatenessMs: number;
  readonly averageFrameLatenessMs: number;
  readonly estimatedDuplicateCaptures: number;
  readonly elapsedMs: number;
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  return reason instanceof Error ? reason : new DOMException(String(reason ?? 'Export cancelled.'), 'AbortError');
}

/**
 * Absolute-deadline export clock.
 *
 * Frame zero may be pre-published before MediaRecorder starts. When
 * startFrameIndex is 1, frame 0 remains visible for the first complete frame
 * interval and frame 1 is rendered at the 33.33ms boundary for 30fps. This
 * avoids the duplicated frame-zero burst that previously shortened playback.
 */
export async function runRealTimeExportClock(input: RealTimeExportClockInput): Promise<RealTimeExportClockResult> {
  const fps = Math.max(1, Math.floor(input.fps));
  const durationMs = Math.max(1, input.durationMs);
  const totalFrames = Math.max(1, Math.round(durationMs / 1000 * fps));
  const frameIntervalMs = 1000 / fps;
  const now = input.now ?? (() => performance.now());
  const requestFrame = input.requestAnimationFrameFn ?? requestAnimationFrame;
  const cancelFrame = input.cancelAnimationFrameFn ?? cancelAnimationFrame;
  const scheduleTimeout = input.setTimeoutFn ?? setTimeout;
  const cancelTimeout = input.clearTimeoutFn ?? clearTimeout;
  const startFrameIndex = Math.min(totalFrames, Math.max(0, Math.floor(input.startFrameIndex ?? 0)));
  const startedAt = now();
  let nextFrameIndex = startFrameIndex;
  let lateFrameCount = 0;
  let maxFrameLatenessMs = 0;
  let totalFrameLatenessMs = 0;
  let estimatedDuplicateCaptures = 0;
  let rafHandle: number | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  return await new Promise<RealTimeExportClockResult>((resolve, reject) => {
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (rafHandle !== null) cancelFrame(rafHandle);
      if (timeoutHandle !== null) cancelTimeout(timeoutHandle);
      input.signal?.removeEventListener('abort', onAbort);
      const elapsedMs = Math.max(0, now() - startedAt);
      const renderedFrames = Math.max(0, nextFrameIndex - startFrameIndex);
      const averageFrameLatenessMs = renderedFrames > 0 ? totalFrameLatenessMs / renderedFrames : 0;
      const result = {
        totalFrames,
        publishedFrames: nextFrameIndex,
        lateFrameCount,
        maxFrameLatenessMs,
        averageFrameLatenessMs,
        estimatedDuplicateCaptures,
        elapsedMs,
      };
      if (error) reject(error);
      else resolve(result);
    };
    const onAbort = () => finish(abortError(input.signal));
    input.signal?.addEventListener('abort', onAbort, { once: true });
    if (input.signal?.aborted) return onAbort();

    const scheduleFrame = () => {
      if (settled) return;
      if (nextFrameIndex >= totalFrames) return finish();
      const targetMs = nextFrameIndex * frameIntervalMs;
      const remainingMs = targetMs - Math.max(0, now() - startedAt);
      if (remainingMs > 5) {
        timeoutHandle = scheduleTimeout(() => {
          timeoutHandle = null;
          scheduleFrame();
        }, Math.max(0, remainingMs - 2));
        return;
      }
      rafHandle = requestFrame(() => {
        rafHandle = null;
        void renderFrameAtDeadline();
      });
    };

    const renderFrameAtDeadline = async () => {
      if (settled) return;
      if (input.signal?.aborted) return onAbort();
      const targetMs = nextFrameIndex * frameIntervalMs;
      const beforeRenderElapsedMs = Math.max(0, now() - startedAt);
      const latenessMs = Math.max(0, beforeRenderElapsedMs - targetMs);
      if (latenessMs > 1) {
        lateFrameCount += 1;
        totalFrameLatenessMs += latenessMs;
        maxFrameLatenessMs = Math.max(maxFrameLatenessMs, latenessMs);
        estimatedDuplicateCaptures += Math.floor(latenessMs / frameIntervalMs);
      }
      const frameIndex = nextFrameIndex;
      try {
        await input.onTick(frameIndex / fps, frameIndex, totalFrames);
        nextFrameIndex += 1;
        input.onProgress?.(nextFrameIndex, totalFrames, Math.min(durationMs, nextFrameIndex * frameIntervalMs));
        scheduleFrame();
      } catch (error) {
        finish(error);
      }
    };

    if (nextFrameIndex >= totalFrames) finish();
    else scheduleFrame();
  });
}
