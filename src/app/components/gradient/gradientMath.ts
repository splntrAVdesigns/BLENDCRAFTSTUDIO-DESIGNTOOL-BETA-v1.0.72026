/**
 * Pure math/encoding helpers for GradientCanvas.
 * Extracted in the Phase 1 refactor with no behavior changes.
 */

/**
 * Map texture animation speed from slider value to actual animation multiplier.
 * Uses the same piecewise curve previously defined inside GradientCanvas.
 */
export function mapTextureAnimationSpeed(raw: number | undefined): number {
  const sliderValue = Math.max(0, Math.min(100, raw ?? 50));
  if (sliderValue <= 0) return 0;

  // v2.2.6: More motion-graphics-friendly curve. The previous 0.05–2.0
  // mapping put too much useful range in the fast end and made procedural
  // textures/fractals feel rushed in WebM exports. This curve keeps plenty
  // of slow-control resolution while still allowing energetic motion.
  const t = sliderValue / 100;
  return 0.02 + Math.pow(t, 1.7) * 2.98; // 0.02x–3.0x
}

/**
 * Shared layer animation speed authority.
 * UI values remain 0.1–10, but live preview and export both consume this
 * mapped multiplier so exports cannot run a different speed curve.
 */
export function mapLayerAnimationSpeed(raw: number | undefined): number {
  const value = Math.max(0, Math.min(10, raw ?? 1));
  if (value <= 0) return 0;

  // 0.1 => ~0.02x, 1.0 => ~0.17x, 5.0 => ~0.94x, 10 => 3.0x.
  // This makes slow cinematic motion much easier to dial in while preserving
  // medium/fast options for punchy motion graphics.
  const t = value / 10;
  return 0.02 + Math.pow(t, 1.45) * 2.98;
}

/**
 * Advance the layer-speed smoother by elapsed wall/timeline time.
 *
 * The old fixed 0.15-per-rendered-frame EMA changed its real-time response
 * with preview FPS and could not be continued faithfully by a fixed-FPS
 * export. This is algebraically identical at 60 fps, while remaining stable
 * at any preview/export cadence.
 */
export function smoothLayerAnimationSpeed(
  current: number,
  target: number,
  deltaSeconds: number,
): number {
  if (Math.abs(current - target) < 0.001) return target;
  const safeDelta = Math.max(0, Math.min(0.1, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
  if (safeDelta === 0) return current;
  const alphaAt60Fps = 0.15;
  const alpha = 1 - Math.pow(1 - alphaAt60Fps, safeDelta * 60);
  return current * (1 - alpha) + target * alpha;
}

export interface ExportLayerTimelineState {
  phase: number;
  smoothedSpeed: number;
}

/** Continue one layer from its exact captured preview phase/speed. */
export function advanceExportLayerTimeline(params: {
  previous?: ExportLayerTimelineState;
  capturedPhase: number;
  capturedSpeed: number;
  targetSpeed: number;
  deltaSeconds: number;
  speedMultiplier?: number;
}): ExportLayerTimelineState {
  if (!params.previous) {
    return { phase: params.capturedPhase, smoothedSpeed: params.capturedSpeed };
  }
  const smoothedSpeed = smoothLayerAnimationSpeed(
    params.previous.smoothedSpeed,
    params.targetSpeed,
    params.deltaSeconds,
  );
  return {
    phase: params.previous.phase
      + params.deltaSeconds * smoothedSpeed * (params.speedMultiplier ?? 1),
    smoothedSpeed,
  };
}

export function mapMaskAnimationSpeed(raw: number | undefined): number {
  const sliderValue = Math.max(0, Math.min(100, raw ?? 50));
  if (sliderValue <= 0) return 0;
  const t = sliderValue / 100;
  return 0.02 + Math.pow(t, 1.7) * 2.98;
}

export function encodeTextureType(type?: string): number {
  switch (type) {
    case 'grain': return 0.0;
    case 'noise': return 1.0;
    case 'dots': return 2.0;
    case 'lines': return 3.0;
    case 'organic': return 4.0;
    case 'camoShadows': return 5.0;
    case 'linearGlass': return 6.0;
    case 'frostedGlass': return 7.0;
    case 'blockGlass': return 8.0;
    case 'fractalGlass': return 9.0;
    case 'heatMelt': return 10.0;
    case 'waveSignal': return 11.0;
    case 'topography': return 12.0;
    case 'plasma': return 13.0;
    case 'shape-pattern': return 14.0;
    case 'spackle': return 15.0;
    case 'grunge': return 16.0;
    default: return 0.0;
  }
}

export function encodePatternFlipMode(mode?: string): number {
  switch (mode) {
    case 'horizontal': return 1.0;
    case 'vertical': return 2.0;
    case 'checker': return 3.0;
    default: return 0.0;
  }
}

export function encodePatternOpacityCurveMode(mode?: string): number {
  switch (mode) {
    case 'center': return 1.0;
    case 'edge': return 2.0;
    default: return 0.0;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
