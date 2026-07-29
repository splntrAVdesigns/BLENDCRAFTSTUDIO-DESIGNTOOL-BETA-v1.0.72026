// Layer Panel Component - Manage layers with drag & drop
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { SelectWrapper } from '../ui/select-wrapper';
import { Slider } from '../ui/slider';
import { ScrollArea } from '../ui/scroll-area';
import { toast } from 'sonner';
import { canAddLayer, MAX_LAYERS, LAYER_LIMIT_MESSAGE } from '../../utils/layerLimits';
import { isMediaLayerActive } from '../../media/mediaShader';
import { Input } from '../ui/input';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '../ui/dialog';
import { Plus, Eye, EyeOff, Lock, Unlock, Copy, Trash2, GripVertical } from 'lucide-react';
import type { Layer, BlendMode } from '../../types/gradient';
import { useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { DndProvider } from 'react-dnd';
import { useState, useRef, useEffect } from 'react';

interface LayerPanelProps {
  layers: Layer[];
  activeLayerId: string;
  onLayersChange: (layers: Layer[]) => void;
  onActiveLayerChange: (layerId: string) => void;
  /** STAGE 2.7C: fired once on drop so a drag produces ONE history entry. */
  onCommitHistory?: () => void;
  /**
   * STAGE 2.7C: applies a reorder WITHOUT committing history. moveLayer() runs
   * on every hover tick during a drag; routing it through the committing
   * onLayersChange produced dozens of history entries (and dozens of full
   * state replacements) per drag. Reorder now streams through here and is
   * committed exactly once on drop.
   */
  onReorderLayers?: (layers: Layer[]) => void;
}

interface DraggableLayerItemProps {
  layer: Layer;
  index: number;
  activeLayerId: string;
  onActiveLayerChange: (layerId: string) => void;
  updateLayer: (layerId: string, updates: Partial<Layer>) => void;
  deleteLayer: (layerId: string) => void;
  duplicateLayer: (layerId: string) => void;
  moveLayer: (fromIndex: number, toIndex: number) => void;
  layersLength: number;
  blendModes: BlendMode[];
  onReorderCommit?: () => void;
}

const LAYER_ITEM_TYPE = 'layer';

/**
 * STAGE 2.7D — LayerTags
 * Compact, borderless indicators of which systems are active on a layer.
 * Deliberately text-only: chips/badges add visual weight the layer list can't
 * afford at this density (see spec — "no big blocks or outline borders").
 */
function LayerTags({ layer }: { layer: Layer }) {
  const tags: { label: string; className: string; title: string }[] = [];

  // MEDIA (green) — distinguishes image vs video at a glance.
  // STAGE 2.7.9 (A): blob-backed (restored) media layers must tag too.
  if (isMediaLayerActive(layer.media)) {
    // isMediaLayerActive() already proved media exists; optional-chain anyway
    // so the narrowing lives in the type system rather than in a comment.
    const isVideo = layer.media?.sourceKind === 'video';
    tags.push({
      label: isVideo ? 'VID' : 'IMG',
      className: 'text-pink-400',
      title: isVideo ? 'Video media source' : 'Image media source',
    });
  }

  // TEXTURE (blue)
  if (layer.texture) {
    tags.push({
      label: 'TEX',
      className: 'text-[#51a2ff]',
      title: `Texture: ${layer.texture.type}`,
    });
  }

  // MASK (white)
  if (layer.mask && layer.mask.type && layer.mask.type !== 'none') {
    tags.push({
      label: 'MASK',
      className: 'text-zinc-100',
      title: `Mask: ${layer.mask.type}`,
    });
  }

  // ANIMATION (pink) — three independent systems can animate one layer, so the
  // tag names its SOURCE rather than just saying "animated". This is the whole
  // point of the tag: knowing WHERE the motion is coming from.
  const animSources: string[] = [];
  if (layer.animation?.enabled) animSources.push(`Layer: ${layer.animation.type}`);
  if (layer.texture?.animateTexture) animSources.push(`Texture: ${layer.texture.textureAnimationType ?? 'default'}`);
  if (layer.mask?.animation?.enabled) animSources.push(`Mask: ${layer.mask.animation.type}`);
  if (animSources.length > 0) {
    tags.push({
      label: 'ANIM',
      // Green to match the "Animated" indicator in the app's bottom status bar,
      // so the same concept reads the same colour everywhere.
      className: 'text-green-400',
      title: `Animated —\n${animSources.join('\n')}`,
    });
  }

  if (tags.length === 0) return null;

  // Own row (below the name + control buttons, above the opacity slider) so the
  // header doesn't get crowded — the header already carries the drag grip,
  // thumbnail, editable name, and four icon buttons.
  return (
    <div className="flex items-center gap-2 flex-wrap mb-2 pl-[22px]">
      {tags.map(tag => (
        <span
          key={tag.label}
          title={tag.title}
          className={`text-[9px] font-semibold tracking-wider leading-none ${tag.className}`}
        >
          {tag.label}
        </span>
      ))}
    </div>
  );
}

const DraggableLayerItem = ({
  layer,
  index,
  activeLayerId,
  onActiveLayerChange,
  updateLayer,
  deleteLayer,
  duplicateLayer,
  moveLayer,
  layersLength,
  blendModes,
  onReorderCommit,
}: DraggableLayerItemProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);

  // STAGE 2.7C: commit the reorder ONCE, on drop — not on every hover tick.
  // Previously `hover()` called moveLayer() continuously during a drag, firing
  // a flood of onLayersChange() calls (dozens per second) with no history
  // commit. That churn is both a perf problem and the most likely source of
  // the "blend mode spontaneously became Lighten after a reorder" report:
  // rapid-fire state replacement mid-drag races with the controlled <select>.
  // `end()` fires exactly once, when the user releases.
  const [{ isDragging }, drag] = useDrag({
    type: LAYER_ITEM_TYPE,
    item: { index },
    end: (item, monitor) => {
      if (monitor.didDrop() || item.index !== index) {
        onReorderCommit?.();
      }
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [{ isOver }, drop] = useDrop({
    accept: LAYER_ITEM_TYPE,
    hover(item: { index: number }, monitor) {
      if (!ref.current) {
        return;
      }
      const dragIndex = item.index;
      const hoverIndex = index;

      if (dragIndex === hoverIndex) {
        return;
      }

      const hoverBoundingRect = ref.current.getBoundingClientRect();
      const hoverMiddleY =
        (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;

      const clientOffset = monitor.getClientOffset();
      const hoverClientY = clientOffset!.y - hoverBoundingRect.top;

      if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) {
        return;
      }

      if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) {
        return;
      }

      moveLayer(dragIndex, hoverIndex);
      item.index = hoverIndex;
    },
  });

  // CRITICAL FIX: Attach drag handler ONLY to grip icon, not entire card
  // This prevents slider interactions from triggering card drag
  drag(dragHandleRef);
  drop(ref);

  // STAGE 2.6: keep the active layer visible without moving it in the list —
  // this is what sortedLayers was actually trying to accomplish, done the
  // correct way: scroll it into view on selection, never reorder anything.
  const isActive = activeLayerId === layer.id;
  useEffect(() => {
    if (!isActive) return;
    // Deferred one tick so the row's expanded controls (opacity/blend, which
    // add height) have already laid out before the target offset is computed.
    const raf = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;

      // STAGE 2.6.1 FIX (panel content shifted LEFT after media upload):
      // this previously called el.scrollIntoView({ block: 'nearest' }).
      // `inline` is unspecified there, which DEFAULTS TO 'nearest' — and
      // scrollIntoView walks EVERY scrollable ancestor, scrolling each on
      // BOTH axes. Critically, `overflow-x: hidden` containers are still
      // PROGRAMMATICALLY scrollable, so the sidebar was being scrolled
      // sideways — permanently shifting its content left and clipping the
      // first characters of labels ("Layers" → "ayers"). It only surfaced
      // on media upload because that's when a new layer is auto-selected,
      // firing this effect.
      //
      // Fix: scroll the nearest vertically-scrollable ancestor MANUALLY,
      // touching scrollTop only. scrollLeft is never written, so horizontal
      // displacement is impossible by construction.
      let scroller: HTMLElement | null = el.parentElement;
      while (scroller) {
        const canScrollY = scroller.scrollHeight > scroller.clientHeight;
        if (canScrollY) break;
        scroller = scroller.parentElement;
      }
      if (!scroller) return;

      const elTop = el.offsetTop;
      const elBottom = elTop + el.offsetHeight;
      const viewTop = scroller.scrollTop;
      const viewBottom = viewTop + scroller.clientHeight;

      // 'nearest' semantics: only scroll if the row is actually out of view.
      let nextTop: number | null = null;
      if (elTop < viewTop) nextTop = elTop;
      else if (elBottom > viewBottom) nextTop = elBottom - scroller.clientHeight;
      if (nextTop === null) return;

      scroller.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [isActive]);

  const opacity = Math.round(layer.opacity * 100);

  return (
    <div
      ref={ref}
      className={`p-2.5 rounded-lg border-2 transition-all cursor-pointer ${
        activeLayerId === layer.id
          ? 'bg-zinc-800 border-blue-500'
          : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'
      } ${isDragging ? 'opacity-50' : 'opacity-100'}`}
      onClick={() => onActiveLayerChange(layer.id)}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <div ref={dragHandleRef} className="flex items-center cursor-move">
          <GripVertical className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
        </div>

        {/* Media layer thumbnail (Stage 2A) — small, cheap, identifies media
            layers at a glance. Videos use their poster previewUrl. */}
        {(layer.media?.previewUrl || (layer.media?.src && layer.media.sourceKind !== 'video')) && (
          <div className="w-6 h-6 rounded overflow-hidden bg-zinc-900 flex-shrink-0 border border-zinc-700">
            <img
              src={layer.media.sourceKind === 'video' ? layer.media.previewUrl : layer.media.src}
              alt=""
              className="w-full h-full object-cover"
            />
          </div>
        )}

        <input
          type="text"
          value={layer.name}
          onChange={(e) => updateLayer(layer.id, { name: e.target.value })}
          className="flex-1 bg-transparent text-sm text-zinc-100 focus:outline-none min-w-0"
          onClick={(e) => e.stopPropagation()}
        />

        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            updateLayer(layer.id, { visible: !layer.visible });
          }}
        >
          {layer.visible ? (
            <Eye className="w-3.5 h-3.5 text-zinc-400" />
          ) : (
            <EyeOff className="w-3.5 h-3.5 text-zinc-600" />
          )}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            updateLayer(layer.id, { locked: !layer.locked });
          }}
        >
          {layer.locked ? (
            <Lock className="w-3.5 h-3.5 text-amber-500" />
          ) : (
            <Unlock className="w-3.5 h-3.5 text-zinc-400" />
          )}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 hover:text-blue-400 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            duplicateLayer(layer.id);
          }}
          title="Duplicate layer"
        >
          <Copy className="w-3.5 h-3.5" />
        </Button>

        {layersLength > 1 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 hover:text-red-400 flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              deleteLayer(layer.id);
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {/* STAGE 2.7D — LAYER TAGS (own row).
          Moved out of the header: that row already carries the drag grip,
          thumbnail, editable name and four icon buttons — adding tags there
          crowded it and truncated the layer name. They now sit on their own
          strip between the header and the opacity slider.
          Colour-coded, and deliberately matched to the app's bottom status bar
          so the same concept reads the same colour everywhere:
            IMG / VID — pink   (media)
            TEX       — blue
            MASK      — white
            ANIM      — green, naming its SOURCE on hover (layer / texture /
                        mask), since three independent systems can animate one
                        layer and knowing WHICH is the whole point of the tag. */}
      <LayerTags layer={layer} />

      {layer.mask && layer.mask.type !== 'none' && (
        <div className="mb-2 ml-5 flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/70 px-2 py-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-medium text-zinc-200 truncate">
              Mask · {layer.mask.type === 'image' ? ((layer.mask.sourceType === 'svg') ? 'SVG' : 'Image') : layer.mask.type === 'alpha' ? 'Alpha' : layer.mask.type === 'luminance' ? 'Luminance' : 'Layer'}
            </span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              updateLayer(layer.id, {
                mask: {
                  ...layer.mask!,
                  visible: !(layer.mask?.visible ?? true),
                },
              });
            }}
            title={(layer.mask.visible ?? true) ? 'Hide mask' : 'Show mask'}
          >
            {(layer.mask.visible ?? true) ? (
              <Eye className="w-3.5 h-3.5 text-cyan-400" />
            ) : (
              <EyeOff className="w-3.5 h-3.5 text-zinc-600" />
            )}
          </Button>
        </div>
      )}

      {activeLayerId === layer.id && (
        <div className="mt-2.5 pt-2.5 border-t border-zinc-700 space-y-2.5" onClick={(e) => e.stopPropagation()}>
          {/* Opacity */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Opacity</Label>
              <span className="text-xs text-zinc-400">{opacity}%</span>
            </div>
            <div onPointerDown={(e) => e.stopPropagation()}>
              <Slider
                value={[layer.opacity * 100]}
                onValueChange={([value]) => updateLayer(layer.id, { opacity: value / 100 })}
                min={0}
                max={100}
                step={1}
              />
            </div>
          </div>

          {/* Blend Mode */}
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">Blend Mode</Label>
            <SelectWrapper
              value={layer.blendMode}
              onValueChange={(value) => updateLayer(layer.id, { blendMode: value as BlendMode })}
              options={blendModes.map(mode => ({ value: mode, label: mode.charAt(0).toUpperCase() + mode.slice(1) }))}
              triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
              contentClassName="bg-zinc-900 border-zinc-700"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export function LayerPanel({ layers, activeLayerId, onLayersChange, onActiveLayerChange, onCommitHistory, onReorderLayers }: LayerPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newLayerName, setNewLayerName] = useState('');

  const updateLayer = (layerId: string, updates: Partial<Layer>) => {
    const newLayers = layers.map(layer =>
      layer.id === layerId ? { ...layer, ...updates } : layer
    );
    onLayersChange(newLayers);
  };

  const handleAddLayerClick = () => {
    // STAGE 2.7.4: enforce the per-session layer cap at the entry point so the
    // dialog never even opens when full.
    if (!canAddLayer(layers.length)) {
      toast.error(LAYER_LIMIT_MESSAGE);
      return;
    }
    setNewLayerName(`Layer ${layers.length + 1}`);
    setDialogOpen(true);
  };

  const handleCreateLayer = () => {
    if (!newLayerName.trim()) return;
    if (!canAddLayer(layers.length)) {
      toast.error(LAYER_LIMIT_MESSAGE);
      setDialogOpen(false);
      return;
    }
    
    const newLayer: Layer = {
      id: `layer-${Date.now()}`,
      name: newLayerName.trim(),
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
      gradient: {
        type: 'linear',
        colors: [
          { color: '#FF6B6B', position: 0 },
          { color: '#4ECDC4', position: 1 },
        ],
        angle: 90,
        scale: 1,
        intensity: 1,
      },
    };
    onLayersChange([...layers, newLayer]);
    onActiveLayerChange(newLayer.id);
    setDialogOpen(false);
    setNewLayerName('');
  };

  const duplicateLayer = (layerId: string) => {
    // STAGE 2.7.4: duplication also creates a layer — same cap applies.
    if (!canAddLayer(layers.length)) {
      toast.error(LAYER_LIMIT_MESSAGE);
      return;
    }
    const layerToDuplicate = layers.find(layer => layer.id === layerId);
    if (!layerToDuplicate) return;

    const duplicatedLayer: Layer = {
      ...layerToDuplicate,
      id: `layer-${Date.now()}`,
      name: `${layerToDuplicate.name} Copy`,
      // Deep clone the gradient to avoid reference issues
      gradient: JSON.parse(JSON.stringify(layerToDuplicate.gradient)),
      // Deep clone animation if it exists
      animation: layerToDuplicate.animation 
        ? JSON.parse(JSON.stringify(layerToDuplicate.animation))
        : undefined,
      // Deep clone mask if it exists
      mask: layerToDuplicate.mask
        ? JSON.parse(JSON.stringify(layerToDuplicate.mask))
        : undefined,
    };

    // Insert the duplicated layer right after the original
    const originalIndex = layers.findIndex(layer => layer.id === layerId);
    const newLayers = [
      ...layers.slice(0, originalIndex + 1),
      duplicatedLayer,
      ...layers.slice(originalIndex + 1)
    ];
    
    onLayersChange(newLayers);
    onActiveLayerChange(duplicatedLayer.id);
  };

  const deleteLayer = (layerId: string) => {
    if (layers.length === 1) return; // Keep at least one layer
    const newLayers = layers.filter(layer => layer.id !== layerId);
    onLayersChange(newLayers);
    if (activeLayerId === layerId) {
      onActiveLayerChange(newLayers[0].id);
    }
  };

  // STAGE 2.6 REWRITE (Layers Panel Rebuild): the previous `sortedLayers`
  // always bumped the ACTIVE layer to the top of the list on every click —
  // not how any layers panel works (Photoshop/Affinity/Figma never reorder
  // on selection). That one design choice explained nearly everything
  // reported in testing: clicking a layer appeared to "move it to the top";
  // dragging a real reorder appeared to silently fail because the display
  // immediately re-sorted around whatever became active afterward; opacity/
  // blend mode looked wrong because they were being applied to a real stack
  // order that no longer matched what the panel displayed.
  //
  // Fix: the list now has ONE fixed relationship to the real `layers` array
  // — reversed, so the topmost real layer (rendered frontmost on canvas,
  // per GradientCanvas's `mesh.position.z = index * 0.01`, where higher
  // array index = higher z = closer to camera = on top) shows at the TOP of
  // the panel, matching standard layers-panel convention. This mapping is
  // constant regardless of selection — clicking a layer ONLY sets
  // activeLayerId (selection highlight + inline control expansion below,
  // both already keyed purely on `activeLayerId === layer.id`, independent
  // of list position). Reordering is the ONLY thing that changes the list.
  const moveLayer = (fromDisplayIndex: number, toDisplayIndex: number) => {
    const total = layers.length;
    const realFromIndex = total - 1 - fromDisplayIndex;
    const realToIndex = total - 1 - toDisplayIndex;
    if (realFromIndex === realToIndex || realFromIndex < 0 || realToIndex < 0) return;
    const newLayers = [...layers];
    const [removed] = newLayers.splice(realFromIndex, 1);
    newLayers.splice(realToIndex, 0, removed);
    // STAGE 2.7C: stream the reorder without committing history (see prop docs).
    (onReorderLayers ?? onLayersChange)(newLayers);
  };

  const blendModes: BlendMode[] = [
    'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
    'color-dodge', 'color-burn', 'hard-light', 'soft-light',
    'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'
  ];

  // Display order: top-of-stack (highest real index, rendered frontmost)
  // shown first — the fixed, selection-independent convention described
  // above. A plain reversed copy; `layers` itself is never mutated here.
  const displayLayers = [...layers].reverse();

  return (
    <>
      <div className="space-y-3 px-[0px] py-[10px]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-zinc-100">Layers</h3>
            {/* STAGE 2.7.4: layer counter — makes the cap visible so the disabled
                Add button reads as intentional, not broken. */}
            <span className="text-[10px] text-zinc-500 tabular-nums">{layers.length}/{MAX_LAYERS}</span>
          </div>
          <Button
            size="sm"
            onClick={handleAddLayerClick}
            disabled={!canAddLayer(layers.length)}
            title={!canAddLayer(layers.length) ? LAYER_LIMIT_MESSAGE : undefined}
            className="bg-gradient-to-r from-[#0066FF] via-[#0099FF] to-[#00CCFF] hover:from-[#0052CC] hover:via-[#0080DD] hover:to-[#00B8E6] text-white border-none shadow-lg shadow-blue-500/20 whitespace-nowrap text-xs px-3 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-3 h-3 mr-1" />
            Add Layer
          </Button>
        </div>

        {/* Scrollable Layers List - Shows 1 open + 2 closed layers at a time */}
        <ScrollArea className="h-[350px] pr-3 bg-[#262626] rounded m-[0px] px-[8px] py-[12px]">
          <div className="space-y-2">
            <DndProvider backend={HTML5Backend}>
              {displayLayers.map((layer, index) => (
                <DraggableLayerItem
                  key={layer.id}
                  layer={layer}
                  index={index}
                  activeLayerId={activeLayerId}
                  onActiveLayerChange={onActiveLayerChange}
                  updateLayer={updateLayer}
                  deleteLayer={deleteLayer}
                  duplicateLayer={duplicateLayer}
                  moveLayer={moveLayer}
                  layersLength={layers.length}
                  blendModes={blendModes}
                  onReorderCommit={onCommitHistory}
                />
              ))}
            </DndProvider>
          </div>
        </ScrollArea>
      </div>

      {/* New Layer Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-zinc-100">Create New Layer</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Enter a name for your new layer.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newLayerName}
              onChange={(e) => setNewLayerName(e.target.value)}
              placeholder="Layer name"
              className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCreateLayer();
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              className="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateLayer}
              disabled={!newLayerName.trim()}
              className="bg-gradient-to-r from-[#0066FF] via-[#0099FF] to-[#00CCFF] hover:from-[#0052CC] hover:via-[#0080DD] hover:to-[#00B8E6] text-white border-none"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}