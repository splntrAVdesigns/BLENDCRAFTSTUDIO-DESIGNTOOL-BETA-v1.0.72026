import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const renderer = fs.readFileSync(new URL('../src/app/components/gradient/GradientCanvas.tsx', import.meta.url), 'utf8');
const exporter = fs.readFileSync(new URL('../src/app/utils/exportUtils.ts', import.meta.url), 'utf8');

test('preview and deterministic export use the same post-process authority', () => {
  const calls = renderer.match(/shouldUsePostProcess\(/g) ?? [];
  assert.ok(calls.length >= 2, 'expected shared predicate in preview and export paths');
  assert.doesNotMatch(renderer, /if \(renderTarget\) \{\s*renderer\.setRenderTarget\(renderTarget\)/);
});

test('presentation canvas is primary and raw readback is fallback only', () => {
  const primary = exporter.indexOf('if (liveCanvas && liveCanvas.width > 1');
  const fallback = exporter.indexOf('const frame = getReadFramePixels?.()', primary);
  assert.ok(primary >= 0 && fallback > primary);
  assert.match(exporter, /ctx\.drawImage\(liveCanvas/);
});

test('MP4 and WebM share the same CanvasSource encode engine', () => {
  const calls = exporter.match(/encodeVideoWithMediabunny\(\{/g) ?? [];
  assert.equal(calls.length, 2);
});
