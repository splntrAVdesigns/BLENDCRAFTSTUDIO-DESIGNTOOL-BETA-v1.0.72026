import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const panel = fs.readFileSync('src/app/components/controls/ExportPanel.tsx', 'utf8');
const exporter = fs.readFileSync('src/app/export/RealtimeHiddenCanvasProductionExporter.ts', 'utf8');
const engine = fs.readFileSync('src/app/export/recording/RecordingExportEngine.ts', 'utf8');
const profiles = fs.readFileSync('src/app/export/recording/RecordingProfiles.ts', 'utf8');

test('production video button is cut over to realtime hidden-canvas exporter', () => {
  assert.match(panel, /exportRealtimeHiddenCanvasVideo\(/);
  assert.doesNotMatch(panel, /exportWebMFromCanvas\(/);
});

test('production exporter uses hidden canvas MediaRecorder engine and certifies playback', () => {
  assert.match(exporter, /exportWithProductionRecordingEngine\(/);
  assert.match(exporter, /certifyPlayback\(/);
  assert.match(exporter, /\[BLENDCRAFT Video Export\] Started/);
  assert.match(exporter, /\[BLENDCRAFT Video Export\] Complete/);
  assert.match(exporter, /\[BLENDCRAFT Video Export\] Failed/);
});

test('recording engine captures an attached hidden canvas at the requested fps', () => {
  assert.match(engine, /left: '-100000px'/);
  assert.match(engine, /captureStream\(fps\)/);
  assert.match(engine, /captureMode = 'automatic-fps'/);
  assert.match(engine, /Recording frame \$\{frame\}\/\$\{totalFrames\}/);
});

test('1080p30 quality ladder is 10, 16, and 24 Mbps', () => {
  assert.match(profiles, /standard: 10_000_000/);
  assert.match(profiles, /high: 16_000_000/);
  assert.match(profiles, /ultra: 24_000_000/);
});
