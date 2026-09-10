import type { AnimationType } from '../types/gradient.ts';

/**
 * Authoritative declared cycle duration for one animation family.
 * Kept free of React and renderer dependencies so preview, export planning,
 * tests, and future recorder engines all use exactly the same cycle policy.
 *
 * SPRINT 3.1.0 — LOOP-LOCK HARMONIC RETUNE.
 * Prior to this pass, most of these values were aspirational — they did not
 * match the actual mathematical period of the sin/cos superpositions driving
 * the animation (see calculateAnimationOffset() and the shader field
 * functions in animationHelpers.ts). Vortex was the one exception, retuned
 * correctly in STAGE 2.9.3 by making every internal frequency an integer
 * multiple of one base period. That "harmonic retune" pattern has now been
 * applied to wave, morph, liquid, turbulence, ripple, drift, and
 * kaleidoscope — every frequency constant in each of those formulas (JS AND
 * shader-field, where both exist) is now an exact integer multiple of
 * TAU/cycleSeconds, so the values below are the TRUE closure period, not an
 * estimate. This is load-bearing: ExportDurationPlan.ts uses these values to
 * set the actual exported clip length for seamless loops.
 */
export function estimateCycleTime(animationType: AnimationType, speed: number): number {
  const s = Math.max(0.001, speed || 1);
  switch (animationType) {
    case 'rotation':       return 10000 / s;
    case 'pulse':
    case 'scale':          return 1000 / s;
    case 'drift':          return 4000 / s;   // retuned: orbital term now closes at 4s exactly (was 1s)
    case 'wave':           return 30000 / s;  // retuned: true period of the shader wave field
    case 'morph':          return 8000 / s;   // retuned: crossfade term compressed for a practical loop
    case 'turbulence':     return 11000 / s;  // retuned: shared by JS + shader-field turbulence
    case 'shimmer':
    case 'dualShifter':    return 1000 / s;
    case 'vortex':         return 5000 / s;
    case 'kaleidoscope':   return 60000 / s;  // retuned: rotation (6s) and hue (60s) now close together
    case 'fractalZoom':    return 5000 / s;
    case 'chromaticPulse': return 2000 / s;
    case 'liquid':         return 8000 / s;   // retuned: unified with morph field's shared 8s base
    case 'hueShift':       return 10000 / s;
    case 'ripple':         return 16000 / s;  // retuned: shared by JS + shader-field ripple
    case 'glitch':         return 1000 / s;   // discrete/quantised by design — see calculateAnimationOffset
    default:               return 2000 / s;
  }
}
