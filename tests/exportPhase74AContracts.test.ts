import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('video engines use the authoritative GradientCanvas frame source', () => {
  const bridge = read('src/app/export/GradientExportBridge.ts');
  const lab = read('src/app/components/controls/VideoExportLabPanel.tsx');
  assert.match(bridge, /createAuthoritativeExportFrameSource/);
  assert.match(lab, /createAuthoritativeExportFrameSource/);
});

test('phone blocker is lightweight and does not initialize WebGL', () => {
  const mobile = read('src/app/components/landing/MobileBlockPage.tsx');
  assert.doesNotMatch(mobile, /three|WebGLRenderer|requestAnimationFrame/i);
  assert.match(mobile, /Mobile phones are not supported yet/);
});

test('Blob shader uses deterministic local metaballs and avoids uniform-array reads', () => {
  const shaders = read('src/app/shaders/gradientShaders.ts');
  const blob = shaders.slice(shaders.indexOf('export const blobGradientShader'), shaders.indexOf('// Texture overlay shader'));
  assert.match(blob, /shader-local centers/);
  assert.doesNotMatch(blob, /scaled - blobPositions\[i\]/);
  assert.match(blob, /value = smoothstep/);
});
