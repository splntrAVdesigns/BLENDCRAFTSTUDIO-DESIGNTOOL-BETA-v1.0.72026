/**
 * PHASE 7.7 — Deterministic export session bridge.
 *
 * Owns the renderer lifecycle around an export: preview isolation, export sizing,
 * shader/mask warmup, audio envelope baking, and guaranteed restoration. Mirrors
 * the proven ProductionRecordingExportBridge sequencing so the surrounding
 * renderer contract is unchanged — only the capture/encode engine is replaced.
 */

import { isolatePreview } from '../recording/PreviewIsolationController';
import { assertExactRecordingResolution, normalizeRecordingResolution } from '../recording/RecordingResolution';
import { acquireRecordingSessionLease, runRecoveryStep } from '../recording/RecordingRecovery';
import type { ProductionRecordingRenderApi } from '../recording/ProductionRecordingExportBridge';
import { exportDeterministicVideo } from './DeterministicVideoExporter';
import { certifyExportedTimeline, type ExportedTimelineCertification } from './ExportedTimelineCertification';
import type { DeterministicExportResult, DeterministicQuality } from './types';

export interface DeterministicExportSessionInput {
  readonly api: ProductionRecordingRenderApi;
  readonly sourceCanvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationMs: number;
  readonly quality: DeterministicQuality;
  readonly loopLockEnabled: boolean;
  readonly resetExportPhase: boolean;
  readonly filename: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (percent: number, message: string) => void;
}

export type DeterministicExportSessionResult = DeterministicExportResult & {
  readonly playback: ExportedTimelineCertification;
};

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
  }
}

export async function runDeterministicExportSession(
  input: DeterministicExportSessionInput,
): Promise<DeterministicExportSessionResult> {
  const startedAt = performance.now();
  const resolution = normalizeRecordingResolution(input.width, input.height);
  const totalFrames = Math.max(1, Math.round((input.durationMs / 1000) * input.fps));

  console.info('[BLENDCRAFT Video Export] Started', {
    engine: 'deterministic-webcodecs',
    width: resolution.width,
    height: resolution.height,
    fps: input.fps,
    durationMs: input.durationMs,
    totalFrames,
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
      totalFrames,
      durationMs: input.durationMs,
      loopLockEnabled: input.loopLockEnabled,
    });
    input.api.pauseAnimation?.({ resetExportPhase: input.resetExportPhase });
    input.api.setExportSize?.(resolution.width, resolution.height);

    // PHASE 7.7b DIAGNOSTIC: a hang here looks IDENTICAL from outside to a
    // hang in the per-frame loop — the progress bar just never starts. Each
    // step is timed and logged so a stuck warmup is distinguishable from a
    // stuck render loop.
    const timedStep = async <T,>(label: string, run: () => Promise<T> | T): Promise<T> => {
      const startedAt = performance.now();
      const watchdog = window.setTimeout(() => {
        console.warn(`[BLENDCRAFT Video Export] "${label}" has not resolved after 3000 ms.`);
      }, 3_000);
      try {
        const result = await run();
        console.info(`[BLENDCRAFT Video Export] "${label}" completed in ${(performance.now() - startedAt).toFixed(0)} ms`);
        return result;
      } finally {
        window.clearTimeout(watchdog);
      }
    };

    await timedStep('waitForMaskTextures', () => input.api.waitForMaskTextures?.());

    // Frame zero doubles as shader warmup and a hard resolution certification
    // before a single frame is committed to the encoder.
    const warmupPixels = await timedStep('renderAtTime(0) warmup', async () => {
      await input.api.renderAtTime(0, undefined, { seekMedia: true });
      return input.api.readFramePixels?.() ?? null;
    });
    assertExactRecordingResolution(
      resolution,
      warmupPixels
        ? { width: warmupPixels.width, height: warmupPixels.height }
        : { width: input.sourceCanvas.width, height: input.sourceCanvas.height },
      warmupPixels ? 'warmup render target' : 'renderer canvas',
    );

    const bakeStatus = await input.api.prepareAudioExport?.();
    if (bakeStatus) input.onProgress?.(1, bakeStatus);

    const result = await exportDeterministicVideo({
      sourceCanvas: input.sourceCanvas,
      // PHASE 7.8: the export-size GPU readback is the PRIMARY capture source,
      // matching the working Stage 3.3 engine. It preserves the exact
      // full-resolution renderAtTime() output; the live canvas is fallback
      // only, since it may be preview-sized.
      readFramePixels: input.api.readFramePixels,
      width: resolution.width,
      height: resolution.height,
      fps: input.fps,
      durationMs: input.durationMs,
      quality: input.quality,
      signal: input.signal,
      renderFrame: async (elapsedSeconds) => {
        await input.api.renderAtTime(elapsedSeconds, undefined, { seekMedia: false });
      },
      onProgress: (progress) => input.onProgress?.(progress.percent, progress.label),
    });

    input.onProgress?.(94, 'Verifying exported timeline…');
    const playback = await certifyExportedTimeline({
      blob: result.blob,
      expectedDurationMs: input.durationMs,
      fps: input.fps,
      expectedWidth: resolution.width,
      expectedHeight: resolution.height,
      encodedFrames: result.diagnostics.encodedFrames,
    });

    input.onProgress?.(99, 'Preparing download…');
    downloadBlob(result.blob, input.filename);

    console.info('[BLENDCRAFT Video Export] Complete', {
      engine: 'deterministic-webcodecs',
      totalWallClockSec: (performance.now() - startedAt) / 1000,
      requestedDurationSec: input.durationMs / 1000,
      // Read back off the real decoded file, not recomputed from the request.
      measuredDurationSec: playback.measuredDurationSeconds,
      durationDriftMs: playback.durationDriftMs,
      realtimeFactor: result.diagnostics.realtimeFactor,
      diagnostics: result.diagnostics,
    });

    return { ...result, playback };
  } catch (error) {
    console.error('[BLENDCRAFT Video Export] Failed', {
      engine: 'deterministic-webcodecs',
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
      console.warn('[Blendcraft deterministic export recovery]', cleanupWarnings);
    }
  }
}
