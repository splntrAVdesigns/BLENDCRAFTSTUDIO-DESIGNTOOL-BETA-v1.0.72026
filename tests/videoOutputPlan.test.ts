import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveVideoOutputDimensions } from '../src/app/export/VideoOutputPlan.ts';

test('canvas-sized output remains pixel exact at full scale', () => {
  assert.deepEqual(resolveVideoOutputDimensions(1080, 1080, 1), {
    baseWidth: 1080,
    baseHeight: 1080,
    width: 1080,
    height: 1080,
    renderScale: 1,
    aspectRatio: 1,
  });
});

test('portrait output keeps even encoder dimensions and the selected aspect', () => {
  const plan = resolveVideoOutputDimensions(1080, 1920, 0.75);
  assert.equal(plan.width, 810);
  assert.equal(plan.height, 1440);
  assert.equal(plan.aspectRatio, 810 / 1440);
});

