/**
 * session/components/SessionSlotsPanel.tsx — Stage 2.8.5
 *
 * Manual save slots + .blendcraft import/export. Mounts BELOW the history
 * section in the Export tab.
 *
 * Product decisions this implements (confirmed before build):
 *  • Overwriting an occupied slot ASKS first. Silent overwrite with undo was
 *    the alternative; a confirm is the right default when the thing being
 *    replaced is work the user deliberately saved.
 *  • Slots auto-name ("Session 1") and can be renamed. No prompt on every save
 *    — saving should be one click.
 *  • Import offers BOTH "replace current session" and "load into a slot".
 *  • An over-budget save is BLOCKED with an explanation, never silently
 *    stripped of media.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Save, FolderOpen, Trash2, Pencil, Download, Upload, Check, X, HardDrive,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  listSlots, saveSlot, loadSlot, deleteSlot, renameSlot, saveDocumentToSlot,
  totalSlotBytes, formatMB, SLOT_IDS, SLOT_MEDIA_BUDGET_BYTES,
  type SlotId, type SlotMeta,
} from '../slotStore';
import { exportBlendcraftFile, importBlendcraftFile } from '../blendcraftFile';
import { describeDocument } from '../sessionSerializer';
import type { Layer, CanvasSettings, EffectsConfig } from '../../types/gradient';

interface SessionSlotsPanelProps {
  layers: Layer[];
  canvasSettings: CanvasSettings;
  effects: EffectsConfig;
  activeLayerId: string | null;
  /** Applies a loaded session to the live document. */
  onLoadSession: (
    layers: Layer[],
    canvasSettings: CanvasSettings,
    effects: EffectsConfig,
    activeLayerId: string | null,
  ) => void;
  /** Canvas poster for slot thumbnails; may return null before first render. */
  getThumbnail?: () => string | null;
}

export function SessionSlotsPanel({
  layers, canvasSettings, effects, activeLayerId, onLoadSession, getThumbnail,
}: SessionSlotsPanelProps) {
  const [slots, setSlots] = useState<(SlotMeta | null)[]>([null, null, null]);
  const [usedBytes, setUsedBytes] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<SlotId | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [pendingImport, setPendingImport] = useState<
    { doc: Awaited<ReturnType<typeof importBlendcraftFile>>; name: string } | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // STAGE 2.8.6: drag-and-drop import. Reported as expected behaviour and it
  // is — every desktop tool accepts a dropped project file. Handled at the
  // panel level rather than per-slot: a dropped file goes through the SAME
  // confirm-then-choose-target flow as the Import button, so a drop can never
  // silently overwrite the current session or a slot.
  const [dragActive, setDragActive] = useState(false);

  const refresh = useCallback(async () => {
    setSlots(await listSlots());
    setUsedBytes(await totalSlotBytes());
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const currentInput = () => ({ layers, canvasSettings, effects, activeLayerId });

  const doSave = async (slot: SlotId, name?: string) => {
    setBusy(`save-${slot}`);
    try {
      const result = await saveSlot(slot, currentInput(), {
        name,
        thumbnail: getThumbnail?.() ?? undefined,
      });
      if (result.ok) {
        toast.success(`Saved to ${result.meta.name}`);
        await refresh();
      } else {
        // Blocked saves explain themselves — an unexplained failure on
        // something the user deliberately did is worse than the failure.
        toast.error(result.error, { duration: 10000 });
      }
    } finally {
      setBusy(null);
    }
  };

  const handleSave = (slot: SlotId) => {
    const existing = slots[slot - 1];
    if (existing) {
      toast('Overwrite this slot?', {
        description: `"${existing.name}" will be replaced. This can't be undone.`,
        duration: 12000,
        action: { label: 'Overwrite', onClick: () => void doSave(slot, existing.name) },
        cancel: { label: 'Cancel', onClick: () => {} },
      });
      return;
    }
    void doSave(slot);
  };

  const handleLoad = async (slot: SlotId) => {
    const meta = slots[slot - 1];
    if (!meta) return;
    toast(`Load "${meta.name}"?`, {
      description: 'Your current session will be replaced.',
      duration: 12000,
      action: {
        label: 'Load',
        onClick: async () => {
          setBusy(`load-${slot}`);
          try {
            const result = await loadSlot(slot);
            if (!result.ok) return toast.error(result.error);
            onLoadSession(
              result.layers,
              result.document.canvasSettings,
              result.document.effects,
              result.document.activeLayerId,
            );
            toast.success(`Loaded "${meta.name}"`);
          } finally {
            setBusy(null);
          }
        },
      },
      cancel: { label: 'Cancel', onClick: () => {} },
    });
  };

  const handleDelete = (slot: SlotId) => {
    const meta = slots[slot - 1];
    if (!meta) return;
    toast(`Delete "${meta.name}"?`, {
      description: 'The session and its media will be removed permanently.',
      duration: 12000,
      action: {
        label: 'Delete',
        onClick: async () => {
          await deleteSlot(slot);
          await refresh();
          toast.success('Slot deleted');
        },
      },
      cancel: { label: 'Cancel', onClick: () => {} },
    });
  };

  const commitRename = async (slot: SlotId) => {
    const name = renameValue.trim();
    setRenaming(null);
    if (!name) return;
    if (await renameSlot(slot, name)) await refresh();
  };

  const handleExportFile = async () => {
    setBusy('export-file');
    try {
      const result = await exportBlendcraftFile(currentInput(), {
        thumbnail: getThumbnail?.() ?? undefined,
        onProgress: (_pct, label) => setBusy(label),
      });
      result.ok
        ? toast.success(`Exported ${result.filename}`)
        : toast.error(result.error);
    } finally {
      setBusy(null);
    }
  };

  const ingestFile = async (file: File) => {
    if (!/\.blendcraft$/i.test(file.name)) {
      toast.error(`"${file.name}" isn't a .blendcraft session file`);
      return;
    }
    setBusy('import');
    try {
      const result = await importBlendcraftFile(file, (_p, label) => setBusy(label));
      if (!result.ok) return toast.error(result.error, { duration: 10000 });
      setPendingImport({ doc: result, name: file.name.replace(/\.blendcraft$/i, '') });
    } finally {
      setBusy(null);
    }
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (file) await ingestFile(file);
  };

  const applyImportToDocument = () => {
    if (!pendingImport?.doc.ok) return;
    const { document: doc, blobs } = pendingImport.doc;
    const hydrated = doc.layers.map((layer) => {
      const blob = blobs.get(layer.id);
      return blob ? ({ ...layer, media: { ...(layer as any).media, blob } } as Layer) : layer;
    });
    onLoadSession(hydrated, doc.canvasSettings, doc.effects, doc.activeLayerId);
    const name = pendingImport.name;
    setPendingImport(null);
    // STAGE 2.8.6: name what was loaded and what it contains. Reported: after
    // "Replace current" with a file whose media matched the open session, the
    // canvas looked unchanged and there was no way to tell it had worked.
    // Naming the file plus its contents makes the outcome legible even when
    // the pixels happen to be identical.
    toast.success(`Loaded "${name}" — ${describeDocument(doc)}`, { duration: 6000 });
  };

  const applyImportToSlot = async (slot: SlotId) => {
    if (!pendingImport?.doc.ok) return;
    const { document: doc, blobs } = pendingImport.doc;
    setBusy(`import-slot-${slot}`);
    try {
      const result = await saveDocumentToSlot(slot, doc, blobs, pendingImport.name);
      if (!result.ok) return toast.error(result.error, { duration: 10000 });
      setPendingImport(null);
      await refresh();
      toast.success(`Imported into ${result.meta.name}`);
    } finally {
      setBusy(null);
    }
  };

  const overBudget = usedBytes > SLOT_MEDIA_BUDGET_BYTES * 0.9;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-zinc-200">Saved Sessions</h3>
        <span className={`flex items-center gap-1 text-[11px] ${overBudget ? 'text-amber-400' : 'text-zinc-500'}`}>
          <HardDrive className="h-3 w-3" />
          {formatMB(usedBytes)} / {formatMB(SLOT_MEDIA_BUDGET_BYTES)}
        </span>
      </div>

      <p className="text-[11px] leading-relaxed text-zinc-500">
        Manual saves, separate from autosave. Kept until you delete them.
      </p>

      <div className="space-y-2">
        {SLOT_IDS.map((slot) => {
          const meta = slots[slot - 1];
          const isBusy = busy?.startsWith(`save-${slot}`) || busy?.startsWith(`load-${slot}`);
          return (
            <div key={slot} className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2.5">
              {renaming === slot ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(slot);
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100 outline-none ring-1 ring-blue-500"
                  />
                  <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => void commitRename(slot)}>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setRenaming(null)}>
                    <X className="h-3.5 w-3.5 text-zinc-400" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-start gap-2.5">
                  {meta?.thumbnail ? (
                    <img src={meta.thumbnail} alt="" className="h-9 w-14 shrink-0 rounded object-cover" />
                  ) : (
                    <div className="h-9 w-14 shrink-0 rounded bg-zinc-800" />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-zinc-200">
                      {meta ? meta.name : `Slot ${slot}`}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                      {meta
                        ? `${meta.layerCount} layer${meta.layerCount === 1 ? '' : 's'} · ${meta.width}×${meta.height}` +
                          (meta.mediaCount ? ` · ${formatMB(meta.mediaBytes)}` : '') +
                          ` · ${new Date(meta.savedAt).toLocaleDateString()}`
                        : 'Empty'}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      size="sm" variant="ghost" className="h-6 px-1.5"
                      title="Save current session here"
                      disabled={!!isBusy}
                      onClick={() => handleSave(slot)}
                    >
                      <Save className="h-3.5 w-3.5 text-blue-400" />
                    </Button>
                    {meta && (
                      <>
                        <Button size="sm" variant="ghost" className="h-6 px-1.5" title="Load" disabled={!!isBusy} onClick={() => void handleLoad(slot)}>
                          <FolderOpen className="h-3.5 w-3.5 text-zinc-300" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 px-1.5" title="Rename"
                          onClick={() => { setRenaming(slot); setRenameValue(meta.name); }}>
                          <Pencil className="h-3.5 w-3.5 text-zinc-400" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 px-1.5" title="Delete" onClick={() => handleDelete(slot)}>
                          <Trash2 className="h-3.5 w-3.5 text-red-400" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Portable file — survives browser storage being cleared */}
      <div
        className={`rounded-md border-t border-zinc-800 pt-3 transition-colors ${
          dragActive ? 'bg-blue-950/30 ring-1 ring-blue-500' : ''
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void ingestFile(file);
        }}
      >
        <div className="mb-2 text-[11px] text-zinc-500">
          {dragActive
            ? 'Drop to open this session file'
            : 'Session files include all media and work across machines. Drop one here to import.'}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" disabled={!!busy} onClick={() => void handleExportFile()}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export .blendcraft
          </Button>
          <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" disabled={!!busy} onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Import
          </Button>
        </div>
        <input ref={fileInputRef} type="file" accept=".blendcraft,application/zip" className="hidden" onChange={handleFilePicked} />
        {busy && <div className="mt-2 text-[11px] text-blue-400">{busy}</div>}
      </div>

      {/* Import target — never clobbers the current session without asking */}
      {pendingImport?.doc.ok && (
        <div className="rounded-md border border-blue-900/60 bg-blue-950/30 p-2.5">
          <div className="text-xs font-medium text-zinc-200">Import "{pendingImport.name}"</div>
          <div className="mt-0.5 text-[11px] text-zinc-400">
            {describeDocument(pendingImport.doc.document)}
            {pendingImport.doc.migratedFrom !== undefined && ' · older format, updated on load'}
          </div>
          {/* STAGE 2.8.6: state the distinction explicitly — "Replace current"
              loads into the working canvas and deliberately does NOT create or
              rename a slot, which is why the slot cards keep their own names. */}
          <div className="mt-1 text-[11px] text-zinc-500">
            Replace loads it into the canvas · a slot keeps it saved
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" className="h-6 text-[11px]" onClick={applyImportToDocument}>
              Replace current
            </Button>
            {SLOT_IDS.map((slot) => (
              <Button key={slot} size="sm" variant="outline" className="h-6 text-[11px]"
                disabled={!!busy} onClick={() => void applyImportToSlot(slot)}>
                → Slot {slot}
              </Button>
            ))}
            <Button size="sm" variant="ghost" className="h-6 text-[11px] text-zinc-400" onClick={() => setPendingImport(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}