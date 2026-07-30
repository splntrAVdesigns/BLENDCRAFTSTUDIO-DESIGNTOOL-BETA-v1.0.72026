import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const exportSource = readFileSync(new URL('../src/app/utils/exportUtils.ts', import.meta.url), 'utf8');
const shaderSource = readFileSync(new URL('../src/app/shaders/gradientShaders.ts', import.meta.url), 'utf8');

test('Blob twist uses the stable continuous radial transform', () => {
  assert.match(shaderSource, /float blobTwistAngle = uTwist \* twistDistance \* 2\.25/);
  assert.match(shaderSource, /vec2 twisted = twistVector \+ vec2\(0\.5\)/);
});

test('encoder selection probes hardware across codecs before software fallback', () => {
  assert.match(exportSource, /hardware-across-codecs/);
  assert.match(exportSource, /const softwareFallback = vp8First/);
  const hardwarePass = exportSource.indexOf("hardwareAcceleration: 'prefer-hardware'");
  const softwarePass = exportSource.indexOf("hardwareAcceleration: 'prefer-software'", hardwarePass);
  assert.ok(hardwarePass >= 0 && softwarePass > hardwarePass);
});

test('finalized WebM is playback-certified before download', () => {
  assert.match(exportSource, /async function assertPlayableVideoBlob/);
  const certification = exportSource.indexOf("await assertPlayableVideoBlob(blob, 'WebCodecs WebM'");
  const download = exportSource.indexOf('handoffExportDownload', certification);
  assert.ok(certification >= 0 && download > certification);
});

test('opaque encoder flush has a dequeue liveness watchdog', () => {
  assert.match(exportSource, /async function flushEncoderWithLiveness/);
  assert.match(exportSource, /Video encoding stalled while the BLENDCRAFT tab was in the background/);
  assert.match(exportSource, /await flushEncoderWithLiveness\(encoder!/);
});
