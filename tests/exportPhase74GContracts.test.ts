import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const production = fs.readFileSync('src/app/export/MediabunnyProductionExporter.ts', 'utf8');
const runner = fs.readFileSync('src/app/export/DirectWebCodecsWorkerExporter.ts', 'utf8');
const worker = fs.readFileSync('src/app/export/directWebCodecsEncoder.worker.ts', 'utf8');

test('production uses direct WebCodecs worker runner', () => {
  assert.match(production, /runDirectWebCodecsWorkerExport/);
  assert.doesNotMatch(production, /runMediabunnyMainThread/);
});

test('worker uses direct VideoEncoder with realtime mode', () => {
  assert.match(worker, /new VideoEncoder/);
  assert.match(worker, /latencyMode: 'realtime'/);
  assert.match(worker, /encodeQueueSize/);
});

test('Mediabunny is used as encoded packet muxer', () => {
  assert.match(worker, /EncodedVideoPacketSource/);
  assert.match(worker, /EncodedPacket\.fromEncodedChunk/);
  assert.doesNotMatch(worker, /VideoSampleSource/);
});

test('frames are transferred to a dedicated worker', () => {
  assert.match(runner, /new Worker\(new URL/);
  assert.match(runner, /postMessage\([^]*\[frame\]/);
  assert.match(runner, /Rendered .*Encoded/);
});
