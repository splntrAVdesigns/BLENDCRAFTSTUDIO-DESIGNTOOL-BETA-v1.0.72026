import { Layer, CanvasSettings as CanvasSettingsType, type RenderApi } from '../../types/gradient';
import { isMediaLayerActive } from '../../media/mediaShader';
import { toast } from 'sonner';
import { canAddLayer, LAYER_LIMIT_MESSAGE } from '../../utils/layerLimits';
import { putBlob as persistMediaBlob } from '../../media/mediaBlobStore';
import { LayerPanel } from '../controls/LayerPanel';
import { MaskControls } from '../controls/MaskControls';
import { MediaUploadPanel } from '../../media/components/MediaUploadPanel';
import { AnimationControls } from '../controls/AnimationControls';
import { TextureControls } from '../controls/TextureControls';
import { AdvancedExportPanel } from '../controls/AdvancedExportPanel';
import { ProTipsPanel } from '../controls/ProTipsPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { ScrollArea } from '../ui/scroll-area';
import type { HistoryState } from '../../hooks/useHistory';
import { useMemo, memo } from 'react';

interface RightSidebarProps {
  layers: Layer[];
  activeLayerId: string;
  // STAGE 2.8.5 — forwarded to the session slots panel in the Export tab.
  effects?: any;
  onLoadSession?: (
    layers: Layer[],
    canvasSettings: CanvasSettingsType,
    effects: any,
    activeLayerId: string | null,
  ) => void;
  activeLayer: Layer | undefined;
  canvasSettings: CanvasSettingsType;
  /** 2.7 — lets the media panel offer "match canvas to media aspect". */
  onCanvasSettingsChange?: (settings: CanvasSettingsType) => void;
  onLayersChange: (layers: Layer[]) => void;
  /** 2.7.6d — reset global effects to defaults when a NEW media layer is
   *  created from an upload (fresh media = fresh canvas). NOT called on
   *  Replace (that keeps the styling you already set for that slot). */
  onResetEffectsForNewMedia?: () => void;
  onActiveLayerChange: (id: string) => void;
  onUpdateActiveLayer: (updates: Partial<Layer>) => void;
  canvasRef: React.RefObject<HTMLDivElement>;
  renderApiRef?: React.MutableRefObject<RenderApi | null>;
  isPlaying?: boolean;
  onPlayToggle?: () => void;
  
  // History props
  history: HistoryState[];
  currentHistoryIndex: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onGoToHistoryState: (index: number) => void;
  onClearHistory: () => void;
  onCommitHistory?: () => void; // 🔥 COMMIT-BASED HISTORY
  
  // 🔥 Drag callbacks
  onStartDrag?: () => void;
  onEndDrag?: () => void;
}

export function RightSidebar({
  layers,
  activeLayerId,
  effects,
  onLoadSession,
  activeLayer,
  canvasSettings,
  onCanvasSettingsChange,
  onLayersChange,
  onResetEffectsForNewMedia,
  onActiveLayerChange,
  onUpdateActiveLayer,
  canvasRef,
  renderApiRef,
  history,
  currentHistoryIndex,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onGoToHistoryState,
  onClearHistory,
  onCommitHistory,
  isPlaying,
  onPlayToggle,
  onStartDrag,
  onEndDrag,
}: RightSidebarProps) {

  // Memoize default animation to prevent creating new object on every render
  const defaultAnimation = useMemo(() => ({
    enabled: false,
    type: 'rotation' as const,
    speed: 1,
    intensity: 1,
    loop: true,
    easing: 'linear' as const,
    direction: 'forward' as const,
    resetCounter: 0,
  }), []);

  return (
    // flex-shrink-0: guarantees this sidebar always renders at its full 384px
    // regardless of pressure from the canvas area; overflow-x-hidden is a
    // second clip boundary so no internal control (slider, select, thumbnail)
    // can bleed past the panel edge. See App.tsx `main` for the matching fix
    // on the canvas side — this was the flexbox min-content overflow bug that
    // cropped the sidebar after a media layer's render size briefly changed.
    <aside className="w-96 flex-shrink-0 overflow-x-hidden border-l border-zinc-800 flex flex-col" style={{ backgroundColor: '#404040' }}>
      <Tabs defaultValue="layers" className="flex-1 flex flex-col overflow-hidden">
        <div className="flex justify-center px-4 mt-6 flex-shrink-0">
          <TabsList className="grid grid-cols-5 bg-zinc-900">
            <TabsTrigger value="layers" className="text-xs text-white data-[state=active]:text-[#51a2ff]">
              Layers
            </TabsTrigger>
            <TabsTrigger value="animation" className="text-xs text-white data-[state=active]:text-[#51a2ff]">
              Animation
            </TabsTrigger>
            <TabsTrigger value="textures" className="text-xs text-white data-[state=active]:text-[#51a2ff]">
              Textures
            </TabsTrigger>
            <TabsTrigger value="export" className="text-xs text-white data-[state=active]:text-[#51a2ff]">
              Export
            </TabsTrigger>
            <TabsTrigger value="protips" className="text-xs text-white data-[state=active]:text-[#51a2ff]">
              ProTips
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Each TabsContent now has its own ScrollArea to prevent conflicts */}
        <TabsContent value="layers" className="mt-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full w-full max-w-full overflow-x-hidden">
            {/* STAGE 2.6.1: min-w-0 + max-w-full + overflow-x-hidden clip any
                over-wide descendant AT THE CONTENT WRAPPER, so nothing inside
                (long file names, layer-name inputs, sliders) can inflate the
                panel's layout width. Belt-and-suspenders alongside the
                ScrollArea primitive's own enforcement. */}
            <div className="pb-8 px-4 space-y-4 w-full min-w-0 max-w-full overflow-x-hidden">
              {/* Layers List Section - Scrollable */}
              <LayerPanel
                layers={layers}
                activeLayerId={activeLayerId}
                onLayersChange={(newLayers) => {
                  onLayersChange(newLayers);
                  onCommitHistory?.(); // 🔥 Commit on layer operations
                }}
                onActiveLayerChange={onActiveLayerChange}
                onStartDrag={onStartDrag}
                onEndDrag={onEndDrag}
                onCommitHistory={onCommitHistory}
                onReorderLayers={onLayersChange}
              />

              <div className="border-t border-zinc-800" />

              {/* Media Upload Section — Media Layer System (Stage 2).
                  Placement per spec: under Layers list, above Mask Settings.
                  2A: uploads create their OWN dedicated layer. */}
              <MediaUploadPanel
                layer={activeLayer}
                canCreateLayer={canAddLayer(layers.length)}
                canvasWidth={canvasSettings.width}
                canvasHeight={canvasSettings.height}
                onUpdate={(media) => {
                  // STAGE 2.7.8 (C): when the SOURCE is replaced, the incoming
                  // media carries a new fileName. Sync the layer NAME to it —
                  // otherwise the layer kept the previous file's title after a
                  // Replace (confusing: new video, old name). Only rename when
                  // the fileName actually changed, so ordinary media tweaks
                  // (opacity, transform, fit, speed…) don't touch the name or a
                  // name the user may have customised beyond the filename.
                  const prevFile = (activeLayer?.media as any)?.fileName;
                  const nextFile = (media as any)?.fileName;
                  const sourceReplaced =
                    !!nextFile && !!prevFile && nextFile !== prevFile;
                  if (sourceReplaced) {
                    const baseName = String(nextFile).replace(/\.[^.]+$/, '');
                    onUpdateActiveLayer({
                      media,
                      name: baseName.slice(0, 40) || 'Media',
                    });
                    // STAGE 2.7.8 (D): re-persist the new source under the same
                    // layer id so the replaced video also survives a reload.
                    // STAGE 2.8.0: persist for ALL source kinds — images now
                    // carry blobs too, and reload survival must not depend on
                    // the media happening to be a video.
                    const b = (media as any)?.blob as Blob | undefined;
                    if (b && activeLayer?.id) {
                      void persistMediaBlob(activeLayer.id, b, {
                        fileName: (media as any).fileName,
                        sourceKind: (media as any).sourceKind,
                      });
                    }
                  } else {
                    onUpdateActiveLayer({ media });
                  }
                  onCommitHistory?.(); // Commit on media changes
                }}
                onDeleteMediaLayer={(layerId) => {
                  // 2.7.3 — the media panel's X removes the whole layer.
                  // Refuse if it's the last layer (the app requires >=1 layer);
                  // the panel falls back to clearing the media in that case.
                  if (layers.length <= 1) return false;
                  const next = layers.filter((l) => l.id !== layerId);
                  onLayersChange(next);
                  if (activeLayerId === layerId) {
                    onActiveLayerChange(next[next.length - 1].id);
                  }
                  onCommitHistory?.();
                  return true;
                }}
                onAddMediaLayer={(media) => {
                  // STAGE 2.7.4: media layers are the heaviest layer type (large
                  // GPU textures). Enforce the session cap here too — this is a
                  // layer-creation entry point just like Add Layer / Duplicate.
                  if (!canAddLayer(layers.length)) {
                    toast.error(LAYER_LIMIT_MESSAGE);
                    return;
                  }
                  // 2A: dedicated media layer — named from the file, inserted
                  // above (rendered on top of) the active layer, selected.
                  // Carries a default gradient so: (a) the Color Stops editor
                  // doubles as the LUT ramp, (b) the animation transform
                  // machinery engages natively (it requires layer.gradient).
                  const baseName = (media.fileName ?? 'Media').replace(/\.[^.]+$/, '');
                  const newLayer: Layer = {
                    id: `layer-${Date.now()}`,
                    name: baseName.slice(0, 40) || 'Media',
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
                    media: { ...media, enabled: true },
                  };
                  // STAGE 2.7.8 (D): persist the blob to IndexedDB IMMEDIATELY
                  // here, under this layer's brand-new id — the moment we have
                  // both. Previously persistence was deferred to the render
                  // effect, which could be missed/raced (a likely cause of
                  // "re-upload to restore" after a real upload). This is the
                  // authoritative persist; the render effect's persist stays as
                  // a backstop but is now redundant for the new-layer path.
                  {
                    // STAGE 2.8.0: all source kinds persist (see replace path).
                    const b = (media as any)?.blob as Blob | undefined;
                    if (b) {
                      void persistMediaBlob(newLayer.id, b, {
                        fileName: media.fileName,
                        sourceKind: media.sourceKind,
                      });
                    }
                  }
                  const activeIndex = layers.findIndex((l) => l.id === activeLayerId);
                  const insertAt = activeIndex >= 0 ? activeIndex + 1 : layers.length;
                  const next = [...layers.slice(0, insertAt), newLayer, ...layers.slice(insertAt)];
                  onLayersChange(next);
                  onActiveLayerChange(newLayer.id);
                  // 2.7.6d: fresh upload → reset global effects to defaults so the
                  // new media isn't unexpectedly inheriting the previous file's
                  // grade (chromatic aberration, vignette, etc.). Replace keeps
                  // effects; only a brand-new media layer resets them.
                  onResetEffectsForNewMedia?.();
                  onCommitHistory?.();
                }}
              />

              <div className="border-t border-zinc-800" />

              {/* Mask Layer Section - Below divider */}
              {activeLayer && (
                <MaskControls
                  layer={activeLayer}
                  layers={layers}
                  isPlaying={isPlaying}
                  onPlayToggle={onPlayToggle}
                  onUpdate={(mask) => {
                    onUpdateActiveLayer({ mask });
                    onCommitHistory?.(); // 🔥 Commit on mask changes
                  }}
                />
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="animation" className="mt-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="pb-8 px-4 space-y-4">
              {activeLayer ? (
                <AnimationControls
                  /* STAGE 2.9.3: media layers take the bounded field path. */
                  isMediaLayer={isMediaLayerActive(activeLayer?.media)}
                  animation={activeLayer.animation || defaultAnimation}
                  onChange={(animation) => {
                    onUpdateActiveLayer({ animation });
                  }}
                  onStartDrag={onStartDrag}
                  onEndDrag={onEndDrag}
                />
              ) : (
                <div className="p-6 text-center text-zinc-500 text-sm">
                  <p>No layer selected</p>
                  <p className="text-xs mt-1">Select or create a layer to add animations</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="textures" className="mt-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="pb-8 px-4">
              {activeLayer && (
                <TextureControls
                  texture={activeLayer.texture}
                  onChange={(texture) => {
                    onUpdateActiveLayer({ texture });
                  }}
                />
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="export" className="mt-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="px-[16px] pb-8">
          <AdvancedExportPanel
            canvasRef={canvasRef}
            renderApiRef={renderApiRef}
            canvasSettings={canvasSettings}
            layers={layers}
            history={history}
            currentHistoryIndex={currentHistoryIndex}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={onUndo}
            onRedo={onRedo}
            onGoToHistoryState={onGoToHistoryState}
            onClearHistory={onClearHistory}
            onCommitHistory={onCommitHistory}
            effects={effects}
            activeLayerId={activeLayerId}
            onLoadSession={onLoadSession}
          />
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="protips" className="mt-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="px-[16px] pb-8">
          <ProTipsPanel 
            onApplyExample={(gradientConfig) => {
              if (activeLayer) {
                onUpdateActiveLayer({ gradient: gradientConfig });
              }
            }}
            activeLayer={activeLayer}
            layers={layers}
          />
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </aside>
  );
}

export default memo(RightSidebar);