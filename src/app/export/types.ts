/**
 * Phase 7.3A — Shared export contracts.
 *
 * These contracts deliberately contain no encoder or renderer implementation.
 * They define the migration boundary that the replacement video engine will
 * use while the Phase 7.2 exporter remains the active production path.
 */

export type ExportMediaKind = 'image' | 'video';

export type ExportVideoFormat = 'webm' | 'mp4';

export type ExportLifecyclePhase =
  | 'idle'
  | 'preparing'
  | 'rendering'
  | 'recording'
  | 'encoding'
  | 'finalizing'
  | 'downloading'
  | 'complete'
  | 'cancelling'
  | 'cancelled'
  | 'failed';

export type ExportQuality = 'standard' | 'high' | 'ultra' | 'max' | 'sharp-max';

export interface ExportDimensions {
  readonly width: number;
  readonly height: number;
}

export interface ExportTimingContract {
  /** User-selected target duration. Exact when loop lock is disabled. */
  readonly requestedDurationMs: number;
  /** Authoritative duration after the existing loop-lock calculation. */
  readonly effectiveDurationMs: number;
  readonly fps: number;
  readonly totalFrames: number;
  readonly loopLockEnabled: boolean;
}

export interface ExportRequestContract extends ExportDimensions, ExportTimingContract {
  readonly kind: ExportMediaKind;
  readonly format: string;
  readonly quality: string;
}

export interface ExportProgressContract {
  readonly phase: ExportLifecyclePhase;
  readonly percent: number;
  readonly label: string;
  readonly frame: number;
  readonly totalFrames: number;
  readonly elapsedMs?: number;
  readonly effectiveDurationMs?: number;
}

export interface ExportCancellationContract {
  readonly signal: AbortSignal;
  throwIfCancelled(): void;
}

export interface ExportFailureContract {
  readonly code: string;
  readonly message: string;
  readonly phase: ExportLifecyclePhase;
  readonly cause?: unknown;
}
