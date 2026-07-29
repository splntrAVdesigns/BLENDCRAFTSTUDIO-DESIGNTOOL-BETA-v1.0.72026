/**
 * Authoritative deterministic timeline for animated exports.
 *
 * Every export subsystem must derive its time from frameIndex/fps through this
 * object. Wall-clock APIs (performance.now, Date.now, requestAnimationFrame)
 * are intentionally excluded from timeline calculation.
 */
export interface ExportTimelineConfig {
  fps: number;
  totalFrames: number;
  startTimeSeconds?: number;
}

export interface ExportFrameContext {
  frameIndex: number;
  totalFrames: number;
  fps: number;
  relativeTimeSeconds: number;
  absoluteTimeSeconds: number;
  timestampUs: number;
  durationUs: number;
  progress01: number;
  isFirstFrame: boolean;
  isLastFrame: boolean;
}

export interface ExportTimeline {
  fps: number;
  totalFrames: number;
  startTimeSeconds: number;
  frameDurationSeconds: number;
  frameDurationUs: number;
  durationSeconds: number;
  durationMs: number;
  frame(frameIndex: number): ExportFrameContext;
  wrapFrame(): ExportFrameContext;
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number.`);
  }
}

export function createExportTimeline(config: ExportTimelineConfig): ExportTimeline {
  assertPositiveFinite(config.fps, 'fps');
  if (!Number.isInteger(config.totalFrames) || config.totalFrames <= 0) {
    throw new Error('totalFrames must be a positive integer.');
  }

  const fps = config.fps;
  const totalFrames = config.totalFrames;
  const startTimeSeconds = Number.isFinite(config.startTimeSeconds)
    ? Math.max(0, config.startTimeSeconds ?? 0)
    : 0;
  const frameDurationSeconds = 1 / fps;
  // WebCodecs timestamps are integer microseconds. Derive both timestamp and
  // duration from the same rounded frame boundary so long exports cannot drift
  // from repeated floating-point addition.
  const frameBoundaryUs = (index: number) => Math.round((index * 1_000_000) / fps);
  const durationSeconds = totalFrames / fps;
  const durationMs = durationSeconds * 1000;

  const frame = (frameIndex: number): ExportFrameContext => {
    if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= totalFrames) {
      throw new Error(`frameIndex ${frameIndex} is outside 0..${totalFrames - 1}.`);
    }
    const timestampUs = frameBoundaryUs(frameIndex);
    const nextTimestampUs = frameBoundaryUs(frameIndex + 1);
    const relativeTimeSeconds = frameIndex / fps;
    return {
      frameIndex,
      totalFrames,
      fps,
      relativeTimeSeconds,
      absoluteTimeSeconds: startTimeSeconds + relativeTimeSeconds,
      timestampUs,
      durationUs: Math.max(1, nextTimestampUs - timestampUs),
      progress01: (frameIndex + 1) / totalFrames,
      isFirstFrame: frameIndex === 0,
      isLastFrame: frameIndex === totalFrames - 1,
    };
  };

  return {
    fps,
    totalFrames,
    startTimeSeconds,
    frameDurationSeconds,
    frameDurationUs: Math.max(1, frameBoundaryUs(1)),
    durationSeconds,
    durationMs,
    frame,
    wrapFrame: () => ({
      frameIndex: totalFrames,
      totalFrames,
      fps,
      relativeTimeSeconds: durationSeconds,
      absoluteTimeSeconds: startTimeSeconds + durationSeconds,
      timestampUs: frameBoundaryUs(totalFrames),
      durationUs: Math.max(1, frameBoundaryUs(totalFrames + 1) - frameBoundaryUs(totalFrames)),
      progress01: 1,
      isFirstFrame: false,
      isLastFrame: false,
    }),
  };
}
