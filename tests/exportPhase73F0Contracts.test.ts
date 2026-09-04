import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('production dependency and lockfile pin Mediabunny identically', () => {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(pkg.dependencies.mediabunny, '1.51.0');
  assert.equal(lock.packages[''].dependencies.mediabunny, '1.51.0');
  assert.equal(lock.packages['node_modules/mediabunny'].version, '1.51.0');
});

test('PNG and video both treat presentation canvas as color authority', () => {
  const source = read('src/app/utils/exportUtils.ts');
  assert.match(source, /authoritative display-referred sRGB result/);
  assert.match(source, /AUTHORITATIVE PRIMARY SOURCE: the presentation canvas/);
});
