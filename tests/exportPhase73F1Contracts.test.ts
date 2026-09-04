import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('production encoder uses CanvasSource with awaited deterministic timing', () => {
  const source = read('src/app/export/mediabunnyExport.ts');
  assert.match(source, /new MeasuredCanvasSource\(stagingCanvas/);
  assert.match(source, /const t = i \/ fps/);
  assert.match(source, /await videoSource\.add\(t, frameDurationSeconds\)/);
});

test('manual canvas VideoFrame color metadata workaround is absent', () => {
  const source = read('src/app/export/mediabunnyExport.ts');
  assert.doesNotMatch(source, /CANVAS_SOURCE_COLOR_SPACE|VideoFrameInitWithColorSpace|new VideoFrame\(/);
});

test('output finalization remains after all frame submissions', () => {
  const source = read('src/app/export/mediabunnyExport.ts');
  assert.ok(source.indexOf('await output.finalize()') > source.indexOf('await runFrameLoopViaRAF'));
});
