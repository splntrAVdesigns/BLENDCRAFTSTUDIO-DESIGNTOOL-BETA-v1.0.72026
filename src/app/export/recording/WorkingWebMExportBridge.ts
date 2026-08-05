/**
 * PHASE 7.12 — GIANT LEAP: stop reconstructing the export engine, call the
 * real one.
 *
 * `src/app/utils/exportUtils.ts` already contains `exportWebMFromCanvas`: a
 * complete, sprint-hardened WebM export engine with the correct VP9 level
 * selection (Stage 3.3), the correct backpressure watermark and yield
 * cadence (Stage 2.8.2/2.8.5), the correct staging-canvas capture path, real
 * flush-drain progress polling (Stage 2.8.3), loop verification (Stage
 * 2.8.4), and an explicit MediaRecorder fallback of last resort. It has been
 * present and untouched in this codebase throughout Phases 7.7-7.11.
 *
 * The entire "deterministic-webcodecs" engine built across Phases 7.7-7.11
 * was an unnecessary reimplementation of logic that already existed,
 * already worked, and already carried the lessons of every bug this
 * reimplementation went on to independently rediscover (VP9 level cascade,
 * dequeue-vs-flush starvation, watermark tuning, flush taking a long time on
 * software encode). This bridge stops calling the reconstruction and wires
 * the real function in directly.
 *
 * The one thing the reconstruction got right that exportWebMFromCanvas does
 * NOT handle on its own: freezing the live preview canvas during export.
 * exportWebMFromCanvas renders directly onto the export-resolution canvas
 * via renderFrameAtTime, so without isolation the live preview would visibly
 * flash/resize during export. That lifecycle (isolatePreview + pause/resume
 * animation + mask-texture wait) is preserved here exactly as validated in
 * DeterministicExportBridge.
 */

import { exportWebMFromCanvas, type VideoQuality } from '../../utils/exportUtils';
import { isolatePreview } from './PreviewIsolationController';
import { acquireRecordingSessionLease, runRecoveryStep } from './RecordingRecovery';
import type { ProductionRecordingRenderApi } from './ProductionRecordingExportBridge';

export interface WorkingWebMExportInput {
  readonly api: ProductionRecordingRenderApi;
  readonly sourceCanvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationMs: number;
  readonly quality: VideoQuality;
  readonly loopLockEnabled: boolean;
  readonly filename: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (percent: number, message: string) => void;
}

export async function runWorkingWebMExport(input: WorkingWebMExportInput): Promise<void> {
  const startedAt = performance.now();
  console.info('[BLENDCRAFT Video Export] Started', {
    engine: 'exportWebMFromCanvas (proven Stage 3.3 engine)',
    width: input.width,
    height: input.height,
    fps: input.fps,
    durationMs: input.durationMs,
    quality: input.quality,
    loopLockEnabled: input.loopLockEnabled,
  });

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
      totalFrames: Math.max(1, Math.round((input.durationMs / 1000) * input.fps)),
      durationMs: input.durationMs,
      loopLockEnabled: input.loopLockEnabled,
    });
    input.api.pauseAnimation?.({ resetExportPhase: input.loopLockEnabled });
    await input.api.waitForMaskTextures?.();

    const bakeStatus = await input.api.prepareAudioExport?.();
    if (bakeStatus) input.onProgress?.(1, bakeStatus);

    // THE ACTUAL CALL: the real, proven engine. Not a reconstruction.
    await exportWebMFromCanvas({
      canvas: input.sourceCanvas,
      renderFrameAtTime: input.api.renderAtTime,
      fps: input.fps,
      durationMs: input.durationMs,
      filename: input.filename,
      quality: input.quality,
      width: input.width,
      height: input.height,
      getLiveCanvas: () => input.sourceCanvas,
      getReadFramePixels: input.api.readFramePixels,
      setExportSize: input.api.setExportSize,
      restoreSize: input.api.restoreSize,
      onProgress: (percent, message) => input.onProgress?.(percent, message ?? ''),
      signal: input.signal,
      verifyLoop: input.loopLockEnabled,
      onLoopVerified: (result) => {
        console.info('[BLENDCRAFT Video Export] Loop verification:', result);
      },
    });

    console.info('[BLENDCRAFT Video Export] Complete', {
      engine: 'exportWebMFromCanvas',
      totalWallClockSec: (performance.now() - startedAt) / 1000,
      requestedDurationSec: input.durationMs / 1000,
    });
  } catch (error) {
    console.error('[BLENDCRAFT Video Export] Failed', {
      engine: 'exportWebMFromCanvas',
      totalWallClockSec: (performance.now() - startedAt) / 1000,
      error,
    });
    throw error;
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
      console.warn('[Blendcraft working-webm export recovery]', cleanupWarnings);
    }
  }
}
