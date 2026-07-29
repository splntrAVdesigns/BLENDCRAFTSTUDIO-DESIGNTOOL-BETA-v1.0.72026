import { RecordingExportEngine } from './RecordingExportEngine';
import { resolveRecordingProfile } from './RecordingProfiles';
import { isolatePreview } from './PreviewIsolationController';
import { assertExactRecordingResolution, normalizeRecordingResolution } from './RecordingResolution';
import { acquireRecordingSessionLease, runRecoveryStep } from './RecordingRecovery';
import type { RecordingProgress, RecordingQuality, RecordingSessionResult } from './types';

export interface ProductionRecordingRenderApi {
  readonly renderAtTime: (time: number, exportRenderer?: unknown, opts?: { seekMedia?: boolean }) => Promise<void>;
  readonly readFramePixels?: () => { data: Uint8Array; width: number; height: number } | null;
  readonly configureExportTimeline?: (config: { fps: number; totalFrames: number; durationMs: number; loopLockEnabled?: boolean }) => void;
  readonly clearExportTimeline?: () => void;
  readonly pauseAnimation?: (options?: { resetExportPhase?: boolean }) => void;
  readonly resumeAnimation?: () => void;
  readonly setExportSize?: (width: number, height: number) => void;
  readonly restoreSize?: () => void;
  readonly waitForMaskTextures?: (timeoutMs?: number) => Promise<void>;
  readonly prepareAudioExport?: () => Promise<string | null>;
  readonly finishAudioExport?: () => void;
  readonly cleanupExportSession?: () => Promise<void>;
}

export interface ProductionRecordingExportInput {
  readonly api: ProductionRecordingRenderApi;
  readonly sourceCanvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationMs: number;
  readonly quality: RecordingQuality;
  readonly resetExportPhase: boolean;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: number, message: string) => void;
}

function progressPercent(progress: RecordingProgress): number {
  if (progress.totalFrames <= 0) return 0;
  return Math.min(96, Math.max(0, Math.round(progress.publishedFrameCount / progress.totalFrames * 92)));
}

export async function exportWithProductionRecordingEngine(
  input: ProductionRecordingExportInput,
): Promise<RecordingSessionResult> {
  const resolution = normalizeRecordingResolution(input.width, input.height);
  const profile = resolveRecordingProfile({
    width: resolution.width,
    height: resolution.height,
    fps: input.fps,
    quality: input.quality,
    durationMs: input.durationMs,
  });
  const engine = new RecordingExportEngine();
  const releaseSessionLease = acquireRecordingSessionLease();
  let previewIsolation: ReturnType<typeof isolatePreview> | null = null;

  try {
    input.onProgress?.(0, 'Capturing preview…');
    previewIsolation = isolatePreview({
      sourceCanvas: input.sourceCanvas,
      readFramePixels: input.api.readFramePixels,
    });

    input.api.configureExportTimeline?.({
      fps: input.fps,
      totalFrames: Math.max(1, Math.round(input.durationMs / 1000 * input.fps)),
      durationMs: input.durationMs,
    });
    input.api.pauseAnimation?.({ resetExportPhase: input.resetExportPhase });
    input.api.setExportSize?.(resolution.width, resolution.height);
    await input.api.waitForMaskTextures?.();

    // Render frame zero once after the renderer and all post-process targets have
    // reached the exact export dimensions. This is both a shader warmup and a
    // hard resolution certification before MediaRecorder starts.
    await input.api.renderAtTime(0, undefined, { seekMedia: true });
    const warmupPixels = input.api.readFramePixels?.() ?? null;
    if (warmupPixels) {
      assertExactRecordingResolution(
        resolution,
        { width: warmupPixels.width, height: warmupPixels.height },
        'warmup render target',
      );
    } else {
      assertExactRecordingResolution(
        resolution,
        { width: input.sourceCanvas.width, height: input.sourceCanvas.height },
        'renderer canvas',
      );
    }

    const bakeStatus = await input.api.prepareAudioExport?.();
    if (bakeStatus) input.onProgress?.(1, bakeStatus);

    return await engine.record({
      sourceCanvas: input.sourceCanvas,
      profile,
      durationMs: input.durationMs,
      signal: input.signal,
      readFramePixels: input.api.readFramePixels,
      renderFrame: async (elapsedSeconds) => {
        await input.api.renderAtTime(elapsedSeconds, undefined, { seekMedia: false });
      },
      onProgress: (progress) => input.onProgress?.(progressPercent(progress), progress.label),
    });
  } finally {
    input.onProgress?.(98, input.signal?.aborted ? 'Cancelling and restoring preview…' : 'Restoring preview safely…');
    const cleanupWarnings: string[] = [];

    const audioWarning = await runRecoveryStep({
      label: 'Audio export cleanup',
      timeoutMs: 750,
      run: () => input.api.finishAudioExport?.(),
    });
    if (audioWarning) cleanupWarnings.push(audioWarning);

    let rendererCleanupWarning: string | null = null;
    if (input.api.cleanupExportSession) {
      rendererCleanupWarning = await runRecoveryStep({
        label: 'Renderer export cleanup',
        timeoutMs: 2_000,
        run: () => input.api.cleanupExportSession?.(),
      });
    }

    if (!input.api.cleanupExportSession || rendererCleanupWarning) {
      if (rendererCleanupWarning) cleanupWarnings.push(rendererCleanupWarning);
      const fallbackSteps = [
        { label: 'Export timeline reset', run: () => input.api.clearExportTimeline?.() },
        { label: 'Renderer size restoration', run: () => input.api.restoreSize?.() },
        { label: 'Animation restoration', run: () => input.api.resumeAnimation?.() },
      ] as const;
      for (const step of fallbackSteps) {
        const warning = await runRecoveryStep({ ...step, timeoutMs: 750 });
        if (warning) cleanupWarnings.push(warning);
      }
    }

    const previewWarning = await runRecoveryStep({
      label: 'Preview isolation cleanup',
      timeoutMs: 500,
      run: () => previewIsolation?.dispose(),
    });
    if (previewWarning) cleanupWarnings.push(previewWarning);

    releaseSessionLease();
    if (cleanupWarnings.length > 0) {
      console.warn('[Blendcraft recording recovery]', cleanupWarnings);
    }
  }
}
