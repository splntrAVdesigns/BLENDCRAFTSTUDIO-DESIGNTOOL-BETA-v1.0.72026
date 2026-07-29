import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getKeyFrameIntervalFrames,
  getOptimizedEncoderBitrate,
  getOptimizedQueueWatermark,
  orderWebMCodecCandidates,
  shouldEncodeKeyFrame,
} from '../src/app/utils/exportEncoderOptimization.ts';

const vp9 = [{ codec: 'vp09.00.31.08', codecId: 'V_VP9' as const }];
const vp8 = { codec: 'vp8', codecId: 'V_VP8' as const };

test('iframe balanced exports prefer VP8 to avoid pathological software VP9', () => {
  assert.equal(orderWebMCodecCandidates(vp9, vp8, { iframe: true, quality: 'high' })[0].codecId, 'V_VP8');
});

test('master tiers preserve VP9-first ordering', () => {
  assert.equal(orderWebMCodecCandidates(vp9, vp8, { iframe: true, quality: 'sharpMax' })[0].codecId, 'V_VP9');
});

test('VP8 receives gradient-safe bitrate headroom', () => {
  assert.equal(getOptimizedEncoderBitrate(24_000_000, 'V_VP8', 'high'), 28_320_000);
  assert.equal(getOptimizedEncoderBitrate(24_000_000, 'V_VP9', 'high'), 24_000_000);
});

test('uses a two-second GOP instead of one keyframe every second', () => {
  const interval = getKeyFrameIntervalFrames(30, 150);
  assert.equal(interval, 60);
  assert.equal(shouldEncodeKeyFrame(0, interval), true);
  assert.equal(shouldEncodeKeyFrame(30, interval), false);
  assert.equal(shouldEncodeKeyFrame(60, interval), true);
});

test('software VP8 gets bounded pipeline overlap', () => {
  assert.equal(getOptimizedQueueWatermark(1920, 1080, 'V_VP8', true), 10);
  assert.equal(getOptimizedQueueWatermark(1920, 1080, 'V_VP9', true), 6);
});
