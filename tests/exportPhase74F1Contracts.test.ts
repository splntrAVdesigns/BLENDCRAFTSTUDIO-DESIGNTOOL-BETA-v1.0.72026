import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runner = fs.readFileSync('src/app/export/video-lab/mainThreadRunner.ts', 'utf8');
const production = fs.readFileSync('src/app/export/MediabunnyProductionExporter.ts', 'utf8');
const types = fs.readFileSync('src/app/export/video-lab/types.ts', 'utf8');

test('Phase 7.4F.1 probes the exact requested encoder configuration before construction', () => {
  assert.match(runner, /runtime\.canEncodeVideo\(codec, \{/);
  assert.match(runner, /width,\s*height,\s*bitrate,\s*hardwareAcceleration/);
  const probeIndex = runner.indexOf('selectSupportedEncoderProfile(');
  const sourceIndex = runner.indexOf('new runtime.VideoSampleSource');
  assert.ok(probeIndex >= 0 && sourceIndex > probeIndex);
});

test('Phase 7.4F.1 selects a supported VP8 acceleration profile without changing requested dimensions or bitrate', () => {
  assert.match(runner, /'no-preference',\s*'prefer-hardware',\s*'prefer-software'/s);
  assert.match(runner, /return \{ codec, bitrate, width, height, hardwareAcceleration \}/);
  assert.doesNotMatch(runner, /bitrate\s*\*\s*0\.|width\s*\/|height\s*\//);
});

test('Phase 7.4F.1 fails early only after all exact profiles fail', () => {
  assert.match(runner, /No supported .* encoder profile exists/);
  assert.match(runner, /Capability probes:/);
  assert.match(runner, /for \(const hardwareAcceleration of candidates\)/);
});

test('Phase 7.4F.1 exposes selected acceleration in progress and benchmark diagnostics', () => {
  assert.match(runner, /Encoder ready: .*hardwareAcceleration/);
  assert.match(runner, /encoderConfig:/);
  assert.match(types, /encoderConfig\?:/);
  assert.match(production, /Encoder capability selected/);
});

test('Phase 7.4F.1 does not render a warm-up frame before capability selection', () => {
  assert.doesNotMatch(production, /renderAtTime\(0, offline\.renderer/);
  assert.match(production, /capability selection happens inside the runner before the/);
});
