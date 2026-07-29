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
import { toast } from 'sonner';

export interface EffectsConfig {
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
            </div>
          </AccordionContent>
        </AccordionItem>
        {/* ── Light Flash Effects ──────────────────────────────────────── */}
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