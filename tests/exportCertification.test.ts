import test from 'node:test';
import assert from 'node:assert/strict';
import { planWebMExport } from '../src/app/utils/exportPlanner.ts';
import {
  CERTIFIED_EXPORT_ANIMATION_FAMILIES,
  calculateMemoryGrowthPercent,
  durationWithinOneFrame,
  encodedDurationMs,
  expectedFrameCount,
  frameTimeSeconds,
} from '../src/app/utils/exportCertification.ts';

test('5 seconds at 30 FPS is exactly 150 frames', () => {
  assert.equal(expectedFrameCount(5_000, 30), 150);
  const plan = planWebMExport({ width: 1920, height: 1080, fps: 30, targetDurationMs: 5_000, quality: 'high' });
  assert.equal(plan.totalFrames, 150);
  assert.equal(plan.durationMs, 5_000);
});

test('7 seconds at 60 FPS is exactly 420 frames', () => {
  assert.equal(expectedFrameCount(7_000, 60), 420);
  const plan = planWebMExport({ width: 1920, height: 1080, fps: 60, targetDurationMs: 7_000, quality: 'high' });
  assert.equal(plan.totalFrames, 420);
  assert.equal(plan.durationMs, 7_000);
});

test('Smart Loop is opt-in and cannot override target duration while disabled', () => {
  const unlocked = planWebMExport({
    width: 1920, height: 1080, fps: 30, targetDurationMs: 7_000,
    plannedDurationMs: 25_000, loopLockEnabled: false, quality: 'high',
  });
  assert.equal(unlocked.totalFrames, 210);
  assert.equal(unlocked.durationMs, 7_000);

  const locked = planWebMExport({
    width: 1920, height: 1080, fps: 30, targetDurationMs: 7_000,
    plannedDurationMs: 25_000, loopLockEnabled: true, quality: 'high',
  });
  assert.equal(locked.totalFrames, 750);
  assert.equal(locked.durationMs, 25_000);
});

test('frame cap recalculates duration from final frame count', () => {
  const plan = planWebMExport({
    width: 1920, height: 1080, fps: 60, targetDurationMs: 60_000,
    quality: 'high', hardCapFrames: 420,
  });
  assert.equal(plan.totalFrames, 420);
  assert.equal(plan.durationMs, 7_000);
  assert.equal(encodedDurationMs(plan.totalFrames, plan.fps), plan.durationMs);
});

test('timestamps and duration are within one frame', () => {
  assert.equal(frameTimeSeconds(419, 60), 419 / 60);
  assert.equal(durationWithinOneFrame(7_000, encodedDurationMs(420, 60), 60), true);
});

test('memory recovery acceptance threshold is 15 percent', () => {
  assert.equal(calculateMemoryGrowthPercent(100, 115), 15);
  assert.ok(calculateMemoryGrowthPercent(100, 116) > 15);
});

test('all major animation families are part of export certification contract', () => {
  assert.deepEqual([...CERTIFIED_EXPORT_ANIMATION_FAMILIES], [
    'animation-type', 'animate-texture', 'mask-animation', 'flash-fx',
    'audio-reactive', 'pattern-scroll', 'pattern-rotation', 'pattern-scale',
    'gradient-movement', 'noise-animation', 'random-seed',
  ]);
});