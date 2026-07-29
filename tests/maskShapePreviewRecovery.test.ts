import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/app/components/controls/MaskControls.tsx', import.meta.url),
  'utf8',
);

describe('mask shape preview recovery guards', () => {
  it('guards incomplete lazy-loaded shape records before rendering', () => {
    expect(source).toContain('function isRenderableShapePreset');
    expect(source).toContain('if (!isRenderableShapePreset(shape))');
  });

  it('provides a safe fallback viewBox', () => {
    expect(source).toContain("{ x: 0, y: 0, w: 100, h: 100 }");
  });

  it('uses non-submitting shape buttons during rapid switching', () => {
    expect(source).toContain('type=\"button\"');
  });
});
