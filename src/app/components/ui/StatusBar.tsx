import { Layer, CanvasSettings } from '../../types/gradient';
import { isMediaLayerActive } from '../../media/mediaShader';
import { Info } from 'lucide-react';

interface StatusBarProps {
  layers: Layer[];
  canvasSettings: CanvasSettings;
  activeLayerId: string;
}

export function StatusBar({ layers, canvasSettings, activeLayerId }: StatusBarProps) {
  // Safety check: ensure layers is defined
  if (!layers || !canvasSettings) {
    return null;
  }

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const visibleLayers = layers.filter((l) => l.visible).length;

  return (
    <div className="border-t border-zinc-800 bg-zinc-900/50 backdrop-blur-sm px-6 py-2 flex-shrink-0">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Info className="w-3 h-3" />
            <span>
              Canvas: {canvasSettings.width}×{canvasSettings.height}px
            </span>
          </div>
          
          <div className="w-px h-3 bg-zinc-700" />
          
          <span>
            Layers: {visibleLayers}/{layers.length} visible
          </span>

          {activeLayer && (
            <>
              <div className="w-px h-3 bg-zinc-700" />
              <span>
                Active: {activeLayer.name || `Layer ${layers.indexOf(activeLayer) + 1}`}
              </span>
            </>
          )}

          {activeLayer?.gradient && (
            <>
              <div className="w-px h-3 bg-zinc-700" />
              <span className="capitalize">
                {activeLayer.gradient.type} gradient
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-4">
          {activeLayer?.animation?.enabled && (
            <span className="text-green-400">● Animated</span>
          )}
          
          {activeLayer?.texture && (
            <span className="text-blue-400">● Textured</span>
          )}

          {/* 2.7 — MEDIA indicator, matching the layer-tag colour (pink) so the
              same concept reads the same colour in both places. Distinguishes
              video from image, as the layer tag does. */}
          {isMediaLayerActive(activeLayer?.media) && (
            <span className="text-pink-400">
              ● {activeLayer?.media?.sourceKind === 'video' ? 'Video' : 'Image'}
            </span>
          )}

          {/* Mask indicator — completes the set, so every system that can be
              active on a layer is represented in the status bar. */}
          {activeLayer?.mask && activeLayer.mask.type !== 'none' && (
            <span className="text-zinc-100">● Masked</span>
          )}

          <span className="text-zinc-600">
            Blendcraft Studio v1.0
          </span>
        </div>
      </div>
    </div>
  );
}