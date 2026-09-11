import { Button } from '../ui/button';
import { isMediaFriendlyAnimation } from '../../hooks/useLayerAnimations';
import { Label } from '../ui/label';
import { Slider } from '../ui/slider';
import { Switch } from '../ui/switch';
import { SelectWrapper } from '../ui/select-wrapper';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../ui/accordion';
import { AnimationPresetsPanel } from './AnimationPresetsPanel';
import { memo, useMemo, useState, useEffect } from 'react';
import { RotateCcw, Shuffle } from 'lucide-react';
import { toast } from 'sonner';
import type { AnimationConfig, AnimationType, EasingType, AnimationDirection } from '../../types/gradient';

interface AnimationControlsProps {
  animation: AnimationConfig;
  onChange: (animation: AnimationConfig) => void;
  onReset?: () => void; // Optional reset callback
  onStartDrag?: () => void;  // NEW: Signal drag start
  onEndDrag?: () => void;    // NEW: Signal drag end
  /** STAGE 2.9.3: active layer renders media — surfaces the field-safety note. */
  isMediaLayer?: boolean;
}

export const AnimationControls = memo(function AnimationControls({ 
  animation, 
  onChange, 
  onReset,
  onStartDrag,
  onEndDrag,
  isMediaLayer = false
}: AnimationControlsProps) {
  // Memoize the safe animation to prevent unnecessary re-renders
  const safeAnimation: AnimationConfig = useMemo(() => animation || {
    enabled: false,
    type: 'rotation',
    speed: 1,
    intensity: 1,
    easing: 'linear',
    direction: 'forward',
    loop: true,
    resetCounter: 0,
  }, [animation]);

  // 🔥 LOCAL STATE FOR SLIDERS (COMMIT-BASED PATTERN)
  const [localSpeed, setLocalSpeed] = useState(safeAnimation.speed);
  const [localIntensity, setLocalIntensity] = useState(safeAnimation.intensity);
  // SPRINT 3.1.2: Glitch-only controls, same commit pattern.
  const [localGlitchSeed, setLocalGlitchSeed] = useState(safeAnimation.glitchSeed ?? 0.5);
  const [localGlitchChaos, setLocalGlitchChaos] = useState(safeAnimation.glitchChaos ?? 0.5);

  // Sync local state when props change (from external updates)
  useEffect(() => {
    setLocalSpeed(safeAnimation.speed);
  }, [safeAnimation.speed]);

  useEffect(() => {
    setLocalIntensity(safeAnimation.intensity);
  }, [safeAnimation.intensity]);

  useEffect(() => {
    setLocalGlitchSeed(safeAnimation.glitchSeed ?? 0.5);
  }, [safeAnimation.glitchSeed]);

  useEffect(() => {
    setLocalGlitchChaos(safeAnimation.glitchChaos ?? 0.5);
  }, [safeAnimation.glitchChaos]);

  const updateAnimation = (updates: Partial<AnimationConfig>) => {
    onChange({ ...safeAnimation, ...updates });
  };

  const commitSpeed = (value: number) => {
    updateAnimation({ speed: value });
    onEndDrag?.();
  };

  const commitIntensity = (value: number) => {
    updateAnimation({ intensity: value });
    onEndDrag?.();
  };

  const commitGlitchSeed = (value: number) => {
    updateAnimation({ glitchSeed: value });
    onEndDrag?.();
  };

  const commitGlitchChaos = (value: number) => {
    updateAnimation({ glitchChaos: value });
    onEndDrag?.();
  };

  const shuffleGlitchSeed = () => {
    const next = Math.random();
    setLocalGlitchSeed(next);
    updateAnimation({ glitchSeed: next });
    toast.success('New glitch pattern', { duration: 1200 });
  };

  const animationTypes: { value: AnimationType; label: string; description: string }[] = [
    { value: 'rotation', label: 'Rotation', description: 'Spin continuously' },
    { value: 'pulse', label: 'Pulse', description: 'Breathe in/out' },
    { value: 'wave', label: 'Wave', description: 'Travelling sheet sweep' },
    { value: 'morph', label: 'Morph', description: 'Liquid blob warp' },
    { value: 'drift', label: 'Drift', description: 'Circular orbit' },
    { value: 'scale', label: 'Scale', description: 'Zoom in/out' },
    { value: 'turbulence', label: 'Turbulence', description: 'Chaotic organic' },
    { value: 'glitch', label: 'Glitch', description: 'Digital datamosh tear' },
    { value: 'hueShift', label: 'Hue Shift', description: 'Color rotation' },
    { value: 'ripple', label: 'Ripple', description: 'Expanding rings' },
    { value: 'dualShifter', label: 'Dual Shifter', description: 'Frame shift w/ vortex' },
    { value: 'vortex', label: 'Vortex', description: 'Spiral swirl' },
    { value: 'kaleidoscope', label: 'Kaleidoscope', description: 'Spinning gem rotation' },
    { value: 'fractalZoom', label: 'Fractal Zoom', description: 'Infinite zoom-in' },
    { value: 'chromaticPulse', label: 'LFO Pulse', description: 'Rhythmic pulsing' },
    { value: 'liquid', label: 'Liquid', description: 'Morphing drift' },
  ];

  const easingTypes: { value: EasingType; label: string }[] = [
    { value: 'linear', label: 'Linear' },
    // Legacy (backward compatible, mapped to anime.js)
    { value: 'easeIn', label: 'Ease In (Cubic)' },
    { value: 'easeOut', label: 'Ease Out (Cubic)' },
    { value: 'easeInOut', label: 'Ease In/Out (Cubic)' },
    { value: 'bounce', label: 'Bounce' },
    { value: 'elastic', label: 'Elastic' },
    // Anime.js enhanced - Quad (gentle)
    { value: 'easeInQuad', label: 'Ease In Quad' },
    { value: 'easeOutQuad', label: 'Ease Out Quad' },
    { value: 'easeInOutQuad', label: 'Ease In/Out Quad' },
    // Anime.js enhanced - Cubic
    { value: 'easeInCubic', label: 'Ease In Cubic' },
    { value: 'easeOutCubic', label: 'Ease Out Cubic' },
    { value: 'easeInOutCubic', label: 'Ease In/Out Cubic' },
    // Anime.js enhanced - Quart (smooth)
    { value: 'easeInQuart', label: 'Ease In Quart' },
    { value: 'easeOutQuart', label: 'Ease Out Quart' },
    { value: 'easeInOutQuart', label: 'Ease In/Out Quart' },
    // Anime.js enhanced - Quint (very smooth)
    { value: 'easeInQuint', label: 'Ease In Quint' },
    { value: 'easeOutQuint', label: 'Ease Out Quint' },
    { value: 'easeInOutQuint', label: 'Ease In/Out Quint' },
    // Anime.js enhanced - Sine (natural)
    { value: 'easeInSine', label: 'Ease In Sine' },
    { value: 'easeOutSine', label: 'Ease Out Sine' },
    { value: 'easeInOutSine', label: 'Ease In/Out Sine' },
    // Anime.js enhanced - Expo (dramatic)
    { value: 'easeInExpo', label: 'Ease In Expo' },
    { value: 'easeOutExpo', label: 'Ease Out Expo' },
    { value: 'easeInOutExpo', label: 'Ease In/Out Expo' },
    // Anime.js enhanced - Circ (circular)
    { value: 'easeInCirc', label: 'Ease In Circ' },
    { value: 'easeOutCirc', label: 'Ease Out Circ' },
    { value: 'easeInOutCirc', label: 'Ease In/Out Circ' },
    // Anime.js enhanced - Back (overshoot)
    { value: 'easeInBack', label: 'Ease In Back' },
    { value: 'easeOutBack', label: 'Ease Out Back' },
    { value: 'easeInOutBack', label: 'Ease In/Out Back' },
    // Anime.js enhanced - Elastic (spring)
    { value: 'easeInElastic', label: 'Ease In Elastic' },
    { value: 'easeOutElastic', label: 'Ease Out Elastic' },
    { value: 'easeInOutElastic', label: 'Ease In/Out Elastic' },
    // Anime.js enhanced - Bounce
    { value: 'easeInBounce', label: 'Ease In Bounce' },
    { value: 'easeOutBounce', label: 'Ease Out Bounce' },
    { value: 'easeInOutBounce', label: 'Ease In/Out Bounce' },
  ];

  const directionTypes: { value: AnimationDirection; label: string }[] = [
    { value: 'forward', label: 'Forward' },
    { value: 'reverse', label: 'Reverse' },
    { value: 'pingPong', label: 'Ping-Pong' },
  ];

  return (
    <div className="space-y-6">
      {/* Enable Animation */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label>Enable Animation</Label>
          <p className="text-xs text-zinc-500">Animate this layer</p>
        </div>
        <Switch
          checked={safeAnimation.enabled}
          onCheckedChange={(enabled) => updateAnimation({ enabled })}
        />
      </div>

      {/* Animation Type - Always Visible */}
      <div className="space-y-2">
        <Label className="text-xs text-zinc-400">Animation Type</Label>
        <select
          value={safeAnimation.type}
          onChange={(e) => updateAnimation({ type: e.target.value as AnimationType })}
          className="w-full h-9 pr-10 pl-3 py-2 text-sm bg-[#262626] border border-zinc-700 rounded-md text-zinc-100 hover:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-colors"
        >
          {animationTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label} - {type.description}
            </option>
          ))}
        </select>
      </div>

      {/* Easing / LFO Mode — hidden for glitch (pseudo-random, not easing-driven) */}
      {safeAnimation.type !== 'glitch' && (
      <div className="space-y-2">
        <Label className="text-xs text-zinc-400">
          {safeAnimation.type === 'chromaticPulse' ? 'LFO Mode' : 'Easing'}
        </Label>
        <select
          value={safeAnimation.easing || 'linear'}
          onChange={(e) => updateAnimation({ easing: e.target.value as EasingType })}
          className="w-full h-9 pr-10 pl-3 py-2 text-sm bg-[#262626] border border-zinc-700 rounded-md text-zinc-100 hover:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-colors"
        >
          {safeAnimation.type === 'chromaticPulse' ? (
            <>
              <option value="linear">Stutter — Sharp flash, long silence</option>
              <option value="ease">Oscillate — Smooth continuous throb</option>
              <option value="bounce">Pulse — Fast rise, slow decay</option>
              <option value="easeIn">Strobe — Rapid double-flash burst</option>
              <option value="easeOut">Wave — Rolling soft wave</option>
            </>
          ) : (
            easingTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))
          )}
        </select>
      </div>
      )}

      {/* Glitch controls — shown instead of easing/direction */}
      {safeAnimation.type === 'glitch' && (
        <>
          <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
            <p className="text-[10px] text-zinc-500">
              Glitch uses pseudo-random bucket timing — easing and direction don't apply to this type.
            </p>
          </div>

          {/* SPRINT 3.1.2: two new controls so glitch doesn't tear the same
              way every time it's turned on — Pattern picks WHERE it tears,
              Chaos controls HOW MUCH. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Pattern</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-400">{Math.round(localGlitchSeed * 100)}</span>
                <button
                  type="button"
                  onClick={shuffleGlitchSeed}
                  className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                  title="Shuffle pattern"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <Slider
              value={[localGlitchSeed * 100]}
              onValueChange={([value]) => setLocalGlitchSeed(value / 100)}
              onValueCommit={([value]) => commitGlitchSeed(value / 100)}
              min={0}
              max={100}
              step={1}
            />
            <p className="text-xs text-zinc-500">Which bands tear and when — shuffle for a different layout</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Chaos</Label>
              <span className="text-sm text-zinc-400">{Math.round(localGlitchChaos * 100)}%</span>
            </div>
            <Slider
              value={[localGlitchChaos * 100]}
              onValueChange={([value]) => setLocalGlitchChaos(value / 100)}
              onValueCommit={([value]) => commitGlitchChaos(value / 100)}
              min={0}
              max={100}
              step={1}
            />
            <div className="flex justify-between text-xs text-zinc-500">
              <span>Sparse</span>
              <span>Aggressive</span>
            </div>
          </div>
        </>
      )}

      {/* Direction — hidden for glitch */}
      {safeAnimation.type !== 'glitch' && (
      <div className="space-y-2">
        <Label className="text-xs text-zinc-400">Direction</Label>
        <select
          value={safeAnimation.direction || 'forward'}
          onChange={(e) => updateAnimation({ direction: e.target.value as AnimationDirection })}
          className="w-full h-9 pr-10 pl-3 py-2 text-sm bg-[#262626] border border-zinc-700 rounded-md text-zinc-100 hover:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-colors"
        >
          {directionTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </div>
      )}

      {/* Speed - Always Visible */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Speed</Label>
          <span className="text-sm text-zinc-400">{localSpeed.toFixed(1)}</span>
        </div>
        <Slider
          value={[localSpeed]}
          onValueChange={([value]) => {
            // Update local display number only — NO canvas update during drag.
            // The canvas EMA smoother in GradientCanvas reads the committed speed
            // value and ramps to it over ~6 frames, eliminating the chaotic jump.
            setLocalSpeed(value);
          }}
          onValueCommit={([value]) => {
            // Fire ONE update on pointer-up — the EMA in GradientCanvas eases in
            // from the old smoothedSpeed to this new target over ~100ms.
            commitSpeed(value);
          }}
          min={0.1}
          max={10}
          step={0.1}
        />
        <div className="flex justify-between text-xs text-zinc-500">
          <span>Slow</span>
          <span>Fast</span>
        </div>
      </div>

      {/* Intensity - Always Visible */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Intensity</Label>
          <span className="text-sm text-zinc-400">{Math.round(localIntensity * 100)}%</span>
        </div>
        <Slider
          value={[localIntensity * 100]}
          onValueChange={([value]) => {
            const next = value / 100;
            setLocalIntensity(next);
            onStartDrag?.();
          }}
          onValueCommit={([value]) => commitIntensity(value / 100)}
          min={0}
          max={100}
          step={1}
        />
        <div className="flex justify-between text-xs text-zinc-500">
          <span>Subtle</span>
          <span>Extreme</span>
        </div>
      </div>

      {/* Loop - Always Visible */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label>Loop Animation</Label>
          <p className="text-xs text-zinc-500">Repeat continuously</p>
        </div>
        <Switch
          checked={safeAnimation.loop}
          onCheckedChange={(loop) => updateAnimation({ loop })}
        />
      </div>

      {/* Animation Presets - Always Visible */}
      <Accordion type="single" collapsible className="border-t border-zinc-800 pt-4">
        <AccordionItem value="presets" className="border-none">
          <AccordionTrigger className="text-sm py-2 px-3 rounded-md bg-[#262626] hover:no-underline hover:bg-[#2a2a2a]" style={{ color: '#51A2FF' }}>
            Animation Presets
          </AccordionTrigger>
          <AccordionContent className="pt-3">
            <AnimationPresetsPanel
              currentAnimation={safeAnimation}
              onApplyPreset={(newAnimation) => updateAnimation(newAnimation)}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Reset Button - Always show when animation is enabled */}
      {safeAnimation.enabled && (
        <div className="border-t border-zinc-800 pt-4">
          <button
            onClick={() => {
              const currentCounter = safeAnimation.resetCounter || 0;
              updateAnimation({ resetCounter: currentCounter + 1 });
              toast.success('Animation restarted', { duration: 1500 });
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-zinc-100 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-md transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Restart Cycle
          </button>
          <p className="text-xs text-zinc-500 mt-2 text-center">
            Restart animation from beginning
          </p>
        </div>
      )}

      {/* STAGE 2.9.3: say out loud that media takes a different path. Without
          this the same preset legitimately looks different on a media layer
          than on a gradient, which reads as a bug rather than a deliberate
          (and necessary) difference. */}
      {isMediaLayer && !isMediaFriendlyAnimation(safeAnimation.type) && (
        <div className="rounded-md border border-blue-900/50 bg-blue-950/25 p-2.5 text-[11px] leading-relaxed text-zinc-400">
          <span className="font-medium text-blue-300">Media-safe motion:</span>{' '}
          this animation is a displacement field. On a gradient it can sample
          anywhere; on media it would pull the image outside its own edges, so
          it runs bounded here — Vortex as a true rotation, others
          magnitude-limited. Expect a calmer result than on a gradient layer.
        </div>
      )}

      {/* ProTip */}
      <div className="border-t border-zinc-800 pt-4">
        <div className="flex items-start gap-2 text-xs text-zinc-500">
          <span className="flex-shrink-0">💡</span>
          <p>
            <span className="font-medium text-zinc-400">Protip:</span> Various animation types react differently depending on the type of gradient on canvas.
          </p>
        </div>
      </div>
    </div>
  );
});