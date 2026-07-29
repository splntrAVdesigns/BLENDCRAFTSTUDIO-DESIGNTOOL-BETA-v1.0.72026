import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('resets export phase only when Loop Lock is enabled', () => {
  const panel = readFileSync('src/app/components/controls/ExportPanel.tsx', 'utf8');
  assert.match(panel, /resetExportPhase: durationPlan\.loopLockEnabled/);
  assert.match(panel, /Resetting animation loop start/);
});

test('keeps preview restore state while zeroing export-only clocks', () => {
  const canvas = readFileSync('src/app/components/gradient/GradientCanvas.tsx', 'utf8');
  assert.match(canvas, /options\?\.resetExportPhase \? 0 : \(state\.signedPhase \?\? 0\)/);
  assert.match(canvas, /masterTime: options\?\.resetExportPhase \? 0 : animationMasterTimeRef\.current/);
  assert.match(canvas, /accumulatedTime: animationAccumulatedTimeRef\.current/);
});
