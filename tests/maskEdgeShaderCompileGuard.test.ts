import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const shaderPath = path.resolve(process.cwd(), 'src/app/shaders/maskShaderWrapper.ts');
const source = fs.readFileSync(shaderPath, 'utf8');

describe('mask edge shader compile guard', () => {
  it('does not reference the nonexistent sampleThreshBoundsAware helper', () => {
    expect(source).not.toContain('sampleThreshBoundsAware(');
  });

  it('uses the existing bounds-aware raw-UV sampler for center and edge taps', () => {
    expect(source).toContain('sampleExpandThresh(uv, vec2( 0.0,  0.0), tLo, tHi)');
    expect(source.match(/sampleExpandThresh\(uv,/g)?.length).toBeGreaterThanOrEqual(9);
  });
});