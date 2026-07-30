import type { RenderApi } from '../types/gradient.ts';
import { createAuthoritativeExportFrameSource } from './AuthoritativeExportFrameSource.ts';
import { MediaRecorderExportEngine } from './MediaRecorderExportEngine.ts';
import {
  runExportRenderScheduler,
  type ExportRenderSchedulerResult,
} from './ExportRenderScheduler.ts';

export interface NativeRecorderExportInput {
  readonly api: RenderApi;
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationMs: number;
  readonly videoBitsPerSecond?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: number, message: string) => void;
  readonly onSlowFrame?: (renderMs: number, frameBudgetMs: number) => void;
  readonly resetExportPhase?: boolean;
  readonly recorderEngine?: MediaRecorderExportEngine;
}

export interface NativeRecorderExportResult {
  readonly blob: Blob;
  readonly scheduler: ExportRenderSchedulerResult;
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

/**
 * Phase 7.3D integration boundary.
 *
 * This bridge deliberately owns only renderer/recorder coordination. Animation
 * speed, easing, phase, audio response, video seeking, masks, and shader time
 * remain authoritative inside GradientCanvas.renderAtTime().
 */
export async function exportWithNativeRecorder(
  input: NativeRecorderExportInput,
): Promise<NativeRecorderExportResult> {
  const {
    api,
    canvas,
    width,
    height,
    fps,
    durationMs,
    videoBitsPerSecond,
    signal,
    onProgress,
    onSlowFrame,
  } = input;

  const frameSource = createAuthoritativeExportFrameSource(api);
  if (!api.setExportSize || !api.restoreSize) {
    throw new Error('Export-size renderer controls are unavailable.');
  }

  throwIfAborted(signal);
  onProgress?.(0, 'Preparing native recorder…');

  await api.waitForMaskTextures?.(4000);
  throwIfAborted(signal);

  api.setExportSize(width, height);
  throwIfAborted(signal);

  // Prepare the exact starting frame before captureStream/MediaRecorder begins,
  // preventing a preview-sized or stale frame from becoming frame zero.
  await frameSource.renderFrame(0, true);
  throwIfAborted(signal);

  const recorderEngine = input.recorderEngine ?? new MediaRecorderExportEngine();
  let markRecorderStarted!: (requestCapturedFrame?: () => void) => void;
  let requestCapturedFrame: (() => void) | undefined;
  const recorderStarted = new Promise<void>((resolve) => {
    markRecorderStarted = (requestFrame) => {
      requestCapturedFrame = requestFrame;
      resolve();
    };
  });
  let schedulerResult: ExportRenderSchedulerResult | null = null;

  const schedulerPromise = recorderStarted.then(async () => {
    schedulerResult = await runExportRenderScheduler({
      durationMs,
      fps,
      signal,
      catchUpStrategy: 'latest',
      startFrame: 1,
      renderAtTime: async (elapsedSeconds) => {
        await frameSource.renderFrame(elapsedSeconds, true);
        // Manual captureStream tracks only emit after the deterministic frame
        // has fully settled, avoiding compositor-time sampling of stale frames.
        requestCapturedFrame?.();
      },
      onFrame: (frame, totalFrames, elapsedMs) => {
        const progress = Math.min(99, Math.max(0, (elapsedMs / Math.max(1, durationMs)) * 100));
        onProgress?.(
          progress,
          `Recording ${(elapsedMs / 1000).toFixed(1)}s / ${(durationMs / 1000).toFixed(1)}s · ${frame}/${totalFrames} samples`,
        );
      },
      onSlowFrame,
    });
    return schedulerResult;
  });

  let blob: Blob;
  try {
    blob = await recorderEngine.record({
      canvas,
      fps,
      durationMs,
      videoBitsPerSecond,
      signal,
      onStarted: markRecorderStarted,
      stopWhen: schedulerPromise,
    });
  } catch (error) {
    // Ensure the render scheduler has fully stopped before the caller restores
    // preview size/state. This closes the cancellation reset race.
    await schedulerPromise.catch(() => undefined);
    throw error;
  }

  const finalSchedulerResult = schedulerResult ?? await schedulerPromise;
  onProgress?.(100, 'Native recording complete');
  return { blob, scheduler: finalSchedulerResult };
}
