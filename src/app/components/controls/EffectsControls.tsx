import { useState, useEffect, memo } from 'react';
import { Label } from '../ui/label';
import { Slider } from '../ui/slider';
import { Switch } from '../ui/switch';
import { SelectWrapper } from '../ui/select-wrapper';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../ui/accordion';
import { Button } from '../ui/button';
import { ConditionalTooltip } from '../ui/ConditionalTooltip';
import { Sparkles, Copy, Clipboard } from 'lucide-react';
import { copyEffects, pasteEffects, hasEffectsInClipboard } from '../../utils/effectsClipboard';
import { SpatialChainOrderControl } from './SpatialChainOrderControl';
import { toast } from 'sonner';

// ── Sprint 1.1/1.4: Effects Layering chain ──────────────────────────────
// The set of stages that compose into one running color (+ UV, for the
// spatial ones) through the multi-pass compositor, in user-configurable
// order. Started as just the 7 spatial (UV-remap/filter) effects; Sprint
// 1.4 folded in 5 more pure per-pixel color effects (Vignette, Film Grain,
// Posterize, Halftone, Fresnel) since those never had the composability
// problem the spatial ones did — they already correctly operate on the
// passed-in color — so bringing them into the same multi-pass system was
// just a matter of giving each its own stage file, not a new pattern.
// Color Adjustments (Saturation/Brightness/Contrast/Hue Shift),
// Temperature/Tint, Invert, and Light Flash Effects stay OUT of this
// chain — fixed position, applied after it resolves, per explicit
// direction (they're not meant to be layerable).
export type SpatialStageId =
  | 'mirror'        // Quad Mirror
  | 'displace'       // Noise Displacement
  | 'slice'          // Graphic Slice
  | 'chroma'         // Chromatic Aberration
  | 'blur'           // Blur
  | 'pixelate'       // Pixelate
  | 'shapeOverlay'   // Shape Overlay
  | 'vignette'       // Vignette
  | 'filmGrain'      // Film Grain
  | 'posterize'      // Posterize
  | 'halftone'       // Halftone
  | 'fresnel';       // Fresnel Edge Glow

// Default order: fold → distort → cut, then the pre-existing spatial
// effects in their original execution order, then the 5 newly-layerable
// effects in their original fixed-shader order. Since Mirror/Displace/
// Slice default to disabled, and the other 11 default to whatever they
// already defaulted to, this order produces the same output as before
// for every existing saved project until a user actually drags something.
export const DEFAULT_SPATIAL_CHAIN_ORDER: SpatialStageId[] = [
  'mirror', 'displace', 'slice', 'chroma', 'blur', 'pixelate', 'shapeOverlay',
  'posterize', 'halftone', 'filmGrain', 'vignette', 'fresnel',
];

export interface EffectsConfig {
  // Order of the composable Effects Layering chain (12 stages — see
  // SpatialStageId above). User-reorderable via drag UI. Always length
  // 12, one entry per SpatialStageId, no duplicates — validated at the
  // point of use (falls back to DEFAULT_SPATIAL_CHAIN_ORDER if malformed).
  spatialChainOrder: SpatialStageId[];

  // Quad Mirror — 4-way kaleidoscope fold around an adjustable center.
  quadMirrorEnabled: boolean;
  quadMirrorCenterX: number; // 0–1
  quadMirrorCenterY: number; // 0–1

  // Noise Displacement — smooth animated value-noise UV offset.
  noiseDisplaceEnabled: boolean;
  noiseDisplaceAmount: number; // 0–0.5
  noiseDisplaceScale: number;  // 0.5–8
  noiseDisplaceSpeed: number;  // 0–2

  // Graphic Slice — stepped-clock row-banded horizontal glitch.
  graphicSliceEnabled: boolean;
  graphicSliceBands: number;  // 2–64
  graphicSliceAmount: number; // 0–0.3
  graphicSliceRate: number;   // 0.5–30 Hz

  blur: number;
  chromaticAberration: number;
  vignette: number;
  filmGrain: number;
  filmGrainSize: number;
  saturation: number;
  brightness: number;
  contrast: number;
  hueShift: number;
  temperature: number; // -100 to +100 (warm/cool)
  tint: number; // -100 to +100 (green/magenta)
  invert: boolean;
  posterize: number; // 0-100 amount; 0 = off/no effect
  posterizeEnabled: boolean;
  posterizeDithering: 'none' | 'bayer' | 'noise' | 'blueNoise' | 'scanline' | 'dotDiffusion' | 'crosshatch'; // Dithering mode
  ditherStrength: number; // 0-100 intensity for dithering texture injected before quantization
  ditherScale: number; // 1-100 density / cell scale for dither patterns
  halftone: number; // 0-20 dot size
  halftoneEnabled: boolean;
  halftoneAngle: number; // 0-360 degrees
  shapeOverlay: number; // 0-200 shape-based overlay (RENAMED from halftone2)
  shapeOverlayEnabled: boolean;
  pixelate: number; // 0-200 pixel size
  pixelateEnabled: boolean;
  creativeShape: 'square' | 'circle' | 'hexagon' | 'diamond' | 'triangle' | 'lines'; // Shared shape for halftone & shape overlay
  // NEW PHASE 1: Fresnel Effect
  fresnelEnabled: boolean;
  fresnelPower: number;
  fresnelIntensity: number;
  // Light Flash Effects
  flashEnabled: boolean;
  flashType: 'quick' | 'color' | 'hueRotate' | 'dark';
  flashMode: 'stutter' | 'oscillate' | 'pulse' | 'beatDrop' | 'breathe' | 'sawtooth';
  flashSpeed: number;
  flashIntensity: number;
  flashPosition: 'full' | 'topbottom' | 'sides' | 'corners' | 'cornersAlt' | 'opposite' | 'centerBurst';
  flashEasing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
  flashAfterGlow: number;        // 0–1: exponential decay tail after each flash peak
  flashSyncAnimation: boolean;   // sync flash beat to active layer's animation cycle
}

interface EffectsControlsProps {
  effects: EffectsConfig;
  onChange: (effects: EffectsConfig) => void;
  onStartDrag?: () => void;  // NEW: Signal drag start
  onEndDrag?: () => void;    // NEW: Signal drag end
  onCommitHistory?: () => void; // 🔥 COMMIT-BASED HISTORY
}

export const defaultEffects: EffectsConfig = {
  // Sprint 1.1: Spatial FX chain — all three new effects ship OFF by
  // default with the default chain order, so existing projects are
  // visually unaffected until a user explicitly enables one.
  spatialChainOrder: DEFAULT_SPATIAL_CHAIN_ORDER,
  quadMirrorEnabled: false,
  quadMirrorCenterX: 0.5,
  quadMirrorCenterY: 0.5,
  noiseDisplaceEnabled: false,
  noiseDisplaceAmount: 0.1,
  noiseDisplaceScale: 2,
  noiseDisplaceSpeed: 0.5,
  graphicSliceEnabled: false,
  graphicSliceBands: 16,
  graphicSliceAmount: 0.08,
  graphicSliceRate: 8,

  blur: 0,
  chromaticAberration: 0,
  vignette: 0,
  filmGrain: 0,
  filmGrainSize: 1,
  saturation: 1,
  brightness: 1,
  contrast: 1,
  hueShift: 0,
  temperature: 0,
  tint: 0,
  invert: false,
  posterize: 0,
  posterizeEnabled: false,
  posterizeDithering: 'none',
  ditherStrength: 65,
  ditherScale: 50,
  halftone: 0,
  halftoneEnabled: false,
  halftoneAngle: 0,
  shapeOverlay: 0,
  shapeOverlayEnabled: false,
  pixelate: 0,
  pixelateEnabled: false,
  creativeShape: 'square',
  // NEW PHASE 1: Fresnel Effect
  fresnelEnabled: false,
  fresnelPower: 2,
  fresnelIntensity: 0.5,
  flashEnabled: false,
  flashType: 'quick',
  flashMode: 'stutter',
  flashSpeed: 2,
  flashIntensity: 0.7,
  flashPosition: 'full',
  flashEasing: 'easeOut',
  flashAfterGlow: 0,
  flashSyncAnimation: false,
};

// Also export as DEFAULT_EFFECTS for backwards compatibility
export const DEFAULT_EFFECTS = defaultEffects;

// EFFECT PRESETS - Quick apply popular effect combinations
const EFFECT_PRESETS: { name: string; effects: EffectsConfig; description: string }[] = [
  {
    name: 'Vintage Film',
    description: 'Classic analog film',
    effects: {
      ...defaultEffects,
      filmGrain: 0.3,
      filmGrainSize: 1.2,
      saturation: 0.85,
      temperature: 15,
      tint: -5,
      vignette: 0.3,
    },
  },
  {
    name: 'Cyberpunk',
    description: 'Futuristic neon',
    effects: {
      ...defaultEffects,
      chromaticAberration: 0.2,
      filmGrain: 0.15,
      saturation: 1.3,
      temperature: -10,
      tint: 15,
    },
  },
  {
    name: 'Cinematic',
    description: 'Movie-like grade',
    effects: {
      ...defaultEffects,
      vignette: 0.4,
      contrast: 1.2,
      saturation: 0.9,
      temperature: 8,
      filmGrain: 0.1,
    },
  },
  {
    name: 'Print Halftone',
    description: 'Vintage newspaper',
    effects: {
      ...defaultEffects,
      halftoneEnabled: true,
      halftone: 8,
      halftoneAngle: 45,
      saturation: 0.7,
      contrast: 1.3,
    },
  },
  {
    name: 'Pixelated',
    description: 'Retro pixel art',
    effects: {
      ...defaultEffects,
      pixelateEnabled: true,
      pixelate: 8,
      saturation: 1.1,
    },
  },
  {
    name: 'Bloom',
    description: 'Soft ethereal glow',
    effects: {
      ...defaultEffects,
      blur: 2,
      brightness: 1.15,
      saturation: 1.1,
    },
  },
];

export const EffectsControls = memo(function EffectsControls({ 
  effects, 
  onChange,
  onStartDrag,
  onEndDrag,
  onCommitHistory
}: EffectsControlsProps) {
  // 🔥 LOCAL STATE FOR SLIDERS (COMMIT-BASED PATTERN)
  const [localEffects, setLocalEffects] = useState(effects);
  
  // Load accordion state from localStorage
  const [openSections, setOpenSections] = useState<string[]>(() => {
    const saved = localStorage.getItem('effects-accordion-state');
    return saved ? JSON.parse(saved) : ['visual-effects'];
  });

  // Sync local state when props change (from external updates)
  useEffect(() => {
    setLocalEffects(effects);
  }, [effects]);

  // Save accordion state to localStorage
  useEffect(() => {
    localStorage.setItem('effects-accordion-state', JSON.stringify(openSections));
  }, [openSections]);

  // 🔥 COMMIT PATTERN: Update local state during drag
  const updateLocalEffect = (key: keyof EffectsConfig, value: any) => {
    setLocalEffects(prev => ({ ...prev, [key]: value }));
  };

  // 🔥 COMMIT PATTERN: Commit on drag end
  const commitEffect = (key: keyof EffectsConfig, value: any) => {
    onChange({ ...effects, [key]: value });
    onEndDrag?.();
    onCommitHistory?.();
  };

  // Immediate update for toggles and dropdowns (no drag)
  const updateEffect = (key: keyof EffectsConfig, value: any) => {
    onChange({ ...effects, [key]: value });
    onCommitHistory?.();
  };

  const resetToDefaults = () => {
    onChange(defaultEffects);
  };

  // Sprint 1.3: which spatial-chain stages are currently "on", for the
  // reorder control's dim/highlight state. Mirrors each stage's own
  // isActive() check in postfx/stages/*.ts closely enough for a UI hint —
  // doesn't need to match the amount-threshold precision the compositor
  // uses, just enabled-vs-not.
  const activeSpatialStages = new Set<SpatialStageId>([
    ...(effects.quadMirrorEnabled ? (['mirror'] as const) : []),
    ...(effects.noiseDisplaceEnabled ? (['displace'] as const) : []),
    ...(effects.graphicSliceEnabled ? (['slice'] as const) : []),
    ...(effects.chromaticAberration > 0.01 ? (['chroma'] as const) : []),
    ...(effects.blur > 0.01 ? (['blur'] as const) : []),
    ...(effects.pixelateEnabled && effects.pixelate > 0 ? (['pixelate'] as const) : []),
    ...(effects.shapeOverlayEnabled && effects.shapeOverlay > 0 ? (['shapeOverlay'] as const) : []),
    ...(effects.vignette > 0.01 ? (['vignette'] as const) : []),
    ...((effects.filmGrain || 0) > 0.01 ? (['filmGrain'] as const) : []),
    ...(effects.posterizeEnabled && (effects.posterize || 0) > 0.01 ? (['posterize'] as const) : []),
    ...(effects.halftoneEnabled && (effects.halftone || 0) > 0.01 ? (['halftone'] as const) : []),
    ...(effects.fresnelEnabled ? (['fresnel'] as const) : []),
  ]);

  const creativeShapeOptions = [
    { value: 'square', label: '■ Square' },
    { value: 'circle', label: '● Circle' },
    { value: 'hexagon', label: '⬡ Hexagon' },
    { value: 'diamond', label: '◆ Diamond' },
    { value: 'triangle', label: '▲ Triangle' },
    { value: 'lines', label: '≡ Lines' },
  ];

  const posterizeDitheringOptions = [
    { value: 'none', label: 'None' },
    { value: 'bayer', label: 'Ordered 4×4 Bayer' },
    { value: 'noise', label: 'Noise Dither' },
    { value: 'blueNoise', label: 'Blue-Noise Hash' },
    { value: 'scanline', label: 'Scanline Dither' },
    { value: 'dotDiffusion', label: 'Dot Diffusion' },
    { value: 'crosshatch', label: 'Crosshatch Dither' },
  ];

  const handleCopyEffects = () => {
    try {
      copyEffects(effects);
      toast.success('Effects copied to clipboard');
    } catch (error) {
      toast.error('Failed to copy effects');
    }
  };

  const handlePasteEffects = () => {
    try {
      const pastedEffects = pasteEffects();
      if (pastedEffects) {
        onChange(pastedEffects);
        toast.success('Effects pasted successfully');
      } else {
        toast.error('No effects in clipboard');
      }
    } catch (error) {
      toast.error('Failed to paste effects');
    }
  };

  const hasChanges = JSON.stringify(effects) !== JSON.stringify(defaultEffects);
  const canPaste = hasEffectsInClipboard();

  return (
    <div className="p-4">
      {/* Effect Presets */}
      <div className="mb-6 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium text-zinc-100 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
            Effect Presets
          </Label>
          {/* Copy/Paste Effects */}
          <div className="flex gap-1">
            <ConditionalTooltip content="Copy current effects">
              <Button
                onClick={handleCopyEffects}
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-zinc-400 hover:text-blue-400 hover:bg-zinc-800"
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </ConditionalTooltip>
            <ConditionalTooltip content="Paste copied effects">
              <Button
                onClick={handlePasteEffects}
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-zinc-400 hover:text-blue-400 hover:bg-zinc-800 disabled:opacity-30"
                disabled={!canPaste}
              >
                <Clipboard className="w-3.5 h-3.5" />
              </Button>
            </ConditionalTooltip>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {EFFECT_PRESETS.map((preset) => (
            <Button
              key={preset.name}
              onClick={() => onChange(preset.effects)}
              variant="outline"
              className="h-auto flex-col items-start p-2 border-zinc-700 hover:border-blue-400 hover:bg-zinc-800/50 transition-all"
            >
              <span className="text-[11px] font-medium text-[#51a2ff]">{preset.name}</span>
              <span className="text-[9px] text-zinc-500 line-clamp-1">{preset.description}</span>
            </Button>
          ))}
        </div>
      </div>

      <Accordion
        type="multiple"
        value={openSections}
        onValueChange={setOpenSections}
        className="space-y-4"
      >
        {/* Color Adjustments */}
        <AccordionItem value="color-adjustments" className="border-none">
          <AccordionTrigger className="py-3 px-4 hover:no-underline">
            <span className="text-sm font-medium text-zinc-100">Color Adjustments</span>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2">
            <div className="space-y-4">
              {/* Saturation */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Saturation</Label>
                  <span className="text-xs text-zinc-400">{Math.round(localEffects.saturation * 100)}%</span>
                </div>
                <Slider
                  value={[localEffects.saturation * 100]}
                  onValueChange={([value]) => {
                    onStartDrag?.();
                    updateLocalEffect('saturation', value / 100);
                  }}
                  onValueCommit={([value]) => commitEffect('saturation', value / 100)}
                  min={0}
                  max={200}
                  step={1}
                />
              </div>

              {/* Brightness */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Brightness</Label>
                  <span className="text-xs text-zinc-400">{Math.round(localEffects.brightness * 100)}%</span>
                </div>
                <Slider
                  value={[localEffects.brightness * 100]}
                  onValueChange={([value]) => {
                    onStartDrag?.();
                    updateLocalEffect('brightness', value / 100);
                  }}
                  onValueCommit={([value]) => commitEffect('brightness', value / 100)}
                  min={0}
                  max={200}
                  step={1}
                />
              </div>

              {/* Contrast */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Contrast</Label>
                  <span className="text-xs text-zinc-400">{Math.round(localEffects.contrast * 100)}%</span>
                </div>
                <Slider
                  value={[localEffects.contrast * 100]}
                  onValueChange={([value]) => {
                    onStartDrag?.();
                    updateLocalEffect('contrast', value / 100);
                  }}
                  onValueCommit={([value]) => commitEffect('contrast', value / 100)}
                  min={0}
                  max={200}
                  step={1}
                />
              </div>

              {/* Hue Shift */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Hue Shift</Label>
                  <span className="text-xs text-zinc-400">{Math.round(localEffects.hueShift)}°</span>
                </div>
                <Slider
                  value={[localEffects.hueShift]}
                  onValueChange={([value]) => {
                    onStartDrag?.();
                    updateLocalEffect('hueShift', value);
                  }}
                  onValueCommit={([value]) => commitEffect('hueShift', value)}
                  min={0}
                  max={360}
                  step={1}
                />
              </div>

              {/* Temperature */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Temperature</Label>
                  <span className="text-xs text-zinc-400">
                    {localEffects.temperature > 0 ? '+' : ''}{Math.round(localEffects.temperature)}
                  </span>
                </div>
                <Slider
                  value={[localEffects.temperature]}
                  onValueChange={([value]) => {
                    onStartDrag?.();
                    updateLocalEffect('temperature', value);
                  }}
                  onValueCommit={([value]) => commitEffect('temperature', value)}
                  min={-100}
                  max={100}
                  step={1}
                />
              </div>

              {/* Tint */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Tint</Label>
                  <span className="text-xs text-zinc-400">
                    {localEffects.tint > 0 ? '+' : ''}{Math.round(localEffects.tint)}
                  </span>
                </div>
                <Slider
                  value={[localEffects.tint]}
                  onValueChange={([value]) => {
                    onStartDrag?.();
                    updateLocalEffect('tint', value);
                  }}
                  onValueCommit={([value]) => commitEffect('tint', value)}
                  min={-100}
                  max={100}
                  step={1}
                />
              </div>

              {/* Invert */}
              <div className="flex items-center justify-between">
                <Label className="text-xs text-zinc-400">Invert Colors</Label>
                <Switch
                  checked={effects.invert}
                  onCheckedChange={(checked) => updateEffect('invert', checked)}
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Effects Layering */}
        <AccordionItem value="effects-layering" className="border-none">
          <AccordionTrigger className="py-3 px-4 hover:no-underline">
            <span className="text-sm font-medium text-zinc-100">Effects Layering</span>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2">
            <div className="space-y-2">
              <p className="text-[10px] text-zinc-500 px-1">
                Effects Layering — drag a slot to change the order they apply in.
              </p>
              <SpatialChainOrderControl
                order={
                  Array.isArray(effects.spatialChainOrder) && effects.spatialChainOrder.length === 12
                    ? effects.spatialChainOrder
                    : DEFAULT_SPATIAL_CHAIN_ORDER
                }
                activeStages={activeSpatialStages}
                onChange={(order) => onChange({ ...effects, spatialChainOrder: order })}
                onCommitHistory={onCommitHistory}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Visual Effects */}
        <AccordionItem value="visual-effects" className="border-none">
          <AccordionTrigger className="py-3 px-4 hover:no-underline">
            <div className="flex items-center justify-between w-full pr-4">
              <span className="text-sm font-medium text-zinc-100">Visual Effects</span>
              {hasChanges && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    resetToDefaults();
                  }}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                >
                  Reset
                </span>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2">
            <div className="space-y-4">
              {/* Blur */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <ConditionalTooltip content="Apply Gaussian blur for soft, dreamy effects">
                    <Label className="text-xs text-zinc-400">Blur</Label>
                  </ConditionalTooltip>
                  <span className="text-xs text-zinc-400">{localEffects.blur.toFixed(1)}px</span>
                </div>
                <Slider
                  value={[localEffects.blur]}
                  onValueChange={([value]) => {
                    onStartDrag?.();
                    updateLocalEffect('blur', value);
                  }}
                  onValueCommit={([value]) => commitEffect('blur', value)}
                  min={0}
                  max={20}
                  step={0.1}
                />
              </div>

              {/* Chromatic Aberration */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Chromatic Aberration</Label>
                  <span className="text-xs text-zinc-400">{localEffects.chromaticAberration.toFixed(2)}</span>
                </div>
                <Slider
                  value={[localEffects.chromaticAberration * 100]}
                  onValueChange={([value]) => {
                    onStartDrag?.();
                    updateLocalEffect('chromaticAberration', value / 100);
                  }}
                  onValueCommit={([value]) => commitEffect('chromaticAberration', value / 100)}
                  min={0}
                  max={50}
                  step={0.5}
                />
              </div>

              {/* Vignette */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Vignette</Label>
                  <span className="text-xs text-zinc-400">{Math.round(localEffects.vignette * 100)}%</span>
                </div>
                <Slider
                  value={[localEffects.vignette * 100]}
                  onValueChange={([value]) => {
                    onStartDrag?.();
                    updateLocalEffect('vignette', value / 100);
                  }}
                  onValueCommit={([value]) => commitEffect('vignette', value / 100)}
                  min={0}
                  max={100}
                  step={1}
                />
              </div>

              {/* Film Grain */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Film Grain</Label>
                  <span className="text-xs text-zinc-400">{Math.round((localEffects.filmGrain || 0) * 100)}%</span>
                </div>
                <Slider
                  value={[(localEffects.filmGrain || 0) * 100]}
                  onValueChange={([value]) => {
                    onStartDrag?.();
                    updateLocalEffect('filmGrain', value / 100);
                  }}
                  onValueCommit={([value]) => commitEffect('filmGrain', value / 100)}
                  min={0}
                  max={100}
                  step={1}
                />
              </div>

              {/* Film Grain Size */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Grain Size</Label>
                  <span className="text-xs text-zinc-400">{(localEffects.filmGrainSize || 1).toFixed(1)}</span>
                </div>
                <Slider
                  value={[localEffects.filmGrainSize || 1]}
                  onValueChange={([value]) => {
                    onStartDrag?.();
                    updateLocalEffect('filmGrainSize', value);
                  }}
                  onValueCommit={([value]) => commitEffect('filmGrainSize', value)}
                  min={0.5}
                  max={5}
                  step={0.1}
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Creative Effects */}
        <AccordionItem value="creative-effects" className="border-none">
          <AccordionTrigger className="py-3 px-4 hover:no-underline">
            <span className="text-sm font-medium text-zinc-100">Creative Effects</span>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2">
            <div className="space-y-4">
              {/* Shared Creative Shape Selector */}
              <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
                <Label className="text-xs text-zinc-500">Creative Shape</Label>
                <SelectWrapper
                  value={effects.creativeShape}
                  onValueChange={(value: any) => updateEffect('creativeShape', value)}
                  options={creativeShapeOptions}
                  triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
                  contentClassName="bg-zinc-900 border-zinc-700"
                />
              </div>

              {/* Posterize */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Posterize</Label>
                  <Switch
                    checked={effects.posterizeEnabled}
                    onCheckedChange={(checked) => updateEffect('posterizeEnabled', checked)}
                  />
                </div>
                {effects.posterizeEnabled && (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-zinc-500">Amount</Label>
                        <span className="text-xs text-zinc-500">{Math.round(localEffects.posterize)}%</span>
                      </div>
                      <Slider
                        value={[localEffects.posterize]}
                        onValueChange={([value]) => {
                          onStartDrag?.();
                          updateLocalEffect('posterize', value);
                        }}
                        onValueCommit={([value]) => commitEffect('posterize', value)}
                        min={0}
                        max={100}
                        step={1}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-zinc-500">Dithering</Label>
                      <SelectWrapper
                        value={effects.posterizeDithering}
                        onValueChange={(value: any) => updateEffect('posterizeDithering', value)}
                        options={posterizeDitheringOptions}
                        triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
                        contentClassName="bg-zinc-900 border-zinc-700"
                      />
                    </div>
                    {effects.posterizeDithering !== 'none' && (
                      <>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs text-zinc-500">Dither Strength</Label>
                            <span className="text-xs text-zinc-500">{Math.round(localEffects.ditherStrength)}%</span>
                          </div>
                          <Slider
                            value={[localEffects.ditherStrength]}
                            onValueChange={([value]) => {
                              onStartDrag?.();
                              updateLocalEffect('ditherStrength', value);
                            }}
                            onValueCommit={([value]) => commitEffect('ditherStrength', value)}
                            min={0}
                            max={100}
                            step={1}
                          />
                          <div className="flex justify-between text-[10px] text-zinc-600">
                            <span>Subtle</span>
                            <span>Extreme</span>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs text-zinc-500">Dither Scale</Label>
                            <span className="text-xs text-zinc-500">{Math.round(localEffects.ditherScale)}%</span>
                          </div>
                          <Slider
                            value={[localEffects.ditherScale]}
                            onValueChange={([value]) => {
                              onStartDrag?.();
                              updateLocalEffect('ditherScale', value);
                            }}
                            onValueCommit={([value]) => commitEffect('ditherScale', value)}
                            min={1}
                            max={100}
                            step={1}
                          />
                          <div className="flex justify-between text-[10px] text-zinc-600">
                            <span>Chunky</span>
                            <span>Fine</span>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>

              {/* Halftone */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Halftone</Label>
                  <Switch
                    checked={effects.halftoneEnabled}
                    onCheckedChange={(checked) => updateEffect('halftoneEnabled', checked)}
                  />
                </div>
                {effects.halftoneEnabled && (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-zinc-500">Dot Size</Label>
                        <span className="text-xs text-zinc-500">{localEffects.halftone.toFixed(1)}</span>
                      </div>
                      <Slider
                        value={[localEffects.halftone]}
                        onValueChange={([value]) => {
                          onStartDrag?.();
                          updateLocalEffect('halftone', value);
                        }}
                        onValueCommit={([value]) => commitEffect('halftone', value)}
                        min={0}
                        max={20}
                        step={0.5}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-zinc-500">Angle</Label>
                        <span className="text-xs text-zinc-500">{Math.round(localEffects.halftoneAngle)}°</span>
                      </div>
                      <Slider
                        value={[localEffects.halftoneAngle]}
                        onValueChange={([value]) => {
                          onStartDrag?.();
                          updateLocalEffect('halftoneAngle', value);
                        }}
                        onValueCommit={([value]) => commitEffect('halftoneAngle', value)}
                        min={0}
                        max={360}
                        step={1}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Shape Overlay */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Shape Overlay</Label>
                  <Switch
                    checked={effects.shapeOverlayEnabled}
                    onCheckedChange={(checked) => updateEffect('shapeOverlayEnabled', checked)}
                  />
                </div>
                {effects.shapeOverlayEnabled && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-zinc-500">Intensity</Label>
                      <span className="text-xs text-zinc-500">{Math.round(localEffects.shapeOverlay)}</span>
                    </div>
                    <Slider
                      value={[localEffects.shapeOverlay]}
                      onValueChange={([value]) => {
                        onStartDrag?.();
                        updateLocalEffect('shapeOverlay', value);
                      }}
                      onValueCommit={([value]) => commitEffect('shapeOverlay', value)}
                      min={0}
                      max={200}
                      step={1}
                    />
                  </div>
                )}
              </div>

              {/* Pixelate */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Pixelate</Label>
                  <Switch
                    checked={effects.pixelateEnabled}
                    onCheckedChange={(checked) => updateEffect('pixelateEnabled', checked)}
                  />
                </div>
                {effects.pixelateEnabled && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-zinc-500">Pixel Size</Label>
                      <span className="text-xs text-zinc-500">{Math.round(localEffects.pixelate)}</span>
                    </div>
                    <Slider
                      value={[localEffects.pixelate]}
                      onValueChange={([value]) => {
                        onStartDrag?.();
                        updateLocalEffect('pixelate', value);
                      }}
                      onValueCommit={([value]) => commitEffect('pixelate', value)}
                      min={0}
                      max={200}
                      step={1}
                    />
                  </div>
                )}
              </div>

              {/* Fresnel Effect */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Fresnel Edge Glow</Label>
                  <Switch
                    checked={effects.fresnelEnabled}
                    onCheckedChange={(checked) => updateEffect('fresnelEnabled', checked)}
                  />
                </div>
                {effects.fresnelEnabled && (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-zinc-500">Power</Label>
                        <span className="text-xs text-zinc-500">{localEffects.fresnelPower.toFixed(1)}</span>
                      </div>
                      <Slider
                        value={[localEffects.fresnelPower]}
                        onValueChange={([value]) => {
                          onStartDrag?.();
                          updateLocalEffect('fresnelPower', value);
                        }}
                        onValueCommit={([value]) => commitEffect('fresnelPower', value)}
                        min={1}
                        max={5}
                        step={0.1}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-zinc-500">Intensity</Label>
                        <span className="text-xs text-zinc-500">{Math.round(localEffects.fresnelIntensity * 100)}%</span>
                      </div>
                      <Slider
                        value={[localEffects.fresnelIntensity * 100]}
                        onValueChange={([value]) => {
                          onStartDrag?.();
                          updateLocalEffect('fresnelIntensity', value / 100);
                        }}
                        onValueCommit={([value]) => commitEffect('fresnelIntensity', value / 100)}
                        min={0}
                        max={100}
                        step={1}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* ── Noise & Symmetry ────────────────────────────────────────
                  Quad Mirror / Noise Displacement / Graphic Slice controls.
                  Reorder now lives in the top-level "Effects Layering"
                  section (which covers all 12 layerable effects) — this
                  box just holds these three's own toggles/sliders, per
                  explicit direction to keep them here under Fresnel. */}
              <div className="space-y-4 rounded-md border border-zinc-800 bg-zinc-900/30 p-3">
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-zinc-300">Noise & Symmetry</Label>
                </div>

                {/* Quad Mirror */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-zinc-400">Quad Mirror</Label>
                    <Switch
                      checked={effects.quadMirrorEnabled}
                      onCheckedChange={(checked) => updateEffect('quadMirrorEnabled', checked)}
                    />
                  </div>
                  {effects.quadMirrorEnabled && (
                    <>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-zinc-500">Center X</Label>
                          <span className="text-xs text-zinc-500">{Math.round(localEffects.quadMirrorCenterX * 100)}%</span>
                        </div>
                        <Slider
                          value={[localEffects.quadMirrorCenterX * 100]}
                          onValueChange={([value]) => {
                            onStartDrag?.();
                            updateLocalEffect('quadMirrorCenterX', value / 100);
                          }}
                          onValueCommit={([value]) => commitEffect('quadMirrorCenterX', value / 100)}
                          min={0}
                          max={100}
                          step={1}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-zinc-500">Center Y</Label>
                          <span className="text-xs text-zinc-500">{Math.round(localEffects.quadMirrorCenterY * 100)}%</span>
                        </div>
                        <Slider
                          value={[localEffects.quadMirrorCenterY * 100]}
                          onValueChange={([value]) => {
                            onStartDrag?.();
                            updateLocalEffect('quadMirrorCenterY', value / 100);
                          }}
                          onValueCommit={([value]) => commitEffect('quadMirrorCenterY', value / 100)}
                          min={0}
                          max={100}
                          step={1}
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Noise Displacement */}
                <div className="space-y-2 border-t border-zinc-800 pt-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-zinc-400">Noise Displacement</Label>
                    <Switch
                      checked={effects.noiseDisplaceEnabled}
                      onCheckedChange={(checked) => updateEffect('noiseDisplaceEnabled', checked)}
                    />
                  </div>
                  {effects.noiseDisplaceEnabled && (
                    <>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-zinc-500">Amount</Label>
                          <span className="text-xs text-zinc-500">{localEffects.noiseDisplaceAmount.toFixed(2)}</span>
                        </div>
                        <Slider
                          value={[localEffects.noiseDisplaceAmount]}
                          onValueChange={([value]) => {
                            onStartDrag?.();
                            updateLocalEffect('noiseDisplaceAmount', value);
                          }}
                          onValueCommit={([value]) => commitEffect('noiseDisplaceAmount', value)}
                          min={0}
                          max={0.5}
                          step={0.01}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-zinc-500">Scale</Label>
                          <span className="text-xs text-zinc-500">{localEffects.noiseDisplaceScale.toFixed(1)}</span>
                        </div>
                        <Slider
                          value={[localEffects.noiseDisplaceScale]}
                          onValueChange={([value]) => {
                            onStartDrag?.();
                            updateLocalEffect('noiseDisplaceScale', value);
                          }}
                          onValueCommit={([value]) => commitEffect('noiseDisplaceScale', value)}
                          min={0.5}
                          max={8}
                          step={0.1}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-zinc-500">Speed</Label>
                          <span className="text-xs text-zinc-500">{localEffects.noiseDisplaceSpeed.toFixed(2)}</span>
                        </div>
                        <Slider
                          value={[localEffects.noiseDisplaceSpeed]}
                          onValueChange={([value]) => {
                            onStartDrag?.();
                            updateLocalEffect('noiseDisplaceSpeed', value);
                          }}
                          onValueCommit={([value]) => commitEffect('noiseDisplaceSpeed', value)}
                          min={0}
                          max={2}
                          step={0.05}
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Graphic Slice */}
                <div className="space-y-2 border-t border-zinc-800 pt-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-zinc-400">Graphic Slice</Label>
                    <Switch
                      checked={effects.graphicSliceEnabled}
                      onCheckedChange={(checked) => updateEffect('graphicSliceEnabled', checked)}
                    />
                  </div>
                  {effects.graphicSliceEnabled && (
                    <>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-zinc-500">Bands</Label>
                          <span className="text-xs text-zinc-500">{Math.round(localEffects.graphicSliceBands)}</span>
                        </div>
                        <Slider
                          value={[localEffects.graphicSliceBands]}
                          onValueChange={([value]) => {
                            onStartDrag?.();
                            updateLocalEffect('graphicSliceBands', value);
                          }}
                          onValueCommit={([value]) => commitEffect('graphicSliceBands', value)}
                          min={2}
                          max={64}
                          step={1}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-zinc-500">Amount</Label>
                          <span className="text-xs text-zinc-500">{localEffects.graphicSliceAmount.toFixed(2)}</span>
                        </div>
                        <Slider
                          value={[localEffects.graphicSliceAmount]}
                          onValueChange={([value]) => {
                            onStartDrag?.();
                            updateLocalEffect('graphicSliceAmount', value);
                          }}
                          onValueCommit={([value]) => commitEffect('graphicSliceAmount', value)}
                          min={0}
                          max={0.3}
                          step={0.01}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-zinc-500">Rate</Label>
                          <span className="text-xs text-zinc-500">{localEffects.graphicSliceRate.toFixed(1)} Hz</span>
                        </div>
                        <Slider
                          value={[localEffects.graphicSliceRate]}
                          onValueChange={([value]) => {
                            onStartDrag?.();
                            updateLocalEffect('graphicSliceRate', value);
                          }}
                          onValueCommit={([value]) => commitEffect('graphicSliceRate', value)}
                          min={0.5}
                          max={30}
                          step={0.5}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="flash-fx" className="border-0 rounded-lg overflow-hidden bg-zinc-900/60">
          <AccordionTrigger className="px-3 py-2.5 hover:bg-zinc-800/50 transition-colors">
            <span className="text-sm font-medium text-zinc-100">Light Flash Effects</span>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3 pt-1 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-zinc-400">Enable Flash</Label>
              <Switch
                checked={effects.flashEnabled ?? false}
                onCheckedChange={(checked) => updateEffect('flashEnabled', checked)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Flash Type</Label>
              <div className="flex gap-1">
                {([
                  { v: 'quick' as const,      label: 'Quick' },
                  { v: 'color' as const,      label: 'Color Cycle' },
                  { v: 'hueRotate' as const,  label: 'Hue Rotate' },
                  { v: 'dark' as const,       label: 'Dark' },
                ]).map(({ v, label }) => (
                  <button key={v} onClick={() => updateEffect('flashType', v)}
                    className={`flex-1 py-1.5 text-xs rounded-md border transition-colors font-medium ${
                      (effects.flashType??'quick')===v
                        ? 'border-transparent text-white'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
                    }`}
                    style={(effects.flashType??'quick')===v ? {
                      background: 'linear-gradient(135deg, #3b82f6, #6366f1)', borderColor: 'transparent'
                    } : undefined}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">LFO Mode</Label>
              <div className="grid grid-cols-3 gap-1">
                {([
                  { v: 'stutter' as const,   label: 'Stutter' },
                  { v: 'oscillate' as const, label: 'Oscillate' },
                  { v: 'pulse' as const,     label: 'Pulse' },
                  { v: 'beatDrop' as const,  label: 'Beat Drop' },
                  { v: 'breathe' as const,   label: 'Breathe' },
                  { v: 'sawtooth' as const,  label: 'Sawtooth' },
                ]).map(({ v, label }) => (
                  <button key={v} onClick={() => updateEffect('flashMode', v)}
                    className={`py-1.5 text-xs rounded-md border transition-colors font-medium ${
                      (effects.flashMode??'stutter')===v
                        ? 'border-transparent text-white'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
                    }`}
                    style={(effects.flashMode??'stutter')===v ? {
                      background: 'linear-gradient(135deg, #3b82f6, #6366f1)', borderColor: 'transparent'
                    } : undefined}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Position</Label>
              <SelectWrapper
                value={effects.flashPosition ?? 'full'}
                onValueChange={(v) => updateEffect('flashPosition', v)}
                options={[
                  { value: 'full',        label: 'Full Canvas' },
                  { value: 'centerBurst', label: 'Center Burst' },
                  { value: 'topbottom',   label: 'Top & Bottom' },
                  { value: 'sides',       label: 'Left & Right Sides' },
                  { value: 'corners',     label: '4 Corners (Sync)' },
                  { value: 'cornersAlt',  label: '4 Corners (Alternate)' },
                  { value: 'opposite',    label: 'Opposite Ends (Alt.)' },
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Easing</Label>
              <SelectWrapper
                value={effects.flashEasing ?? 'easeOut'}
                onValueChange={(v) => updateEffect('flashEasing', v)}
                options={[
                  { value: 'linear',    label: 'Linear' },
                  { value: 'easeIn',    label: 'Ease In' },
                  { value: 'easeOut',   label: 'Ease Out' },
                  { value: 'easeInOut', label: 'Ease In / Out' },
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-zinc-400">Speed</Label>
                <span className="text-xs text-zinc-500">
                  {(effects.flashSpeed ?? 2).toFixed(1)}{effects.flashSyncAnimation ? '× /cycle' : ' Hz'}
                </span>
              </div>
              <Slider min={0.1} max={10} step={0.1}
                value={[effects.flashSpeed ?? 2]}
                onValueChange={([v]) => updateEffect('flashSpeed', v)}
              />
              <div className="flex justify-between text-[9px] text-zinc-600">
                <span>Slow</span>
                <span>{effects.flashSyncAnimation ? 'Beats per animation cycle' : 'Beats per second'}</span>
                <span>Fast</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-zinc-400">Intensity</Label>
                <span className="text-xs text-zinc-500">{Math.round((effects.flashIntensity ?? 0.7) * 100)}%</span>
              </div>
              <Slider min={0} max={1} step={0.01}
                value={[effects.flashIntensity ?? 0.7]}
                onValueChange={([v]) => updateEffect('flashIntensity', v)}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-zinc-400">After Glow</Label>
                <span className="text-xs text-zinc-500">{Math.round((effects.flashAfterGlow ?? 0) * 100)}%</span>
              </div>
              <Slider min={0} max={1} step={0.01}
                value={[effects.flashAfterGlow ?? 0]}
                onValueChange={([v]) => updateEffect('flashAfterGlow', v)}
              />
              <div className="flex justify-between text-[9px] text-zinc-600"><span>None</span><span>Long Decay</span></div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs text-zinc-400">Sync to Animation</Label>
                <p className="text-[10px] text-zinc-600">Beat aligns to active layer cycle</p>
              </div>
              <Switch
                checked={effects.flashSyncAnimation ?? false}
                onCheckedChange={(checked) => updateEffect('flashSyncAnimation', checked)}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

      </Accordion>
    </div>
  );
});
