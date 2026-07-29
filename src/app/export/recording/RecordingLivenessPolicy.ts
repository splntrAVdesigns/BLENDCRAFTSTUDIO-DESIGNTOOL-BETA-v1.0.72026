import type { RecordingCaptureMode, RecordingCodecSelection, RecordingRecorderAttempt } from './types';

const PROBE_TIMEOUT_MS = 1_750;
const PROBE_SETTLE_MS = 120;
const PRODUCTION_TIMESLICE_MS = 1_000;

export const RECORDING_LIVENESS_PROBE_TIMEOUT_MS = PROBE_TIMEOUT_MS;
export const RECORDING_LIVENESS_PROBE_SETTLE_MS = PROBE_SETTLE_MS;
export const RECORDING_PRODUCTION_TIMESLICE_MS = PRODUCTION_TIMESLICE_MS;

/**
 * Manual requestFrame is intentionally tried only for VP9. If that path is a
 * false-positive in the host, the engine immediately moves to the broadly
 * supported automatic captureStream(fps) path rather than repeating the same
 * failure with every codec.
 */
export function createRecorderAttemptPlan(
  codecs: readonly RecordingCodecSelection[],
): readonly RecordingRecorderAttempt[] {
  const vp9 = codecs.find((codec) => codec.codecLabel === 'VP9');
  const attempts: RecordingRecorderAttempt[] = [];
  if (vp9) attempts.push({ captureMode: 'manual-request-frame', codec: vp9 });
  for (const codec of codecs) attempts.push({ captureMode: 'automatic-fps', codec });
  return attempts;
}

export function describeRecorderAttempt(mode: RecordingCaptureMode, codec: RecordingCodecSelection): string {
  return `${mode}:${codec.codecLabel}`;
}
