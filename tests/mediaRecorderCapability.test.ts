import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/app/utils/exportUtils.ts', import.meta.url), 'utf8');

test('MediaRecorder remains capability fallback only', () => {
  assert.match(source, /WebCodecs unavailable; using MediaRecorder fallback/);
  assert.match(source, /WebM\/VP9 not encodable.*using MediaRecorder fallback/);
});

test('MediaRecorder fallback captures the same presentation staging path', () => {
  const start = source.indexOf('async function exportWebMWithMediaRecorderFallback');
  const end = source.indexOf('async function exportMP4WithMediaRecorderFallback', start);
  const fallback = source.slice(start, end);
  assert.match(fallback, /await renderFrameAtTime\(t, undefined\)/);
  assert.match(fallback, /drawFrameToStagingCanvas\(\{/);
  assert.doesNotMatch(fallback, /createIsolatedExportRenderer/);
});
