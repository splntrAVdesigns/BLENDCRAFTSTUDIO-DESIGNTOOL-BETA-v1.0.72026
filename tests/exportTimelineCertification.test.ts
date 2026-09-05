import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceExportLayerTimeline, smoothLayerAnimationSpeed } from '../src/app/components/gradient/gradientMath.ts';
import { certifyExportTimeline, type ExportTimelineFrameCertification } from '../src/app/utils/exportTimelineCertification.ts';

test('speed smoothing is time-based and identical to the established EMA at 60 fps', () => {
  const current = 0.25;
  const target = 1;
  const at60 = smoothLayerAnimationSpeed(current, target, 1 / 60);
  assert.ok(Math.abs(at60 - (current * 0.85 + target * 0.15)) < 1e-12);

  const halfA = smoothLayerAnimationSpeed(current, target, 1 / 120);
  const halfB = smoothLayerAnimationSpeed(halfA, target, 1 / 120);
  assert.ok(Math.abs(halfB - at60) < 1e-12);
  assert.equal(smoothLayerAnimationSpeed(current, target, 0), current);
});

test('export frame zero preserves preview phase and speed before deterministic continuation', () => {
  const first = advanceExportLayerTimeline({
    capturedPhase: 12.5,
    capturedSpeed: 0.4,
    targetSpeed: 1.2,
    deltaSeconds: 1 / 30,
  });
  assert.deepEqual(first, { phase: 12.5, smoothedSpeed: 0.4 });

  const second = advanceExportLayerTimeline({
    previous: first,
    capturedPhase: 12.5,
    capturedSpeed: 0.4,
    targetSpeed: 1.2,
    deltaSeconds: 1 / 30,
  });
  assert.ok(second.smoothedSpeed > first.smoothedSpeed);
  assert.ok(second.smoothedSpeed < 1.2);
  assert.ok(Math.abs(second.phase - (first.phase + second.smoothedSpeed / 30)) < 1e-12);
});

test('frame certification validates render and encoded timestamps and durations', () => {
  const fps = 30;
  const frames: ExportTimelineFrameCertification[] = Array.from({ length: 3 }, (_, frameIndex) => ({
    frameIndex,
    requestedTimestamp: frameIndex / fps,
    renderedDeterministicTime: frameIndex / fps,
    encodedTimestamp: frameIndex / fps,
    encodedDuration: 1 / fps,
    layers: [{ layerId: 'layer-1', capturedPhase: 2, effectiveSpeed: 0.5, renderedPhase: 2 + frameIndex / 60 }],
  }));

  const passing = certifyExportTimeline(frames, fps, 3);
  assert.equal(passing.passed, true);
  assert.equal(passing.monotonic, true);
  assert.equal(passing.frames.length, 3);

  const broken = frames.map((frame) => ({ ...frame }));
  broken[2].encodedTimestamp += 0.01;
  const failing = certifyExportTimeline(broken, fps, 3);
  assert.equal(failing.passed, false);
  assert.match(failing.failures.join(' '), /timestamp diverged/);
});
