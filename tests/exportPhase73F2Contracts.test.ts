import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFile(new URL(path, root), 'utf8');

test('7.3F.2 lab is URL-gated and clearly isolated from production export', async () => {
  const panel = await read('src/app/components/controls/VideoExportLabPanel.tsx');
  assert.match(panel, /videoLab.*=== '1'/);
  assert.match(panel, /does not replace the production exporter/i);
});

test('7.3F.2 exposes runtime codec probing before proof execution', async () => {
  const panel = await read('src/app/components/controls/VideoExportLabPanel.tsx');
  assert.match(panel, /probeVideoLabCapabilities/);
  assert.match(panel, /selectedCapability\?\.supported/);
});

test('7.3F.2 uses deterministic renderer controls and cleanup', async () => {
  const panel = await read('src/app/components/controls/VideoExportLabPanel.tsx');
  assert.match(panel, /configureExportTimeline/);
  assert.match(panel, /pauseAnimation/);
  assert.match(panel, /renderAtTime\(timeSeconds/);
  assert.match(panel, /cleanupExportSession/);
});

test('production exporter remains free of video-lab imports', async () => {
  const production = await read('src/app/utils/exportUtils.ts');
  assert.doesNotMatch(production, /video-lab|mediabunny/i);
});

test('Mediabunny is pinned for repeatable GitHub and Vercel installs', async () => {
  const pkg = JSON.parse(await read('package.json')) as { dependencies: Record<string, string> };
  assert.equal(pkg.dependencies.mediabunny, '1.51.0');
});
