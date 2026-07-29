export type ExportCatchUpStrategy = 'all' | 'latest';

export interface ExportRenderSchedulerInput {
  readonly durationMs: number;
  readonly fps: number;
  readonly renderAtTime: (elapsedSeconds: number) => void | Promise<void>;
  readonly signal?: AbortSignal;
  readonly onFrame?: (frame: number, totalFrames: number, elapsedMs: number) => void;
  readonly onSlowFrame?: (renderMs: number, frameBudgetMs: number) => void;
  /**
   * `all` preserves the original deterministic offline test behavior.
   * `latest` is used by MediaRecorder so an expensive frame never creates an
   * ever-growing backlog that extends animation timing beyond wall-clock time.
   */
  readonly catchUpStrategy?: ExportCatchUpStrategy;
  /** First sample index. Frame zero may already be prepared/captured by the bridge. */
  readonly startFrame?: number;
  readonly now?: () => number;
  readonly requestFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelFrame?: (handle: number) => void;
}

export interface ExportRenderSchedulerResult {
  readonly totalFrames: number;
  readonly renderedSamples: number;
  readonly skippedSamples: number;
  readonly slowFrames: number;
  readonly longestRenderMs: number;
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  return reason instanceof Error ? reason : new DOMException(String(reason ?? 'Export cancelled.'), 'AbortError');
}

export async function runExportRenderScheduler(
  input: ExportRenderSchedulerInput,
): Promise<ExportRenderSchedulerResult> {
  const durationMs = Math.max(0, input.durationMs);
  const fps = Math.max(1, input.fps);
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * fps));
  const frameIntervalMs = 1000 / fps;
  const catchUpStrategy = input.catchUpStrategy ?? 'all';
  const now = input.now ?? (() => performance.now());
  const requestFrame = input.requestFrame ?? requestAnimationFrame;
  const cancelFrame = input.cancelFrame ?? cancelAnimationFrame;
  const startedAt = now();
  let nextFrame = Math.max(0, Math.min(totalFrames - 1, Math.floor(input.startFrame ?? 0)));
  let renderedSamples = 0;
  let skippedSamples = 0;
  let slowFrames = 0;
  let longestRenderMs = 0;
  let rafHandle: number | null = null;
  let settled = false;

  return await new Promise<ExportRenderSchedulerResult>((resolve, reject) => {
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (rafHandle !== null) cancelFrame(rafHandle);
      input.signal?.removeEventListener('abort', onAbort);
      if (error) {
        reject(error);
      } else {
        resolve({ totalFrames, renderedSamples, skippedSamples, slowFrames, longestRenderMs });
      }
    };
    const onAbort = () => finish(abortError(input.signal));
    input.signal?.addEventListener('abort', onAbort, { once: true });
    if (input.signal?.aborted) return onAbort();

    const schedule = () => { if (!settled) rafHandle = requestFrame(tick); };
    const renderSample = async (frame: number) => {
      const sampleMs = Math.min(durationMs, frame * frameIntervalMs);
      const renderStartedAt = now();
      await input.renderAtTime(sampleMs / 1000);
      const renderMs = Math.max(0, now() - renderStartedAt);
      longestRenderMs = Math.max(longestRenderMs, renderMs);
      if (renderMs > frameIntervalMs) {
        slowFrames += 1;
        input.onSlowFrame?.(renderMs, frameIntervalMs);
      }
      renderedSamples += 1;
      input.onFrame?.(frame + 1, totalFrames, sampleMs);
    };

    const tick: FrameRequestCallback = () => {
      void (async () => {
        if (settled) return;
        if (input.signal?.aborted) return onAbort();
        const elapsedMs = Math.min(durationMs, Math.max(0, now() - startedAt));
        const dueFrame = Math.min(totalFrames - 1, Math.floor(elapsedMs / frameIntervalMs));
        try {
          if (catchUpStrategy === 'latest' && dueFrame >= nextFrame) {
            if (dueFrame > nextFrame) skippedSamples += dueFrame - nextFrame;
            nextFrame = dueFrame + 1;
            await renderSample(dueFrame);
          } else {
            while (nextFrame <= dueFrame) {
              input.signal?.throwIfAborted();
              const frame = nextFrame++;
              await renderSample(frame);
            }
          }
        } catch (error) {
          return finish(error);
        }
        if (elapsedMs >= durationMs && nextFrame >= totalFrames) return finish();
        schedule();
      })();
    };
    schedule();
  });
}
