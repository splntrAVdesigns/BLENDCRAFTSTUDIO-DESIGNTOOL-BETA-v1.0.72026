import test from 'node:test';
import assert from 'node:assert/strict';
import { getOptimizedQueueWatermark } from '../src/app/utils/exportEncoderOptimization.ts';
import { compareLoopFrames } from '../src/app/utils/loopVerification.ts';

test('software 1080p VP8 queue uses a bounded batch', () => {
  assert.equal(getOptimizedQueueWatermark(1920, 1080, 'V_VP8', true), 10);
});

test('software 4K queue remains bounded without serialising', () => {
  assert.equal(getOptimizedQueueWatermark(3840, 2160, 'V_VP8', true), 4);
});

test('loop verifier accepts tiny distributed RGB noise as perceptually seamless', () => {
  const a = new Uint8Array(400 * 4).fill(100);
  const b = new Uint8Array(a);
  for (let i = 0; i < b.length; i += 4) { b[i] += 4; b[i + 1] += 4; b[i + 2] += 4; }
  const result = compareLoopFrames({ data: a, width: 20, height: 20 }, { data: b, width: 20, height: 20 });
  assert.equal(result.seamless, true);
  assert.equal(result.perceptualMatchRatio, 1);
});
