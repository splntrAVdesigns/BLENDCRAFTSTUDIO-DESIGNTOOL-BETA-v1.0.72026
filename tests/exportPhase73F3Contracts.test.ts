import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shaders = readFileSync(new URL('../src/app/shaders/gradientShaders.ts', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../src/app/utils/gradientRenderer.ts', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../src/app/components/controls/VideoExportLabPanel.tsx', import.meta.url), 'utf8');
const exportUtils = readFileSync(new URL('../src/app/utils/exportUtils.ts', import.meta.url), 'utf8');

function section(start: string, end: string): string {
  const a = shaders.indexOf(start);
  const b = shaders.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Missing shader section ${start}`);
  return shaders.slice(a, b);
}

test('Blob keeps deterministic fields and avoids segmented twist collapse', () => {
  const blob = section('export const blobGradientShader = `', '// Texture overlay shader');
  assert.match(blob, /float value = 0\.0;/);
  assert.match(blob, /blobSizes\[i\]/);
  assert.doesNotMatch(blob, /applyEnhancedTwist\(rotated/);
  assert.match(blob, /max\(uScale \* max\(scale, 0\.01\), 0\.01\)/);
  assert.match(renderer, /deterministicRange\(`\$\{layer\.id\}:blob-size`/);
});

test('Wave no longer performs multi-tap sampling across fract boundaries', () => {
  const wave = section('export const waveGradientShader2 = `', '// Fractal gradient shader');
  assert.match(wave, /vec3 color = getGradientColor\(t\) \* intensity \* uPulse;/);
  assert.doesNotMatch(wave, /float footprint = max\(fwidth\(t\)/);
  assert.doesNotMatch(wave, /footprint \* 0\.375/);
});

test('Vercel Mediabunny proof remains isolated from production exporter', () => {
  assert.match(panel, /Video Export Lab · 7\.3F\.3/);
  assert.match(panel, /runMediabunnyMainThread/);
  assert.doesNotMatch(exportUtils, /video-lab|mediabunny/i);
});

test('production WebM implementation remains frozen', () => {
  assert.match(exportUtils, /exportWebMFromCanvas/);
  assert.doesNotMatch(exportUtils, /runMediabunnyMainThread/);
});
