import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('../src/app/components/controls/ExportPanel.tsx', import.meta.url), 'utf8');
const utils = readFileSync(new URL('../src/app/utils/exportUtils.ts', import.meta.url), 'utf8');

test('production video panel uses the recovered direct WebM exporter', () => {
  assert.match(panel, /exportWebMFromCanvas/);
  assert.doesNotMatch(panel, /exportVideoWithMediabunny/);
  assert.doesNotMatch(panel, /runDirectWebCodecsWorkerExport/);
});

test('VP9 selection starts at the minimum adequate level', () => {
  assert.match(utils, /const VP9_LEVELS/);
  assert.match(utils, /findIndex\([\s\S]*maxPicSize[\s\S]*maxSampleRate/);
  assert.match(utils, /VP9_LEVELS\s*\.slice\(startIdx\)/);
  assert.doesNotMatch(utils, /vp09\.00\.61\.08['"]\s*,\s*codecId[\s\S]*first/);
});

test('recovered encoder uses realtime variable-rate WebCodecs', () => {
  assert.match(utils, /latencyMode:\s*['"]realtime['"]/);
  assert.match(utils, /bitrateMode:\s*['"]variable['"]/);
  assert.match(utils, /encodeQueueSize/);
  assert.match(utils, /encoder\.flush\(\)/);
});

test('production does not route to MediaRecorder or codec-race exporters', () => {
  const productionBody = utils.slice(utils.indexOf('export async function exportWebMFromCanvas'));
  assert.doesNotMatch(productionBody, /exportWebMWithMediaRecorderFallback\(options\)/);
  assert.doesNotMatch(panel, /auto codec/);
});
