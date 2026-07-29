import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Slider } from '../ui/slider';
import { Switch } from '../ui/switch';
import { SelectWrapper } from '../ui/select-wrapper';
import {
  MASK_SHAPE_CATEGORY_LABELS,
  MASK_SHAPE_CATEGORY_ORDER,
  MASK_SHAPE_PRESETS,
  getShapeById,
  getShapesByCategory,
  type MaskShapeCategory,
} from '../../lib/maskShapes';
import { useState, useEffect, useCallback, useRef, memo } from 'react';
import type { TextureConfig } from '../../types/gradient';

interface TextureControlsProps {
  texture?: TextureConfig;
  onChange: (texture: TextureConfig | undefined) => void;
}

// ANIMATION SPEED MAPPING - Piecewise linear for better control
// Slider range: 0-100 → Speed range: 0.05x-2.0x
function mapSliderToSpeed(sliderValue: number): number {
  if (sliderValue === 0) return 0; // Paused
  if (sliderValue <= 40) {
    // 1-40: Maps to 0.05x - 0.5x (fine slow-motion control)
    return 0.05 + (sliderValue / 40) * 0.45;
  } else if (sliderValue <= 60) {
    // 40-60: Maps to 0.5x - 1.0x (normal range)
    return 0.5 + ((sliderValue - 40) / 20) * 0.5;
  } else {
    // 60-100: Maps to 1.0x - 2.0x (speed-up range)
    return 1.0 + ((sliderValue - 60) / 40) * 1.0;
  }
}

function mapSpeedToSlider(speed: number): number {
  if (speed === 0) return 0;
  if (speed <= 0.5) {
    return (speed - 0.05) / 0.45 * 40;
  } else if (speed <= 1.0) {
    return 40 + ((speed - 0.5) / 0.5) * 20;
  } else {
    return 60 + ((speed - 1.0) / 1.0) * 40;
  }
}

function formatSpeedLabel(speed: number): string {
  if (speed === 0) return 'Paused';
  
  // Snap to common labels for display
  const labels = [
    { threshold: 0.075, label: '0.05x' },
    { threshold: 0.15, label: '0.1x' },
    { threshold: 0.375, label: '0.25x' },
    { threshold: 0.75, label: '0.5x' },
    { threshold: 1.25, label: '1x' },
    { threshold: 1.75, label: '1.5x' },
    { threshold: Infinity, label: '2x' },
  ];
  
  for (const { threshold, label } of labels) {
    if (speed < threshold) return label;
  }
  
  return `${speed.toFixed(2)}x`;
}

// Get default values for a texture type
function getTextureDefaults(type: TextureConfig['type']): Partial<TextureConfig> {
  const baseDefaults: Partial<TextureConfig> = {
    opacity: 1.0,
    scale: 1.0,
    intensity: 0.5,
    blendMode: 'normal',
    animateTexture: false,
    textureAnimationType: 'drift',
    animationSpeed: 15,
  };

  // Type-specific defaults
  if (type === 'plasma') {
    return {
      ...baseDefaults,
      turbulence: 20,
      waveCount: 5,
      colorIntensity: 15,
      blur: 0.3,
      scale: 5.3,
      intensity: 1.0,
    };
  } else if (type === 'shape-pattern') {
    return {
      ...baseDefaults,
      shapePatternId: 'circle',
      // patternColumns / patternRows removed — grid is fixed 4×4 internally.
      // Density is controlled by the shader `scale` uniform (real-time, no re-bake).
      patternSpacing: 20,
      patternOffsetX: 0,
      patternOffsetY: 0,
      patternRotation: 0,
      patternFillMode: 'fill',
      patternDensity: 50,
      patternRandomRotation: 0,
      // Alternate Tile Flip UI removed; keep saved-state value forced safe.
      patternAlternateFlip: 'none',
      patternStaggerRows: 0,
      patternScaleVariance: 0,
      patternOutlineThickness: 3,
      patternOpacityCurve: 50,
      patternOpacityCurveMode: 'flat',
      opacity: 0.6,
      scale: 1.0,   // 1.0 = 1 tile (4 shapes across); 2.0 = 2 tiles (8 shapes across)
      intensity: 1.0,
      blendMode: 'multiply',
    };
  } else if (type === 'organic') {
    return {
      ...baseDefaults,
      scale: 2.5,
      intensity: 0.6,
    };
  } else if (type === 'dots') {
    return {
      ...baseDefaults,
      scale: 2.5,
      intensity: 0.5,
    };
  } else if (type === 'lines') {
    return {
      ...baseDefaults,
      scale: 2.5,
      intensity: 0.5,
      angle: 0,
    };
  } else if (type === 'camoShadows') {
    return {
      ...baseDefaults,
      scale: 2.5,
      intensity: 0.5,
      angle: 0,
    };
  } else if (type === 'waveSignal') {
    return {
      ...baseDefaults,
      scale: 2.65,
      angle: 30,
      blur: 0.4,
      distortion: 0.3,
    };
  } else if (type === 'heatMelt') {
    return {
      ...baseDefaults,
      scale: 9.0,
      distortion: 0.25,
      blur: 0.6,
    };
  } else if (type === 'linearGlass' || type === 'frostedGlass' || type === 'blockGlass' || type === 'fractalGlass') {
    return {
      ...baseDefaults,
      blur: 0.5,
      distortion: 0.3,
      scale: 1.0,
      intensity: 0.5,
    };
  } else if (type === 'topography') {
    return {
      ...baseDefaults,
      scale: 1.0,
      intensity: 0.5,
      blur: 0.5,
      chromaticShift: 0,
      complexity: 4,
      elevationShift: 0,
      lineThickness: 50,
    };
  } else if (type === 'spackle') {
    return {
      ...baseDefaults,
      scale: 1.5,
      intensity: 0.80,
      turbulence: 30,
      lineThickness: 45,
      invertTexture: false,
      blendMode: 'normal',
    };
  } else if (type === 'grunge') {
    return {
      ...baseDefaults,
      scale: 1.2,
      intensity: 0.80,
      turbulence: 35,
      lineThickness: 50,
      blendMode: 'multiply',
    };
  }

  // Default for grain and others
  return baseDefaults;
}

// TEXTURE PRESETS - Common configurations for quick application
const TEXTURE_PRESETS: { name: string; config: TextureConfig; description: string }[] = [
  {
    name: 'Film Grain (Subtle)',
    description: 'Classic film grain effect',
    config: {
      type: 'grain',
      opacity: 1.0,
      scale: 1.0,
      intensity: 0.3,
      blendMode: 'overlay',
      animateTexture: false,
      animationSpeed: 1.0,
    },
  },
  {
    name: 'Film Grain (Heavy)',
    description: 'Strong grainy texture',
    config: {
      type: 'grain',
      opacity: 1.0,
      scale: 1.2,
      intensity: 0.7,
      blendMode: 'overlay',
      animateTexture: true,
      animationSpeed: 20,
      textureAnimationType: 'breathing',
    },
  },
  {
    name: 'Frosted Glass',
    description: 'Classic frosted glass effect',
    config: {
      type: 'frostedGlass',
      opacity: 1.0,
      scale: 1.0,
      intensity: 0.6,
      blendMode: 'normal',
      blur: 0.4,
      distortion: 0.2,
      animateTexture: false,
      animationSpeed: 1.0,
    },
  },
  {
    name: 'Reeded Glass (Vertical)',
    description: 'Vertical linear glass ridges',
    config: {
      type: 'linearGlass',
      opacity: 1.0,
      scale: 1.5,
      intensity: 0.5,
      blendMode: 'normal',
      blur: 0.3,
      distortion: 0.1,
      angle: 90,
      animateTexture: false,
      animationSpeed: 1.0,
    },
  },
  {
    name: 'Reeded Glass (Horizontal)',
    description: 'Horizontal linear glass ridges',
    config: {
      type: 'linearGlass',
      opacity: 1.0,
      scale: 1.5,
      intensity: 0.5,
      blendMode: 'normal',
      blur: 0.3,
      distortion: 0.1,
      angle: 0,
      animateTexture: false,
      animationSpeed: 1.0,
    },
  },
  {
    name: 'Privacy Glass',
    description: 'Grid-based block glass',
    config: {
      type: 'blockGlass',
      opacity: 1.0,
      scale: 1.0,
      intensity: 0.55,
      blendMode: 'normal',
      blur: 0.35,
      distortion: 0.25,
      gridSize: 12,
      animateTexture: false,
      animationSpeed: 1.0,
    },
  },
  {
    name: 'Prismatic Rainbow',
    description: 'Chromatic aberration with stronger spiral motion',
    config: {
      type: 'fractalGlass',
      opacity: 1.0,
      scale: 1.2,
      intensity: 0.6,
      blendMode: 'normal',
      blur: 0.5,
      distortion: 0.4,
      complexity: 5,
      chromaticShift: 8,
      animateTexture: true,
      animationSpeed: 42,
      textureAnimationType: 'vortex',
    },
  },
  {
    name: 'Organic Flow',
    description: 'Living organic texture',
    config: {
      type: 'organic',
      opacity: 1.0,
      scale: 1.0,
      intensity: 0.6,
      blendMode: 'soft-light',
      animateTexture: true,
      animationSpeed: 42,
      textureAnimationType: 'fluid',
    },
  },
  {
    name: 'Camo Pattern',
    description: 'Military camouflage shadows',
    config: {
      type: 'camoShadows',
      opacity: 1.0,
      scale: 1.5,
      intensity: 0.7,
      blendMode: 'multiply',
      animateTexture: true,
      animationSpeed: 24,
      textureAnimationType: 'tectonic',
    },
  },
  {
    name: 'Halftone Print',
    description: 'Dot pattern printing effect',
    config: {
      type: 'dots',
      opacity: 1.0,
      scale: 2.0,
      intensity: 0.6,
      blendMode: 'multiply',
      animateTexture: false,
      animationSpeed: 50,
      textureAnimationType: 'drift',
    },
  },
  {
    name: 'Wavy Signal',
    description: 'Animated wave interference',
    config: {
      type: 'waveSignal',
      opacity: 1.0,
      scale: 1.3,
      intensity: 0.5,
      blendMode: 'normal',
      blur: 0.4,
      distortion: 0.3,
      angle: 45,
      animateTexture: true,
      animationSpeed: 38,
      textureAnimationType: 'shear',
    },
  },
  {
    name: 'Heat Distortion',
    description: 'Melting heat wave effect',
    config: {
      type: 'heatMelt',
      opacity: 1.0,
      scale: 1.0,
      intensity: 0.65,
      blendMode: 'normal',
      blur: 0.6,
      distortion: 0.5,
      animateTexture: true,
      animationSpeed: 36,
      textureAnimationType: 'fluid',
    },
  },
  {
    name: 'Topographic Map',
    description: 'Elevation contour lines',
    config: {
      type: 'topography',
      opacity: 1.0,
      scale: 1.0,
      intensity: 0.65,
      blendMode: 'multiply',
      blur: 0.5, // Bevel depth (reduced from 0.6 since we made it 2x stronger)
      distortion: 0.15, // Terrain warping
      gridSize: 50, // Elevation shift (0-100, 50 = neutral)
      complexity: 4, // Terrain detail (octaves)
      chromaticShift: 4, // Color tinting (reduced from 8 since we made it 3x stronger)
      animateTexture: true,
      animationSpeed: 26,
      textureAnimationType: 'fluid'
    },
  },
  {
    name: 'Energy Plasma',
    description: 'Vibrant plasma field with stronger rotational sweep',
    config: {
      type: 'plasma',
      opacity: 1.0,
      scale: 1.0,
      intensity: 0.65,
      blendMode: 'screen',
      turbulence: 30, // 0-100, smoothness to chaos
      waveCount: 5, // 1-10, number of overlapping waves
      colorIntensity: 70, // 0-100, gradient color sampling strength
      animateTexture: true,
      animationSpeed: 46,
      textureAnimationType: 'vortex',
    },
  },
];

export const TextureControls = memo(function TextureControls({ texture, onChange }: TextureControlsProps) {
  const [enabled, setEnabled] = useState(!!texture);
  
  // Default texture configuration
  const defaultTexture: TextureConfig = {
    type: 'grain' as const,
    opacity: 1.0,
    scale: 1,
    intensity: 0.5,
    blendMode: 'normal' as const,
    animateTexture: false,
    textureAnimationType: 'drift' as const,
    animationSpeed: 15,
  };
  
  // Maintain texture config in local state so it persists when disabled
  const [localTexture, setLocalTexture] = useState<TextureConfig>(texture || defaultTexture);

  // Track whether update is from user interaction (not from props)
  const isUserUpdateRef = useRef(false);

  // Always drive the UI from local state so sliders/toggles stay responsive
  // even while parent updates are catching up. Sync from props separately below.
  const currentTexture = localTexture;

  // PERFORMANCE FIX: Local state for sliders - commit on release only
  const [localOpacity, setLocalOpacity] = useState(currentTexture.opacity);
  const [localScale, setLocalScale] = useState(currentTexture.scale);
  const [localIntensity, setLocalIntensity] = useState(currentTexture.intensity);
  const [localBlur, setLocalBlur] = useState(currentTexture.blur ?? 0.5);
  const [localDistortion, setLocalDistortion] = useState(currentTexture.distortion ?? 0.5);
  const [localAngle, setLocalAngle] = useState(currentTexture.angle ?? 90);
  const [localGridSize, setLocalGridSize] = useState(currentTexture.gridSize ?? 10);
  const [localComplexity, setLocalComplexity] = useState(currentTexture.complexity ?? 4);
  const [localChromaticShift, setLocalChromaticShift] = useState(currentTexture.chromaticShift ?? 5);
  const [localTurbulence, setLocalTurbulence] = useState(currentTexture.turbulence ?? 20);
  const [localWaveCount, setLocalWaveCount] = useState(currentTexture.waveCount ?? 5);
  const [localColorIntensity, setLocalColorIntensity] = useState(currentTexture.colorIntensity ?? 15);
  const [localLineThickness, setLocalLineThickness] = useState(currentTexture.lineThickness ?? 50);
  const [localAnimationSpeed, setLocalAnimationSpeed] = useState(currentTexture.animationSpeed ?? 15);
  const selectedPatternShape = getShapeById(currentTexture.shapePatternId || 'circle');
  const [shapePatternCategory, setShapePatternCategory] = useState<MaskShapeCategory>(selectedPatternShape?.category || 'core');

  // Sync local texture when parent pushes an external update (preset, restore, etc.)
  useEffect(() => {
    if (texture) {
      isUserUpdateRef.current = false; // Mark as coming from props
      setLocalTexture(texture);
    }
  }, [texture]);

  // Sync local state when texture changes
  useEffect(() => {
    setLocalOpacity(currentTexture.opacity);
  }, [currentTexture.opacity]);

  useEffect(() => {
    setLocalScale(currentTexture.scale);
  }, [currentTexture.scale]);

  useEffect(() => {
    setLocalIntensity(currentTexture.intensity);
  }, [currentTexture.intensity]);

  useEffect(() => {
    setLocalBlur(currentTexture.blur ?? 0.5);
  }, [currentTexture.blur]);

  useEffect(() => {
    setLocalDistortion(currentTexture.distortion ?? 0.5);
  }, [currentTexture.distortion]);

  useEffect(() => {
    setLocalAngle(currentTexture.angle ?? 90);
  }, [currentTexture.angle]);

  useEffect(() => {
    setLocalGridSize(currentTexture.gridSize ?? 10);
  }, [currentTexture.gridSize]);

  useEffect(() => {
    setLocalComplexity(currentTexture.complexity ?? 4);
  }, [currentTexture.complexity]);

  useEffect(() => {
    setLocalChromaticShift(currentTexture.chromaticShift ?? 5);
  }, [currentTexture.chromaticShift]);

  useEffect(() => {
    setLocalTurbulence(currentTexture.turbulence ?? 20);
  }, [currentTexture.turbulence]);

  useEffect(() => {
    setLocalWaveCount(currentTexture.waveCount ?? 5);
  }, [currentTexture.waveCount]);

  useEffect(() => {
    setLocalColorIntensity(currentTexture.colorIntensity ?? 15);
  }, [currentTexture.colorIntensity]);

  useEffect(() => {
    setLocalLineThickness(currentTexture.lineThickness ?? 50);
  }, [currentTexture.lineThickness]);

  useEffect(() => {
    setLocalAnimationSpeed(currentTexture.animationSpeed ?? 15);
  }, [currentTexture.animationSpeed]);

  useEffect(() => {
    const shape = getShapeById(currentTexture.shapePatternId || 'circle');
    if (shape && shape.category !== shapePatternCategory) {
      setShapePatternCategory(shape.category);
    }
  }, [currentTexture.shapePatternId, shapePatternCategory]);

  // M2A.4 Stabilization: Alternate Tile Flip UI was removed.
  // Old autosaves can still contain horizontal/vertical/checker values, which
  // route the shader into the seam-prone mirror path. Normalize those legacy
  // values back to none from the controls layer while keeping the known-good
  // render pipeline untouched.
  useEffect(() => {
    if (currentTexture.type === 'shape-pattern' && currentTexture.patternAlternateFlip && currentTexture.patternAlternateFlip !== 'none') {
      isUserUpdateRef.current = true;
      setLocalTexture(prev => ({ ...prev, patternAlternateFlip: 'none' }));
    }
  }, [currentTexture.type, currentTexture.patternAlternateFlip]);

  const updateTexture = useCallback((updates: Partial<TextureConfig>) => {
    isUserUpdateRef.current = true; // Mark as user update
    setLocalTexture(prev => ({ ...prev, ...updates }));
  }, []);

  // Sync texture state to parent when changed from user interaction
  useEffect(() => {
    if (isUserUpdateRef.current) {
      if (enabled) {
        onChange(localTexture);
      } else {
        onChange(undefined);
      }
      isUserUpdateRef.current = false; // Reset flag after sync
    }
  }, [localTexture, enabled, onChange]);

  const commitTexture = useCallback((updates: Partial<TextureConfig>) => {
    updateTexture(updates);
  }, [updateTexture]);

  const handleEnableToggle = (value: boolean) => {
    isUserUpdateRef.current = true; // Mark as user update
    setEnabled(value);
    // onChange will be called by useEffect to avoid setState during render
  };

  const textureTypes: { value: TextureConfig['type']; label: string; description: string; category: string }[] = [
    { value: 'grain', label: 'Grain', description: 'Film grain', category: 'Patterns' },
    { value: 'dots', label: 'Dots', description: 'Halftone pattern', category: 'Patterns' },
    { value: 'lines', label: 'Lines', description: 'Line hatching', category: 'Patterns' },
    { value: 'organic', label: 'Organic', description: 'Natural flow', category: 'Patterns' },
    { value: 'camoShadows', label: 'Camo Shadows', description: 'Shadow pattern', category: 'Patterns' },
    { value: 'waveSignal', label: 'Wave Signal', description: 'Wave pattern', category: 'Patterns' },
    { value: 'topography', label: 'Topography', description: 'Contour mapping', category: 'Patterns' },
    { value: 'plasma', label: 'Plasma', description: 'Energy field', category: 'Patterns' },
    { value: 'shape-pattern', label: 'Shape Pattern', description: 'Tiled shapes', category: 'Patterns' },
    { value: 'spackle', label: 'Spackle', description: 'Graffiti spray paint', category: 'Patterns' },
    { value: 'grunge', label: 'Grunge', description: 'Weathered & distressed', category: 'Patterns' },
    { value: 'linearGlass', label: 'Linear Glass', description: 'Reeded glass', category: 'Glass' },
    { value: 'frostedGlass', label: 'Frosted Glass', description: 'Cellular glass', category: 'Glass' },
    { value: 'blockGlass', label: 'Block Glass', description: 'Privacy glass', category: 'Glass' },
    { value: 'fractalGlass', label: 'Fractal Glass', description: 'Prismatic', category: 'Glass' },
    { value: 'heatMelt', label: 'HeatMelt', description: 'Organic melt', category: 'Glass' },
  ];

  const blendModes: { value: BlendMode; label: string }[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'multiply', label: 'Multiply' },
    { value: 'screen', label: 'Screen' },
    { value: 'overlay', label: 'Overlay' },
    { value: 'soft-light', label: 'Soft Light' },
    { value: 'hard-light', label: 'Hard Light' },
  ];

  return (
    <div className="space-y-6 px-[0px] py-[16px]">
      {/* Enable Texture */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label>Enable Texture</Label>
          <p className="text-xs text-zinc-500">Add texture overlay</p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleEnableToggle}
        />
      </div>

      {/* Texture Type - Always Visible */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-zinc-400">Texture Type</Label>
          <button
            onClick={() => {
              // Reset the current texture type to its default values
              const defaults = getTextureDefaults(currentTexture.type);
              updateTexture({ ...defaults, type: currentTexture.type });
            }}
            className="text-xs text-[#51A2FF] hover:text-[#6BB3FF] cursor-pointer transition-colors"
          >
            Reset
          </button>
        </div>
        <select
          value={currentTexture.type}
          onChange={(e) => {
            const newType = e.target.value as TextureConfig['type'];
            const baseUpdate: Partial<TextureConfig> = { type: newType, opacity: 1.0 };
            
            // Initialize type-specific properties with defaults
            if (newType === 'plasma') {
              Object.assign(baseUpdate, {
                turbulence: 20, // Reduced for cleaner look
                waveCount: 5,
                colorIntensity: 15, // Subtle color effect
                blur: 0.3,
                scale: 5.3, // Balanced zoom level
                intensity: 1.0, // CRITICAL FIX: Required for shader visibility
              });
            } else if (newType === 'organic') {
              Object.assign(baseUpdate, {
                scale: 2.5,
                intensity: 0.6, // Keep existing default
              });
            } else if (newType === 'dots') {
              Object.assign(baseUpdate, {
                scale: 2.5,
                intensity: 0.5,
              });
            } else if (newType === 'lines') {
              Object.assign(baseUpdate, {
                scale: 2.5,
                intensity: 0.5,
                angle: 0,
              });
            } else if (newType === 'camoShadows') {
              Object.assign(baseUpdate, {
                scale: 2.5,
                intensity: 0.5,
                angle: 0,
              });
            } else if (newType === 'waveSignal') {
              Object.assign(baseUpdate, {
                scale: 2.65,
                angle: 30,
                blur: 0.4,
                distortion: 0.3,
              });
            } else if (newType === 'heatMelt') {
              Object.assign(baseUpdate, {
                scale: 9.0,
                distortion: 0.25,
                blur: 0.6,
              });
            } else if (newType === 'shape-pattern') {
              // Always reset to 1.0x scale — prevents inheriting the previous
              // texture type's scale (e.g. heatMelt at 9.0x would look broken).
              Object.assign(baseUpdate, {
                scale: 1.0,
                intensity: 0.5,
                shapePatternId: 'circle',
              });
            } else if (newType === 'topography') {
              Object.assign(baseUpdate, {
                scale: 2.0,
                intensity: 1.0,
                lineThickness: 40,
                distortion: 0.3,
              });
            }
            
            updateTexture(baseUpdate);
          }}
          className="w-full h-9 pr-10 pl-3 py-2 text-sm bg-[#262626] border border-zinc-700 rounded-md text-zinc-100 hover:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-colors"
        >
          {textureTypes.map(type => (
            <option key={type.value} value={type.value}>
              {type.label} - {type.description}
            </option>
          ))}
        </select>
      </div>

      
          {/* Opacity */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Opacity</Label>
              <span className="text-sm text-zinc-400">{Math.round(localOpacity * 100)}%</span>
            </div>
            <Slider
              value={[localOpacity * 100]}
              onValueChange={([value]) => { setLocalOpacity(value / 100); }}
              onValueCommit={([value]) => commitTexture({ opacity: value / 100 })}
              min={0}
              max={100}
              step={1}
            />
          </div>

          {/* Scale */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Scale</Label>
              <span className="text-sm text-zinc-400">{localScale.toFixed(2)}x</span>
            </div>
            <Slider
              value={[localScale * 100]}
              onValueChange={([value]) => { setLocalScale(value / 100); }}
              onValueCommit={([value]) => commitTexture({ scale: value / 100 })}
              min={currentTexture.type === 'lines' ? 1 : (currentTexture.type === 'heatMelt' || currentTexture.type === 'frostedGlass' ? 1 : (currentTexture.type === 'plasma' ? 5 : 10))}
              max={currentTexture.type === 'heatMelt' || currentTexture.type === 'frostedGlass' ? 2000 : (currentTexture.type === 'plasma' ? 1000 : 500)}
              step={1}
            />
            <div className="flex justify-between text-xs text-zinc-500">
              <span>
                {currentTexture.type === 'lines' 
                  ? 'Thick Lines' 
                  : currentTexture.type === 'linearGlass'
                  ? 'Thick'
                  : currentTexture.type === 'heatMelt' || currentTexture.type === 'frostedGlass'
                  ? 'Microscopic' 
                  : currentTexture.type === 'plasma' 
                  ? 'Zoomed In' 
                  : currentTexture.type === 'topography'
                  ? 'Zoom In'
                  : currentTexture.type === 'organic' || currentTexture.type === 'dots' || currentTexture.type === 'camoShadows' || currentTexture.type === 'waveSignal'
                  ? 'Zoom In'
                  : 'Fine'}
              </span>
              <span>
                {currentTexture.type === 'lines' 
                  ? 'Thin Lines' 
                  : currentTexture.type === 'linearGlass'
                  ? 'Thin'
                  : currentTexture.type === 'heatMelt' || currentTexture.type === 'frostedGlass'
                  ? 'Macroscopic' 
                  : currentTexture.type === 'plasma' 
                  ? 'Zoomed Out' 
                  : currentTexture.type === 'topography'
                  ? 'Zoom Out'
                  : currentTexture.type === 'organic' || currentTexture.type === 'dots' || currentTexture.type === 'camoShadows' || currentTexture.type === 'waveSignal'
                  ? 'Zoom Out'
                  : 'Coarse'}
              </span>
            </div>
          </div>

          {/* Intensity */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{(currentTexture.type === 'linearGlass' || currentTexture.type === 'frostedGlass' || currentTexture.type === 'blockGlass' || currentTexture.type === 'fractalGlass' || currentTexture.type === 'heatMelt') ? 'Bevel Intensity' : 'Intensity'}</Label>
              <span className="text-sm text-zinc-400">{Math.round(localIntensity * 100)}%</span>
            </div>
            <Slider
              value={[localIntensity * 100]}
              onValueChange={([value]) => { setLocalIntensity(value / 100); }}
              onValueCommit={([value]) => commitTexture({ intensity: value / 100 })}
              min={0}
              max={100}
              step={1}
            />
          </div>

          {/* Glass-Specific Controls */}
          {(currentTexture.type === 'linearGlass' || currentTexture.type === 'frostedGlass' || currentTexture.type === 'blockGlass' || currentTexture.type === 'fractalGlass' || currentTexture.type === 'heatMelt') && (
            <>
              {/* Blur Amount (Gaussian blur on bevel edges) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Blur Amount</Label>
                  <span className="text-sm text-zinc-400">{Math.round(localBlur * 100)}%</span>
                </div>
                <Slider
                  value={[localBlur * 100]}
                  onValueChange={([value]) => { setLocalBlur(value / 100); }}
                  onValueCommit={([value]) => commitTexture({ blur: value / 100 })}
                  min={0}
                  max={100}
                  step={1}
                />
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Sharp</span>
                  <span>Soft</span>
                </div>
              </div>

              {/* Distortion (Warps beveled lines and gradient) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Distortion</Label>
                  <span className="text-sm text-zinc-400">{Math.round(localDistortion * 100)}%</span>
                </div>
                <Slider
                  value={[localDistortion * 100]}
                  onValueChange={([value]) => { setLocalDistortion(value / 100); }}
                  onValueCommit={([value]) => commitTexture({ distortion: value / 100 })}
                  min={0}
                  max={100}
                  step={1}
                />
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>None</span>
                  <span>Extreme</span>
                </div>
              </div>
            </>
          )}

          {/* Linear Glass Angle Control */}
          {currentTexture.type === 'linearGlass' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Angle</Label>
                <span className="text-sm text-zinc-400">{Math.round(localAngle || 90)}°</span>
              </div>
              <Slider
                value={[localAngle || 90]}
                onValueChange={([value]) => { setLocalAngle(value); }}
                onValueCommit={([value]) => commitTexture({ angle: value })}
                min={0}
                max={360}
                step={1}
              />
            </div>
          )}

          {/* Lines Texture Angle Control */}
          {currentTexture.type === 'lines' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Angle</Label>
                <span className="text-sm text-zinc-400">{Math.round(localAngle || 0)}°</span>
              </div>
              <Slider
                value={[localAngle || 0]}
                onValueChange={([value]) => { setLocalAngle(value); }}
                onValueCommit={([value]) => commitTexture({ angle: value })}
                min={0}
                max={360}
                step={1}
              />
            </div>
          )}

          {/* Camo Shadows Angle Control */}
          {currentTexture.type === 'camoShadows' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Angle</Label>
                <span className="text-sm text-zinc-400">{Math.round(localAngle || 0)}°</span>
              </div>
              <Slider
                value={[localAngle || 0]}
                onValueChange={([value]) => { setLocalAngle(value); }}
                onValueCommit={([value]) => commitTexture({ angle: value })}
                min={0}
                max={360}
                step={1}
              />
            </div>
          )}

          {/* Wave Signal Controls (angle, blur, distortion) */}
          {currentTexture.type === 'waveSignal' && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Angle</Label>
                  <span className="text-sm text-zinc-400">{Math.round(localAngle ?? 90)}°</span>
                </div>
                <Slider
                  value={[localAngle ?? 90]}
                  onValueChange={([value]) => { setLocalAngle(value); }}
                onValueCommit={([value]) => commitTexture({ angle: value })}
                  min={0}
                  max={360}
                  step={1}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Blur Amount</Label>
                  <span className="text-sm text-zinc-400">{Math.round(localBlur * 100)}%</span>
                </div>
                <Slider
                  value={[localBlur * 100]}
                  onValueChange={([value]) => { setLocalBlur(value / 100); }}
                  onValueCommit={([value]) => commitTexture({ blur: value / 100 })}
                  min={0}
                  max={100}
                  step={1}
                />
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Sharp</span>
                  <span>Soft</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Distortion</Label>
                  <span className="text-sm text-zinc-400">{Math.round(localDistortion * 100)}%</span>
                </div>
                <Slider
                  value={[localDistortion * 100]}
                  onValueChange={([value]) => { setLocalDistortion(value / 100); }}
                  onValueCommit={([value]) => commitTexture({ distortion: value / 100 })}
                  min={0}
                  max={100}
                  step={1}
                />
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>None</span>
                  <span>Extreme</span>
                </div>
              </div>
            </>
          )}

          {/* Block Glass Grid Size */}
          {currentTexture.type === 'blockGlass' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Grid Size</Label>
                <span className="text-sm text-zinc-400">{Math.round(localGridSize || 10)} cells</span>
              </div>
              <Slider
                value={[localGridSize || 10]}
                onValueChange={([value]) => { setLocalGridSize(value); }}
                onValueCommit={([value]) => commitTexture({ gridSize: value })}
                min={2}
                max={50}
                step={1}
              />
            </div>
          )}

          {/* Fractal Glass Complexity & Chromatic Shift */}
          {currentTexture.type === 'fractalGlass' && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Complexity</Label>
                  <span className="text-sm text-zinc-400">{Math.round(localComplexity || 4)} octaves</span>
                </div>
                <Slider
                  value={[localComplexity || 4]}
                  onValueChange={([value]) => { setLocalComplexity(value); }}
                  onValueCommit={([value]) => commitTexture({ complexity: value })}
                  min={1}
                  max={8}
                  step={1}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Chromatic Shift</Label>
                  <span className="text-sm text-zinc-400">{(localChromaticShift || 5).toFixed(1)}px</span>
                </div>
                <Slider
                  value={[localChromaticShift || 5]}
                  onValueChange={([value]) => { setLocalChromaticShift(value); }}
                  onValueCommit={([value]) => commitTexture({ chromaticShift: value })}
                  min={0}
                  max={20}
                  step={0.5}
                />
              </div>
            </>
          )}

          {/* Topography (Contour Mapping) Controls */}
          {currentTexture.type === 'topography' && (
            <>
              {/* Line Thickness */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Line Thickness</Label>
                  <span className="text-sm text-zinc-400">{Math.round(localLineThickness)}%</span>
                </div>
                <Slider
                  value={[localLineThickness]}
                  onValueChange={([value]) => { setLocalLineThickness(value); }}
                  onValueCommit={([value]) => commitTexture({ lineThickness: value })}
                  min={0}
                  max={100}
                  step={1}
                />
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Thin</span>
                  <span>Thick</span>
                </div>
              </div>


              {/* Complexity (terrain detail) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Terrain Detail</Label>
                  <span className="text-sm text-zinc-400">{Math.round(localComplexity || 4)}</span>
                </div>
                <Slider
                  value={[localComplexity || 4]}
                  onValueChange={([value]) => { setLocalComplexity(value); }}
                  onValueCommit={([value]) => commitTexture({ complexity: value })}
                  min={1}
                  max={8}
                  step={1}
                />
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Smooth</span>
                  <span>Detailed</span>
                </div>
              </div>

              {/* Color Tinting */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Color Tinting</Label>
                  <span className="text-sm text-zinc-400">{Math.round((localChromaticShift || 0) / 20 * 100)}%</span>
                </div>
                <Slider
                  value={[localChromaticShift || 0]}
                  onValueChange={([value]) => { setLocalChromaticShift(value); }}
                  onValueCommit={([value]) => commitTexture({ chromaticShift: value })}
                  min={0}
                  max={20}
                  step={0.5}
                />
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Black Lines</span>
                  <span>Gradient Colors</span>
                </div>
              </div>

              {/* Distortion (bending contours) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Distortion</Label>
                  <span className="text-sm text-zinc-400">{Math.round(localDistortion * 100)}%</span>
                </div>
                <Slider
                  value={[localDistortion * 100]}
                  onValueChange={([value]) => { setLocalDistortion(value / 100); }}
                  onValueCommit={([value]) => commitTexture({ distortion: value / 100 })}
                  min={0}
                  max={100}
                  step={1}
                />
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Straight</span>
                  <span>Organic</span>
                </div>
              </div>
            </>
          )}

          {/* Plasma Texture Controls */}
          {currentTexture.type === 'plasma' && (
            <>
              {/* Turbulence */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Turbulence</Label>
                  <span className="text-sm text-zinc-400">{Math.round(localTurbulence || 50)}%</span>
                </div>
                <Slider
                  value={[localTurbulence || 50]}
                  onValueChange={([value]) => { setLocalTurbulence(value); }}
                  onValueCommit={([value]) => commitTexture({ turbulence: value })}
                  min={0}
                  max={100}
                  step={1}
                />
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Smooth</span>
                  <span>Chaotic</span>
                </div>
              </div>

              {/* Wave Count */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Wave Count</Label>
                  <span className="text-sm text-zinc-400">{Math.round(localWaveCount || 5)} waves</span>
                </div>
                <Slider
                  value={[localWaveCount || 5]}
                  onValueChange={([value]) => { setLocalWaveCount(value); }}
                  onValueCommit={([value]) => commitTexture({ waveCount: value })}
                  min={1}
                  max={10}
                  step={1}
                />
              </div>

              {/* Color Intensity */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Color Intensity</Label>
                  <span className="text-sm text-zinc-400">{Math.round(localColorIntensity || 70)}%</span>
                </div>
                <Slider
                  value={[localColorIntensity || 70]}
                  onValueChange={([value]) => { setLocalColorIntensity(value); }}
                  onValueCommit={([value]) => commitTexture({ colorIntensity: value })}
                  min={0}
                  max={100}
                  step={1}
                />
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Monochrome</span>
                  <span>Vibrant</span>
                </div>
              </div>
            </>
          )}

          {/* Shape Pattern Controls */}
          {currentTexture.type === 'shape-pattern' && (
            <>
              {/* Shape Category */}
              <div className="space-y-2">
                <Label>Shape Category</Label>
                <SelectWrapper
                  value={shapePatternCategory}
                  onValueChange={(value) => {
                    const category = value as MaskShapeCategory;
                    const firstShape = getShapesByCategory(category)[0];
                    setShapePatternCategory(category);
                    if (firstShape) {
                      updateTexture({ shapePatternId: firstShape.id });
                    }
                  }}
                  options={MASK_SHAPE_CATEGORY_ORDER
                    .filter(category => getShapesByCategory(category).length > 0)
                    .map(category => ({
                      value: category,
                      label: `${MASK_SHAPE_CATEGORY_LABELS[category]} (${getShapesByCategory(category).length})`,
                    }))}
                  triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
                  contentClassName="bg-zinc-900 border-zinc-700"
                />
              </div>

              {/* Shape Selection */}
              <div className="space-y-2">
                <Label>Shape</Label>
                <SelectWrapper
                  value={currentTexture.shapePatternId || getShapesByCategory(shapePatternCategory)[0]?.id || 'circle'}
                  onValueChange={(value) => updateTexture({ shapePatternId: value })}
                  options={(getShapesByCategory(shapePatternCategory).length > 0
                    ? getShapesByCategory(shapePatternCategory)
                    : MASK_SHAPE_PRESETS
                  ).map(shape => ({
                    value: shape.id,
                    label: `${shape.name}${shape.renderMode === 'wireframe' ? ' · Outline' : ''}`,
                  }))}
                  triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
                  contentClassName="bg-zinc-900 border-zinc-700"
                />
                <p className="text-[10px] text-zinc-500">
                  Shape Pattern now uses the same category system as mask shapes for faster glyph selection.
                </p>
              </div>

              {/* Fill Mode */}
              <div className="space-y-2">
                <Label>Fill Mode</Label>
                <SelectWrapper
                  value={currentTexture.patternFillMode || 'fill'}
                  onValueChange={(value) => updateTexture({ patternFillMode: value as 'fill' | 'wireframe' })}
                  options={[
                    { value: 'fill', label: 'Filled' },
                    { value: 'wireframe', label: 'Wireframe (Outline)' },
                  ]}
                  triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
                  contentClassName="bg-zinc-900 border-zinc-700"
                />
              </div>

              {/* Spacing */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Spacing</Label>
                  <span className="text-sm text-zinc-400">{currentTexture.patternSpacing ?? 0}%</span>
                </div>
                <Slider
                  value={[currentTexture.patternSpacing ?? 0]}
                  onValueChange={([value]) => updateTexture({ patternSpacing: value })}
                  min={0}
                  max={100}
                  step={1}
                />
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>No Gap</span>
                  <span>Wide Gap</span>
                </div>
              </div>

              {/* Offset X */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Offset X</Label>
                  <span className="text-sm text-zinc-400">{currentTexture.patternOffsetX || 0}%</span>
                </div>
                <Slider
                  value={[currentTexture.patternOffsetX || 0]}
                  onValueChange={([value]) => updateTexture({ patternOffsetX: value })}
                  min={-50}
                  max={50}
                  step={1}
                />
              </div>

              {/* Offset Y */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Offset Y</Label>
                  <span className="text-sm text-zinc-400">{currentTexture.patternOffsetY || 0}%</span>
                </div>
                <Slider
                  value={[currentTexture.patternOffsetY || 0]}
                  onValueChange={([value]) => updateTexture({ patternOffsetY: value })}
                  min={-50}
                  max={50}
                  step={1}
                />
              </div>

              {/* Rotation */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Tile Rotation</Label>
                  <span className="text-sm text-zinc-400">{currentTexture.patternRotation || 0}°</span>
                </div>
                <Slider
                  value={[currentTexture.patternRotation || 0]}
                  onValueChange={([value]) => updateTexture({ patternRotation: value })}
                  min={0}
                  max={360}
                  step={1}
                />
              </div>

              {/* Density */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Pattern Density</Label>
                  <span className="text-sm text-zinc-400">{currentTexture.patternDensity ?? 50}%</span>
                </div>
                <Slider
                  value={[currentTexture.patternDensity ?? 50]}
                  onValueChange={([value]) => updateTexture({ patternDensity: value })}
                  min={0}
                  max={100}
                  step={1}
                />
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Open</span>
                  <span>Dense</span>
                </div>
              </div>

              {/* Random Rotation */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Random Rotation</Label>
                  <span className="text-sm text-zinc-400">{currentTexture.patternRandomRotation ?? 0}%</span>
                </div>
                <Slider
                  value={[currentTexture.patternRandomRotation ?? 0]}
                  onValueChange={([value]) => updateTexture({ patternRandomRotation: value })}
                  min={0}
                  max={100}
                  step={1}
                />
              </div>


              {/* Staggered Rows */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Staggered Rows</Label>
                  <span className="text-sm text-zinc-400">{currentTexture.patternStaggerRows ?? 0}%</span>
                </div>
                <Slider
                  value={[currentTexture.patternStaggerRows ?? 0]}
                  onValueChange={([value]) => updateTexture({ patternStaggerRows: value })}
                  min={0}
                  max={100}
                  step={1}
                />
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Grid</span>
                  <span>Half-step</span>
                </div>
              </div>

              {/* Scale Variance */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Scale Variance</Label>
                  <span className="text-sm text-zinc-400">{currentTexture.patternScaleVariance ?? 0}%</span>
                </div>
                <Slider
                  value={[currentTexture.patternScaleVariance ?? 0]}
                  onValueChange={([value]) => updateTexture({ patternScaleVariance: value })}
                  min={0}
                  max={100}
                  step={1}
                />
              </div>

              {/* Outline Thickness */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Outline Thickness</Label>
                  <span className="text-sm text-zinc-400">{currentTexture.patternOutlineThickness ?? 3}px</span>
                </div>
                <Slider
                  value={[currentTexture.patternOutlineThickness ?? 3]}
                  onValueChange={([value]) => updateTexture({ patternOutlineThickness: value })}
                  min={1}
                  max={20}
                  step={1}
                />
              </div>

              {/* Opacity Curve */}
              <div className="space-y-2">
                <Label>Pattern Opacity Curve</Label>
                <SelectWrapper
                  value={currentTexture.patternOpacityCurveMode || 'flat'}
                  onValueChange={(value) => updateTexture({
                    patternOpacityCurveMode: value as 'flat' | 'center' | 'edge',
                    patternOpacityCurve: currentTexture.patternOpacityCurve ?? 50,
                  })}
                  options={[
                    { value: 'flat', label: 'Flat / Even' },
                    { value: 'center', label: 'Center Emphasis' },
                    { value: 'edge', label: 'Edge Emphasis' },
                  ]}
                  triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
                  contentClassName="bg-zinc-900 border-zinc-700"
                />
                <div className="flex items-center justify-between">
                  <Label>Curve Strength</Label>
                  <span className="text-sm text-zinc-400">{currentTexture.patternOpacityCurve ?? 50}%</span>
                </div>
                <Slider
                  value={[currentTexture.patternOpacityCurve ?? 50]}
                  onValueChange={([value]) => updateTexture({ patternOpacityCurve: value })}
                  min={0}
                  max={100}
                  step={1}
                />
              </div>
            </>
          )}

          {/* Spackle (Graffiti Spray Paint) Controls */}
          {currentTexture.type === 'spackle' && (
            <>
              {/* Randomize */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Randomize</Label>
                  <span className="text-sm text-zinc-400">{Math.round(localTurbulence)}%</span>
                </div>
                <Slider
                  value={[localTurbulence]}
                  onValueChange={([value]) => { setLocalTurbulence(value); }}
                  onValueCommit={([value]) => commitTexture({ turbulence: value })}
                  min={0}
                  max={100}
                  step={1}
                />
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Fixed</span>
                  <span>Varied</span>
                </div>
              </div>

              {/* Thickness */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Thickness</Label>
                  <span className="text-sm text-zinc-400">{Math.round(localLineThickness)}%</span>
                </div>
                <Slider
                  value={[localLineThickness]}
                  onValueChange={([value]) => { setLocalLineThickness(value); }}
                  onValueCommit={([value]) => commitTexture({ lineThickness: value })}
                  min={0}
                  max={100}
                  step={1}
                />
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Fine spray</span>
                  <span>Bold blobs</span>
                </div>
              </div>

              {/* Invert Toggle */}
              <div className="flex items-center justify-between py-1">
                <div className="space-y-0.5">
                  <Label>Invert</Label>
                  <p className="text-xs text-zinc-500">Swap dots and background</p>
                </div>
                <Switch
                  checked={currentTexture.invertTexture === true}
                  onCheckedChange={(checked) => updateTexture({ invertTexture: checked })}
                />
              </div>
            </>
          )}

          {/* Grunge Controls */}
          {currentTexture.type === 'grunge' && (
            <>
              {/* Randomize */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Randomize</Label>
                  <span className="text-sm text-zinc-400">{Math.round(localTurbulence)}%</span>
                </div>
                <Slider
                  value={[localTurbulence]}
                  onValueChange={([value]) => { setLocalTurbulence(value); }}
                  onValueCommit={([value]) => commitTexture({ turbulence: value })}
                  min={0}
                  max={100}
                  step={1}
                />
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Fixed pattern</span>
                  <span>Different layout</span>
                </div>
              </div>

              {/* Thickness */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Thickness</Label>
                  <span className="text-sm text-zinc-400">{Math.round(localLineThickness)}%</span>
                </div>
                <Slider
                  value={[localLineThickness]}
                  onValueChange={([value]) => { setLocalLineThickness(value); }}
                  onValueCommit={([value]) => commitTexture({ lineThickness: value })}
                  min={0}
                  max={100}
                  step={1}
                />
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Fine scratches</span>
                  <span>Bold patches</span>
                </div>
              </div>
            </>
          )}

          {/* Animation Controls */}
          <div className="space-y-4 pt-2 border-t border-zinc-800">
            {/* Animate Texture Toggle */}
            <div className="flex items-center justify-between px-[0px] py-[8px]">
              <div className="space-y-1">
                <Label>Animate Texture</Label>
                <p className="text-xs text-zinc-500">Enable texture motion</p>
              </div>
              <Switch
                checked={currentTexture.animateTexture === true}
                onCheckedChange={(value) => updateTexture({ animateTexture: value })}
              />
            </div>

            {/* Animation Type - ALWAYS VISIBLE */}
            <div className="space-y-2">
              <Label className="text-xs text-zinc-400">Animation Type</Label>
              <select
                value={currentTexture.textureAnimationType || 'drift'}
                onChange={(e) => updateTexture({ textureAnimationType: e.target.value as 'spin' | 'warp' | 'pingPong' | 'scale' | 'drift' | 'tectonic' | 'breathing' | 'seismic' | 'shear' | 'vortex' | 'fluid' })}
                className="w-full h-9 pr-10 pl-3 py-2 text-sm bg-[#262626] border border-zinc-700 rounded-md text-zinc-100 hover:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#51A2FF] transition-colors"
              >
                <option value="spin">Spin - Circular rotation</option>
                <option value="warp">Warp - Organic distortion waves</option>
                <option value="pingPong">Ping Pong - Back-and-forth motion</option>
                <option value="scale">Scale - Pulsing zoom</option>
                <option value="drift">Drift - Smooth directional flow</option>
                <option value="tectonic">Tectonic - Plate shifting / structural motion</option>
                <option value="breathing">Breathing - Elevation pulsing</option>
                <option value="seismic">Seismic - Radial wave patterns</option>
                <option value="shear">Shear - Layered directional slippage</option>
                <option value="vortex">Vortex - Rotational field motion</option>
                <option value="fluid">Fluid - Organic water / alive motion</option>
              </select>
            </div>

            {/* Animation Speed - ALWAYS VISIBLE */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Animation Speed</Label>
                <span className="text-sm text-zinc-400">
                  {formatSpeedLabel(mapSliderToSpeed(currentTexture.animationSpeed || 50))}
                </span>
              </div>
              <Slider
                value={[localAnimationSpeed || 50]}
                onValueChange={([value]) => {
                  setLocalAnimationSpeed(value);
                }}
                onValueCommit={([value]) => commitTexture({ animationSpeed: value })}
                min={0}
                max={100}
                step={1}
              />
              <div className="flex justify-between text-xs text-zinc-500">
                <span>0.05x</span>
                <span>2x</span>
              </div>
            </div>
          </div>

          {/* Blend Mode */}
          <div className="space-y-2">
            <Label className="text-xs text-zinc-400">Blend Mode</Label>
            <select
              value={currentTexture.blendMode}
              onChange={(e) => updateTexture({ blendMode: e.target.value as BlendMode })}
              className="w-full h-9 pr-10 pl-3 py-2 text-sm bg-[#262626] border border-zinc-700 rounded-md text-zinc-100 hover:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-colors"
            >
              {blendModes.map(mode => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </div>

          {/* Presets */}
          <div className="space-y-2 pt-2 border-t border-zinc-800">
            <Label className="text-xs px-[0px] py-[8px]" style={{ color: '#51A2FF' }}>Apply Preset</Label>
            <SelectWrapper
              value=""
              onValueChange={(value) => {
                const preset = TEXTURE_PRESETS.find(p => p.name === value);
                if (preset) {
                  setEnabled(true);
                  onChange(preset.config);
                }
              }}
              options={TEXTURE_PRESETS.map(preset => ({
                value: preset.name,
                label: preset.name,
                description: preset.description
              }))}
              placeholder="Select a preset..."
              triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
              contentClassName="bg-zinc-900 border-zinc-700 max-h-[400px]"
            />
            
            {/* Protip */}
            <p className="text-xs text-zinc-500 pt-2">
              💡 Protip: Various types animate differently depending on texture.
            </p>
          </div>
    </div>
  );
})