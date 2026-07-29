import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Layer, CanvasSettings as CanvasSettingsType, InteractionState } from '../types/gradient';
import { DEFAULT_PRESETS } from '../utils/presets';
import { sanitizeLayer } from '../utils/documentState';
import { EffectsConfig, DEFAULT_EFFECTS } from '../components/controls/EffectsControls';

const STORAGE_KEYS = {
  LAYERS: 'gradientStudio_layers',
  CANVAS_SETTINGS: 'gradientStudio_canvasSettings',
  EFFECTS: 'gradientStudio_effects',
  ACTIVE_LAYER: 'gradientStudio_activeLayer',
};

// PERFORMANCE FIX: Schedule localStorage writes during idle time
function scheduleIdleSave(fn: () => void) {
  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(fn, { timeout: 1500 });
  } else {
    setTimeout(fn, 0);
  }
}

export function useGradientState() {
  // Load from localStorage or use defaults
  const [layers, setLayers] = useState<Layer[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.LAYERS);
      return saved ? JSON.parse(saved) : DEFAULT_PRESETS[0].layers;
    } catch {
      return DEFAULT_PRESETS[0].layers;
    }
  });

  const [activeLayerId, setActiveLayerId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_LAYER);
      return saved || layers[0]?.id || DEFAULT_PRESETS[0].layers[0].id;
    } catch {
      return layers[0]?.id || DEFAULT_PRESETS[0].layers[0].id;
    }
  });

  const [canvasSettings, setCanvasSettings] = useState<CanvasSettingsType>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CANVAS_SETTINGS);
      return saved ? JSON.parse(saved) : DEFAULT_PRESETS[0].canvasSettings;
    } catch {
      return DEFAULT_PRESETS[0].canvasSettings;
    }
  });

  const [effects, setEffects] = useState<EffectsConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.EFFECTS);
      if (saved) {
        const parsedEffects = JSON.parse(saved);
        // Merge with DEFAULT_EFFECTS to ensure new properties have proper defaults
        return { ...DEFAULT_EFFECTS, ...parsedEffects };
      }
      return DEFAULT_EFFECTS;
    } catch {
      return DEFAULT_EFFECTS;
    }
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [interactionEnabled, setInteractionEnabled] = useState(false);
  const [interactionState, setInteractionState] = useState<InteractionState>({
    mouseX: 0,
    mouseY: 0,
    intensity: 0,
  });

  // isPlaying initial state is false (see useState above).
  // No force-reset useEffect needed — it was resetting state on every
  // HMR remount and killing any active animation the user had running.

  // PERFORMANCE RESCUE: Save to localStorage with aggressive debouncing + idle-time scheduling
  // LAYERS: 1200ms debounce + idle callback
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      scheduleIdleSave(() => {
        try {
          // STAGE 2.7.7: sanitize before persisting — a Blob serializes to {}
          // (truthy) and would defeat the rehydration guard on reload. Strip
          // blob/src/previewUrl here just like autosave does.
          localStorage.setItem(STORAGE_KEYS.LAYERS, JSON.stringify(layers.map(sanitizeLayer)));
        } catch (error) {
          console.error('Failed to save layers:', error);
        }
      });
    }, 1200);
    
    return () => clearTimeout(timeoutId);
  }, [layers]);

  // CANVAS_SETTINGS: 1000ms debounce + idle callback
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      scheduleIdleSave(() => {
        try {
          localStorage.setItem(STORAGE_KEYS.CANVAS_SETTINGS, JSON.stringify(canvasSettings));
        } catch (error) {
          console.error('Failed to save canvas settings:', error);
        }
      });
    }, 1000);
    
    return () => clearTimeout(timeoutId);
  }, [canvasSettings]);

  // EFFECTS: 1200ms debounce + idle callback
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      scheduleIdleSave(() => {
        try {
          localStorage.setItem(STORAGE_KEYS.EFFECTS, JSON.stringify(effects));
        } catch (error) {
          console.error('Failed to save effects:', error);
        }
      });
    }, 1200);
    
    return () => clearTimeout(timeoutId);
  }, [effects]);

  // ACTIVE_LAYER: 500ms debounce + idle callback
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      scheduleIdleSave(() => {
        try {
          localStorage.setItem(STORAGE_KEYS.ACTIVE_LAYER, activeLayerId);
        } catch (error) {
          console.error('Failed to save active layer:', error);
        }
      });
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [activeLayerId]);

  // PERFORMANCE FIX: Memoize activeLayer to prevent unnecessary re-renders
  // This prevents the object reference from changing on every render
  const activeLayer = useMemo(() => {
    return layers.find((l) => l.id === activeLayerId);
  }, [layers, activeLayerId]);

  // Create a stable reference for activeLayer using a ref and deep comparison
  const activeLayerRef = useRef<Layer | undefined>(activeLayer);
  const prevLayersRef = useRef(layers);
  
  const stableActiveLayer = useMemo(() => {
    const newLayer = layers.find((l) => l.id === activeLayerId);
    
    if (!newLayer) return undefined;
    
    // OPTIMIZATION: Only update reference if activeLayerId changed
    // This prevents re-renders when layers array updates but active layer data is the same
    if (activeLayerRef.current && activeLayerRef.current.id === newLayer.id) {
      // Same layer - only update if it's a different object reference
      if (activeLayerRef.current === newLayer) {
        return activeLayerRef.current; // Same object, return cached
      }
      // Different object but same ID - this means the layer was updated
      activeLayerRef.current = newLayer;
      return newLayer;
    }
    
    // Different layer ID or first time
    activeLayerRef.current = newLayer;
    prevLayersRef.current = layers;
    return newLayer;
  }, [layers, activeLayerId]);

  const updateActiveLayer = useCallback((updates: Partial<Layer>) => {
    setLayers((prevLayers) =>
      prevLayers.map((layer) =>
        layer.id === activeLayerId ? { ...layer, ...updates } : layer
      )
    );
  }, [activeLayerId]);

  const loadPreset = useCallback((preset: typeof DEFAULT_PRESETS[0]) => {
    setLayers(preset.layers);
    setCanvasSettings(preset.canvasSettings);
    setActiveLayerId(preset.layers[0].id);
  }, []);

  const resetToDefaults = useCallback(() => {
    setLayers(DEFAULT_PRESETS[0].layers);
    setCanvasSettings(DEFAULT_PRESETS[0].canvasSettings);
    setEffects(DEFAULT_EFFECTS);
    setActiveLayerId(DEFAULT_PRESETS[0].layers[0].id);
  }, []);

  return {
    // State
    layers,
    setLayers,
    activeLayerId,
    setActiveLayerId,
    activeLayer: stableActiveLayer, // Use stable version to prevent infinite re-renders
    canvasSettings,
    setCanvasSettings,
    effects,
    setEffects,
    isPlaying,
    setIsPlaying,
    interactionEnabled,
    setInteractionEnabled,
    interactionState,
    setInteractionState,
    
    // Actions
    updateActiveLayer,
    loadPreset,
    resetToDefaults,
  };
}