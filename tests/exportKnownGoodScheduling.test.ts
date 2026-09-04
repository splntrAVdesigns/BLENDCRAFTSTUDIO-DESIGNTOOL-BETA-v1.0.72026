import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/app/utils/exportUtils.ts', import.meta.url), 'utf8');
const engine = fs.readFileSync(new URL('../src/app/export/mediabunnyExport.ts', import.meta.url), 'utf8');

test('frame loop never waits for encoder queue to reach a low watermark', () => {
  assert.equal(source.includes('while (((encoder as any)?.encodeQueueSize'), false);
  assert.equal(source.includes('Encoder backpressure stalled for 120 seconds'), false);
});

test('active WebCodecs failures do not launch MediaRecorder fallback', () => {
  assert.equal(source.includes('WebCodecs export failed; attempting MediaRecorder fallback'), false);
  assert.equal(source.includes('recordExportFailure(error)'), true);
});

test('Mediabunny finalize remains the native encoder completion barrier', () => {
  assert.equal(engine.includes('await output.finalize()'), true);
  assert.equal(engine.includes('await videoSource.add(t, frameDurationSeconds)'), true);
});
