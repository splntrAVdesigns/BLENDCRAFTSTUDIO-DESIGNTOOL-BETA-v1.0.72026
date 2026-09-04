import { GradientConfig, GradientType } from '../../types/gradient';
import { Label } from '../ui/label';
import { Slider } from '../ui/slider';
import { SelectWrapper } from '../ui/select-wrapper';
import { Button } from '../ui/button';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../ui/accordion';
import { ConditionalTooltip } from '../ui/ConditionalTooltip';
import { RotateCcw } from 'lucide-react';
import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { applyGradientDefaults, getGradientUIConfig } from '../../utils/gradientDefaults';

interface GradientControlsProps {
  gradient: GradientConfig;
  onChange: (gradient: GradientConfig) => void;
  onCommitHistory?: () => void; // 🔥 COMMIT-BASED HISTORY
  /** STAGE 2.5: true when the active layer has an enabled media source.
   *  Gradient Type is spatial-shape-only and has no effect on the media
   *  shader's luminance-based LUT ramp — so it's disabled and relabeled here
   *  instead of silently doing nothing, which is what prompted the "gradient
   *  type not applying to media" report. */
  isMediaLayer?: boolean;
}

export const GradientControls = memo(function GradientControls({ gradient, onChange, onCommitHistory, isMediaLayer }: GradientControlsProps) {
  // Load accordion state from localStorage
  const [openSections, setOpenSections] = useState<string[]>(() => {
    const saved = localStorage.getItem('gradient-accordion-state');
    return saved ? JSON.parse(saved) : ['type-direction'];
  });

  // Get UI configuration for current gradient type
  const uiConfig = getGradientUIConfig(gradient.type);

  // PERFORMANCE FIX: Local state for sliders - commit on release only
  const [localAngle, setLocalAngle] = useState(gradient.angle || 0);
  const [localScale, setLocalScale] = useState(gradient.scale || 1);
  const [localScaleBoost, setLocalScaleBoost] = useState(gradient.scaleBoost || 1);
  const [localTwist, setLocalTwist] = useState(gradient.twist || 0);
  const [localSegments, setLocalSegments] = useState(gradient.segments || 6);
  const [localFrequency, setLocalFrequency] = useState(gradient.frequency || 2.0);
  const [localCenterX, setLocalCenterX] = useState(gradient.centerX || 0.5);
  const [localCenterY, setLocalCenterY] = useState(gradient.centerY || 0.5);
  const [localStripeCount, setLocalStripeCount] = useState(gradient.stripeCount || 5);
  const [localWaveAmplitude, setLocalWaveAmplitude] = useState(gradient.waveAmplitude || 0.2);
  const [localBlobCount, setLocalBlobCount] = useState(gradient.blobCount || 3);
  const [localOctaves, setLocalOctaves] = useState(gradient.octaves || 4);
  const [localGridRows, setLocalGridRows] = useState(gradient.gridRows || 2);
  const [localGridCols, setLocalGridCols] = useState(gradient.gridCols || 2);
  const [localIntensity, setLocalIntensity] = useState(gradient.intensity || 1);

  // Sync local state when gradient props change (e.g., preset loaded)
  useEffect(() => {
    setLocalAngle(gradient.angle || 0);
  }, [gradient.angle]);

  useEffect(() => {
    setLocalScale(gradient.scale || 1);
  }, [gradient.scale]);

  useEffect(() => {
    setLocalScaleBoost(gradient.scaleBoost || 1);
  }, [gradient.scaleBoost]);

  useEffect(() => {
    setLocalTwist(gradient.twist || 0);
  }, [gradient.twist]);

  useEffect(() => {
    setLocalSegments(gradient.segments || 6);
  }, [gradient.segments]);

  useEffect(() => {
    setLocalFrequency(gradient.frequency || 2.0);
  }, [gradient.frequency]);

  useEffect(() => {
    setLocalCenterX(gradient.centerX || 0.5);
  }, [gradient.centerX]);

  useEffect(() => {
    setLocalCenterY(gradient.centerY || 0.5);
  }, [gradient.centerY]);

  useEffect(() => {
    setLocalStripeCount(gradient.stripeCount || 5);
  }, [gradient.stripeCount]);

  useEffect(() => {
    setLocalWaveAmplitude(gradient.waveAmplitude || 0.2);
  }, [gradient.waveAmplitude]);

  useEffect(() => {
    setLocalBlobCount(gradient.blobCount || 3);
  }, [gradient.blobCount]);

  useEffect(() => {
    setLocalOctaves(gradient.octaves || 4);
  }, [gradient.octaves]);

  useEffect(() => {
    setLocalGridRows(gradient.gridRows || 2);
  }, [gradient.gridRows]);

  useEffect(() => {
    setLocalGridCols(gradient.gridCols || 2);
  }, [gradient.gridCols]);

  useEffect(() => {
    setLocalIntensity(gradient.intensity || 1);
  }, [gradient.intensity]);

  // Save accordion state to localStorage
  useEffect(() => {
    localStorage.setItem('gradient-accordion-state', JSON.stringify(openSections));
  }, [openSections]);

  const updateGradient = (updates: Partial<GradientConfig>) => {
    onChange({ ...gradient, ...updates });
    if (onCommitHistory) {
      onCommitHistory();
    }
  };

  // Handle gradient type change with auto-reset to defaults
  const handleTypeChange = (newType: GradientType) => {
    try {
      const updatedGradient = applyGradientDefaults(gradient, newType);
      onChange(updatedGradient);
      if (onCommitHistory) {
        onCommitHistory();
      }
    } catch (error) {
      // Fallback: just change the type without applying defaults
      onChange({ ...gradient, type: newType });
      if (onCommitHistory) {
        onCommitHistory();
      }
    }
  };

  // Reset current gradient to its default settings
  const resetGradientToDefaults = () => {
    try {
      const updatedGradient = applyGradientDefaults(gradient, gradient.type);
      onChange(updatedGradient);
      if (onCommitHistory) {
        onCommitHistory();
      }
    } catch (error) {
      console.error('Error resetting gradient:', error);
    }
  };

  const gradientTypes: { value: GradientType; label: string }[] = useMemo(() => [
    { value: 'linear', label: 'Linear' },
    { value: 'radial', label: 'Radial' },
    { value: 'conic', label: 'Conic' },
    { value: 'spiral', label: 'Spiral' },
    { value: 'burst', label: 'Burst' },
    { value: 'starburst', label: 'Starburst' },
    { value: 'four-corners', label: 'Four Corners' },
    { value: 'kaleidoscope', label: 'Kaleidoscope' },
    { value: 'blob', label: 'Blob' },
    { value: 'stripe', label: 'Stripe' },
    { value: 'wave', label: 'Wave' },
    { value: 'noise-spiral', label: 'Noise Spiral' },
    { value: 'fractal', label: 'Fractal' },
    { value: 'turbulence', label: 'Turbulence' },
    { value: 'camo', label: 'Camo' },
    { value: 'voronoi', label: 'Voronoi' },
    { value: 'diamond', label: 'Diamond' },
    { value: 'abstract', label: 'Abstract' },
    { value: 'plasma', label: 'Plasma' },
    { value: 'marble', label: 'Marble' },
    { value: 'concentric', label: 'Concentric' },
    { value: 'radial-waves', label: 'Radial Waves' },
    { value: 'mandala', label: 'Mandala' },
    { value: 'grid', label: 'Grid' },
  ], []);

  return (
    <div className="p-4">
      <Accordion
        type="multiple"
        value={openSections}
        onValueChange={setOpenSections}
        className="space-y-4"
      >
        {/* Gradient Type & Direction */}
        <AccordionItem value="type-direction" className="border-none">
          <AccordionTrigger className="py-3 px-4 hover:no-underline">
            <div className="flex items-center justify-between w-full pr-4">
              <span className="text-sm font-medium text-zinc-100">Gradient Type & Direction</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  resetGradientToDefaults();
                }}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
              >
                Reset
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2">
            <div className="space-y-4 px-0.5">
              {/* STAGE 2.5: Type is spatial-shape-only (linear/radial/conic/
                  etc.) and has no effect on a media layer's LUT shader, which
                  maps luminance → Color Stops regardless of type. Disabling
                  with an explanation instead of leaving it silently inert —
                  that silence is what read as "gradient type not applying". */}
              {isMediaLayer && (
                <div className="p-2.5 rounded-lg border border-[#51a2ff]/40 bg-[#51a2ff]/10">
                  <p className="text-[10px] text-[#51a2ff]">
                    Type doesn't affect media layers — this layer's Color Stops act as a
                    Gradient LUT instead (see Media Upload → Gradient LUT).
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label className="text-xs text-zinc-400">Type</Label>
                <SelectWrapper
                  value={gradient.type}
                  onValueChange={(value) => handleTypeChange(value as GradientType)}
                  options={gradientTypes}
                  disabled={isMediaLayer}
                  triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
                  contentClassName="bg-zinc-900 border-zinc-700"
                />
              </div>

              {/* Angle/Rotation Control */}
              {(gradient.type === 'linear' || gradient.type === 'wave' || gradient.type === 'stripe') ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-zinc-400">Angle</Label>
                    <span className="text-xs text-zinc-400">{localAngle}°</span>
                  </div>
                  <Slider
                    value={[localAngle]}
                    onValueChange={([value]) => setLocalAngle(value)}
                    min={0}
                    max={360}
                    step={1}
                    onValueCommit={() => updateGradient({ angle: localAngle })}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-zinc-400">Rotation</Label>
                    <span className="text-xs text-zinc-400">{localAngle}°</span>
                  </div>
                  <Slider
                    value={[localAngle]}
                    onValueChange={([value]) => setLocalAngle(value)}
                    min={0}
                    max={360}
                    step={1}
                    onValueCommit={() => updateGradient({ angle: localAngle })}
                  />
                </div>
              )}

              {/* Universal Scale Control */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Scale</Label>
                  <span className="text-xs text-zinc-400">{localScale.toFixed(2)}x</span>
                </div>
                <Slider
                  value={[localScale]}
                  onValueChange={([value]) => setLocalScale(value)}
                  min={0.1}
                  max={5.0}
                  step={0.1}
                  onValueCommit={() => updateGradient({ scale: localScale })}
                />
              </div>

              {/* Universal Twist Control - Clean rotation distortion */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className={`text-xs ${uiConfig.showTwist ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    {gradient.type === 'four-corners' ? 'Corner Spread' : 'Twist'}
                  </Label>
                  <span className={`text-xs ${uiConfig.showTwist ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    {localTwist.toFixed(1)}
                  </span>
                </div>
                <Slider
                  value={[localTwist]}
                  onValueChange={([value]) => setLocalTwist(value)}
                  min={gradient.type === 'four-corners' ? 0 : -2}
                  max={gradient.type === 'four-corners' ? 1 : 2}
                  step={0.1}
                  disabled={!uiConfig.showTwist}
                  className={uiConfig.showTwist ? '' : 'opacity-40'}
                  onValueCommit={() => updateGradient({ twist: localTwist })}
                />
              </div>

              {/* Kaleidoscope-specific controls */}
              {(gradient.type === 'kaleidoscope' || gradient.type === 'mesh') && (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <ConditionalTooltip content="Mirror segments - controls angular symmetry (3=triangle, 6=hexagon, 8=octagon, 12=star)">
                        <Label className="text-xs text-zinc-400">Segments</Label>
                      </ConditionalTooltip>
                      <span className="text-xs text-zinc-400">{localSegments}</span>
                    </div>
                    <Slider
                      value={[localSegments]}
                      onValueChange={([value]) => setLocalSegments(value)}
                      min={3}
                      max={16}
                      step={1}
                      onValueCommit={() => updateGradient({ segments: localSegments })}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <ConditionalTooltip content="Band count - controls concentric ring density (lower=fewer rings, higher=more detail)">
                        <Label className="text-xs text-zinc-400">Bands</Label>
                      </ConditionalTooltip>
                      <span className="text-xs text-zinc-400">{localFrequency.toFixed(1)}</span>
                    </div>
                    <Slider
                      value={[localFrequency * 10]}
                      onValueChange={([value]) => setLocalFrequency(value / 10)}
                      min={5}
                      max={50}
                      step={1}
                      onValueCommit={() => updateGradient({ frequency: localFrequency })}
                    />
                  </div>
                </>
              )}

              {/* Center Controls - shown for gradient types with center point */}
              {uiConfig.showCenter && (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-zinc-400">Center X</Label>
                      <span className="text-xs text-zinc-400">{Math.round(localCenterX * 100)}%</span>
                    </div>
                    <Slider
                      value={[localCenterX * 100]}
                      onValueChange={([value]) => setLocalCenterX(value / 100)}
                      min={0}
                      max={100}
                      step={1}
                      onValueCommit={() => updateGradient({ centerX: localCenterX })}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-zinc-400">Center Y</Label>
                      <span className="text-xs text-zinc-400">{Math.round(localCenterY * 100)}%</span>
                    </div>
                    <Slider
                      value={[localCenterY * 100]}
                      onValueChange={([value]) => setLocalCenterY(value / 100)}
                      min={0}
                      max={100}
                      step={1}
                      onValueCommit={() => updateGradient({ centerY: localCenterY })}
                    />
                  </div>
                </>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Advanced Properties */}
        <AccordionItem value="advanced" className="border-none">
          <AccordionTrigger className="py-3 px-4 hover:no-underline">
            <span className="text-sm font-medium text-zinc-100">Advanced Properties</span>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2">
            <div className="space-y-4">
              {/* Type-specific controls */}
              {(gradient.type === 'wave' || gradient.type === 'stripe') && (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-zinc-400">Stripe Count</Label>
                      <span className="text-xs text-zinc-400">{localStripeCount}</span>
                    </div>
                    <Slider
                      value={[localStripeCount]}
                      onValueChange={([value]) => setLocalStripeCount(value)}
                      min={1}
                      max={20}
                      step={1}
                      onValueCommit={() => updateGradient({ stripeCount: localStripeCount })}
                    />
                  </div>
                  {gradient.type === 'wave' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-zinc-400">Wave Amplitude</Label>
                        <span className="text-xs text-zinc-400">{(localWaveAmplitude * 100).toFixed(0)}%</span>
                      </div>
                      <Slider
                        value={[localWaveAmplitude * 100]}
                        onValueChange={([value]) => setLocalWaveAmplitude(value / 100)}
                        min={0}
                        max={100}
                        step={1}
                        onValueCommit={() => updateGradient({ waveAmplitude: localWaveAmplitude })}
                      />
                    </div>
                  )}
                </>
              )}

              {gradient.type === 'blob' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-zinc-400">Blob Count</Label>
                    <span className="text-xs text-zinc-400">{localBlobCount}</span>
                  </div>
                  <Slider
                    value={[localBlobCount]}
                    onValueChange={([value]) => setLocalBlobCount(value)}
                    min={1}
                    max={5}
                    step={1}
                    onValueCommit={() => updateGradient({ blobCount: localBlobCount })}
                  />
                </div>
              )}

              {(gradient.type === 'noise-spiral' || gradient.type === 'fractal' || gradient.type === 'turbulence') && (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-zinc-400">Octaves</Label>
                      <span className="text-xs text-zinc-400">{localOctaves}</span>
                    </div>
                    <Slider
                      value={[localOctaves]}
                      onValueChange={([value]) => setLocalOctaves(value)}
                      min={1}
                      max={8}
                      step={1}
                      onValueCommit={() => updateGradient({ octaves: localOctaves })}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-zinc-400">Frequency</Label>
                      <span className="text-xs text-zinc-400">{localFrequency.toFixed(1)}</span>
                    </div>
                    <Slider
                      value={[localFrequency * 10]}
                      onValueChange={([value]) => setLocalFrequency(value / 10)}
                      min={1}
                      max={50}
                      step={1}
                      onValueCommit={() => updateGradient({ frequency: localFrequency })}
                    />
                  </div>
                </>
              )}

              {gradient.type === 'plasma' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <ConditionalTooltip content="Number of wave interference layers (1-8). More layers create denser, more psychedelic patterns">
                      <Label className="text-xs text-zinc-400">Complexity</Label>
                    </ConditionalTooltip>
                    <span className="text-xs text-zinc-400">{localOctaves}</span>
                  </div>
                  <Slider
                    value={[localOctaves]}
                    onValueChange={([value]) => setLocalOctaves(value)}
                    min={1}
                    max={8}
                    step={1}
                    onValueCommit={() => updateGradient({ octaves: localOctaves })}
                  />
                </div>
              )}

              {gradient.type === 'marble' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <ConditionalTooltip content="Vein intensity (1-8). Higher values create more pronounced and complex veining patterns">
                      <Label className="text-xs text-zinc-400">Vein Intensity</Label>
                    </ConditionalTooltip>
                    <span className="text-xs text-zinc-400">{localOctaves}</span>
                  </div>
                  <Slider
                    value={[localOctaves]}
                    onValueChange={([value]) => setLocalOctaves(value)}
                    min={1}
                    max={8}
                    step={1}
                    onValueCommit={() => updateGradient({ octaves: localOctaves })}
                  />
                </div>
              )}

              {gradient.type === 'concentric' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <ConditionalTooltip content="Number of concentric rings (1-8). Higher values create more ripple layers">
                      <Label className="text-xs text-zinc-400">Ring Count</Label>
                    </ConditionalTooltip>
                    <span className="text-xs text-zinc-400">{localOctaves}</span>
                  </div>
                  <Slider
                    value={[localOctaves]}
                    onValueChange={([value]) => setLocalOctaves(value)}
                    min={1}
                    max={8}
                    step={1}
                    onValueCommit={() => updateGradient({ octaves: localOctaves })}
                  />
                </div>
              )}

              {gradient.type === 'radial-waves' && (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <ConditionalTooltip content="Number of wave sources (1-5). More sources create complex interference patterns">
                        <Label className="text-xs text-zinc-400">Wave Count</Label>
                      </ConditionalTooltip>
                      <span className="text-xs text-zinc-400">{localOctaves}</span>
                    </div>
                    <Slider
                      value={[localOctaves]}
                      onValueChange={([value]) => setLocalOctaves(value)}
                      min={1}
                      max={5}
                      step={1}
                      onValueCommit={() => updateGradient({ octaves: localOctaves })}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <ConditionalTooltip content="Wave expansion speed (0.1-5.0). Higher values create faster, more dynamic waves">
                        <Label className="text-xs text-zinc-400">Speed</Label>
                      </ConditionalTooltip>
                      <span className="text-xs text-zinc-400">{localFrequency.toFixed(1)}</span>
                    </div>
                    <Slider
                      value={[localFrequency * 10]}
                      onValueChange={([value]) => setLocalFrequency(value / 10)}
                      min={1}
                      max={50}
                      step={1}
                      onValueCommit={() => updateGradient({ frequency: localFrequency })}
                    />
                  </div>
                </>
              )}

              {gradient.type === 'mandala' && (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <ConditionalTooltip content="Radial symmetry segments (3-16). Controls how many times the pattern repeats around the center">
                        <Label className="text-xs text-zinc-400">Segments</Label>
                      </ConditionalTooltip>
                      <span className="text-xs text-zinc-400">{localSegments}</span>
                    </div>
                    <Slider
                      value={[localSegments]}
                      onValueChange={([value]) => setLocalSegments(value)}
                      min={3}
                      max={16}
                      step={1}
                      onValueCommit={() => updateGradient({ segments: localSegments })}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <ConditionalTooltip content="Concentric layers (1-8). More layers create more complex sacred geometry patterns">
                        <Label className="text-xs text-zinc-400">Layers</Label>
                      </ConditionalTooltip>
                      <span className="text-xs text-zinc-400">{localOctaves}</span>
                    </div>
                    <Slider
                      value={[localOctaves]}
                      onValueChange={([value]) => setLocalOctaves(value)}
                      min={1}
                      max={8}
                      step={1}
                      onValueCommit={() => updateGradient({ octaves: localOctaves })}
                    />
                  </div>
                </>
              )}

              {gradient.type === 'grid' && (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-zinc-400">Grid Rows</Label>
                      <span className="text-xs text-zinc-400">{localGridRows}</span>
                    </div>
                    <Slider
                      value={[localGridRows]}
                      onValueChange={([value]) => setLocalGridRows(value)}
                      min={1}
                      max={6}
                      step={1}
                      onValueCommit={() => updateGradient({ gridRows: localGridRows })}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-zinc-400">Grid Columns</Label>
                      <span className="text-xs text-zinc-400">{localGridCols}</span>
                    </div>
                    <Slider
                      value={[localGridCols]}
                      onValueChange={([value]) => setLocalGridCols(value)}
                      min={1}
                      max={6}
                      step={1}
                      onValueCommit={() => updateGradient({ gridCols: localGridCols })}
                    />
                  </div>
                </>
              )}

              {/* Starburst-specific controls */}
              {gradient.type === 'starburst' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <ConditionalTooltip content="Number of rays radiating from center (3-32). More rays create a denser sunburst pattern">
                      <Label className="text-xs text-zinc-400">Ray Count</Label>
                    </ConditionalTooltip>
                    <span className="text-xs text-zinc-400">{localSegments}</span>
                  </div>
                  <Slider
                    value={[localSegments]}
                    onValueChange={([value]) => setLocalSegments(value)}
                    min={3}
                    max={32}
                    step={1}
                    onValueCommit={() => updateGradient({ segments: localSegments })}
                  />
                </div>
              )}

              {/* Universal controls */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Scale Boost</Label>
                  <span className="text-xs text-zinc-400">{localScaleBoost.toFixed(2)}x</span>
                </div>
                <Slider
                  value={[localScaleBoost * 100]}
                  onValueChange={([value]) => setLocalScaleBoost(value / 100)}
                  min={50}
                  max={250}
                  step={1}
                  onValueCommit={() => updateGradient({ scaleBoost: localScaleBoost })}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Intensity</Label>
                  <span className="text-xs text-zinc-400">{(localIntensity * 100).toFixed(0)}%</span>
                </div>
                <Slider
                  value={[localIntensity * 100]}
                  onValueChange={([value]) => setLocalIntensity(value / 100)}
                  min={0}
                  max={200}
                  step={1}
                  onValueCommit={() => updateGradient({ intensity: localIntensity })}
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
});
