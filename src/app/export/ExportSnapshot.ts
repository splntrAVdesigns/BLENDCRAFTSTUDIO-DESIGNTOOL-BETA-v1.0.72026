import type { ExportRequestContract } from './types';

export interface ExportSnapshotMetadata {
  readonly createdAtMs: number;
  readonly source: 'phase-7.2-bridge' | 'unified-export-engine';
}

/**
 * Immutable session-level data. Renderer-owned animation state remains inside
 * the existing RenderApi pause/capture system; this object must never invent a
 * second animation-speed or phase model.
 */
export interface ExportSnapshot<TPayload = unknown> {
  readonly request: Readonly<ExportRequestContract>;
  readonly metadata: Readonly<ExportSnapshotMetadata>;
  readonly payload: Readonly<TPayload>;
}

export interface CreateExportSnapshotInput<TPayload> {
  readonly request: ExportRequestContract;
  readonly payload: TPayload;
  readonly source?: ExportSnapshotMetadata['source'];
  readonly createdAtMs?: number;
}

export function createExportSnapshot<TPayload>(
  input: CreateExportSnapshotInput<TPayload>,
): Readonly<ExportSnapshot<TPayload>> {
  const request = Object.freeze({ ...input.request });
  const metadata = Object.freeze({
    createdAtMs: input.createdAtMs ?? Date.now(),
    source: input.source ?? 'phase-7.2-bridge',
  });

  return Object.freeze({
    request,
    metadata,
    payload: Object.freeze(input.payload),
  });
}
