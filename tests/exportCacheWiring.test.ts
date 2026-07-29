import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/app/components/gradient/GradientCanvas.tsx', import.meta.url),
  'utf8',
);

test('live render paths do not reference an export-cache-only uniforms binding', () => {
  assert.equal(
    source.includes('const material = mesh.material as any;\n        material.uniforms = uniforms as any;'),
    false,
  );
  assert.equal(
    source.includes('const mat = mesh.material as THREE.ShaderMaterial;\n      mat.uniforms = uniforms as any;\n      if (!mat.uniforms) return;\n      if (mat.uniforms.center)'),
    false,
  );
});

test('only the three export-cache loops bind cached uniforms', () => {
  const bindings = source.match(/= uniforms as any;/g) ?? [];
  assert.equal(bindings.length, 3);
  assert.match(source, /exportCache\.entries\.forEach\(\(\{ mesh, layer, uniforms \}\) => \{/);
});
