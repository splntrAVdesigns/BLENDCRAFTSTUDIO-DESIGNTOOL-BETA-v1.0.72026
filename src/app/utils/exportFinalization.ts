export type ExportFinalizationStage =
  | 'encoding'
  | 'finalizing'
  | 'preparing-file'
  | 'exporting-file'
  | 'cleanup'
  | 'complete';

export interface ExportFinalizationProgress {
  stage: ExportFinalizationStage;
  progress: number;
  message: string;
}

export interface ExportFinalizationTimings {
  encoderDrainAndMuxMs: number;
  /** Retained for older diagnostics; zero when the mux cannot be safely
   *  measured independently from the public encoder-finalization boundary. */
  muxMs: number;
  blobMs: number;
  downloadHandoffMs: number;
  cleanupMs: number;
}

export const EXPORT_FINALIZATION_PROGRESS: Readonly<Record<ExportFinalizationStage, ExportFinalizationProgress>> = {
  encoding: { stage: 'encoding', progress: 90, message: 'Encoding video...' },
  finalizing: { stage: 'finalizing', progress: 95, message: 'Finalizing WebM container...' },
  'preparing-file': { stage: 'preparing-file', progress: 97, message: 'Preparing export file...' },
  'exporting-file': { stage: 'exporting-file', progress: 98, message: 'Exporting file...' },
  cleanup: { stage: 'cleanup', progress: 99, message: 'Cleaning up export resources...' },
  complete: { stage: 'complete', progress: 100, message: 'Export complete' },
};

export function getExportFinalizationProgress(stage: ExportFinalizationStage): ExportFinalizationProgress {
  return EXPORT_FINALIZATION_PROGRESS[stage];
}

function nextAnimationFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function nextMacrotask(delayMs = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Gives the browser a paint before initiating the download and then yields
 * again after the click/blob handoff. This prevents renderer restoration and
 * large resource disposal from starving the queued browser download task.
 */
export async function handoffExportDownload(startDownload: () => void): Promise<number> {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

  await nextAnimationFrame();
  await nextMacrotask(0);
  startDownload();

  // FileSaver queues an anchor click / browser download. Let that task leave
  // JavaScript before cleanup starts competing for the main thread.
  await nextMacrotask(32);
  await nextAnimationFrame();

  const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return endedAt - startedAt;
}

export function createExportFinalizationTimings(): ExportFinalizationTimings {
  return { encoderDrainAndMuxMs: 0, muxMs: 0, blobMs: 0, downloadHandoffMs: 0, cleanupMs: 0 };
}
