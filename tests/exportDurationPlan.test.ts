import test from 'node:test';
import assert from 'node:assert/strict';
import type { Layer } from '../src/app/types/gradient.ts';
import {
  createExportDurationPlan,
  createLayerExportDurationPlan,
} from '../src/app/export/ExportDurationPlan.ts';
import { planWebMExport } from '../src/app/utils/exportPlanner.ts';
import { estimateCycleTime } from '../src/app/animation/estimateAnimationCycle.ts';
import { mapLayerAnimationSpeed } from '../src/app/components/gradient/gradientMath.ts';

function animatedLayer(type: string, speed: number, visible = true): Layer {
  return {
    id: `${type}-${speed}`,
    visible,
    animation: { enabled: true, type, speed },
  } as unknown as Layer;
}

test('Loop Lock off keeps the requested duration exact', () => {
  const plan = createLayerExportDurationPlan({
    requestedDurationMs: 5_000,
    fps: 30,
    loopLockEnabled: false,
    layers: [animatedLayer('rotation', 1)],
  });

  assert.equal(plan.requestedDurationMs, 5_000);
  assert.equal(plan.effectiveDurationMs, 5_000);
  assert.equal(plan.totalFrames, 150);
  assert.equal(plan.loopAlignmentApplied, false);
});

test('Loop Lock uses the longest visible enabled animation cycle', () => {
  const plan = createLayerExportDurationPlan({
    requestedDurationMs: 7_000,
    fps: 30,
    loopLockEnabled: true,
    layers: [
      animatedLayer('pulse', 1),      // 1 second
      animatedLayer('rotation', 2),   // 5 seconds
      animatedLayer('rotation', 0.5, false), // hidden; must not affect plan
    ],
  });

  const expectedReference = Math.max(
    estimateCycleTime('pulse', mapLayerAnimationSpeed(1)),
    estimateCycleTime('rotation', mapLayerAnimationSpeed(2)),
  );
  assert.equal(plan.referenceCycleMs, expectedReference);
  assert.equal(plan.cycleCount, 1);
  assert.equal(plan.effectiveDurationMs, expectedReference);
  assert.equal(plan.totalFrames, Math.round(expectedReference / 1000 * 30));
  assert.equal(plan.animatedLayerCount, 2);
  assert.match(plan.statusLabel, /Snapping to 32\.38s/);
});

test('Loop Lock with no animated layers falls back to target duration', () => {
  const plan = createLayerExportDurationPlan({
    requestedDurationMs: 5_000,
    fps: 60,
    loopLockEnabled: true,
    layers: [],
  });

  assert.equal(plan.effectiveDurationMs, 5_000);
  assert.equal(plan.totalFrames, 300);
  assert.equal(plan.loopAlignmentApplied, false);
  assert.match(plan.statusLabel, /No animated layers/);
});

test('the shared plan is authoritative in the legacy WebM planner', () => {
  const durationPlan = createExportDurationPlan({
    requestedDurationMs: 5_000,
    effectiveDurationMs: 5_400,
    fps: 30,
    loopLockEnabled: true,
    referenceCycleMs: 1_800,
    cycleCount: 3,
    animatedLayerCount: 1,
  });
  const plan = planWebMExport({
    width: 1920,
    height: 1080,
    fps: 30,
    targetDurationMs: 5_000,
    plannedDurationMs: 20_000,
    durationPlan,
    quality: 'high',
    loopLockEnabled: true,
  });

  assert.equal(plan.targetDurationMs, 5_000);
  assert.equal(plan.durationMs, 5_400);
  assert.equal(plan.totalFrames, 162);
});
