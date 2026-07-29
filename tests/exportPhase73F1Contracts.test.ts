import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFile(new URL(path, root), 'utf8');

test('7.3F.1 runner certifies before loading or starting Mediabunny', async () => {
  const source = await read('src/app/export/video-lab/mainThreadRunner.ts');
  const certification = source.indexOf('await certifyAnimationFrames');
  const load = source.indexOf('await loadMediabunny');
  const start = source.indexOf('await output.start');
  assert.ok(certification >= 0 && load > certification && start > load);
});

test('7.3F.1 production exporter remains isolated from video-lab', async () => {
  const production = await read('src/app/utils/exportUtils.ts');
  assert.equal(production.includes("export/video-lab"), false);
  assert.equal(production.includes('mediabunny'), false);
});

test('7.3F.1 awaits CanvasSource.add to respect encoder backpressure', async () => {
  const source = await read('src/app/export/video-lab/mainThreadRunner.ts');
  assert.match(source, /await source\.add\(timestamp, frameDuration/);
});

test('7.3F.1 captures environment and persists benchmark results', async () => {
  const source = await read('src/app/export/video-lab/mainThreadRunner.ts');
  assert.match(source, /captureVideoLabEnvironment\(\)/);
  assert.match(source, /saveVideoLabBenchmark\(benchmark\)/);
});

test('7.3F.1 rejects invalid codec and container pairings', async () => {
  const source = await read('src/app/export/video-lab/mainThreadRunner.ts');
  assert.match(source, /MP4 proof runs require H\.264\/AVC/);
  assert.match(source, /WebM proof runs require VP8 or VP9/);
});
