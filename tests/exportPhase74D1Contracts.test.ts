import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const loaderPath = new URL('../src/app/export/video-lab/mediabunnyLoader.ts', import.meta.url);

test('Mediabunny loader uses a Vite-visible static package import', async () => {
  const source = await readFile(loaderPath, 'utf8');
  assert.match(source, /import \* as mediabunny from ['"]mediabunny['"]/);
  assert.doesNotMatch(source, /new Function|eval\s*\(/);
});

test('loader does not leave a runtime bare-specifier import boundary', async () => {
  const source = await readFile(loaderPath, 'utf8');
  assert.doesNotMatch(source, /import\(specifier\)|import\(packageName\)/);
});
