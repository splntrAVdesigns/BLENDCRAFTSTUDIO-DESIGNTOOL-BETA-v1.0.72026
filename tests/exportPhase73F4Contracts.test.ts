import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('custom visual shaders preserve the established BLENDCRAFT output transfer', () => {
  for (const path of [
    'src/app/utils/gradientRenderer.ts',
    'src/app/utils/meshGradientRenderer.ts',
    'src/app/utils/effectsRenderer.ts',
    'src/app/media/mediaShader.ts',
  ]) {
    assert.doesNotMatch(read(path), /withOutputColorSpace/);
  }
});

test('all procedural gradient color-stop writes use one shader-color conversion', () => {
  const renderer = read('src/app/utils/gradientRenderer.ts');
  const canvas = read('src/app/components/gradient/GradientCanvas.tsx');
  assert.match(renderer, /hexToShaderRgb\(c\.color\)/);
  assert.ok((canvas.match(/hexToShaderRgb\(stop\.color\)/g) ?? []).length >= 2);
  assert.doesNotMatch(canvas, /new THREE\.Color\(stop\.color\)/);
  assert.doesNotMatch(canvas, /_tmpColor\.set\(stop\.color\)/);
});

test('zero-valued advanced gradient settings survive UI and render synchronization', () => {
  const controls = read('src/app/components/controls/GradientControls.tsx');
  const canvas = read('src/app/components/gradient/GradientCanvas.tsx');
  assert.doesNotMatch(controls, /gradient\.(?:angle|intensity|centerX|centerY|waveAmplitude) \|\|/);
  assert.doesNotMatch(canvas, /gradient\.(?:intensity|centerX|centerY|waveAmplitude) \|\|/);
  assert.doesNotMatch(canvas, /layer\.gradient\.(?:angle|centerX|centerY)\s+\|\|/);
  assert.doesNotMatch(read('src/app/utils/gradientRenderer.ts'), /gradient\.(?:angle|intensity|centerX|centerY|waveAmplitude) \|\| (?!0(?:\.0)?\b)/);
});

test('presentation canvas remains the production encoder source', () => {
  const exporter = read('src/app/utils/exportUtils.ts');
  const engine = read('src/app/export/mediabunnyExport.ts');
  assert.match(exporter, /ctx\.drawImage\(liveCanvas/);
  assert.match(engine, /await videoSource\.add\(t, frameDurationSeconds\)/);
  assert.ok((read('src/app/components/gradient/GradientCanvas.tsx').match(/shouldUsePostProcess\(/g) ?? []).length >= 2);
});

test('public Mediabunny finalization precedes MP4 handoff', () => {
  const engine = read('src/app/export/mediabunnyExport.ts');
  const exporter = read('src/app/utils/exportUtils.ts');
  assert.doesNotMatch(engine, /closeAndWait|_closingPromise/);
  assert.match(engine, /await output\.finalize\(\)/);
  assert.match(engine, /finalizeMs/);
  const mp4Start = exporter.indexOf('export async function exportMP4FromCanvas');
  const mp4 = exporter.slice(mp4Start);
  assert.ok(mp4.indexOf('await handoffExportDownload') < mp4.indexOf('verifyExportedArtifactDuration'));
  assert.ok(mp4.indexOf('await handoffExportDownload') < mp4.indexOf('verifyExportedFrameFidelity'));
});

test('H264 completion telemetry remains while encoder selection is browser-owned', () => {
  const engine = read('src/app/export/mediabunnyExport.ts');
  assert.match(engine, /policy: 'browser-default'/);
  assert.match(engine, /renderMs/);
  assert.match(engine, /encodeMs/);
  assert.match(engine, /finalizeMs/);
  assert.doesNotMatch(engine, /policy: 'hardware-first'/);
  assert.doesNotMatch(engine, /policy: 'measured-software-fallback'/);
});
