import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('../src/app/components/controls/ExportPanel.tsx', import.meta.url), 'utf8');

test('public WebM export uses the frame-accurate offline WebCodecs path', () => {
  assert.match(panel, /exportWebMFromCanvas/);
  assert.doesNotMatch(panel, /exportWithProductionRecordingEngine/);
  assert.doesNotMatch(panel, /useProductionRecorderPreview/);
  assert.doesNotMatch(panel, /Production recording test/);
});

test('MP4 remains on its existing dedicated export path', () => {
  assert.match(panel, /if \(wantsMP4\)/);
  assert.match(panel, /exportMP4FromCanvas/);
});

test('offline WebM export isolates the visible preview during render-size changes', () => {
  assert.match(panel, /const previewIsolation = isolatePreview/);
  assert.match(panel, /previewIsolation\.dispose\(\)/);
});
