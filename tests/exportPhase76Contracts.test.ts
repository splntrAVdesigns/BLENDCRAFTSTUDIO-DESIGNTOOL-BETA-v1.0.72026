import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const timeline = readFileSync('src/app/export/DeterministicTimelineCertification.ts', 'utf8');
const exporter = readFileSync('src/app/export/RealtimeHiddenCanvasProductionExporter.ts', 'utf8');

test('Phase 7.6 makes frame count and fps authoritative', () => {
  assert.match(timeline, /expectedFrames = Math\.max\(1, Math\.round\(durationMs \/ 1000 \* safeFps\)\)/);
  assert.match(timeline, /lastTimestampSeconds: \(expectedFrames - 1\) \/ safeFps/);
  assert.match(timeline, /publishedFrames !== timeline\.expectedFrames/);
});

test('Phase 7.6 does not reject export based on media element duration', () => {
  assert.doesNotMatch(timeline, /video\.duration/);
  assert.doesNotMatch(exporter, /certifyWebMPlayback/);
  assert.match(exporter, /certifyDeterministicTimeline/);
});
