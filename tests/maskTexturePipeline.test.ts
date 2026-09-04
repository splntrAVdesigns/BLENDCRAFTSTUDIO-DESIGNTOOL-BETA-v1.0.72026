import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const canvasSource = readFileSync(
  new URL('../src/app/components/gradient/GradientCanvas.tsx', import.meta.url),
  'utf8',
);

const managerSource = readFileSync(
  new URL('../src/app/components/gradient/maskTextureManager.ts', import.meta.url),
  'utf8',
);

test('mask canvas textures use a registered Three color space in the Figma WebGL1 path', () => {
  const applyStart = canvasSource.indexOf('const applyLoadedTexture');
  const applyEnd = canvasSource.indexOf('const loadBitmapMaskTexture', applyStart);
  const applyBlock = canvasSource.slice(applyStart, applyEnd);

  assert.match(applyBlock, /colorSpace:\s*THREE\.LinearSRGBColorSpace/);
  assert.doesNotMatch(applyBlock, /colorSpace:\s*THREE\.NoColorSpace/);
});

test('replacement mask texture binds before the previous texture is disposed', () => {
  const bindIndex = canvasSource.indexOf('material.uniforms.uMaskTexture.value = texture');
  const disposeIndex = canvasSource.indexOf('requestAnimationFrame(() => requestAnimationFrame(() => existing.dispose()))');

  assert.ok(bindIndex >= 0, 'expected synchronous mask uniform binding');
  assert.ok(disposeIndex > bindIndex, 'old texture must be disposed after replacement binding');
});

test('shared SVG mask rasterizer declares both content dimensions', () => {
  assert.match(managerSource, /const contentWidth = Math\.max\(1, Math\.round\(intrinsic\.width \* scale\)\)/);
  assert.match(managerSource, /const contentHeight = Math\.max\(1, Math\.round\(intrinsic\.height \* scale\)\)/);
});
