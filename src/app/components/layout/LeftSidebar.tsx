import { Layer, CanvasSettings as CanvasSettingsType } from '../../types/gradient';
import { isMediaLayerActive } from '../../media/mediaShader';
import { useCallback, useMemo, memo } from 'react';
import { DEFAULT_PRESETS } from '../../utils/presets';
import { GradientControls } from '../controls/GradientControls';
import { EffectsControls } from '../controls/EffectsControls';
import { EffectsConfig } from '../controls/EffectsControls';
import { PresetSelector } from '../controls/PresetSelector';
import { ColorPaletteSelector } from '../controls/ColorPaletteSelector';
import { ColorStopsSection } from '../controls/ColorStopsSection';
import { CanvasSettings } from '../controls/CanvasSettings';
import { SafeModeControls } from '../controls/SafeModeControls';
import { AIToolsPanel } from '../controls/AIToolsPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { ScrollArea } from '../ui/scroll-area';

interface LeftSidebarProps {
  activeLayer: Layer | undefined;
  layers: Layer[];
  canvasSettings: CanvasSettingsType;
  effects: EffectsConfig;
  onUpdateActiveLayer: (updates: Partial<Layer>) => void;
  onCanvasSettingsChange: (settings: CanvasSettingsType) => void;
  onEffectsChange: (effects: EffectsConfig) => void;
  onLoadPreset: (preset: typeof DEFAULT_PRESETS[0]) => void;
  isPlaying?: boolean;
  onLayersChange?: (layers: Layer[]) => void;
  onStopAnimation?: () => void;
  onStartDrag?: () => void;  // 🔥 NEW: Drag callbacks
  onEndDrag?: () => void;    // 🔥 NEW: Drag callbacks
  onCommitHistory?: () => void; // 🔥 COMMIT-BASED HISTORY
}

export const LeftSidebar = memo(function LeftSidebar({
  activeLayer,
  layers,
  canvasSettings,
  effects,
  onUpdateActiveLayer,
  onCanvasSettingsChange,
  onEffectsChange,
  onLoadPreset,
  isPlaying,
  onLayersChange,
  onStopAnimation,
  onStartDrag,  // 🔥 NEW
  onEndDrag,    // 🔥 NEW
  onCommitHistory, // 🔥 COMMIT-BASED HISTORY
}: LeftSidebarProps) {
  // Memoize gradient to provide stable reference to GradientControls
  // This prevents GradientControls from re-rendering when activeLayer object changes but gradient data is the same
  const stableGradient = useMemo(() => activeLayer?.gradient, [activeLayer?.gradient]);
  
  // Memoize gradient onChange to prevent infinite re-renders
  const handleGradientChange = useCallback(
    (gradient: any) => {
      onUpdateActiveLayer({ gradient });
    },
    [onUpdateActiveLayer]
  );

  return (
    // flex-shrink-0 + overflow-x-hidden: same fix as RightSidebar — see notes
    // there. Applied symmetrically so the left panel is equally protected.
    <aside className="w-96 flex-shrink-0 overflow-x-hidden border-r border-zinc-800 flex flex-col" style={{ backgroundColor: '#404040' }}>
      <Tabs defaultValue="gradient" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="grid grid-cols-5 mx-4 mt-6 bg-zinc-900 flex-shrink-0">
          <TabsTrigger value="gradient" className="text-xs text-white data-[state=active]:text-[#51a2ff]">
            Gradient
          </TabsTrigger>
          <TabsTrigger value="effects" className="text-xs text-white data-[state=active]:text-[#51a2ff]">
            Effects
          </TabsTrigger>
          <TabsTrigger value="ai" className="text-xs text-white data-[state=active]:text-[#51a2ff]">
            Adv. Tools
          </TabsTrigger>
          <TabsTrigger value="presets" className="text-xs text-white data-[state=active]:text-[#51a2ff]">
            Presets
          </TabsTrigger>
          <TabsTrigger value="settings" className="text-xs text-white data-[state=active]:text-[#51a2ff]">
            Settings
          </TabsTrigger>
        </TabsList>

        {/* Each TabsContent now has its own ScrollArea to prevent conflicts */}
        <TabsContent value="gradient" className="mt-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="px-[0px] pt-[0px] pb-[28px]">
              <ColorPaletteSelector
                onSelectPalette={(colors) => {
                  if (activeLayer?.gradient) {
                    onUpdateActiveLayer({
                      gradient: { ...activeLayer.gradient, colors },
                    });
                    onCommitHistory?.(); // Commit on palette change
                  }
                }}
              />

              <div style={{ marginTop: '4px' }}>
                {activeLayer?.gradient && (
                  <ColorStopsSection
                    colors={activeLayer.gradient.colors}
                    onColorsChange={(colors) => {
                      if (activeLayer?.gradient) {
                        onUpdateActiveLayer({
                          gradient: { ...activeLayer.gradient, colors },
                        });
                      }
                    }}
                    onCommitHistory={onCommitHistory}
                  />
                )}
              </div>

              <div className="border-t border-zinc-800 mt-4" />

              {stableGradient && (
                <>
                  <GradientControls
                    gradient={stableGradient}
                    onChange={handleGradientChange}
                    onCommitHistory={onCommitHistory}
                    isMediaLayer={isMediaLayerActive(activeLayer?.media)}
                  />
                </>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="ai" className="mt-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="pb-8">
              {activeLayer && (
                <AIToolsPanel
                  activeLayer={activeLayer}
                  onUpdateLayer={onUpdateActiveLayer}
                />
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="effects" className="mt-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="pb-8">
              <EffectsControls 
                effects={effects} 
                onChange={onEffectsChange}
                onStartDrag={onStartDrag}
                onEndDrag={onEndDrag}
                onCommitHistory={onCommitHistory}
              />
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="presets" className="mt-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="pb-8">
              <PresetSelector
                onLoadPreset={(preset) => {
                  onLoadPreset(preset);
                  onCommitHistory?.(); // Commit on preset load
                }}
                currentLayers={layers}
                currentCanvasSettings={canvasSettings}
              />
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="settings" className="mt-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="pb-8">
              <CanvasSettings
                settings={canvasSettings}
                onChange={onCanvasSettingsChange}
                onCommitHistory={onCommitHistory}
              />
              
              {/* Safe Mode / Performance Controls */}
              <div className="mt-8 mb-4" />
              <div className="border-t border-zinc-700" />
              <div className="mt-6" />
              <SafeModeControls
                layers={layers}
                effects={effects}
                canvasSettings={canvasSettings}
                isPlaying={isPlaying || false}
                onLayersChange={onLayersChange || (() => {})}
                onEffectsChange={onEffectsChange}
                onCanvasSettingsChange={onCanvasSettingsChange}
                onStopAnimation={onStopAnimation || (() => {})}
                onStartDrag={onStartDrag || (() => {})}  // 🔥 NEW
                onEndDrag={onEndDrag || (() => {})}      // 🔥 NEW
                onCommitHistory={onCommitHistory || (() => {})} // 🔥 COMMIT-BASED HISTORY
              />
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </aside>
  );
});