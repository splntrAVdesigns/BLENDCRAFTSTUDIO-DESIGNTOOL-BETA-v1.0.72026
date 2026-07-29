/**
 * Deterministic animation helpers shared by live/export rendering and tests.
 * These functions deliberately avoid Date.now(), performance.now() and Math.random().
 */

export const EXPORT_ANIMATION_FAMILIES = [
  'animation-type',
  'animate-texture',
  'mask-animation',
  'flash-fx',
  'audio-reactive',
  'pattern-scroll',
  'pattern-rotation',
  'pattern-scale',
  'gradient-movement',
  'noise-animation',
  'random-seed',
] as const;

export type ExportAnimationFamily = typeof EXPORT_ANIMATION_FAMILIES[number];

/** Snap a requested export time onto the authoritative frame grid. */
export function canonicalExportTimeSeconds(timeSeconds: number, fps: number): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const safeTime = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0;
  const frameIndex = Math.max(0, Math.round(safeTime * safeFps));
  return frameIndex / safeFps;
}

/** Stable 32-bit FNV-1a hash. */
export function stableAnimationSeed(value: string | number): number {
  const text = String(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic pseudo-random value in [0, 1), keyed by seed and sample index. */
export function deterministicUnit(seed: string | number, sampleIndex = 0): number {
  let state = (stableAnimationSeed(seed) ^ Math.imul(sampleIndex + 1, 0x9e3779b1)) >>> 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 0x100000000;
}

export function deterministicRange(
  seed: string | number,
  sampleIndex: number,
  min: number,
  max: number,
): number {
  return min + deterministicUnit(seed, sampleIndex) * (max - min);
}

/**
 * Pure certification snapshot used by automated tests. It models the timeline
 * inputs consumed by each export animation family without touching renderer state.
 */
export function createAnimationCertificationSnapshot(params: {
  timeSeconds: number;
  fps: number;
  seed: string | number;
  speed?: number;
}) {
  const time = canonicalExportTimeSeconds(params.timeSeconds, params.fps);
  const speed = Number.isFinite(params.speed) ? params.speed! : 1;
  const phase = time * speed;
  const seeded = deterministicUnit(params.seed, Math.floor(time * params.fps));

  return {
    time,
    animationTypePhase: phase,
    textureTime: phase,
    maskPhase: phase,
    flashPhase: phase,
    audioSampleTime: time,
    patternScroll: phase,
    patternRotation: phase,
    patternScale: 1 + Math.sin(phase * Math.PI * 2) * 0.1,
    gradientMovement: phase,
    noiseTime: phase,
    seeded,
  } as const;
}
