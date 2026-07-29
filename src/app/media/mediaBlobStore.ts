/**
 * media/mediaBlobStore.ts — Stage 2.7.7
 *
 * Persistent storage for uploaded MEDIA BLOBS (video especially) that are too
 * large for localStorage.
 *
 * WHY: localStorage is a ~5MB text store — the wrong place for binary media. A
 * 16-40MB video Blob can't go there, so across a reload the video source was
 * lost and the user had to re-upload. IndexedDB is the correct, professional
 * store for large binary data: it holds the actual Blob with no practical size
 * cap, keyed by layer id. On reload we read the Blob back and the existing
 * pipeline mints a fresh object URL from it (identical to a live upload), so
 * video "just comes back."
 *
 * DESIGN
 *  • One object store, "mediaBlobs", key = layerId, value = { blob, meta }.
 *  • Best-effort + defensive: every call is wrapped so a storage failure (e.g.
 *    private-mode with IDB disabled, quota) degrades to the existing
 *    "re-upload to restore" path rather than throwing.
 *  • CLEANUP SAFEGUARDS (keep it bounded):
 *      - deleteBlob(layerId) on layer delete / source replace,
 *      - pruneExcept(layerIds) on load + save to sweep entries whose layer no
 *        longer exists in the document,
 *      - a per-blob size ceiling and a total-store budget; when exceeded, the
 *        oldest entries are evicted (LRU by savedAt).
 */

const DB_NAME = 'blendcraft-media';
const DB_VERSION = 1;
const STORE = 'mediaBlobs';

/**
 * ═══ STAGE 2.8.4 — BLOB NAMESPACES ═══
 *
 * Blobs were keyed by bare `layerId`, which was fine while the only consumer
 * was the live document. Save slots and `.blendcraft` import break that
 * assumption hard, because a slot's blobs belong to layer ids that are NOT in
 * the current document — and two existing sweeps delete exactly that:
 *
 *   • pruneExcept(liveLayerIds) — deletes every key not in the current doc.
 *     Unnamespaced, it would wipe every saved slot ~8s after each load.
 *   • enforceBudget() — LRU-evicts the oldest entries. Unnamespaced, a big
 *     live upload could silently evict a slot the user explicitly saved.
 *
 * Both are correct behaviours for TRANSIENT live media and catastrophic for
 * EXPLICIT user saves. So every key is now namespaced:
 *
 *     live::{layerId}        transient — pruned + LRU-evicted freely
 *     slot:{n}::{layerId}    explicit save — never pruned, never evicted
 *
 * Slots are user documents. Nothing may delete them except the user.
 *
 * BACKWARD COMPATIBILITY: records written before 2.8.4 have bare keys. Reads in
 * the `live` namespace fall back to the legacy key and migrate the record
 * forward on the spot, so an existing session keeps its video across this
 * upgrade with no user-visible event.
 */
export type BlobNamespace = string;
export const LIVE_NS: BlobNamespace = 'live';
export const slotNs = (slot: number): BlobNamespace => `slot:${slot}`;

const NS_SEP = '::';
const composeKey = (ns: BlobNamespace, layerId: string): string => `${ns}${NS_SEP}${layerId}`;
function parseKey(key: string): { ns: BlobNamespace; layerId: string; legacy: boolean } {
  const i = key.indexOf(NS_SEP);
  // No separator ⇒ a pre-2.8.4 record, which was implicitly live.
  if (i < 0) return { ns: LIVE_NS, layerId: key, legacy: true };
  return { ns: key.slice(0, i), layerId: key.slice(i + NS_SEP.length), legacy: false };
}

/** Reject blobs larger than this individually (a safety valve, not the app's
 *  upload cap — that lives in mediaValidation). 320MB matches the intended
 *  video ceiling with headroom. */
const MAX_BLOB_BYTES = 320 * 1024 * 1024;
/** Soft total budget for the whole store; oldest entries evicted past this. */
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024; // 1GB

interface StoredMedia {
  /** Composite primary key: `${ns}::${layerId}`. Named layerId for keyPath compat. */
  layerId: string;
  /** STAGE 2.8.4: denormalised for cheap filtering without parsing every key. */
  ns?: BlobNamespace;
  refId?: string;
  blob: Blob;
  fileName: string;
  sourceKind: string;
  savedAt: number;
  size: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

/**
 * STAGE 2.7.8 — always-on diagnostics. Every put/get/delete is recorded to
 * window.__blobLog (capped ring buffer) and a window.__blobState summary is
 * kept current. This is how we diagnose restore on real hardware without
 * guessing: after an upload+reload, read `window.__blobLog` / `window.__blobState`
 * to see whether the blob was stored and whether it was found on restore.
 */
function blobDiag(entry: string): void {
  try {
    const w = window as unknown as Record<string, unknown>;
    const log = (w.__blobLog as string[]) || [];
    log.push(`${new Date().toISOString().slice(11, 23)} ${entry}`);
    while (log.length > 100) log.shift();
    w.__blobLog = log;
  } catch { /* diagnostics must never throw */ }
}
async function publishBlobState(): Promise<void> {
  try {
    const keys = await listKeys();
    (window as unknown as Record<string, unknown>).__blobState = {
      idbAvailable: typeof indexedDB !== 'undefined',
      storedLayerIds: keys,
      count: keys.length,
      at: Date.now(),
    };
  } catch { /* best-effort */ }
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'layerId' });
          store.createIndex('savedAt', 'savedAt', { unique: false });
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

function tx(
  db: IDBDatabase,
  mode: IDBTransactionMode
): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/** Store (or replace) a layer's media blob. Best-effort; never throws. */
export async function putBlob(
  layerId: string,
  blob: Blob,
  meta: { fileName?: string; sourceKind?: string; ns?: BlobNamespace }
): Promise<boolean> {
  try {
    if (!blob || blob.size === 0 || blob.size > MAX_BLOB_BYTES) return false;
    const db = await openDb();
    if (!db) return false;
    const ns = meta.ns ?? LIVE_NS;
    const record: StoredMedia = {
      layerId: composeKey(ns, layerId),
      ns,
      refId: layerId,
      blob,
      fileName: meta.fileName ?? '',
      sourceKind: meta.sourceKind ?? 'video',
      savedAt: Date.now(),
      size: blob.size,
    };
    await new Promise<void>((resolve, reject) => {
      const r = tx(db, 'readwrite').put(record);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
    blobDiag(`PUT ok  ns=${ns} layer=${layerId} size=${blob.size} file=${meta.fileName ?? ''}`);
    // STAGE 2.8.4: budget enforcement evicts LIVE entries only — see enforceBudget.
    await enforceBudget();
    void publishBlobState();
    return true;
  } catch (e) {
    blobDiag(`PUT FAIL layer=${layerId} err=${String((e as Error)?.name || e)}`);
    return false;
  }
}

/** Read a layer's media blob back. Returns null if absent or on any failure. */
export async function getBlob(
  layerId: string,
  ns: BlobNamespace = LIVE_NS,
): Promise<Blob | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    const read = (key: string) => new Promise<StoredMedia | undefined>((resolve) => {
      const r = tx(db, 'readonly').get(key);
      r.onsuccess = () => resolve(r.result as StoredMedia | undefined);
      r.onerror = () => resolve(undefined);
    });

    let record = await read(composeKey(ns, layerId));

    // STAGE 2.8.4 — LEGACY MIGRATION ON READ. Pre-namespace records used the
    // bare layer id and were implicitly live. Without this, every existing
    // user's restored video would break exactly once, on the upgrade to this
    // build. Migrate forward silently, then delete the legacy row.
    if (!record && ns === LIVE_NS) {
      const legacy = await read(layerId);
      if (legacy?.blob) {
        blobDiag(`MIGRATE legacy->live layer=${layerId} size=${legacy.blob.size}`);
        await putBlob(layerId, legacy.blob, {
          fileName: legacy.fileName,
          sourceKind: legacy.sourceKind,
          ns: LIVE_NS,
        });
        await deleteRawKey(layerId);
        record = legacy;
      }
    }

    blobDiag(`GET ${record?.blob ? 'HIT ' : 'MISS'} ns=${ns} layer=${layerId}${record?.blob ? ' size=' + record.blob.size : ''}`);
    return record?.blob ?? null;
  } catch (e) {
    blobDiag(`GET FAIL layer=${layerId} err=${String((e as Error)?.name || e)}`);
    return null;
  }
}

/** Delete one layer's blob (call on layer delete / source replace). */
export async function deleteBlob(
  layerId: string,
  ns: BlobNamespace = LIVE_NS,
): Promise<void> {
  await deleteRawKey(composeKey(ns, layerId));
  blobDiag(`DELETE ns=${ns} layer=${layerId}`);
}

/** Delete by exact stored key. Internal — callers use deleteBlob(layerId, ns). */
async function deleteRawKey(key: string): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const r = tx(db, 'readwrite').delete(key);
      r.onsuccess = () => resolve();
      r.onerror = () => resolve();
    });
    void publishBlobState();
  } catch {
    /* best-effort */
  }
}

/** List all stored layer ids. */
export async function listKeys(): Promise<string[]> {
  try {
    const db = await openDb();
    if (!db) return [];
    return await new Promise<string[]>((resolve) => {
      const r = tx(db, 'readonly').getAllKeys();
      r.onsuccess = () => resolve((r.result as IDBValidKey[]).map(String));
      r.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/** STAGE 2.8.4: layer ids stored under one namespace. */
export async function listNamespaceIds(ns: BlobNamespace): Promise<string[]> {
  const keys = await listKeys();
  return keys.map(parseKey).filter((p) => p.ns === ns).map((p) => p.layerId);
}

/** STAGE 2.8.4: total bytes held by one namespace (slot size / quota checks). */
export async function namespaceBytes(ns: BlobNamespace): Promise<number> {
  try {
    const db = await openDb();
    if (!db) return 0;
    const all = await new Promise<StoredMedia[]>((resolve) => {
      const r = tx(db, 'readonly').getAll();
      r.onsuccess = () => resolve((r.result as StoredMedia[]) ?? []);
      r.onerror = () => resolve([]);
    });
    return all
      .filter((rec) => parseKey(rec.layerId).ns === ns)
      .reduce((sum, rec) => sum + (rec.size || 0), 0);
  } catch {
    return 0;
  }
}

/** STAGE 2.8.4: drop an entire namespace (delete a slot). */
export async function clearNamespace(ns: BlobNamespace): Promise<void> {
  try {
    const keys = await listKeys();
    await Promise.all(
      keys.filter((k) => parseKey(k).ns === ns).map((k) => deleteRawKey(k))
    );
    blobDiag(`CLEAR ns=${ns}`);
  } catch {
    /* best-effort */
  }
}

/**
 * Sweep orphaned entries within ONE namespace (default: live).
 *
 * STAGE 2.8.4 — SCOPING. This is the sweep that would have destroyed every
 * saved slot: it deletes any key absent from the id list it's given, and the
 * only caller passes the CURRENT document's layer ids. Slot blobs are by
 * definition not in the current document. Scoping to a namespace makes the
 * sweep safe by construction rather than by remembering to pass extra ids.
 *
 * Legacy (pre-2.8.4, unnamespaced) keys are treated as live and prunable,
 * which is correct — they were live records.
 */
export async function pruneExcept(
  liveLayerIds: string[],
  ns: BlobNamespace = LIVE_NS,
): Promise<void> {
  try {
    const keep = new Set(liveLayerIds);
    const keys = await listKeys();
    const doomed = keys.filter((k) => {
      const p = parseKey(k);
      return p.ns === ns && !keep.has(p.layerId);
    });
    await Promise.all(doomed.map((k) => deleteRawKey(k)));
  } catch {
    /* best-effort */
  }
}

/** Evict oldest entries (by savedAt) until under the total budget. */
async function enforceBudget(): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const all = await new Promise<StoredMedia[]>((resolve) => {
      const r = tx(db, 'readonly').getAll();
      r.onsuccess = () => resolve((r.result as StoredMedia[]) ?? []);
      r.onerror = () => resolve([]);
    });
    // STAGE 2.8.4: LRU eviction is LIVE-ONLY. Slot blobs are explicit user
    // saves — silently evicting one to make room for a live upload would
    // destroy work the user deliberately kept. Slots are instead protected by
    // an up-front quota check at save time (which blocks with an explanation),
    // never by background eviction.
    const evictable = all.filter((r) => parseKey(r.layerId).ns === LIVE_NS);
    let total = all.reduce((sum, r) => sum + (r.size || 0), 0);
    if (total <= MAX_TOTAL_BYTES) return;
    const byAge = [...evictable].sort((a, b) => a.savedAt - b.savedAt);
    for (const rec of byAge) {
      if (total <= MAX_TOTAL_BYTES) break;
      await deleteRawKey(rec.layerId);
      total -= rec.size || 0;
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Wipe the LIVE namespace (used when the user dismisses their autosave =
 * "start a fresh session").
 *
 * STAGE 2.8.4 — SEMANTICS. "Start a fresh session" must not delete SAVED
 * SLOTS. Slots are documents the user explicitly chose to keep; discarding an
 * unsaved session says nothing about them. Use clearNamespace(slotNs(n)) to
 * delete a specific slot, or clearEverything() for a true factory reset.
 */
export async function clearAll(): Promise<void> {
  await clearNamespace(LIVE_NS);
  // Legacy unnamespaced rows are live records — sweep them too.
  try {
    const keys = await listKeys();
    await Promise.all(
      keys.filter((k) => parseKey(k).legacy).map((k) => deleteRawKey(k))
    );
  } catch { /* best-effort */ }
}

/** Nuke every namespace including saved slots. Only for an explicit factory reset. */
export async function clearEverything(): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const r = tx(db, 'readwrite').clear();
      r.onsuccess = () => resolve();
      r.onerror = () => resolve();
    });
  } catch {
    /* best-effort */
  }
}

// STAGE 2.7.8 — publish an initial blob-state snapshot at module load so
// window.__blobState is defined from boot (mirrors __mediaDebug). If it's ever
// undefined at runtime, the module isn't in the running bundle.
if (typeof window !== 'undefined') {
  void publishBlobState();
}