import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/app/export/mediabunnyExport.ts', import.meta.url), 'utf8');

test('production frame loop is RAF-paced and deterministic', () => {
  assert.match(source, /const t = i \/ fps/);
  assert.match(source, /requestAnimationFrame\(\(\) => step\(i \+ 1\)\)/);
});

test('each CanvasSource frame awaits real encoder backpressure', () => {
  assert.match(source, /new MeasuredCanvasSource\(stagingCanvas/);
  assert.match(source, /await videoSource\.add\(t, frameDurationSeconds\)/);
});

test('canvas frames are not given unsupported manual color metadata', () => {
  assert.doesNotMatch(source, /new VideoFrame\(/);
  assert.doesNotMatch(source, /CANVAS_SOURCE_COLOR_SPACE/);
});
