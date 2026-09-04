import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('CanvasSource uses only the public Visual Mood Labs finalization contract', () => {
  const engine = read('src/app/export/mediabunnyExport.ts');
  assert.match(engine, /new CanvasSource\(stagingCanvas/);
  assert.match(engine, /await videoSource\.add\(t, frameDurationSeconds\)/);
  assert.match(engine, /await output\.finalize\(\)/);
  assert.doesNotMatch(engine, /videoSource\.close\(|closeAndWait|_closingPromise/);
});

test('hardware-first H264 uses realtime latency and full completion cost', () => {
  const engine = read('src/app/export/mediabunnyExport.ts');
  const hardwarePolicy = engine.slice(
    engine.indexOf("policy: 'hardware-first'", engine.indexOf('if (hardwareSupported)')) - 220,
    engine.indexOf("policy: 'hardware-first'", engine.indexOf('if (hardwareSupported)')) + 80,
  );
  assert.match(hardwarePolicy, /latencyMode: 'realtime'/);
  assert.match(engine, /\(encodeMs \+ finalizeMs\) \/ Math\.max\(1, totalFrames\)/);
  assert.match(engine, /h264-encoder-performance:v2/);
});

test('finalization telemetry reports one honest public boundary', () => {
  const engine = read('src/app/export/mediabunnyExport.ts');
  const exporter = read('src/app/utils/exportUtils.ts');
  assert.doesNotMatch(engine, /flushMs/);
  assert.match(engine, /Draining encoder and finalizing/);
  assert.match(exporter, /encoderDrainAndMuxSec/);
  assert.match(exporter, /flushSec: 0/);
});

test('active encoder and decoded artifact resolutions are checked', () => {
  const engine = read('src/app/export/mediabunnyExport.ts');
  const exporter = read('src/app/utils/exportUtils.ts');
  const certification = read('src/app/utils/exportCertification.ts');
  assert.match(engine, /width: \(config as \{ width\?: number \}\)\.width/);
  assert.match(engine, /height: \(config as \{ height\?: number \}\)\.height/);
  assert.ok((exporter.match(/assertEncoderResolution\(encoderConfigInfo, targetWidth, targetHeight/g) ?? []).length >= 2);
  assert.match(certification, /video\.videoWidth/);
  assert.match(certification, /video\.videoHeight/);
  assert.match(certification, /resolutionMatches/);
});

test('Phase 7.3F.4 color and visible-canvas capture corrections remain intact', () => {
  for (const path of [
    'src/app/utils/gradientRenderer.ts',
    'src/app/utils/meshGradientRenderer.ts',
    'src/app/utils/effectsRenderer.ts',
    'src/app/media/mediaShader.ts',
  ]) {
    assert.doesNotMatch(read(path), /withOutputColorSpace/);
  }
  assert.match(read('src/app/utils/exportUtils.ts'), /ctx\.drawImage\(liveCanvas/);
  assert.match(read('src/app/utils/gradientRenderer.ts'), /hexToShaderRgb\(c\.color\)/);
});
