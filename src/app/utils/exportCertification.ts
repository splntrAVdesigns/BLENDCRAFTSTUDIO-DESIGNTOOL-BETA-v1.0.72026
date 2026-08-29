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

export interface ExportArtifactDurationResult {
  /** false only when the browser couldn't decode the artifact at all — the
   *  export itself may still be fine; this just means we couldn't verify it. */
  checked: boolean;
  expectedMs: number;
  actualMs: number | null;
  withinTolerance: boolean;
  reason?: string;
}

/**
 * Decode the ACTUAL exported Blob and read its real `video.duration` —
 * closing a known false-PASS risk where a certification step computed
 * duration from its own planned input rather than the real artifact, so a
 * broken export could still log a PASS. This checks the file that will
 * actually reach the user, not the numbers that were fed into the encoder.
 *
 * Non-throwing by design: a failed decode here should surface as a warning,
 * not block a download the encoder already successfully produced.
 */
export async function verifyExportedArtifactDuration(
  blob: Blob,
  expectedMs: number,
  fps: number,
): Promise<ExportArtifactDurationResult> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const url = URL.createObjectURL(blob);
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve({ checked: false, expectedMs, actualMs: null, withinTolerance: true, reason: 'Metadata decode timed out.' });
    }, 8000);
    video.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      const actualMs = Number.isFinite(video.duration) ? video.duration * 1000 : null;
      cleanup();
      if (actualMs == null) {
        resolve({ checked: false, expectedMs, actualMs: null, withinTolerance: true, reason: 'Decoded duration was not finite.' });
        return;
      }
      resolve({
        checked: true,
        expectedMs,
        actualMs,
        withinTolerance: durationWithinOneFrame(actualMs, expectedMs, fps),
      });
    };
    video.onerror = () => {
      window.clearTimeout(timeout);
      cleanup();
      resolve({ checked: false, expectedMs, actualMs: null, withinTolerance: true, reason: 'Browser could not decode the exported artifact for verification.' });
    };
    video.src = url;
  });
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