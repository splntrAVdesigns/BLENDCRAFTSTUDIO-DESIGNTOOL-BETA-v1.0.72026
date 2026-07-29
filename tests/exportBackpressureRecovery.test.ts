import test from 'node:test';
import assert from 'node:assert/strict';
import { getFigmaSafeQueueYieldThreshold } from '../src/app/utils/exportEncoderOptimization.ts';

test('1080p software VP8 uses a non-blocking diagnostic yield threshold', () => {
  assert.equal(getFigmaSafeQueueYieldThreshold(1920, 1080, 'V_VP8', true), 16);
});

test('software VP9 yields earlier without imposing a low-watermark wait', () => {
  assert.equal(getFigmaSafeQueueYieldThreshold(1920, 1080, 'V_VP9', true), 10);
});

test('4K software VP8 remains conservative', () => {
  assert.equal(getFigmaSafeQueueYieldThreshold(3840, 2160, 'V_VP8', true), 8);
});
