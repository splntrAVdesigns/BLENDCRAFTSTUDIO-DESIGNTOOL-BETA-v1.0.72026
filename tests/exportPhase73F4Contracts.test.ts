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

test('native flush, mux finalization, and MP4 handoff have distinct barriers', () => {
  const engine = read('src/app/export/mediabunnyExport.ts');
  const exporter = read('src/app/utils/exportUtils.ts');
  assert.ok(engine.indexOf('await videoSource.closeAndWait()') < engine.indexOf('await output.finalize()'));
  assert.match(engine, /flushMs/);
  assert.match(engine, /finalizeMs/);
  const mp4Start = exporter.indexOf('export async function exportMP4FromCanvas');
  const mp4 = exporter.slice(mp4Start);
  assert.ok(mp4.indexOf('await handoffExportDownload') < mp4.indexOf('verifyExportedArtifactDuration'));
  assert.ok(mp4.indexOf('await handoffExportDownload') < mp4.indexOf('verifyExportedFrameFidelity'));
});

test('standalone H264 selects a measured hardware-first or software-realtime policy', () => {
  const engine = read('src/app/export/mediabunnyExport.ts');
  assert.match(engine, /hardwareAcceleration: 'prefer-hardware'/);
  assert.match(engine, /policy: 'hardware-first'/);
  assert.match(engine, /hardwareAcceleration: 'prefer-software'/);
  assert.match(engine, /policy: 'software-fallback'/);
  assert.match(engine, /shouldUseMeasuredSoftwareFallback/);
  assert.match(engine, /policy: 'measured-software-fallback'/);
  assert.match(engine, /encodeMs \/ Math\.max\(1, totalFrames\)/);
});
