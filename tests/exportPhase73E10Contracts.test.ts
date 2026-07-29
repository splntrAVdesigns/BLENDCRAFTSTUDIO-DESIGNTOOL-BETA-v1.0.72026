import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('Phase 7.3E.10 export contracts', () => {
  it('keeps texture type out of the mesh structural key', () => {
    const source = read('src/app/components/gradient/GradientCanvas.tsx');
    const keyBlock = source.slice(source.indexOf('const meshStructureKey'), source.indexOf('const meshMaterialKey'));
    expect(keyBlock).not.toContain("l.texture?.type || 'none'");
  });

  it('adds analytic Wave edge sampling and normalized loop phase', () => {
    const shader = read('src/app/shaders/gradientShaders.ts');
    expect(shader).toContain('float footprint = max(fwidth(t)');
    expect(shader).toContain('uExportLoopPhase');
    expect(shader).toContain('loopNoiseOffset');
  });

  it('does not restore the fixed 4 to 2 queue policy', () => {
    const source = read('src/app/utils/exportUtils.ts');
    expect(source).toContain('queueHighWatermark');
    expect(source).not.toContain('embeddedFourCore\n              ? 4');
  });

  it('writes explicit WebM colour metadata', () => {
    const muxer = read('src/app/lib/vendored/webm-muxer.ts');
    expect(muxer).toContain('0x55b0');
    expect(muxer).toContain('matrixCoefficients');
    expect(muxer).toContain('this.chunks.length = 0');
  });
});
