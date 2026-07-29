/**
 * session/blendcraftFile.ts — Stage 2.8.5
 *
 * The `.blendcraft` portable session file.
 *
 * WHY A FILE AND NOT JUST SLOTS
 * ─────────────────────────────────────────────────────────────────────────
 * Browser storage is evictable. IndexedDB can be cleared by the user, by the
 * browser under pressure, or by an iframe host's own lifecycle — none of which
 * a user thinks of as "deleting my work". A file on disk is the only durable
 * artifact, and it's what makes a session portable between machines.
 *
 * This is the `.fig` / `.riv` pattern: a zip with the document, its media, and
 * a metadata header.
 *
 *   project.json          the SessionDocument (shared serializer)
 *   media/{layerId}.bin   raw blobs, one per media layer
 *   meta.json             schema version, app stage, created, thumbnail
 *
 * FORWARD-LOOKING: project.json is byte-for-byte the payload cloud sync will
 * store. A local slot, a .blendcraft file, and a future cloud document are the
 * same serialized shape with three storage backends — which is why the schema
 * lives in sessionSerializer.ts and not in here.
 *
 * meta.json is duplicated header info deliberately: it lets an importer read
 * version and thumbnail WITHOUT parsing a potentially large project.json, and
 * gives a clear refusal path for a future-version file.
 */

import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  serializeDocument,
  collectMediaManifest,
  parseDocument,
  SCHEMA_VERSION,
  type SessionDocument,
  type DocumentInput,
} from './sessionSerializer';

export const BLENDCRAFT_EXTENSION = '.blendcraft';

interface FileMeta {
  schemaVersion: number;
  appStage: string;
  createdAt: number;
  thumbnail?: string;
}

export type ExportOutcome = { ok: true; filename: string } | { ok: false; error: string };

/**
 * Write the current session to a .blendcraft file.
 *
 * DEFLATE level 6, not 9: project.json compresses well but the media blobs are
 * ALREADY compressed (H.264/VP9/JPEG). Level 9 would spend real time
 * re-compressing incompressible bytes for ~0% gain on the part of the file that
 * actually dominates its size.
 */
export async function exportBlendcraftFile(
  input: DocumentInput,
  options: { filename?: string; thumbnail?: string; onProgress?: (pct: number, label: string) => void } = {},
): Promise<ExportOutcome> {
  const { onProgress } = options;
  try {
    onProgress?.(5, 'Collecting session...');
    const manifest = collectMediaManifest(input.layers);
    const doc = serializeDocument(input, manifest);

    const zip = new JSZip();
    zip.file('project.json', JSON.stringify(doc, null, 2));

    const meta: FileMeta = {
      schemaVersion: SCHEMA_VERSION,
      appStage: doc.appStage,
      createdAt: doc.savedAt,
      thumbnail: options.thumbnail,
    };
    zip.file('meta.json', JSON.stringify(meta, null, 2));

    const mediaFolder = zip.folder('media');
    let done = 0;
    for (const entry of manifest) {
      const layer = input.layers.find((l) => l.id === entry.layerId);
      const blob: Blob | undefined = (layer as any)?.media?.blob;
      if (blob instanceof Blob) {
        mediaFolder?.file(`${entry.layerId}.bin`, blob);
      }
      done++;
      onProgress?.(10 + (done / Math.max(1, manifest.length)) * 40, `Packing media (${done}/${manifest.length})`);
    }

    onProgress?.(55, 'Compressing...');
    const out = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      (m) => onProgress?.(55 + (m.percent / 100) * 40, 'Compressing...'),
    );

    const filename = normaliseFilename(options.filename);
    saveAs(out, filename);
    onProgress?.(100, 'Session exported');
    return { ok: true, filename };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || 'Export failed' };
  }
}

export type ImportOutcome =
  | { ok: true; document: SessionDocument; blobs: Map<string, Blob>; migratedFrom?: number }
  | { ok: false; error: string };

/**
 * Read a .blendcraft file.
 *
 * Every failure returns a specific, human message. This is the one place a
 * user's arbitrary file becomes document state, so "something went wrong" is
 * not good enough — they need to know whether the file is wrong, too new, or
 * corrupt.
 *
 * Missing media degrades gracefully: a document whose video is absent still
 * opens and shows the normal "re-upload to restore" state. Refusing to open an
 * otherwise-valid session over one missing file would be worse than the gap.
 */
export async function importBlendcraftFile(
  file: File,
  onProgress?: (pct: number, label: string) => void,
): Promise<ImportOutcome> {
  try {
    onProgress?.(5, 'Reading file...');
    const zip = await JSZip.loadAsync(file);

    // Header first — a future-version file is refused without parsing the body.
    const metaEntry = zip.file('meta.json');
    if (metaEntry) {
      try {
        const meta = JSON.parse(await metaEntry.async('string')) as FileMeta;
        if (typeof meta.schemaVersion === 'number' && meta.schemaVersion > SCHEMA_VERSION) {
          return {
            ok: false,
            error:
              `This file was made with a newer version of BlendCraft ` +
              `(format v${meta.schemaVersion}; this build reads up to v${SCHEMA_VERSION}).`,
          };
        }
      } catch {
        // A damaged header isn't fatal — project.json is validated anyway.
      }
    }

    const projectEntry = zip.file('project.json');
    if (!projectEntry) {
      return { ok: false, error: 'Not a BlendCraft session file (project.json missing)' };
    }

    onProgress?.(20, 'Reading session...');
    let rawDoc: unknown;
    try {
      rawDoc = JSON.parse(await projectEntry.async('string'));
    } catch {
      return { ok: false, error: 'Session data is corrupt and could not be read' };
    }

    const parsed = parseDocument(rawDoc);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const doc = parsed.document;

    onProgress?.(35, 'Extracting media...');
    const blobs = new Map<string, Blob>();
    let done = 0;
    for (const entry of doc.media) {
      const mediaFile = zip.file(`media/${entry.layerId}.bin`);
      if (mediaFile) {
        const blob = await mediaFile.async('blob');
        if (blob.size > 0) blobs.set(entry.layerId, blob);
      }
      done++;
      onProgress?.(35 + (done / Math.max(1, doc.media.length)) * 60, `Extracting media (${done}/${doc.media.length})`);
    }

    onProgress?.(100, 'Session loaded');
    return { ok: true, document: doc, blobs, migratedFrom: parsed.migratedFrom };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || 'Could not read that file' };
  }
}

function normaliseFilename(name?: string): string {
  const base = (name || `blendcraft-session-${new Date().toISOString().slice(0, 10)}`)
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(new RegExp(`\\${BLENDCRAFT_EXTENSION}$`), '')
    .trim();
  return `${base || 'session'}${BLENDCRAFT_EXTENSION}`;
}