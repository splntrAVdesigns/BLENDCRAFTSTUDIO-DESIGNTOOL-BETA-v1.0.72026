import { ExportDiagnostics, type ExportDiagnosticRecord } from './ExportDiagnostics';
import { createExportProgress, type ExportProgressListener } from './ExportProgress';
import type {
  ExportCancellationContract,
  ExportLifecyclePhase,
  ExportProgressContract,
} from './types';

const TERMINAL_PHASES = new Set<ExportLifecyclePhase>(['complete', 'cancelled', 'failed']);

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `export-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface ExportSessionInput {
  readonly requestedDurationMs: number;
  readonly effectiveDurationMs: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly format: string;
  readonly quality: string;
}

/**
 * Engine-neutral lifecycle owner. Phase 7.3A introduces this boundary without
 * routing the production exporter through it yet.
 */
export class ExportSession implements ExportCancellationContract {
  private readonly abortController = new AbortController();
  private readonly listeners = new Set<ExportProgressListener>();
  private readonly diagnostics: ExportDiagnostics;
  private currentPhase: ExportLifecyclePhase = 'idle';

  constructor(input: ExportSessionInput) {
    const initial: ExportDiagnosticRecord = {
      sessionId: createSessionId(),
      startedAtMs: Date.now(),
      requestedDurationMs: input.requestedDurationMs,
      effectiveDurationMs: input.effectiveDurationMs,
      width: input.width,
      height: input.height,
      fps: input.fps,
      format: input.format,
      quality: input.quality,
      phase: 'idle',
    };
    this.diagnostics = new ExportDiagnostics(initial);
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get phase(): ExportLifecyclePhase {
    return this.currentPhase;
  }

  subscribe(listener: ExportProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(progress: Readonly<ExportProgressContract>): void {
    if (TERMINAL_PHASES.has(this.currentPhase)) return;
    this.currentPhase = progress.phase;
    this.diagnostics.update({ phase: progress.phase });
    this.listeners.forEach((listener) => {
      try {
        listener(progress);
      } catch {
        // A UI subscriber must never break an active export session.
      }
    });
  }

  transition(phase: ExportLifecyclePhase, percent: number, label: string): void {
    this.publish(createExportProgress({ phase, percent, label }));
  }

  cancel(reason = 'Export cancelled.'): void {
    if (TERMINAL_PHASES.has(this.currentPhase)) return;
    this.currentPhase = 'cancelling';
    this.abortController.abort(reason);
    this.currentPhase = 'cancelled';
    this.diagnostics.update({
      phase: 'cancelled',
      endedAtMs: Date.now(),
      success: false,
      cancelled: true,
    });
  }

  complete(fileSizeBytes?: number): void {
    if (TERMINAL_PHASES.has(this.currentPhase)) return;
    this.currentPhase = 'complete';
    this.diagnostics.update({
      phase: 'complete',
      endedAtMs: Date.now(),
      success: true,
      cancelled: false,
      fileSizeBytes,
    });
  }

  fail(error: unknown, code = 'EXPORT_FAILED'): void {
    if (TERMINAL_PHASES.has(this.currentPhase)) return;
    const message = error instanceof Error ? error.message : String(error);
    this.currentPhase = 'failed';
    this.diagnostics.update({
      phase: 'failed',
      endedAtMs: Date.now(),
      success: false,
      cancelled: false,
      errorCode: code,
      errorMessage: message,
    });
  }

  throwIfCancelled(): void {
    this.signal.throwIfAborted();
  }

  getDiagnostics(): Readonly<ExportDiagnosticRecord> {
    return this.diagnostics.snapshot();
  }
}
