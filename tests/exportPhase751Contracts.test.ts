import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const exporter = fs.readFileSync('src/app/export/RealtimeHiddenCanvasProductionExporter.ts', 'utf8');
const certification = fs.readFileSync('src/app/export/recording/WebMPlaybackCertification.ts', 'utf8');

test('Phase 7.5.1 routes playback checks through WebM-aware certification', () => {
  assert.match(exporter, /certifyWebMPlayback\(/);
  assert.match(exporter, /playbackDurationSource/);
  assert.doesNotMatch(exporter, /received \$\{\(durationMs \/ 1000\)/);
});

test('infinite MediaRecorder duration is resolved through final-cluster seek', () => {
  assert.match(certification, /Number\.MAX_SAFE_INTEGER/);
  assert.match(certification, /durationchange/);
  assert.match(certification, /seekable-range/);
  assert.match(certification, /expected-duration-after-seek/);
});

test('certification still enforces duration tolerance and valid dimensions', () => {
  assert.match(certification, /videoWidth <= 0/);
  assert.match(certification, /Math\.abs\(durationMs - input\.expectedDurationMs\)/);
  assert.match(certification, /2_000 \/ Math\.max\(1, input\.fps\)/);
});
