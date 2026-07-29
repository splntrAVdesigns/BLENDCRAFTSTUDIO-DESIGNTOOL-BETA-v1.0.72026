import type { AnimationType } from '../types/gradient.ts';

/**
 * Authoritative declared cycle duration for one animation family.
 * Kept free of React and renderer dependencies so preview, export planning,
 * tests, and future recorder engines all use exactly the same cycle policy.
 */
export function estimateCycleTime(animationType: AnimationType, speed: number): number {
  const s = Math.max(0.001, speed || 1);
  switch (animationType) {
    case 'rotation':       return 10000 / s;
    case 'pulse':
    case 'scale':          return 1000 / s;
    case 'drift':          return 4000 / s;
    case 'wave':           return 1000 / s;
    case 'morph':          return 2000 / s;
    case 'turbulence':     return 2000 / s;
    case 'shimmer':
    case 'dualShifter':    return 1000 / s;
    case 'vortex':         return 5000 / s;
    case 'kaleidoscope':   return 4000 / s;
    case 'fractalZoom':    return 5000 / s;
    case 'chromaticPulse': return 2000 / s;
    case 'liquid':         return 6000 / s;
    case 'hueShift':       return 10000 / s;
    case 'ripple':         return 1000 / s;
    case 'glitch':         return 1000 / s;
    default:               return 2000 / s;
  }
}
