import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('normal video export is wired only to Mediabunny', async () => {
  const panel = await read('src/app/components/controls/ExportPanel.tsx');
  assert.match(panel, /exportVideoWithMediabunny/);
  assert.doesNotMatch(panel, /exportWebMFromCanvas/);
  assert.doesNotMatch(panel, /exportMP4FromCanvas/);
});

test('production Mediabunny export uses VP8 for WebM speed path', async () => {
  const source = await read('src/app/export/MediabunnyProductionExporter.ts');
  assert.match(source, /container === 'mp4' \? 'avc1\.42001f' : 'vp8'/);
  assert.match(source, /certifyFrames: false/);
});

test('production export certifies finalized playback before download', async () => {
  const source = await read('src/app/export/MediabunnyProductionExporter.ts');
  assert.match(source, /certifyPlayableVideo/);
  assert.match(source, /midpoint seek certification/);
  const panel = await read('src/app/components/controls/ExportPanel.tsx');
  assert.ok(panel.indexOf('exportVideoWithMediabunny') < panel.indexOf('saveAs(result.blob'));
});

test('legacy encoder is not imported by the production export panel', async () => {
  const panel = await read('src/app/components/controls/ExportPanel.tsx');
  assert.doesNotMatch(panel, /MediaRecorderExportEngine|webmEncoderSession|exportUtils.*exportWebM/);
});
