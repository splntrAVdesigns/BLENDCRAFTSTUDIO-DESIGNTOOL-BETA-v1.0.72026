import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Blob material generation uses the supplied layer id and has no free layer reference', () => {
  const source = read('src/app/utils/gradientRenderer.ts');
  assert.match(source, /createGradientMaterial\(layer\.gradient, layer\.texture, interaction, undefined, 0, layer\.id\)/);
  assert.match(source, /deterministicRange\(`\$\{layerId\}:blob-size`/);
  assert.doesNotMatch(source, /deterministicRange\(`\$\{layer\.id\}:blob-size`/);
});

test('native recorder captures the authoritative renderer canvas', () => {
  const source = read('src/app/export/GradientExportBridge.ts');
  assert.match(source, /canvas: frameSource\.canvas/);
});

test('authoritative source measures every requested frame timestamp', () => {
  const source = read('src/app/export/AuthoritativeExportFrameSource.ts');
  assert.match(source, /ExportFrameTimingDiagnostics/);
  assert.match(source, /diagnostics\.measure\(frameIndex, timeSeconds/);
  assert.match(source, /getTimingSummary/);
});
