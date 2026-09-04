import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { Shield, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Layer, CanvasSettings as CanvasSettingsType } from '../../types/gradient';
import { EffectsConfig } from './EffectsControls';

interface SafeModeControlsProps {
  onStartDrag?: () => void;
  onEndDrag?: () => void;
  onCommitHistory?: () => void;
  layers: Layer[];
  effects: EffectsConfig;
  canvasSettings: CanvasSettingsType;
  isPlaying: boolean;
  onLayersChange: (layers: Layer[]) => void;
  onEffectsChange: (effects: EffectsConfig) => void;
  onCanvasSettingsChange: (settings: CanvasSettingsType) => void;
  onStopAnimation: () => void;
}

export function SafeModeControls({
  layers,
  effects,
  canvasSettings,
  isPlaying,
  onLayersChange,
  onEffectsChange,
  onCanvasSettingsChange,
  onStopAnimation,
}: SafeModeControlsProps) {
  const [safeMode, setSafeMode] = useState(false);

  // Detect if any expensive features are active
  const hasExpensiveFeatures = 
    layers.some(layer => 
      Boolean(layer.texture) ||
      Boolean(layer.animation?.enabled)
    ) ||
    effects.filmGrain > 0 ||
    effects.blur > 0 ||
    effects.chromaticAberration > 0 ||
    effects.pixelateEnabled ||
    effects.halftoneEnabled ||
    effects.vignette > 0.3 ||
    isPlaying;

  const enableSafeMode = () => {
    // Stop all animations
    onStopAnimation();

    // Disable textures on all layers and reset animation to correct shape
    const safeLayers = layers.map(layer => ({
      ...layer,
      texture: undefined,
      animation: layer.animation ? {
        ...layer.animation,
        enabled: false,
        speed: 0,
        intensity: 0,
      } : {
        enabled: false,
        type: 'rotation' as const,
        speed: 0,
        intensity: 0,
        loop: true,
        easing: 'linear' as const,
        direction: 'forward' as const,
      },
    }));
    onLayersChange(safeLayers);

    // Reset expensive effects
    onEffectsChange({
      ...effects,
      filmGrain: 0,
      blur: 0,
      chromaticAberration: 0,
      pixelateEnabled: false,
      halftoneEnabled: false,
      vignette: 0,
    });

    // Set safe canvas resolution if too high
    if (canvasSettings.width * canvasSettings.height > 2073600) { // > 1920×1080
      onCanvasSettingsChange({
        ...canvasSettings,
        width: 1920,
        height: 1080,
      });
    }

    setSafeMode(true);
    toast.success('Safe Mode enabled - all expensive features disabled');
  };

  const disableSafeMode = () => {
    setSafeMode(false);
    toast.info('Safe Mode disabled - you can now re-enable features manually');
  };

  const resetRenderer = () => {
    // Force canvas re-render by temporarily changing resolution
    const currentWidth = canvasSettings.width;
    const currentHeight = canvasSettings.height;
    
    onCanvasSettingsChange({
      ...canvasSettings,
      width: currentWidth - 1,
      height: currentHeight - 1,
    });

    // Restore after a brief delay
    setTimeout(() => {
      onCanvasSettingsChange({
        ...canvasSettings,
        width: currentWidth,
        height: currentHeight,
      });
      toast.success('Renderer reset successfully');
    }, 100);
  };

  return (
    <div className="px-4 pb-4 space-y-4">
      {/* Safe Mode Toggle - Clean minimal style */}
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-3">
          <Shield className={`w-5 h-5 ${safeMode ? 'text-green-500' : 'text-zinc-400'}`} />
          <div>
            <Label className="text-sm font-medium text-zinc-100">Safe Mode</Label>
            <p className="text-xs text-zinc-400 mt-0.5">
              Disables expensive textures, effects, and animations
            </p>
          </div>
        </div>
        <Switch
          checked={safeMode}
          onCheckedChange={(checked) => {
            if (checked) {
              enableSafeMode();
            } else {
              disableSafeMode();
            }
          }}
        />
      </div>

      {/* Warning if expensive features detected - Smaller and less invasive */}
      {hasExpensiveFeatures && !safeMode && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-yellow-500/5 border border-yellow-500/20">
          <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-zinc-300">
            <span className="font-medium">Performance Warning:</span> Expensive features detected. Enable Safe Mode if experiencing lag or freezing.
          </p>
        </div>
      )}

      {/* Recovery Actions */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          Recovery Actions
        </Label>
        
        <Button
          onClick={enableSafeMode}
          variant="outline"
          size="sm"
          className="w-full justify-start text-zinc-300 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
          disabled={safeMode}
        >
          <Shield className="w-4 h-4 mr-2" />
          Enable Safe Mode
        </Button>

        <Button
          onClick={resetRenderer}
          variant="outline"
          size="sm"
          className="w-full justify-start text-zinc-300 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Reset Renderer
        </Button>

        <Button
          onClick={() => {
            onStopAnimation();
            toast.success('All animations stopped');
          }}
          variant="outline"
          size="sm"
          className="w-full justify-start text-zinc-300 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
          disabled={!isPlaying}
        >
          <AlertTriangle className="w-4 h-4 mr-2" />
          Stop All Animations
        </Button>
      </div>

      {/* Safe Mode Active Info - Smaller and less invasive */}
      {safeMode && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-green-500/5 border border-green-500/20">
          <Shield className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-zinc-300">
            <span className="font-medium">Safe Mode Active:</span> All expensive features disabled. Re-enable features individually when ready.
          </p>
        </div>
      )}
    </div>
  );
}
