import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const runner = readFileSync('src/app/export/video-lab/mainThreadRunner.ts', 'utf8');
const panel = readFileSync('src/app/components/controls/ExportPanel.tsx', 'utf8');

describe('Phase 7.4E retained contracts after 7.4F supersession', () => {
  it('keeps VideoSampleSource and does not return to CanvasSource', () => {
    expect(runner).toContain('new runtime.VideoSampleSource');
    expect(runner).not.toContain('new runtime.CanvasSource');
  });

  it('keeps Standard as default and Sharp Max hidden', () => {
    expect(panel).toContain("useState<VideoQuality>('standard')");
    expect(panel).not.toContain("{ value: 'sharpMax'");
  });
});
