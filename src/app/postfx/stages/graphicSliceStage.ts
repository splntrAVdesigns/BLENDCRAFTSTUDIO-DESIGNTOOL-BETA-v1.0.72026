import * as THREE from '../../lib/three';
import { EffectsConfig } from '../../components/controls/EffectsControls';
import { FULLSCREEN_VERTEX_SHADER, PostProcessStage } from '../types';

// Graphic Slice — stepped-clock row-banded horizontal displacement glitch.
// Ported from Visual Mood Lab's VFX rack (family: slice). Re-randomizes on
// a discrete time step (not a continuous drift) so each band holds steady
// then snaps — reads as a glitch cut rather than a smooth wobble.
//
// Hash inputs (band index / step index, each x a small constant) stay
// small, so the plain sin()-based hash is safe here — matching VML's own
// slice.frag. Contrast with Noise Displacement, which needs the
// precision-safe hash because it evaluates noise continuously.
const FRAGMENT_SHADER = `
  precision highp float;
  uniform sampler2D tSource;
  uniform float time;
  uniform float graphicSliceBands;
  uniform float graphicSliceAmount;
  uniform float graphicSliceRate;
  varying vec2 vUv;

  void main() {
    float bandCount = max(1.0, graphicSliceBands);
    float band = floor(vUv.y * bandCount);
    float stepIndex = floor(time * graphicSliceRate);
    float n = band * 12.9898 + stepIndex * 78.233;
    float h = fract(sin(n) * 43758.5453);
    float offset = (h - 0.5) * 2.0 * graphicSliceAmount;
    vec2 sliced = clamp(vec2(vUv.x + offset, vUv.y), 0.0, 1.0);
    gl_FragColor = texture2D(tSource, sliced);
  }
`;

export function createGraphicSliceStage(): PostProcessStage {
  const material = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      tSource: { value: null },
      time: { value: 0 },
      graphicSliceBands: { value: 16 },
      graphicSliceAmount: { value: 0.08 },
      graphicSliceRate: { value: 8 },
    },
    depthWrite: false,
    transparent: false,
    blending: THREE.NoBlending,
    depthTest: false,
  });

  return {
    id: 'slice',
    material,
    isActive(effects: EffectsConfig): boolean {
      return !!effects.graphicSliceEnabled && (effects.graphicSliceAmount || 0) > 0.001;
    },
    syncUniforms(effects: EffectsConfig, time: number): void {
      material.uniforms.time.value = time;
      material.uniforms.graphicSliceBands.value = effects.graphicSliceBands ?? 16;
      material.uniforms.graphicSliceAmount.value = effects.graphicSliceAmount ?? 0.08;
      material.uniforms.graphicSliceRate.value = effects.graphicSliceRate ?? 8;
    },
  };
}
