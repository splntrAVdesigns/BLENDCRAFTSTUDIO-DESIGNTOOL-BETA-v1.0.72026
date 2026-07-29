import type { ExportLifecyclePhase } from './types';

export interface ExportDiagnosticRecord {
  readonly sessionId: string;
  readonly startedAtMs: number;
  readonly endedAtMs?: number;
  readonly requestedDurationMs: number;
  readonly effectiveDurationMs: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly format: string;
  readonly quality: string;
  readonly phase: ExportLifecyclePhase;
  readonly success?: boolean;
  readonly cancelled?: boolean;
  readonly fileSizeBytes?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

/**
 * Small mutable builder contained to one export session. Call snapshot() before
 * exposing diagnostics so consumers only receive immutable data.
 */
export class ExportDiagnostics {
  private record: ExportDiagnosticRecord;

  constructor(initial: ExportDiagnosticRecord) {
    this.record = { ...initial };
  }

  update(patch: Partial<ExportDiagnosticRecord>): void {
    this.record = { ...this.record, ...patch };
  }

  snapshot(): Readonly<ExportDiagnosticRecord> {
    return Object.freeze({ ...this.record });
  }
}
