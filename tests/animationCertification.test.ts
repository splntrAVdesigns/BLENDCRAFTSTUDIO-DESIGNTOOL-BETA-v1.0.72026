import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_ANIMATION_FAMILIES,
  canonicalExportTimeSeconds,
  createAnimationCertificationSnapshot,
  deterministicRange,
  deterministicUnit,
  stableAnimationSeed,
} from '../src/app/utils/deterministicAnimation.ts';

test('all Phase 2 animation families are explicitly certified', () => {
  assert.deepEqual([...EXPORT_ANIMATION_FAMILIES], [
    'animation-type',
    'animate-texture',
    'mask-animation',
    'flash-fx',
    'audio-reactive',
    'pattern-scroll',
    'pattern-rotation',
    'pattern-scale',
    'gradient-movement',
    'noise-animation',
    'random-seed',
  ]);
});

test('time is snapped to the authoritative frame grid', () => {
  assert.equal(canonicalExportTimeSeconds(1.00001, 30), 1);
  assert.equal(canonicalExportTimeSeconds(419 / 60, 60), 419 / 60);
});

test('same frame, seed and settings produce an identical animation snapshot', () => {
  const params = { timeSeconds: 3.14159, fps: 60, seed: 'layer-a', speed: 1.25 };
  assert.deepEqual(
    createAnimationCertificationSnapshot(params),
    createAnimationCertificationSnapshot(params),
  );
});

test('animation snapshot is independent of wall-clock time', async () => {
  const params = { timeSeconds: 2.5, fps: 30, seed: 'stable', speed: 0.75 };
  const first = createAnimationCertificationSnapshot(params);
  await new Promise(resolve => setTimeout(resolve, 5));
  const second = createAnimationCertificationSnapshot(params);
  assert.deepEqual(first, second);
});

test('stable random seed is reproducible and sample-indexed', () => {
  assert.equal(stableAnimationSeed('blob-layer'), stableAnimationSeed('blob-layer'));
  assert.equal(deterministicUnit('blob-layer', 2), deterministicUnit('blob-layer', 2));
  assert.notEqual(deterministicUnit('blob-layer', 2), deterministicUnit('blob-layer', 3));
  const value = deterministicRange('blob-layer', 0, 0.4, 0.6);
  assert.ok(value >= 0.4 && value < 0.6);
});
