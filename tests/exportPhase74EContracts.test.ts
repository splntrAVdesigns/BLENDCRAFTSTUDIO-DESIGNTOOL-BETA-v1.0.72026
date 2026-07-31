import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const runner = readFileSync('src/app/export/video-lab/mainThreadRunner.ts', 'utf8');
const panel = readFileSync('src/app/components/controls/ExportPanel.tsx', 'utf8');

describe('Phase 7.4E contracts', () => {
  it('uses a dedicated VideoSampleSource instead of CanvasSource', () => {
    expect(runner).toContain('new runtime.VideoSampleSource');
    expect(runner).not.toContain('new runtime.CanvasSource');
  });

  it('uses a bounded three-frame pipeline', () => {
    expect(runner).toContain('MAX_PENDING_FRAMES = 3');
    expect(runner).toContain('Promise.race(pending)');
  });

  it('stages frames through dedicated export surfaces', () => {
    expect(runner).toContain('createExportSurface');
    expect(runner).toContain('snapshotIntoSurface');
    expect(runner).toContain('createImageBitmap');
  });

  it('defaults quality to Standard and hides Sharp Max', () => {
    expect(panel).toContain("useState<VideoQuality>('standard')");
    expect(panel).not.toContain("{ value: 'sharpMax'");
  });
});
