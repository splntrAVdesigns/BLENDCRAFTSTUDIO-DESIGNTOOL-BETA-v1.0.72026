import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_COLOR_CONTRACT,
  applyTextureQualityPolicy,
  compareRgbaFrames,
  qualityDither,
} from '../src/app/utils/exportRenderQuality.ts';

test('export contract is sRGB with straight alpha', () => {
  assert.equal(EXPORT_COLOR_CONTRACT.outputSpace, 'srgb');
  assert.equal(EXPORT_COLOR_CONTRACT.alphaMode, 'straight');
});

test('texture quality policy mutates and reuses the same texture', () => {
  const texture: any = {};
  const result = applyTextureQualityPolicy(texture, {
    colorSpace: 'none', minFilter: 'linear', magFilter: 'linear',
    wrapS: 'clamp', wrapT: 'clamp', anisotropy: 8, generateMipmaps: false,
  });
  assert.equal(result, texture);
  assert.equal(texture.colorSpace, 'none');
  assert.equal(texture.anisotropy, 8);
  assert.equal(texture.generateMipmaps, false);
  assert.equal(texture.needsUpdate, true);
});

test('identical PNG and WebM frames pass parity certification', () => {
  const frame = new Uint8Array([0, 32, 255, 255, 100, 120, 140, 255]);
  const metrics = compareRgbaFrames(frame, frame);
  assert.equal(metrics.passed, true);
  assert.equal(metrics.rootMeanSquareError, 0);
});

test('small codec error passes while visible drift fails', () => {
  const reference = new Uint8Array([10, 20, 30, 255, 200, 210, 220, 255]);
  const close = new Uint8Array([11, 19, 32, 255, 198, 212, 219, 255]);
  const far = new Uint8Array([60, 70, 80, 255, 130, 140, 150, 255]);
  assert.equal(compareRgbaFrames(reference, close).passed, true);
  assert.equal(compareRgbaFrames(reference, far).passed, false);
});

test('dither is deterministic and remains below one 8-bit step', () => {
  const a = qualityDither(17, 29, 4);
  const b = qualityDither(17, 29, 4);
  assert.equal(a, b);
  assert.ok(Math.abs(a) <= 0.5 / 255 + Number.EPSILON);
});
