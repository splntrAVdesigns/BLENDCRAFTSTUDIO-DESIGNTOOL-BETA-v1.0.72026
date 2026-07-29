import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertExactRecordingResolution,
  normalizeRecordingResolution,
} from '../src/app/export/recording/RecordingResolution.ts';

test('normalizes recording dimensions to positive even codec-safe values', () => {
  assert.deepEqual(normalizeRecordingResolution(1921, 1081), { width: 1920, height: 1080 });
  assert.deepEqual(normalizeRecordingResolution(1, 1), { width: 2, height: 2 });
});

test('exact recording resolution guard rejects scaled or stale render targets', () => {
  assert.doesNotThrow(() => assertExactRecordingResolution(
    { width: 1920, height: 1080 },
    { width: 1920, height: 1080 },
  ));
  assert.throws(
    () => assertExactRecordingResolution(
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
    ),
    /resolution mismatch/,
  );
});
