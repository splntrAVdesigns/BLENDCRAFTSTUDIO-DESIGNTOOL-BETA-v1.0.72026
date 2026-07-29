import { runRealTimeExportClock } from './RealTimeExportClock';
import type { RecordingFramePublisherResult } from './types';

export interface RecordingFramePublisherInput {
  readonly fps: number;
  readonly durationMs: number;
  readonly renderFrame: (elapsedSeconds: number, frameIndex: number) => void | Promise<void>;
  readonly requestCapturedFrame?: () => void;
  readonly signal?: AbortSignal;
  readonly onFrame?: (frame: number, totalFrames: number, elapsedMs: number) => void;
  readonly now?: () => number;
  readonly requestAnimationFrameFn?: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrameFn?: (handle: number) => void;
}

export async function publishRecordingFrames(
  input: RecordingFramePublisherInput,
): Promise<RecordingFramePublisherResult> {
  const result = await runRealTimeExportClock({
    fps: input.fps,
    durationMs: input.durationMs,
    startFrameIndex: 1,
    signal: input.signal,
    now: input.now,
    requestAnimationFrameFn: input.requestAnimationFrameFn,
    cancelAnimationFrameFn: input.cancelAnimationFrameFn,
    onTick: async (elapsedSeconds, frameIndex) => {
      await input.renderFrame(elapsedSeconds, frameIndex);
      input.requestCapturedFrame?.();
    },
    onProgress: input.onFrame,
  });

  return {
    totalFrames: result.totalFrames,
    publishedFrames: result.publishedFrames,
    skippedFrames: result.estimatedDuplicateCaptures,
    lateFrameCount: result.lateFrameCount,
    maxFrameLatenessMs: result.maxFrameLatenessMs,
    averageFrameLatenessMs: result.averageFrameLatenessMs,
    estimatedDuplicateCaptures: result.estimatedDuplicateCaptures,
    elapsedMs: result.elapsedMs,
    usedManualRequestFrame: Boolean(input.requestCapturedFrame),
  };
}
