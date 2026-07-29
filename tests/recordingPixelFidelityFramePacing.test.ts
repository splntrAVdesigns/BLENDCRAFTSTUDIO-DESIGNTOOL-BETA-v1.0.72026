import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('PNG renders a supersampled source and resolves once to delivery size', () => {
  const source = read('src/app/utils/exportUtils.ts');
  assert.match(source, /supersampleScale/);
  assert.match(source, /imageSmoothingQuality = 'high'/);
  assert.match(source, /globalCompositeOperation = 'copy'/);
});

test('offline WebM frames carry explicit timestamps and durations', () => {
  const source = read('src/app/utils/exportUtils.ts');
  assert.match(source, /timestamp: exportFrame\.timestampUs/);
  assert.match(source, /duration: exportFrame\.durationUs/);
  assert.match(source, /encoder!\.encode\(frame/);
});

test('offline WebM has one final encoder flush rather than per-frame flushes', () => {
  const source = read('src/app/utils/exportUtils.ts');
  const functionStart = source.indexOf('export async function exportWebMFromCanvas');
  const functionEnd = source.indexOf('async function exportWebMWithMediaRecorderFallback', functionStart);
  const body = source.slice(functionStart, functionEnd);
  assert.equal((body.match(/encoder!\.flush\(\)/g) ?? []).length, 1);
});

test('grain remains generated in output pixel space', () => {
  const source = read('src/app/shaders/gradientShaders.ts');
  assert.match(source, /grainPixel = floor\(gl_FragCoord\.xy/);
});
