import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createLayerExportDurationPlan } from '../src/app/export/ExportDurationPlan.ts';

test('Loop Lock uses mapped runtime animation speed and never shortens duration', () => {
  const plan = createLayerExportDurationPlan({
    requestedDurationMs: 5000,
    fps: 30,
    loopLockEnabled: true,
    layers: [{ id: 'a', visible: true, animation: { enabled: true, type: 'wave', speed: 5, intensity: 1, easing: 'linear', direction: 'forward', loop: true } }] as any,
  });
  assert.ok(plan.effectiveDurationMs >= 5000);
  assert.equal(plan.totalFrames, Math.round(plan.effectiveDurationMs / 1000 * 30));
});

test('production encoder keeps one final flush and bounded queue drain', () => {
  const source = readFileSync(new URL('../src/app/utils/exportUtils.ts', import.meta.url), 'utf8');
  assert.match(source, /waitForEncoderQueueBelow/);
  assert.match(source, /highWatermark/);
  const flushCalls = source.match(/await encoder!?\.flush\(\)/g) ?? [];
  assert.ok(flushCalls.length >= 1);
  assert.doesNotMatch(source, /for \(let i = 0; i < totalFrames; i\+\+\)[\s\S]{0,500}await encoder!?\.flush/);
});

test('preview isolation prioritizes display canvas over raw readback', () => {
  const source = readFileSync(new URL('../src/app/export/recording/PreviewIsolationController.ts', import.meta.url), 'utf8');
  assert.ok(source.indexOf('context.drawImage(source') < source.indexOf('input.readFramePixels?.()'));
});
