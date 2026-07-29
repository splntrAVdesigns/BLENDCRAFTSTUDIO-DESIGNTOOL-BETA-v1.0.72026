import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('production recorder uses attached automatic capture and no blocking liveness probe', () => {
  const source = readFileSync('src/app/export/recording/RecordingExportEngine.ts', 'utf8');
  assert.match(source, /document\.body\.appendChild\(canvas\)/);
  assert.match(source, /captureMode = 'automatic-fps'/);
  assert.doesNotMatch(source, /probeRecorderLiveness/);
  assert.match(source, /await input\.renderFrame\(0, 0\)/);
});

test('PNG uses the visible canvas before raw GPU readback', () => {
  const source = readFileSync('src/app/utils/exportUtils.ts', 'utf8');
  const fn = source.slice(source.indexOf('export async function exportPNGAtSize'), source.indexOf('function createIsolatedExportRenderer'));
  assert.ok(fn.indexOf('if (liveCanvas') < fn.indexOf('const frame = getReadFramePixels'));
});
