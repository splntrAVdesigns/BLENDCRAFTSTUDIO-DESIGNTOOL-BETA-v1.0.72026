import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecorderAttemptPlan,
  RECORDING_LIVENESS_PROBE_TIMEOUT_MS,
  RECORDING_PRODUCTION_TIMESLICE_MS,
} from '../src/app/export/recording/RecordingLivenessPolicy.ts';
import type { RecordingCodecSelection } from '../src/app/export/recording/types.ts';

const allCodecs: readonly RecordingCodecSelection[] = [
  { mimeType: 'video/webm;codecs=vp9', codecLabel: 'VP9' },
  { mimeType: 'video/webm;codecs=vp8', codecLabel: 'VP8' },
  { mimeType: 'video/webm', codecLabel: 'WebM' },
];

test('liveness attempts manual VP9 once, then automatic VP9, VP8 and generic WebM', () => {
  const attempts = createRecorderAttemptPlan(allCodecs);
  assert.deepEqual(
    attempts.map((attempt) => `${attempt.captureMode}:${attempt.codec.codecLabel}`),
    [
      'manual-request-frame:VP9',
      'automatic-fps:VP9',
      'automatic-fps:VP8',
      'automatic-fps:WebM',
    ],
  );
});

test('unsupported VP9 skips manual capture and begins with automatic VP8', () => {
  const attempts = createRecorderAttemptPlan(allCodecs.slice(1));
  assert.deepEqual(
    attempts.map((attempt) => `${attempt.captureMode}:${attempt.codec.codecLabel}`),
    ['automatic-fps:VP8', 'automatic-fps:WebM'],
  );
});

test('production liveness policy uses bounded probing and one-second chunks', () => {
  assert.equal(RECORDING_PRODUCTION_TIMESLICE_MS, 1_000);
  assert.ok(RECORDING_LIVENESS_PROBE_TIMEOUT_MS >= 1_000);
  assert.ok(RECORDING_LIVENESS_PROBE_TIMEOUT_MS <= 3_000);
});
