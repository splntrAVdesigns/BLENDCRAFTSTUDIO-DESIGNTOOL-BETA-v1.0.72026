import type { ExportLifecyclePhase, ExportProgressContract } from './types';

export type ExportProgressListener = (progress: Readonly<ExportProgressContract>) => void;

export interface CreateExportProgressInput {
  readonly phase: ExportLifecyclePhase;
  readonly percent: number;
  readonly label: string;
  readonly frame?: number;
  readonly totalFrames?: number;
  readonly elapsedMs?: number;
  readonly effectiveDurationMs?: number;
}

/** Creates a clamped immutable progress event for UI-independent publishing. */
export function createExportProgress(
  input: CreateExportProgressInput,
): Readonly<ExportProgressContract> {
  return Object.freeze({
    phase: input.phase,
    percent: Math.max(0, Math.min(100, input.percent)),
    label: input.label,
    frame: Math.max(0, Math.trunc(input.frame ?? 0)),
    totalFrames: Math.max(0, Math.trunc(input.totalFrames ?? 0)),
    elapsedMs: input.elapsedMs,
    effectiveDurationMs: input.effectiveDurationMs,
  });
}
