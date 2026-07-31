import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runner = fs.readFileSync('src/app/export/video-lab/mainThreadRunner.ts', 'utf8');
const production = fs.readFileSync('src/app/export/MediabunnyProductionExporter.ts', 'utf8');
const offline = fs.readFileSync('src/app/export/OfflineExportRenderer.ts', 'utf8');

test('Phase 7.4F uses one sequential Mediabunny submission', () => {
  assert.match(runner, /await source\.add\(sample\)/);
  assert.doesNotMatch(runner, /MAX_PENDING_FRAMES|Promise\.race\(pending\)|new Set<Promise/);
  assert.match(runner, /peakPendingFrames: 1/);
});

test('Phase 7.4F removes ImageBitmap and 2D staging copies', () => {
  assert.doesNotMatch(runner, /createImageBitmap|drawImage\(|OffscreenCanvasRenderingContext2D|staging surfaces/i);
  assert.match(runner, /new runtime\.VideoSample\(options\.canvas/);
});

test('Phase 7.4F production renders through an independent WebGL renderer', () => {
  assert.match(production, /createOfflineExportRenderer\(width, height\)/);
  assert.match(production, /api\.renderAtTime\(timeSeconds, offline\.renderer/);
  assert.doesNotMatch(production, /api\.setExportSize\(/);
  assert.match(offline, /new THREE\.WebGLRenderer/);
  assert.doesNotMatch(offline, /appendChild/);
});

test('Phase 7.4F progress is based on accepted encoded frames', () => {
  const addIndex = runner.indexOf('await source.add(sample)');
  const emitIndex = runner.indexOf("stage: 'encoding'", addIndex);
  assert.ok(addIndex >= 0 && emitIndex > addIndex);
  assert.match(production, /progress\.percent \* 0\.88/);
});
