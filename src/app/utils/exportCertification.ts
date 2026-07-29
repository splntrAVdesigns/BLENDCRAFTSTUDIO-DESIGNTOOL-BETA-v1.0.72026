export interface ExportMemorySnapshot {
  usedBytes: number | null;
  capturedAt: number;
}

export interface ExportMemoryRecoveryResult {
  supported: boolean;
  baselineBytes: number | null;
  recoveredBytes: number | null;
  growthPercent: number | null;
  withinLimit: boolean;
}

export const EXPORT_MEMORY_GROWTH_LIMIT_PERCENT = 15;

export function expectedFrameCount(durationMs: number, fps: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('durationMs must be positive.');
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('fps must be positive.');
  return Math.max(1, Math.round((durationMs / 1000) * fps));
}

export function frameTimeSeconds(frameIndex: number, fps: number): number {
  if (!Number.isInteger(frameIndex) || frameIndex < 0) throw new Error('frameIndex must be a non-negative integer.');
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('fps must be positive.');
  return frameIndex / fps;
}

export function encodedDurationMs(totalFrames: number, fps: number): number {
  if (!Number.isInteger(totalFrames) || totalFrames <= 0) throw new Error('totalFrames must be positive.');
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('fps must be positive.');
  return (totalFrames / fps) * 1000;
}

export function durationWithinOneFrame(actualDurationMs: number, plannedDurationMs: number, fps: number): boolean {
  const toleranceMs = 1000 / fps;
  return Math.abs(actualDurationMs - plannedDurationMs) <= toleranceMs + Number.EPSILON;
}

export function calculateMemoryGrowthPercent(baselineBytes: number, recoveredBytes: number): number {
  if (baselineBytes <= 0) return recoveredBytes <= 0 ? 0 : Infinity;
  return ((recoveredBytes - baselineBytes) / baselineBytes) * 100;
}

export function captureExportMemorySnapshot(): ExportMemorySnapshot {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  return {
    usedBytes: typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null,
    capturedAt: performance.now(),
  };
}

export function verifyExportMemoryRecovery(
  baseline: ExportMemorySnapshot,
  recovered: ExportMemorySnapshot,
  limitPercent = EXPORT_MEMORY_GROWTH_LIMIT_PERCENT,
): ExportMemoryRecoveryResult {
  if (baseline.usedBytes == null || recovered.usedBytes == null) {
    return {
      supported: false,
      baselineBytes: baseline.usedBytes,
      recoveredBytes: recovered.usedBytes,
      growthPercent: null,
      withinLimit: true,
    };
  }
  const growthPercent = calculateMemoryGrowthPercent(baseline.usedBytes, recovered.usedBytes);
  return {
    supported: true,
    baselineBytes: baseline.usedBytes,
    recoveredBytes: recovered.usedBytes,
    growthPercent,
    withinLimit: growthPercent <= limitPercent,
  };
}

/** Animation families that must be driven by the single deterministic export clock. */
export const CERTIFIED_EXPORT_ANIMATION_FAMILIES = [
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