/**
 * Mask Animation Controls
 * Provides animation controls for mask shapes using the same animation system as gradients
 */

import { Label } from '../ui/label';
import { SelectWrapper } from '../ui/select-wrapper';
import { Slider } from '../ui/slider';
import { Switch } from '../ui/switch';
import { Play, Pause } from 'lucide-react';
import React, { useState } from 'react';
import type { MaskConfig, EasingType } from '../../types/gradient';

interface MaskAnimationControlsProps {
  maskConfig: MaskConfig;
  onUpdate: (updates: Partial<MaskConfig>) => void;
  isPlaying?: boolean;       // global play state for play/pause button visual
  onPlayToggle?: () => void; // toggle global animation play/pause
  onResetPosition?: () => void; // snap mask position back to current slider X/Y values
}

const DEFAULT_ANIMATION: NonNullable<MaskConfig['animation']> = {
  enabled: false,
  type: 'rotate',
  speed: 5,
  intensity: 50,
  easing: 'linear',
  loop: true,
  direction: 'forward',
};

export function MaskAnimationControls({ maskConfig, onUpdate, isPlaying, onPlayToggle, onResetPosition }: MaskAnimationControlsProps) {
  const animation: NonNullable<MaskConfig['animation']> = {
    ...DEFAULT_ANIMATION,
    ...(maskConfig.animation || {}),
  };

  // Incremented on reset — used as Slider key to force remount and reinitialize
  // internal state even when reset values match current values.
  const [resetKey, setResetKey] = React.useState(0);

  // Sprint C: Local state for continuous sliders — mirrors AnimationControls pattern.
  // onValueChange updates local state only (visual feedback during drag).
  // onValueCommit pushes to parent (triggers the full effects chain) only on pointer-up.
  const [localSpeed,     setLocalSpeed]     = useState(animation.speed);
  const [localIntensity, setLocalIntensity] = useState(animation.intensity);

  // Keep local state in sync when animation resets externally (resetKey bump)
  React.useEffect(() => { setLocalSpeed(animation.speed); }, [resetKey]);     // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { setLocalIntensity(animation.intensity); }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const commitSpeed     = (v: number) => handleAnimationChange({ speed: v });
  const commitIntensity = (v: number) => handleAnimationChange({ intensity: v });

  const handleAnimationChange = (updates: Partial<NonNullable<MaskConfig['animation']>>) => {
    onUpdate({
      animation: {
        ...animation,
        ...updates,
      },
    });
  };

  const animationTypes = [
    { value: 'rotate',  label: 'Rotate',  description: 'Continuous rotation' },
    { value: 'scale',   label: 'Scale',   description: 'Breathing scale' },
    { value: 'pulse',   label: 'Pulse',   description: 'Opacity pulse' },
    { value: 'drift',   label: 'Drift',   description: 'Circular drift' },
    { value: 'swing',   label: 'Swing',   description: 'Lateral swing' },
    { value: 'fade',    label: 'Fade',    description: 'Fade in / fade out' },
    { value: 'bounce',  label: 'Bounce',  description: 'Vertical bounce' },
    { value: 'spin',    label: 'Spin',    description: 'Fast continuous spin' },
    { value: 'wobble',  label: 'Wobble',  description: 'Erratic shake' },
    { value: 'zoom',    label: 'Zoom',    description: 'Rhythmic zoom in/out' },
    { value: 'breathe',      label: 'Breathe',      description: 'Soft living inhale / exhale' },
    { value: 'scanReveal',   label: 'Scan Reveal',  description: 'Scanner-style sweep reveal' },
    { value: 'radialExpand', label: 'Radial Expand',description: 'Shape expands outward from center' },
    { value: 'sliceWipe',    label: 'Slice Wipe',   description: 'Directional slice sweep' },
    { value: 'glitchMask',   label: 'Glitch Mask',  description: 'Controlled digital jump cuts' },
    { value: 'orbitDrift',   label: 'Orbit Drift',  description: 'Orbital motion with subtle turn' },
  ];

  const directions = [
    { value: 'forward', label: 'Forward' },
    { value: 'reverse', label: 'Reverse' },
    { value: 'pingPong', label: 'Ping-Pong' },
  ];

  return (
    <div className="space-y-3 pt-3 border-t border-zinc-800">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-zinc-300 font-semibold">Mask Animation</Label>
        <div className="flex items-center gap-2">
          {animation.enabled && (
            <button
              onClick={() => {
                // FIX: Do NOT set enabled:false — that hides the sliders before
                // the user can see the reset values, and they think nothing happened.
                // Just reset speed and intensity back to their defaults.
                handleAnimationChange({
                  speed: 5,
                  intensity: 50,
                });
                onResetPosition?.();
                setResetKey(k => k + 1); // force Slider remount to reinitialize internal state
              }}
              className="text-xs text-blue-400 hover:text-blue-300"
              title="Reset animation speed, intensity, and position"
            >
              Reset
            </button>
          )}
          {animation.enabled && (
            <button
              onClick={onPlayToggle}
              title={isPlaying ? 'Pause animation' : 'Play animation'}
              className="flex items-center justify-center w-5 h-5 rounded hover:bg-zinc-700 transition-colors"
            >
              {isPlaying ? (
                <Pause className="w-3 h-3 text-green-400" />
              ) : (
                <Play className="w-3 h-3 text-zinc-400 hover:text-green-400" />
              )}
            </button>
          )}
          <Switch
            checked={animation.enabled}
            onCheckedChange={(checked) => handleAnimationChange({ enabled: checked })}
          />
        </div>
      </div>

      {animation.enabled && (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-zinc-400">Animation Type</Label>
            <SelectWrapper
              value={animation.type}
              onValueChange={(value) => handleAnimationChange({ type: value as typeof animation.type })}
              options={animationTypes.map(({ value, label, description }) => ({
                value,
                label: `${label} — ${description}`,
              }))}
              triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
              contentClassName="bg-zinc-900 border-zinc-700"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-zinc-400">Speed</Label>
              <span className="text-xs text-zinc-400">{Math.round(localSpeed)}</span>
            </div>
            <Slider
              key={`speed-${resetKey}`}
              value={[localSpeed]}
              onValueChange={([value]) => setLocalSpeed(value)}
              onValueCommit={([value]) => commitSpeed(value)}
              min={0}
              max={100}
              step={1}
            />
            <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5">
              <span>Slow motion</span>
              <span>Fast</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-zinc-400">Amplitude Depth</Label>
              <span className="text-xs text-zinc-400">{Math.round(localIntensity)}</span>
            </div>
            <Slider
              key={`intensity-${resetKey}`}
              value={[localIntensity]}
              onValueChange={([value]) => setLocalIntensity(value)}
              onValueCommit={([value]) => commitIntensity(value)}
              min={0}
              max={100}
              step={1}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-zinc-400">Easing</Label>
            <SelectWrapper
              value={animation.easing || 'linear'}
              onValueChange={(value) => handleAnimationChange({ easing: value as EasingType })}
              options={[
                { value: 'linear',  label: 'Linear' },
                { value: 'easeIn',  label: 'Ease In' },
                { value: 'easeOut', label: 'Ease Out' },
                { value: 'bounce',  label: 'Bounce' },
                { value: 'elastic', label: 'Elastic' },
              ]}
              triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
              contentClassName="bg-zinc-900 border-zinc-700"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-zinc-400">Direction</Label>
            <SelectWrapper
              value={animation.direction || 'forward'}
              onValueChange={(value) => handleAnimationChange({ direction: value as typeof animation.direction })}
              options={directions}
              triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
              contentClassName="bg-zinc-900 border-zinc-700"
            />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs text-zinc-400">Loop</Label>
            <Switch
              checked={animation.loop}
              onCheckedChange={(checked) => handleAnimationChange({ loop: checked })}
            />
          </div>

          <div className="p-2 rounded-md bg-blue-950/20 border border-blue-900/30">
            <p className="text-xs text-blue-300">
              Mask animation uses the same smooth animation system as gradient animations.
              {animation.type === 'rotate' && ' Rotates the mask shape continuously.'}
              {animation.type === 'scale' && ' Scales the mask with breathing motion.'}
              {animation.type === 'pulse' && ' Pulses mask opacity rhythmically.'}
              {animation.type === 'drift' && ' Drifts the mask position smoothly.'}
              {animation.type === 'swing' && ' Swings the mask like a pendulum.'}
              {animation.type === 'breathe' && ' Adds a soft living inhale/exhale shape behavior.'}
              {animation.type === 'scanReveal' && ' Moves the mask through a scanner-style reveal pass.'}
              {animation.type === 'radialExpand' && ' Expands the mask outward from its center point.'}
              {animation.type === 'sliceWipe' && ' Pushes the mask across the canvas as a directional slice wipe.'}
              {animation.type === 'glitchMask' && ' Adds controlled digital jump-cut motion to the mask.'}
              {animation.type === 'orbitDrift' && ' Orbits the mask with subtle rotation for animated glyph systems.'}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
