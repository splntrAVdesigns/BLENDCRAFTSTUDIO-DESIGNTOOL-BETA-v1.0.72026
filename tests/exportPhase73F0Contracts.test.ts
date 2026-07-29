import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const read = (path: string) => readFileSync(path, 'utf8');

test('Phase 7.3F.0 keeps PNG continuity code intact', () => {
  assert.match(read('src/app/utils/exportUtils.ts'), /PHASE 7\.3E\.10 PNG CONTINUITY/);
});

test('Phase 7.3F.0 keeps Mediabunny isolated from production exporter', () => {
  assert.doesNotMatch(read('src/app/utils/exportUtils.ts'), /from ['"]mediabunny['"]/);
  assert.match(read('src/app/export/video-lab/mediabunnyLoader.ts'), /packageName = 'mediabunny'/);
});

test('Phase 7.3F.0 provides frame certification and codec probes', () => {
  assert.match(read('src/app/export/video-lab/frameCertification.ts'), /visually identical/);
  const probe = read('src/app/export/video-lab/capabilityProbe.ts');
  assert.match(probe, /avc1\.42001f/);
  assert.match(probe, /vp09\.00\.10\.08/);
  assert.match(probe, /'vp8'/);
});

test('Phase 7.3F.0 documents the frozen production boundary', () => {
  assert.match(read('docs/PHASE_7.3F.0_VIDEO_EXPORT_LAB.md'), /production exporter remains untouched/);
});
