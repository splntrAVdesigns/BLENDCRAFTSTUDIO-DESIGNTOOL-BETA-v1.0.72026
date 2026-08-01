import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const worker = readFileSync(new URL('../src/app/export/directWebCodecsEncoder.worker.ts', import.meta.url), 'utf8');
const exporter = readFileSync(new URL('../src/app/export/DirectWebCodecsWorkerExporter.ts', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../src/app/components/controls/ExportPanel.tsx', import.meta.url), 'utf8');

test('Phase 7.4H measures H.264 before VP codecs', () => {
  const avc = worker.indexOf("webCodec: 'avc1.42001f'");
  const vp9 = worker.indexOf("webCodec: 'vp09.00.10.08'");
  const vp8 = worker.indexOf("webCodec: 'vp8'");
  assert.ok(avc >= 0 && vp9 > avc && vp8 > vp9);
  assert.match(worker, /benchmarkCandidate/);
  assert.match(worker, /firstChunkMs <= 2_500/);
  assert.match(worker, /fps >= 6/);
});

test('Phase 7.4H cuts over to MP4 when AVC wins', () => {
  assert.match(worker, /mediaCodec: 'avc', container: 'mp4'/);
  assert.match(worker, /new Mp4OutputFormat\(\)/);
  assert.match(exporter, /selectedProfile\.container === 'mp4'/);
});

test('Phase 7.4H reports measured profile and candidates', () => {
  assert.match(exporter, /measuredCodecSelection/);
  assert.match(exporter, /selectedMeasuredFps/);
  assert.match(exporter, /candidateReport/);
});

test('Phase 7.4H exposes one automatic production format', () => {
  assert.match(panel, /Video — best compatible format/);
  assert.match(panel, /Production Video · auto codec/);
  assert.match(panel, /Export Video/);
});
