import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('../src/app/components/controls/ExportPanel.tsx', import.meta.url), 'utf8');
const utils = readFileSync(new URL('../src/app/utils/exportUtils.ts', import.meta.url), 'utf8');
const duration = readFileSync(new URL('../src/app/export/ExportDurationPlan.ts', import.meta.url), 'utf8');

test('public WebM path uses timestamped WebCodecs exporter', () => {
  assert.match(panel, /await exportWebMFromCanvas\(/);
  assert.doesNotMatch(panel, /exportWithProductionRecordingEngine/);
  assert.match(utils, /new VideoFrame\(stagingCanvas/);
  assert.match(utils, /timestamp: exportFrame\.timestampUs/);
  assert.match(utils, /await encoder!\.flush\(\)/);
});

test('PNG uses a supersampled source and hides live renderer resize', () => {
  assert.match(utils, /supersampleScale = targetWidth \* targetHeight <= 1920 \* 1080 \? 2 : 1/);
  assert.match(utils, /imageSmoothingQuality = 'high'/);
  assert.match(panel, /pngPreviewIsolation = isolatePreview/);
});

test('Loop Lock snaps forward and never to an earlier cycle', () => {
  assert.match(duration, /Math\.ceil\(requestedDurationMs \/ referenceCycleMs\)/);
  assert.doesNotMatch(duration, /Math\.round\(requestedDurationMs \/ referenceCycleMs\)/);
});

test('iframe encoder policy does not force software first', () => {
  assert.match(utils, /\? \[undefined, 'prefer-hardware', 'prefer-software'\]/);
});
