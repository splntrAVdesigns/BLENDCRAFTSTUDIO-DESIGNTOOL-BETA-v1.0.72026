/**
 * Frame-level certification for the deterministic preview -> encoder timeline.
 *
 * These records cross the complete production boundary: renderAtTime reports
 * the phase/speed it actually rendered, and the Mediabunny bridge appends the
 * timestamp/duration it actually submitted to CanvasSource.
 */

export interface RenderedTimelineLayerState {
  layerId: string;
  capturedPhase: number;
  effectiveSpeed: number;
  renderedPhase: number;
}

export interface RenderedMotionState {
  layerId: string;
  maskRotation: number | null;
  maskScale: number | null;
  maskOpacity: number | null;
  maskOffset: [number, number] | null;
  textureTime: number | null;
  mediaTime: number | null;
  configuredLayerSpeed: number | null;
  configuredMaskSpeed: number | null;
  configuredTextureSpeed: number | null;
  configuredMediaSpeed: number | null;
}

export interface RenderedTimelineFrameState {
  renderedDeterministicTime: number;
  layers: RenderedTimelineLayerState[];
  motion?: RenderedMotionState[];
}

export interface ExportTimelineFrameCertification {
  frameIndex: number;
  requestedTimestamp: number;
  renderedDeterministicTime: number;
  encodedTimestamp: number;
  encodedDuration: number;
  layers: RenderedTimelineLayerState[];
  motion?: RenderedMotionState[];
}

export interface ExportTimelineCertificationResult {
  checked: true;
  passed: boolean;
  frameCount: number;
  expectedFrameCount: number;
  fps: number;
  maximumTimestampError: number;
  maximumDurationError: number;
  monotonic: boolean;
  failures: string[];
  frames: ExportTimelineFrameCertification[];
}

const TIMELINE_EPSILON_SECONDS = 1e-6;

export function certifyExportTimeline(
  frames: ExportTimelineFrameCertification[],
  fps: number,
  expectedFrameCount: number,
): ExportTimelineCertificationResult {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const expectedDuration = 1 / safeFps;
  const failures: string[] = [];
  let maximumTimestampError = 0;
  let maximumDurationError = 0;
  let monotonic = true;

  if (frames.length !== expectedFrameCount) {
    failures.push(`Expected ${expectedFrameCount} frames, received ${frames.length}.`);
  }

  frames.forEach((frame, index) => {
    const expectedTimestamp = index / safeFps;
    if (![frame.requestedTimestamp, frame.renderedDeterministicTime,
      frame.encodedTimestamp, frame.encodedDuration].every(Number.isFinite)) {
      failures.push(`Frame ${index} is missing finite render/submission timing.`);
    }
    frame.layers.forEach(layer => {
      if (![layer.capturedPhase, layer.effectiveSpeed, layer.renderedPhase].every(Number.isFinite)) {
        failures.push(`Frame ${index}, layer ${layer.layerId}: invalid animation state.`);
      }
    });
    frame.motion?.forEach(motion => {
      const values = [motion.maskRotation, motion.maskScale, motion.maskOpacity,
        motion.textureTime, motion.mediaTime, ...(motion.maskOffset ?? [])];
      if (values.some(value => value !== null && !Number.isFinite(value))) {
        failures.push(`Frame ${index}, layer ${motion.layerId}: invalid mask/texture/media state.`);
      }
    });
    const timestampError = Math.max(
      Math.abs(frame.requestedTimestamp - expectedTimestamp),
      Math.abs(frame.renderedDeterministicTime - expectedTimestamp),
      Math.abs(frame.encodedTimestamp - expectedTimestamp),
    );
    const durationError = Math.abs(frame.encodedDuration - expectedDuration);
    maximumTimestampError = Math.max(maximumTimestampError, timestampError);
    maximumDurationError = Math.max(maximumDurationError, durationError);

    if (frame.frameIndex !== index) failures.push(`Frame ${index} reported index ${frame.frameIndex}.`);
    if (timestampError > TIMELINE_EPSILON_SECONDS) {
      failures.push(`Frame ${index} timestamp diverged by ${timestampError.toFixed(9)}s.`);
    }
    if (durationError > TIMELINE_EPSILON_SECONDS) {
      failures.push(`Frame ${index} duration diverged by ${durationError.toFixed(9)}s.`);
    }
    if (index > 0 && frame.encodedTimestamp <= frames[index - 1].encodedTimestamp) {
      monotonic = false;
    }
  });

  if (!monotonic) failures.push('Encoded timestamps are not strictly monotonic.');

  return {
    checked: true,
    passed: failures.length === 0,
    frameCount: frames.length,
    expectedFrameCount,
    fps: safeFps,
    maximumTimestampError,
    maximumDurationError,
    monotonic,
    failures,
    frames,
  };
}
