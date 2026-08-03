import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const utils = readFileSync(new URL('../src/app/utils/exportUtils.ts', import.meta.url), 'utf8');

test('final flush no longer rejects from an unchanged queue count', () => {
  const start = utils.indexOf('async function flushEncoderWithLiveness');
  const end = utils.indexOf('export function cleanupExportResources', start);
  const flush = utils.slice(start, end);
  assert.match(flush, /encoder\.flush\(\)/);
  assert.match(flush, /Export cancelled/);
  assert.doesNotMatch(flush, /Video encoder stalled/);
  assert.doesNotMatch(flush, /hiddenAllowance/);
  assert.doesNotMatch(flush, /lastProgressAt/);
});

test('encoded chunks are tracked as the authoritative output signal', () => {
  assert.match(utils, /let encodedChunkCount = 0/);
  assert.match(utils, /encodedChunkCount \+= 1/);
  assert.match(utils, /lastEncodedChunkAt = performance\.now\(\)/);
});

test('failed exports publish complete diagnostic timing', () => {
  assert.match(utils, /\[BLENDCRAFT Export 7\.4R\.1\] Export failed:/);
  assert.match(utils, /phase: failurePhase/);
  assert.match(utils, /encodeQueueSize:/);
  assert.match(utils, /lastEncodedChunkAgeMs:/);
  assert.match(utils, /__exportFailureTiming/);
});

test('recovery remains on the direct VP9 WebCodecs path', () => {
  assert.match(utils, /vp09\.00\./);
  assert.match(utils, /latencyMode:\s*['"]realtime['"]/);
  assert.match(utils, /bitrateMode:\s*['"]variable['"]/);
  assert.doesNotMatch(utils, /await exportWebMWithMediaRecorderFallback\(options\)/);
});
