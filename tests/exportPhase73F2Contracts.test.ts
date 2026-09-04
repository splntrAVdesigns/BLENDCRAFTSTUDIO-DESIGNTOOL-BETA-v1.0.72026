import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('preview and export share the post-process predicate', () => {
  const source = read('src/app/components/gradient/GradientCanvas.tsx');
  assert.ok((source.match(/shouldUsePostProcess\(/g) ?? []).length >= 2);
});

test('intermediate targets are linear and presentation output is sRGB', () => {
  const source = read('src/app/components/gradient/GradientCanvas.tsx');
  assert.match(source, /renderer\.outputColorSpace = THREE\.SRGBColorSpace/);
  assert.ok((source.match(/colorSpace: THREE\.LinearSRGBColorSpace/g) ?? []).length >= 3);
});

test('actual encoded artifact receives decoded-frame fidelity verification', () => {
  const exporter = read('src/app/utils/exportUtils.ts');
  const verifier = read('src/app/export/exportFrameFidelity.ts');
  assert.ok((exporter.match(/verifyExportedFrameFidelity\(/g) ?? []).length >= 2);
  assert.match(verifier, /new VideoSampleSink/);
  assert.match(verifier, /sample\.draw/);
});
