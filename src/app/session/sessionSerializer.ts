/**
 * session/sessionSerializer.ts — Stage 2.8.5
 *
 * THE ONE PLACE THAT KNOWS THE DOCUMENT SCHEMA.
 *
 * Both consumers go through here:
 *   • Save slots   (session/slotStore.ts)      — local, IndexedDB
 *   • .blendcraft  (session/blendcraftFile.ts) — portable zip
 *
 * and, when cloud sync arrives, that will be a third backend behind the SAME
 * serialized shape rather than a fourth definition of "what a document is".
 * That is the entire reason this module exists as its own file: the moment two
 * places independently decide what a document looks like, they drift, and the
 * drift shows up as corrupted user work. (We already paid for that lesson once
 * this cycle — a duplicated RenderApi interface silently lost a method.)
 *
 * SCHEMA VERSIONING
 * ─────────────────────────────────────────────────────────────────────────
 * `schemaVersion` is written on every save and checked on every load, from day
 * one — not retrofitted later. A file written today must still open after the
 * document shape changes, and a file from the FUTURE must be refused clearly
 * rather than half-loaded into a broken state.
 *
 * MEDIA IS NOT IN HERE
 * ─────────────────────────────────────────────────────────────────────────
 * Blobs are large binary and are stored alongside (IndexedDB namespace for
 * slots, a media/ folder for .blendcraft). This module records only the media
 * MANIFEST — which layer expects which file — and deliberately strips the
 * runtime-only fields (`src`, `previewUrl`, `blob`) exactly as autosave does.
 * Those are document-scoped and die across a reload; persisting them would
 * recreate the dead-object-URL class of bug we spent 2.7.5–2.8.0 removing.
 */

import type { Layer, CanvasSettings, EffectsConfig } from '../types/gradient';

/** Bump ONLY when the shape changes in a way older readers can't handle. */
export const SCHEMA_VERSION = 1;

/** Oldest schema this build can still read. */
export const MIN_SUPPORTED_SCHEMA = 1;

export interface MediaManifestEntry {
  layerId: string;
  fileName: string;
  sourceKind: string;
  /** Byte size at save time — lets the UI show slot cost without loading blobs. */
  size: number;
}

export interface SessionDocument {
  schemaVersion: number;
  /** Informational only; never used for compatibility decisions. */
  appStage: string;
  savedAt: number;
  layers: Layer[];
  canvasSettings: CanvasSettings;
  effects: EffectsConfig;
  activeLayerId: string | null;
  media: MediaManifestEntry[];
}

export interface DocumentInput {
  layers: Layer[];
  canvasSettings: CanvasSettings;
  effects: EffectsConfig;
  activeLayerId: string | null;
}

export type LoadResult =
  | { ok: true; document: SessionDocument; migratedFrom?: number }
  | { ok: false; error: string };

/**
 * Strip runtime-only media fields. Mirrors what autosave does — a saved layer
 * must be shape-identical whether it came from autosave, a slot, or a file, so
 * the existing rehydration path handles all three with no special cases.
 */
function stripRuntimeMedia(layer: Layer): Layer {
  const media = (layer as any).media;
  if (!media) return layer;
  const { src, previewUrl, blob, ...persistable } = media;
  return { ...layer, media: persistable } as Layer;
}

/** Build the portable document. Pure — no storage, no side effects. */
export function serializeDocument(
  input: DocumentInput,
  media: MediaManifestEntry[] = [],
): SessionDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    appStage: '2.8.5',
    savedAt: Date.now(),
    layers: input.layers.map(stripRuntimeMedia),
    canvasSettings: { ...input.canvasSettings },
    effects: JSON.parse(JSON.stringify(input.effects)),
    activeLayerId: input.activeLayerId ?? null,
    media,
  };
}

/**
 * Collect the media manifest from live layers. Only layers that actually carry
 * a Blob are listed — a layer whose media was never persisted must not appear,
 * or load would wait on a file that will never arrive.
 */
export function collectMediaManifest(layers: Layer[]): MediaManifestEntry[] {
  const out: MediaManifestEntry[] = [];
  for (const layer of layers) {
    const media = (layer as any).media;
    const blob: Blob | undefined = media?.blob;
    if (!media?.enabled || !(blob instanceof Blob) || blob.size === 0) continue;
    out.push({
      layerId: layer.id,
      fileName: media.fileName ?? 'media',
      sourceKind: media.sourceKind ?? 'video',
      size: blob.size,
    });
  }
  return out;
}

/**
 * Validate + migrate an untrusted document (from IndexedDB or a user's file).
 *
 * Defensive on purpose: this is the one entry point where data the app did not
 * create reaches document state. A malformed slot or a hand-edited file must
 * produce a clear refusal, never a half-applied document.
 */
export function parseDocument(raw: unknown): LoadResult {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Not a valid session document' };
  const doc = raw as Partial<SessionDocument>;

  const version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 0;
  if (version === 0) return { ok: false, error: 'Missing schema version' };
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        `This session was made with a newer version of BlendCraft ` +
        `(format v${version}; this build reads up to v${SCHEMA_VERSION}). Update to open it.`,
    };
  }
  if (version < MIN_SUPPORTED_SCHEMA) {
    return { ok: false, error: `Session format v${version} is no longer supported` };
  }

  if (!Array.isArray(doc.layers) || doc.layers.length === 0) {
    return { ok: false, error: 'Session contains no layers' };
  }
  const cs = doc.canvasSettings;
  if (!cs || typeof cs.width !== 'number' || typeof cs.height !== 'number') {
    return { ok: false, error: 'Session has invalid canvas settings' };
  }

  const migrated = migrate(doc as SessionDocument, version);
  return version < SCHEMA_VERSION
    ? { ok: true, document: migrated, migratedFrom: version }
    : { ok: true, document: migrated };
}

/**
 * Forward-migrate an older document. Empty today (v1 is current) — the point is
 * that the seam EXISTS, so a future shape change is an added case here rather
 * than a breaking change for everyone with saved sessions.
 */
function migrate(doc: SessionDocument, fromVersion: number): SessionDocument {
  let out = doc;
  // if (fromVersion < 2) out = { ...out, /* v1 → v2 */ schemaVersion: 2 };
  void fromVersion;
  return {
    ...out,
    schemaVersion: SCHEMA_VERSION,
    effects: out.effects ?? ({} as EffectsConfig),
    activeLayerId: out.activeLayerId ?? null,
    media: Array.isArray(out.media) ? out.media : [],
  };
}

/** Short human summary for confirmation dialogs, so a load is never blind. */
export function describeDocument(doc: SessionDocument): string {
  const layerCount = doc.layers.length;
  const mediaCount = doc.media.length;
  const size = `${doc.canvasSettings.width}×${doc.canvasSettings.height}`;
  const mediaPart = mediaCount > 0 ? ` · ${mediaCount} media file${mediaCount === 1 ? '' : 's'}` : '';
  return `${layerCount} layer${layerCount === 1 ? '' : 's'} · ${size}${mediaPart}`;
}

/** Total media bytes a document will occupy. Used for the slot quota check. */
export function documentMediaBytes(doc: SessionDocument): number {
  return doc.media.reduce((sum, m) => sum + (m.size || 0), 0);
}