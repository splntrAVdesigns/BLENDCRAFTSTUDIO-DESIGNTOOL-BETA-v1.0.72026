/**
 * useLayerAnimations.ts  —  v6 animation engine (full easing integration)
 *
 * DESIGN PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. UNBOUNDED MONOTONIC TIME
 *    All animation drivers use `signedTime = animationTime * speed` directly —
 *    an unbounded, ever-increasing value that never resets or wraps.
 *    sin/cos of signedTime produces perfectly seamless, continuous oscillation.
 *    No fract(), no modulo wrap, no cycle boundaries to snap on.
 *
 * 2. fract() ONLY FOR BOUNDED ANIMATIONS
 *    phase01 = fract(animationTime / cycleSeconds) is still computed for:
 *    - pingPong direction (needs 0→1→0 shape)
 *    - reverse direction  (needs 1→0 shape)
 *    - liquid/drift (need exact 0→1 sweep per cycle for positional wrapping)
 *    Everything else uses sin/cos(signedTime * freq) — no hard boundaries.
 *
 * 3. PAUSE / RESUME CORRECTNESS
 *    animationTime is the accumulated wall-clock seconds while playing.
 *    It is preserved on pause and resumed from exactly where it stopped.
 *    All sin/cos expressions produce the same value for the same time input,
 *    so freeze/resume is inherently correct with zero extra bookkeeping.
 *
 * 4. FLOAT PRECISION GUARD
 *    animationTime is periodically modulo-wrapped in GradientCanvas at pause
 *    points (every ~300s) to prevent float precision decay after long sessions.
 *    sin/cos are periodic so the wrap is invisible.
 *
 * 5. VSYNC JITTER SMOOTHING
 *    The clock in GradientCanvas uses an EMA-smoothed delta so 16.6ms/17.3ms
 *    frame oscillation doesn't produce visible micro-stutter at slow speeds.
 *
 * 6. ANIME.JS 4.4.1 EASING INTEGRATION (NEW)
 *    Superior easing engine with hardware-accelerated curves for smoother motion.
 *    Supports advanced easings: spring physics, cubic bezier, irregular curves.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useRef } from 'react';
import { eases } from 'animejs/easings/eases';
import { estimateCycleTime } from '../animation/estimateAnimationCycle';
export { estimateCycleTime } from '../animation/estimateAnimationCycle';
import type {
  Layer,
  LayerTransformState,
  AnimationType,
  EasingType,
  AnimationDirection,
  AnimationEval,
} from '../types/gradient';

// ─── Hook types ──────────────────────────────────────────────────────────────

interface UseLayerAnimationsReturn {
  initializeLayer: (layerId: string, layer: Layer) => void;
  updateLayerTransformState: (layerId: string, updates: Partial<LayerTransformState>) => void;
  getLayerTransformState: (layerId: string) => LayerTransformState | undefined;
  resetLayerAnimation: (layerId: string) => void;
  setBaseTransform: (
    layerId: string,
    baseUpdates: Partial<
      Pick<LayerTransformState, 'baseAngle' | 'baseCenterX' | 'baseCenterY' | 'baseScale'>
    >
  ) => void;
}

const createDefaultTransformState = (layer: Layer): LayerTransformState => {
  const g = layer.gradient;
  return {
    currentAngle:    g?.angle    || 0,
    currentCenterX:  g?.centerX  || 0.5,
    currentCenterY:  g?.centerY  || 0.5,
    currentScale:    g?.scale    || 1,
    currentIntensity: g?.intensity || 1,
    animationTime:   0,
    baseAngle:       g?.angle    || 0,
    baseCenterX:     g?.centerX  || 0.5,
    baseCenterY:     g?.centerY  || 0.5,
    baseScale:       g?.scale    || 1,
    signedPhase:     0,
    smoothedSpeed:   layer.animation?.speed ?? 0,
  };
};

export function useLayerAnimations(): UseLayerAnimationsReturn {
  const layerStatesRef = useRef<Map<string, LayerTransformState>>(new Map());

  const initializeLayer = useCallback((layerId: string, layer: Layer) => {
    if (!layerStatesRef.current.has(layerId)) {
      layerStatesRef.current.set(
        layerId,
        layer.transformState || createDefaultTransformState(layer)
      );
    }
  }, []);

  const updateLayerTransformState = useCallback(
    (layerId: string, updates: Partial<LayerTransformState>) => {
      const s = layerStatesRef.current.get(layerId);
      if (s) layerStatesRef.current.set(layerId, { ...s, ...updates });
    },
    []
  );

  const getLayerTransformState = useCallback(
    (layerId: string) => layerStatesRef.current.get(layerId),
    []
  );

  const resetLayerAnimation = useCallback((layerId: string) => {
    const s = layerStatesRef.current.get(layerId);
    if (s) {
      layerStatesRef.current.set(layerId, {
        ...s,
        currentAngle:   s.baseAngle,
        currentCenterX: s.baseCenterX,
        currentCenterY: s.baseCenterY,
        currentScale:   s.baseScale,
        animationTime:  0,
      });
    }
  }, []);

  const setBaseTransform = useCallback(
    (
      layerId: string,
      baseUpdates: Partial<
        Pick<LayerTransformState, 'baseAngle' | 'baseCenterX' | 'baseCenterY' | 'baseScale'>
      >
    ) => {
      const s = layerStatesRef.current.get(layerId);
      if (!s) return;
      const n = { ...s, ...baseUpdates };
      if (baseUpdates.baseAngle    !== undefined) n.currentAngle   = baseUpdates.baseAngle;
      if (baseUpdates.baseCenterX  !== undefined) n.currentCenterX = baseUpdates.baseCenterX;
      if (baseUpdates.baseCenterY  !== undefined) n.currentCenterY = baseUpdates.baseCenterY;
      if (baseUpdates.baseScale    !== undefined) n.currentScale   = baseUpdates.baseScale;
      layerStatesRef.current.set(layerId, n);
    },
    []
  );

  return { initializeLayer, updateLayerTransformState, getLayerTransformState, resetLayerAnimation, setBaseTransform };
}

// ─── Easing (anime.js 4.4.1) ─────────────────────────────────────────────────

/**
 * Apply easing curve using anime.js 4.4.1's superior easing engine.
 * Maps easing names to anime.js easing functions for hardware-accelerated curves.
 */
export function applyEasing(t: number, easing: EasingType): number {
  t = Math.max(0, Math.min(1, t));

  // Map easing type to anime.js easing function
  // Note: Back and Elastic easings are parametric functions - call with default params first
  switch (easing) {
    // Linear
    case 'linear': return (eases.linear as (t: number) => number)(t);

    // CSS ease — smooth inOutSine, used by chromaticPulse LFO Oscillate mode
    case 'ease': return (eases.inOutSine as (t: number) => number)(t);

    // Legacy (backward compatible) - map to cubic equivalents
    case 'easeIn': return (eases.inCubic as (t: number) => number)(t);
    case 'easeOut': return (eases.outCubic as (t: number) => number)(t);
    case 'easeInOut': return (eases.inOutCubic as (t: number) => number)(t);
    case 'bounce': return (eases.outBounce as (t: number) => number)(t);
    case 'elastic': return ((eases.outElastic as any)(1, 0.3))(t); // ElasticEasing with defaults

    // Quad
    case 'easeInQuad': return (eases.inQuad as (t: number) => number)(t);
    case 'easeOutQuad': return (eases.outQuad as (t: number) => number)(t);
    case 'easeInOutQuad': return (eases.inOutQuad as (t: number) => number)(t);

    // Cubic
    case 'easeInCubic': return (eases.inCubic as (t: number) => number)(t);
    case 'easeOutCubic': return (eases.outCubic as (t: number) => number)(t);
    case 'easeInOutCubic': return (eases.inOutCubic as (t: number) => number)(t);

    // Quart
    case 'easeInQuart': return (eases.inQuart as (t: number) => number)(t);
    case 'easeOutQuart': return (eases.outQuart as (t: number) => number)(t);
    case 'easeInOutQuart': return (eases.inOutQuart as (t: number) => number)(t);

    // Quint
    case 'easeInQuint': return (eases.inQuint as (t: number) => number)(t);
    case 'easeOutQuint': return (eases.outQuint as (t: number) => number)(t);
    case 'easeInOutQuint': return (eases.inOutQuint as (t: number) => number)(t);

    // Sine
    case 'easeInSine': return (eases.inSine as (t: number) => number)(t);
    case 'easeOutSine': return (eases.outSine as (t: number) => number)(t);
    case 'easeInOutSine': return (eases.inOutSine as (t: number) => number)(t);

    // Expo
    case 'easeInExpo': return (eases.inExpo as (t: number) => number)(t);
    case 'easeOutExpo': return (eases.outExpo as (t: number) => number)(t);
    case 'easeInOutExpo': return (eases.inOutExpo as (t: number) => number)(t);

    // Circ
    case 'easeInCirc': return (eases.inCirc as (t: number) => number)(t);
    case 'easeOutCirc': return (eases.outCirc as (t: number) => number)(t);
    case 'easeInOutCirc': return (eases.inOutCirc as (t: number) => number)(t);

    // Back (parametric - call with default overshoot)
    case 'easeInBack': return ((eases.inBack as any)(1.7))(t);
    case 'easeOutBack': return ((eases.outBack as any)(1.7))(t);
    case 'easeInOutBack': return ((eases.inOutBack as any)(1.7))(t);

    // Elastic (parametric - call with default amplitude and period)
    case 'easeInElastic': return ((eases.inElastic as any)(1, 0.3))(t);
    case 'easeOutElastic': return ((eases.outElastic as any)(1, 0.3))(t);
    case 'easeInOutElastic': return ((eases.inOutElastic as any)(1, 0.3))(t);

    // Bounce
    case 'easeInBounce': return (eases.inBounce as (t: number) => number)(t);
    case 'easeOutBounce': return (eases.outBounce as (t: number) => number)(t);
    case 'easeInOutBounce': return (eases.inOutBounce as (t: number) => number)(t);

    default: return t;
  }
}

// ─── Internal constants ───────────────────────────────────────────────────────

const TAU = Math.PI * 2;

function fract(v: number): number { return v - Math.floor(v); }
function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }
function triangle01(t: number): number { return 1 - Math.abs(1 - 2 * t); }

/** Smooth symmetric wave in [-1, 1] driven by an unbounded angle (radians). */
function wave(radians: number): number { return Math.sin(radians); }

// ─── Core phase calculator ────────────────────────────────────────────────────
/**
 * Returns the canonical set of phase descriptors.
 *
 * KEY CHANGE FROM v3:
 *   signedTime  = animationTime * speed   (unbounded — primary driver for sin/cos)
 *   phase01     = fract-based 0-1         (only used where a hard 0→1 sweep is needed)
 *
 * Most animation cases now use `signedTime` directly so they are truly
 * continuous and never snap on cycle boundaries.
 */
function getPhase(
  animationType: AnimationType,
  animationTime: number,
  speed: number,
  easing: EasingType,
  direction: AnimationDirection
) {
  const cycleSeconds = Math.max(0.001, estimateCycleTime(animationType, speed) / 1000);

  // Bounded 0-1 phase — computed first now, since pingPong's signedTime fix
  // below needs it too (not just phase01/eased01 as before).
  const basePhase = fract(animationTime / cycleSeconds);
  let phase01 = direction === 'reverse'  ? 1 - basePhase
              : direction === 'pingPong' ? triangle01(basePhase)
              : basePhase;

  // SPRINT 3.1.0 FIX — DIRECTION MODE WAS INERT UNDER LINEAR EASING.
  // Previously: signedTime only flipped sign for 'reverse'; 'pingPong' used
  // the exact same unbounded formula as 'forward'. Since every animation
  // case (and every GPU shader field, which is driven by uAnimTime =
  // signedTime directly) falls back to raw signedTime whenever easing is
  // 'linear' — the default — PingPong was pixel-for-pixel identical to
  // Forward for every animation type, on every gradient type, as long as
  // Easing was Linear. Direction only did anything if a non-linear easing
  // happened to route through eased01/theta instead.
  //
  // Fix: for 'pingPong', signedTime now bounces through the same
  // triangle-folded phase01 already computed above (the same technique the
  // 'liquid' case already used locally for its own hue drift) — scaled back
  // out to real seconds so every existing Hz/rad-per-second constant
  // downstream keeps working unchanged. This makes PingPong visibly bounce
  // even under Linear easing, for both JS transforms and shader fields.
  const rawTime = animationTime * speed;
  const signedTime = direction === 'reverse'
    ? -rawTime
    : direction === 'pingPong'
    ? triangle01(basePhase) * cycleSeconds
    : rawTime;

  const eased01 = applyEasing(clamp01(phase01), easing);

  // theta is the primary oscillation angle (unbounded radians from signedTime)
  // For eased modes, we construct theta from eased01 per-cycle; otherwise use signedTime directly
  const theta = easing === 'linear'
    ? signedTime * TAU   // unbounded continuous wave (now pingPong-aware too)
    : eased01 * TAU;     // easing applied within each cycle boundary

  return { cycleSeconds, phase01, eased01, theta, signedTime };
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function calculateAnimationOffset(
  animationType: AnimationType,
  animationTime: number,
  speed: number,
  intensity: number,
  easing: EasingType = 'linear',
  direction: AnimationDirection = 'forward',
  loop: boolean = true
): AnimationEval {
  const base: AnimationEval = {
    angleOffset: 0, scaleOffset: 0, xOffset: 0, yOffset: 0,
    intensityMultiplier: 1, hueShiftOffset: 0,
    phase01: 0, eased01: 0, theta: 0, signedTime: 0, cycleSeconds: 1,
  };

  const { cycleSeconds, phase01, eased01, theta, signedTime } = getPhase(
    animationType, animationTime, speed, easing, direction
  );

  // One-shot: freeze at end of first cycle when loop=false
  if (!loop && animationTime > cycleSeconds) {
    return { ...base, phase01, eased01, theta, signedTime, cycleSeconds };
  }

  const i = intensity;

  switch (animationType) {

    // ── Continuous rotation ─────────────────────────────────────────────────
    // linear: constant angular velocity via signedTime — seamless, no boundary.
    // non-linear: eased01*360 gives one full revolution per cycle with eased
    //   velocity profile (easeInOut = slow→fast→slow within each turn).
    //   pingPong direction uses triangle01(phase), so eased01*360 naturally
    //   rotates forward then back — correct bidirectional behaviour.
    case 'rotation': {
      const deg = easing === 'linear'
        ? ((signedTime * 36) % 360 + 360) % 360
        : eased01 * 360;
      return { ...base, angleOffset: deg, phase01, eased01, theta, signedTime, cycleSeconds };
    }

    // ── Oscillating scale + intensity (breathe) ─────────────────────────────
    // theta = eased01*TAU when non-linear → easing reshapes the sin waveform.
    // easeInOut: slow at peaks, fast through centre — natural breathe rhythm.
    case 'pulse': {
      const breath = Math.sin(easing === 'linear' ? signedTime * TAU : theta);
      return {
        ...base,
        scaleOffset: breath * 0.32 * i,
        intensityMultiplier: 1 + breath * 0.22 * i,
        phase01, eased01, theta, signedTime, cycleSeconds,
      };
    }

    case 'scale': {
      const zoom = Math.sin(easing === 'linear' ? signedTime * TAU : theta);
      return { ...base, scaleOffset: zoom * 0.28 * i, phase01, eased01, theta, signedTime, cycleSeconds };
    }

    // ── Circular drift ───────────────────────────────────────────────────────
    // Orbital angle uses theta — eased orbital velocity (orbit speeds up/slows down).
    // Harmonics for scale/intensity stay on signedTime to preserve organic character.
    case 'drift': {
      // SPRINT 3.1.0 — HARMONIC RETUNE. Orbital angle and both harmonics are now
      // integer multiples of TAU/4s, so the whole term closes exactly at the
      // declared 4s cycle (previously the orbit silently completed a full
      // revolution every 1s regardless of the declared cycle — see diagnostic).
      const t = signedTime * TAU;
      const a = easing === 'linear' ? t * 0.25 : theta; // 1 revolution per 4s
      return {
        ...base,
        xOffset: Math.cos(a) * 0.07 * i,
        yOffset: Math.sin(a) * 0.07 * i,
        scaleOffset:  Math.sin(t * 0.75) * 0.025 * i,
        intensityMultiplier: 1 + Math.sin(t * 1.25) * 0.06 * i,
        phase01, eased01, theta, signedTime, cycleSeconds,
      };
    }

    // ── Multi-frequency organic motion ───────────────────────────────────────
    // Easing applied to the slow (dominant) component only.
    // Fast harmonics (1.9x, 2.7x) stay on signedTime — preserves organic texture.
    case 'ripple': {
      // SPRINT 3.1.0 — HARMONIC RETUNE. 0.47/0.39/1.9/2.7 Hz didn't share a
      // common period; retuned to 0.5/0.375/1.875/2.6875 Hz — all exact
      // integer multiples of 1/16s — so the JS ripple closes at 16s, matching
      // the shader-field ripple retune (both are "ripple" and must agree).
      const t   = signedTime;
      const s   = easing === 'linear' ? t : eased01; // slow/primary driver
      return {
        ...base,
        xOffset: (Math.sin(s * 0.5 * TAU) * 0.036 + Math.sin(t * 1.875 * TAU) * 0.014) * i,
        yOffset: (Math.cos(s * 0.375 * TAU) * 0.036 + Math.cos(t * 2.6875 * TAU) * 0.014) * i,
        scaleOffset: Math.sin(t * 1.875 * TAU + 0.4) * 0.028 * i,
        intensityMultiplier: 1 + Math.abs(Math.sin(t * 1.875 * TAU)) * 0.10 * i,
        hueShiftOffset: Math.sin(s * 0.5 * TAU) * 5 * i,
        phase01, eased01, theta, signedTime, cycleSeconds,
      };
    }

    // ── Dual Shifter ─────────────────────────────────────────────────────────
    // theta as base angle reshapes the sweep and sparkle waveforms together.
    case 'shimmer':       // backward-compat alias for saved projects
    case 'dualShifter': {
      const t = easing === 'linear' ? signedTime * TAU : theta;
      const sweep   = Math.sin(t);
      const sparkle = Math.pow(Math.max(0, Math.sin(t * 6.0)), 6.0);
      return {
        ...base,
        xOffset: sweep * 0.018 * i,
        yOffset: Math.cos(t * 0.7) * 0.008 * i,
        scaleOffset: sparkle * 0.03 * i,
        intensityMultiplier: 1 + (0.10 * sweep + 0.24 * sparkle) * i,
        hueShiftOffset: sparkle * 14 * i,
        phase01, eased01, theta, signedTime, cycleSeconds,
      };
    }

    // ── Kaleidoscope — Spinning Gem ──────────────────────────────────────────
    // Rotation and hue both use eased01*360 when non-linear (same as rotation).
    // Flash uses theta for easing-shaped facet pops.
    case 'kaleidoscope': {
      // SPRINT 3.1.0 (revised): rotation stays at 60deg/s (6s/turn, so 5 clean
      // turns fit a 30s cycle). Hue was 6deg/s (needed 60s to close on its
      // own) — doubled to 12deg/s so it closes in exactly 30s too, matching
      // the shortened declared cycle below. Hue drift is now twice as fast
      // as the first pass — flag if that reads as too brisk.
      const rotDeg = easing === 'linear'
        ? ((signedTime * 60) % 360 + 360) % 360
        : eased01 * 360;
      const t = easing === 'linear' ? signedTime * TAU : theta;
      const flash = Math.pow(Math.abs(Math.sin(t * 2.0)), 8.0);
      const hue   = easing === 'linear'
        ? ((signedTime * 12) % 360 + 360) % 360
        : eased01 * 360;
      return {
        ...base,
        angleOffset: rotDeg * i,
        intensityMultiplier: 1 + (0.30 * flash) * i,
        hueShiftOffset: hue * i,
        scaleOffset: flash * 0.015 * i,
        phase01, eased01, theta, signedTime, cycleSeconds,
      };
    }

    // ── Fractal Zoom ─────────────────────────────────────────────────────────
    // baseP drives the zoom CURVE (easing affects zoom acceleration shape).
    // cyclePhase drives the CROSSFADE guard (always the raw linear position).
    //
    // CRITICAL: the crossfade MUST use cyclePhase (raw phase01), not baseP
    // (the eased value). Non-linear easings like Bounce/Elastic reach their
    // peak value (1.0) multiple times per cycle — each peak would trigger the
    // fade, briefly collapsing zoomScale to 0, causing the fractal gradient
    // shader (adjustedScale = scale * uScale) to return to a tiny UV divisor
    // and tile the canvas in a 3×3 grid. Using the raw cycle position ensures
    // the fade fires exactly ONCE per cycle at the natural loop boundary.
    case 'fractalZoom': {
      const p  = direction === 'reverse' ? 1 - phase01  : phase01;
      const pE = direction === 'reverse' ? 1 - eased01  : eased01;
      const baseP = easing === 'linear' ? p : pE; // drives zoom curve shape

      const EXP_K   = 2.2;
      const expNorm = (Math.exp(baseP * EXP_K) - 1) / (Math.exp(EXP_K) - 1);

      // Raw linear cycle position — fires crossfade exactly once per cycle
      const cyclePhase = direction === 'reverse' ? 1 - phase01 : phase01;
      const FADE_START = 0.92;
      const fadeBlend  = cyclePhase > FADE_START
        ? (cyclePhase - FADE_START) / (1 - FADE_START)
        : 0;
      const zoomScale  = expNorm * 0.55 * i * (1 - fadeBlend);

      return {
        ...base,
        scaleOffset: zoomScale,
        phase01, eased01, theta, signedTime, cycleSeconds,
      };
    }

    // ── LFO Pulse — chromaticPulse ───────────────────────────────────────────
    // Easing field repurposed as LFO mode selector (by design, documented).
    // 'linear' Stutter  'ease' Oscillate  'bounce' Pulse  'easeIn' Strobe  'easeOut' Wave
    case 'chromaticPulse': {
      const t = signedTime;
      const phaseDir = direction === 'reverse' ? -1 : 1;
      const p0 = t * TAU * phaseDir;
      const p1 = p0 + TAU / 3;
      const p2 = p0 + TAU * 2 / 3;

      let ch1: number, ch2: number, ch3: number;
      if (easing === 'ease') {
        ch1 = Math.pow(Math.max(0, Math.sin(p0)), 2);
        ch2 = Math.pow(Math.max(0, Math.sin(p1)), 2) * 0.85;
        ch3 = Math.pow(Math.max(0, Math.sin(p2)), 2) * 0.70;
      } else if (easing === 'bounce') {
        ch1 = Math.pow(Math.abs(Math.sin(p0 * 0.5)), 3);
        ch2 = Math.pow(Math.abs(Math.sin(p1 * 0.5)), 3) * 0.85;
        ch3 = Math.pow(Math.abs(Math.sin(p2 * 0.5)), 3) * 0.70;
      } else if (easing === 'easeIn') {
        ch1 = Math.pow(Math.max(0, Math.sin(p0 * 2)), 12);
        ch2 = Math.pow(Math.max(0, Math.sin(p1 * 2)), 12) * 0.85;
        ch3 = Math.pow(Math.max(0, Math.sin(p2 * 2)), 12) * 0.70;
      } else if (easing === 'easeOut') {
        ch1 = (1 + Math.sin(p0 - Math.PI * 0.5)) * 0.5;
        ch2 = (1 + Math.sin(p1 - Math.PI * 0.5)) * 0.5 * 0.85;
        ch3 = (1 + Math.sin(p2 - Math.PI * 0.5)) * 0.5 * 0.70;
      } else {
        ch1 = Math.pow(Math.max(0, Math.sin(p0)), 8);
        ch2 = Math.pow(Math.max(0, Math.sin(p1)), 8) * 0.85;
        ch3 = Math.pow(Math.max(0, Math.sin(p2)), 8) * 0.70;
      }
      const totalPulse = ch1 + ch2 + ch3;
      return {
        ...base,
        scaleOffset:         totalPulse * 0.22 * i,
        intensityMultiplier: 1 + totalPulse * 0.40 * i,
        hueShiftOffset:      (ch1 * 0 + ch2 * 120 + ch3 * 240) * i,
        phase01, eased01, theta, signedTime, cycleSeconds,
      };
    }

    // ── Liquid ───────────────────────────────────────────────────────────────
    // forward/reverse: signedTime drives continuous multi-frequency hue drift.
    // pingPong FIX v6: was signedTime*(eased01<0.5?1:-1) which caused a visible
    //   hue jump at the phase-switch boundary by flipping the sign of an unbounded
    //   value. Now maps eased01 (triangle01 for pingPong = smooth 0->1->0) to a
    //   +-cycleSeconds range — fully continuous, no discontinuity, easing-aware.
    case 'liquid': {
      // SPRINT 3.1.0 (revised): halved again to match the doubled 16s period
      // shared with the Morph field.
      const t = signedTime;
      const morphT = (direction === 'pingPong')
        ? (eased01 * 2 - 1) * cycleSeconds   // smooth bidirectional, easing-aware
        : t;                                   // forward/reverse: use signedTime

      const hueDrift = Math.sin(morphT * 0.0625 * TAU) * 14
                     + Math.sin(morphT * 0.125 * TAU) *  8
                     + Math.sin(morphT * 0.25 * TAU) *  3;

      const glow = 1 + Math.sin(t * 0.125 * TAU) * 0.06 * i
                     + Math.sin(t * 0.1875 * TAU) * 0.03 * i;

      return {
        ...base,
        intensityMultiplier: glow,
        hueShiftOffset:      hueDrift * i,
        phase01, eased01, theta, signedTime, cycleSeconds,
      };
    }

    // ── Glitch ───────────────────────────────────────────────────────────────
    // Intentionally discrete/quantised — easing and direction are no-ops by design.
    case 'glitch': {
      const bucket = Math.floor(animationTime * (6 + speed * 6));
      const rand = (s: number) => { const x = Math.sin(s * 12.9898) * 43758.5453; return x - Math.floor(x); };
      const isBurst = rand(bucket * 1.13) > 0.72;
      const isMicro = rand(bucket * 1.87) > 0.52;
      const g = isBurst ? 1 : isMicro ? 0.45 : 0.12;
      return {
        ...base,
        angleOffset:         (rand(bucket * 1.31) - 0.5) * 16   * i * g,
        xOffset:             (rand(bucket * 1.73) - 0.5) * 0.045 * i * g,
        yOffset:             (rand(bucket * 2.07) - 0.5) * 0.038 * i * g,
        scaleOffset:         (rand(bucket * 2.71) - 0.5) * 0.030 * i * g,
        intensityMultiplier: 1 + (rand(bucket * 3.17) - 0.5) * 0.18 * i * g,
        hueShiftOffset:      (rand(bucket * 3.71) - 0.5) * 10   * i * g,
        phase01, eased01, theta, signedTime, cycleSeconds,
      };
    }

    // ── Hue shift ────────────────────────────────────────────────────────────
    // linear: constant hue velocity. non-linear: eased01*360 per cycle.
    case 'hueShift': {
      const deg = easing === 'linear'
        ? ((signedTime * 36) % 360 + 360) % 360
        : eased01 * 360;
      return { ...base, hueShiftOffset: deg * i, phase01, eased01, theta, signedTime, cycleSeconds };
    }

    // ── Shader-driven families ────────────────────────────────────────────────
    case 'wave': {
      return {
        ...base,
        intensityMultiplier: 1 + 0.05 * Math.sin(easing === 'linear' ? signedTime * TAU : theta) * i,
        phase01, eased01, theta, signedTime, cycleSeconds,
      };
    }

    case 'morph': {
      // SPRINT 3.1.0 (revised): halved again to match the doubled 16s period.
      const t = easing === 'linear' ? signedTime * TAU : theta;
      return {
        ...base,
        xOffset: Math.sin(t * 0.375) * 0.025 * i,
        yOffset: Math.cos(t * 0.4375) * 0.025 * i,
        scaleOffset: Math.sin(t * 0.5) * 0.03 * i,
        intensityMultiplier: 1 + 0.08 * Math.sin(t) * i,
        phase01, eased01, theta, signedTime, cycleSeconds,
      };
    }

    case 'vortex': {
      const v = Math.sin(easing === 'linear' ? signedTime * TAU : theta);
      return {
        ...base,
        intensityMultiplier: 1 + 0.10 * v * i,
        phase01, eased01, theta, signedTime, cycleSeconds,
      };
    }

    case 'turbulence': {
      // SPRINT 3.1.0 — HARMONIC RETUNE. 1.3/1.1/0.7 Hz retuned to 14/11,
      // 12/11, 8/11 Hz — integer multiples of 1/11s — closes at 11s with the
      // shader field below. 2.0 Hz already fit (22/11) — unchanged.
      const t = easing === 'linear' ? signedTime * TAU : theta;
      return {
        ...base,
        xOffset: 0.012 * Math.sin(t * (14 / 11)) * i,
        yOffset: 0.012 * Math.cos(t * (12 / 11)) * i,
        scaleOffset: 0.015 * Math.sin(t * (8 / 11)) * i,
        intensityMultiplier: 1 + 0.06 * Math.sin(t * 2.0) * i,
        phase01, eased01, theta, signedTime, cycleSeconds,
      };
    }

    default:
      return { ...base, phase01, eased01, theta, signedTime, cycleSeconds };
  }
}

// ─── Cycle detection (used by recording) ─────────────────────────────────────

export function detectCycleCompletion(
  animationType: AnimationType,
  currentState: LayerTransformState,
  startState: LayerTransformState,
  threshold = 5
): boolean {
  const angleDiff = Math.abs(((currentState.currentAngle - startState.currentAngle + 180) % 360) - 180);
  const posDiff   = Math.hypot(
    currentState.currentCenterX - startState.currentCenterX,
    currentState.currentCenterY - startState.currentCenterY
  );
  const scaleDiff = Math.abs(currentState.currentScale - startState.currentScale);

  switch (animationType) {
    case 'rotation': return angleDiff < threshold;
    case 'pulse': case 'scale': return scaleDiff < 0.05 && currentState.animationTime > 1;
    case 'drift': return posDiff < threshold / 100;
    case 'wave': return angleDiff < threshold && posDiff < threshold / 100;
    case 'morph': case 'turbulence':
      return angleDiff < threshold && posDiff < 0.05 && scaleDiff < 0.05 && currentState.animationTime > 2;
    default: return false;
  }
}

// ─── Cycle time estimates ─────────────────────────────────────────────────────
// These are used by getPhase() for phase01/pingPong calculations only.
// They do NOT affect the primary sin/cos drivers.

/**
 * STAGE 2.9.3 — MEDIA COMPATIBILITY METADATA.
 *
 * Animations fall into two kinds, and the distinction was never written down:
 *
 *  'rigid'  — shape-preserving (rotation, zoom, bounded offsets). Safe on a
 *             texture: samples stay inside the image.
 *  'field'  — a displacement FIELD evaluated per-pixel. Correct and beautiful
 *             on a procedural gradient, which has no edges to fall off. On a
 *             texture, displacement magnitude IS deformation, so a large field
 *             samples outside the image and clamps.
 *
 * Media layers now route through applySharedAnimationFieldMedia, which gives
 * vortex a rigid differential-rotation variant and magnitude-bounds the rest.
 * This table records WHY that path exists so the next animation added gets
 * classified deliberately rather than discovered in testing.
 */
export type AnimationFieldKind = 'rigid' | 'field';

export const ANIMATION_FIELD_KIND: Partial<Record<AnimationType, AnimationFieldKind>> = {
  rotation: 'rigid',
  scale: 'rigid',
  pulse: 'rigid',
  shimmer: 'rigid',
  hueShift: 'rigid',
  chromaticPulse: 'rigid',
  drift: 'field',        // unbounded time term — bounded in 2.9.3
  wave: 'field',
  morph: 'field',
  vortex: 'field',       // peak 2.65 UV — rigid variant for media in 2.9.3
  kaleidoscope: 'field',
  fractalZoom: 'field',
  turbulence: 'field',
  ripple: 'field',
  liquid: 'field',
  glitch: 'field',
  dualShifter: 'field',
};

/** True when an animation deforms media through a bounded/rigid path. */
export function isMediaFriendlyAnimation(type: AnimationType): boolean {
  return (ANIMATION_FIELD_KIND[type] ?? 'field') === 'rigid';
}
