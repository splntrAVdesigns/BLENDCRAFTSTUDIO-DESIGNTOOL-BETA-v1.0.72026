/**
 * session/slotStore.ts — Stage 2.8.5
 *
 * Three manual save slots. Completely separate from autosave.
 *
 * RELATIONSHIP TO AUTOSAVE — the hard constraint
 * ─────────────────────────────────────────────────────────────────────────
 * Autosave is a SAFETY NET: implicit, overwritten constantly, discarded on
 * Dismiss. Slots are DOCUMENTS: explicit, named, and destroyed only by the
 * user. Conflating them would mean an autosave tick could silently clobber
 * saved work.
 *
 * So nothing here reads or writes:
 *   • the autosave key ('blendcraft-autosave-v2')
 *   • the live document keys (useGradientState.STORAGE_KEYS)
 *   • the `live::` blob namespace
 *
 * Slot metadata lives in its own IndexedDB store; slot media lives in the
 * `slot:{n}::` blob namespace added in 2.8.4, which pruneExcept() and the LRU
 * budget sweep are both scoped to skip. That scoping is what makes slots safe
 * by construction rather than by remembering to special-case them.
 */

import {
  putBlob,
  getBlob,
  clearNamespace,
  namespaceBytes,
  slotNs,
} from '../media/mediaBlobStore';
import {
  serializeDocument,
  collectMediaManifest,
  parseDocument,
  documentMediaBytes,
  type SessionDocument,
  type DocumentInput,
} from './sessionSerializer';
import type { Layer } from '../types/gradient';

export const SLOT_COUNT = 3;
export const SLOT_IDS = [1, 2, 3] as const;
export type SlotId = (typeof SLOT_IDS)[number];

/**
 * Per-slot media ceiling. Three slots of 1080p video adds up fast, and browser
 * storage is a shared, evictable resource — so a save that would blow the
 * budget is BLOCKED with an explanation rather than silently dropping media or
 * evicting another slot. (Per product decision: block, explain, and revisit
 * when cloud storage lands.)
 */
export const SLOT_MEDIA_BUDGET_BYTES = 500 * 1024 * 1024;

const DB_NAME = 'blendcraft-sessions';
const DB_VERSION = 1;
const STORE = 'slots';

export interface SlotMeta {
  slot: SlotId;
  name: string;
  savedAt: number;
  layerCount: number;
  mediaCount: number;
  mediaBytes: number;
  width: number;
  height: number;
  /** Small data-URL canvas poster, so a slot is recognisable at a glance. */
  thumbnail?: string;
}

interface StoredSlot {
  slot: SlotId;
  meta: SlotMeta;
  document: SessionDocument;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'slot' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/** Read one slot's stored record, or null. */
async function readSlot(slot: SlotId): Promise<StoredSlot | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    return await new Promise<StoredSlot | null>((resolve) => {
      const r = tx(db, 'readonly').get(slot);
      r.onsuccess = () => resolve((r.result as StoredSlot) ?? null);
      r.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** All slot metadata, sparse — index i is slot i+1, null when empty. */
export async function listSlots(): Promise<(SlotMeta | null)[]> {
  const results = await Promise.all(SLOT_IDS.map((s) => readSlot(s)));
  return results.map((r) => r?.meta ?? null);
}

export type SaveOutcome =
  | { ok: true; meta: SlotMeta }
  | { ok: false; error: string; overBudgetBy?: number };

/**
 * Save the current document into a slot.
 *
 * Order matters and is deliberate: quota check → media blobs → metadata. The
 * metadata record is written LAST so a failure partway through leaves the slot
 * looking empty rather than looking full and loading broken. A slot that says
 * "occupied" must be loadable.
 */
export async function saveSlot(
  slot: SlotId,
  input: DocumentInput,
  options: { name?: string; thumbnail?: string } = {},
): Promise<SaveOutcome> {
  try {
    const manifest = collectMediaManifest(input.layers);
    const doc = serializeDocument(input, manifest);
    const incomingBytes = documentMediaBytes(doc);

    // Budget is measured across the OTHER slots plus this document, so
    // overwriting a large slot with a small one always succeeds.
    let otherBytes = 0;
    for (const s of SLOT_IDS) {
      if (s === slot) continue;
      otherBytes += await namespaceBytes(slotNs(s));
    }
    const projected = otherBytes + incomingBytes;
    if (projected > SLOT_MEDIA_BUDGET_BYTES) {
      return {
        ok: false,
        error:
          `Saving this session would use ${formatMB(projected)} of media across your slots, ` +
          `over the ${formatMB(SLOT_MEDIA_BUDGET_BYTES)} limit. ` +
          `Delete a slot with large video to make room.`,
        overBudgetBy: projected - SLOT_MEDIA_BUDGET_BYTES,
      };
    }

    // Replace this slot's media wholesale — stale blobs from a previous save
    // in this slot would otherwise linger forever (nothing prunes slot space).
    await clearNamespace(slotNs(slot));

    for (const entry of manifest) {
      const layer = input.layers.find((l) => l.id === entry.layerId);
      const blob: Blob | undefined = (layer as any)?.media?.blob;
      if (!(blob instanceof Blob)) continue;
      const stored = await putBlob(entry.layerId, blob, {
        fileName: entry.fileName,
        sourceKind: entry.sourceKind,
        ns: slotNs(slot),
      });
      if (!stored) {
        await clearNamespace(slotNs(slot));
        return { ok: false, error: `Couldn't store "${entry.fileName}" — storage may be full.` };
      }
    }

    const meta: SlotMeta = {
      slot,
      name: options.name?.trim() || `Session ${slot}`,
      savedAt: doc.savedAt,
      layerCount: doc.layers.length,
      mediaCount: manifest.length,
      mediaBytes: incomingBytes,
      width: doc.canvasSettings.width,
      height: doc.canvasSettings.height,
      thumbnail: options.thumbnail,
    };

    const db = await openDb();
    if (!db) return { ok: false, error: 'Storage unavailable in this browser' };
    await new Promise<void>((resolve, reject) => {
      const r = tx(db, 'readwrite').put({ slot, meta, document: doc } as StoredSlot);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });

    return { ok: true, meta };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || 'Save failed' };
  }
}

export type LoadOutcome =
  | { ok: true; document: SessionDocument; layers: Layer[] }
  | { ok: false; error: string };

/**
 * Load a slot, rehydrating its media blobs onto the layers.
 *
 * Blobs are attached but `src` is NOT minted here — the existing rehydration
 * path in App owns URL minting, and duplicating it would mean two places
 * deciding when an object URL is created. Missing media degrades to the normal
 * "re-upload to restore" state rather than failing the whole load: a document
 * with one absent video is still worth opening.
 */
export async function loadSlot(slot: SlotId): Promise<LoadOutcome> {
  try {
    const stored = await readSlot(slot);
    if (!stored) return { ok: false, error: 'That slot is empty' };

    const parsed = parseDocument(stored.document);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const doc = parsed.document;

    const byId = new Map(doc.media.map((m) => [m.layerId, m]));
    const layers = await Promise.all(
      doc.layers.map(async (layer) => {
        if (!byId.has(layer.id)) return layer;
        const blob = await getBlob(layer.id, slotNs(slot));
        if (!blob) return layer;
        return {
          ...layer,
          media: { ...(layer as any).media, blob, __rehydrated: true },
        } as Layer;
      }),
    );

    return { ok: true, document: doc, layers };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || 'Load failed' };
  }
}

/** Delete a slot and every blob it owns. */
export async function deleteSlot(slot: SlotId): Promise<void> {
  try {
    await clearNamespace(slotNs(slot));
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const r = tx(db, 'readwrite').delete(slot);
      r.onsuccess = () => resolve();
      r.onerror = () => resolve();
    });
  } catch {
    /* best-effort */
  }
}

/** Rename without touching the document or its media. */
export async function renameSlot(slot: SlotId, name: string): Promise<boolean> {
  try {
    const stored = await readSlot(slot);
    if (!stored) return false;
    const db = await openDb();
    if (!db) return false;
    const meta = { ...stored.meta, name: name.trim() || stored.meta.name };
    await new Promise<void>((resolve, reject) => {
      const r = tx(db, 'readwrite').put({ ...stored, meta } as StoredSlot);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
    return true;
  } catch {
    return false;
  }
}

/** Save a document that came from a .blendcraft file straight into a slot. */
export async function saveDocumentToSlot(
  slot: SlotId,
  doc: SessionDocument,
  blobs: Map<string, Blob>,
  name: string,
): Promise<SaveOutcome> {
  const layers = doc.layers.map((layer) => {
    const blob = blobs.get(layer.id);
    return blob ? ({ ...layer, media: { ...(layer as any).media, blob } } as Layer) : layer;
  });
  return saveSlot(
    slot,
    {
      layers,
      canvasSettings: doc.canvasSettings,
      effects: doc.effects,
      activeLayerId: doc.activeLayerId,
    },
    { name },
  );
}

/** Total media bytes across all slots (for the UI's usage readout). */
export async function totalSlotBytes(): Promise<number> {
  let total = 0;
  for (const s of SLOT_IDS) total += await namespaceBytes(slotNs(s));
  return total;
}

export function formatMB(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`;
}