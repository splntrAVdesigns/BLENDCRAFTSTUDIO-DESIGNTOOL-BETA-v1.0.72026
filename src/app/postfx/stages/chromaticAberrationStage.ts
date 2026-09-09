import * as THREE from '../../lib/three';
import { EffectsConfig } from '../../components/controls/EffectsControls';
import { FULLSCREEN_VERTEX_SHADER, PostProcessStage, StageOverrides } from '../types';

// Chromatic Aberration — lateral prismatic RGB split, ported unchanged from
// the pre-multipass finishing shader (effectsRenderer.ts). Now runs as its
// own ping-pong pass instead of resampling tDiffuse independently, which is
// what let it get silently discarded by whichever spatial stage ran after
// it — see SPATIAL_FX_MULTIPASS.md for the full bug writeup.
//
// amount is in the same 0-1 UV-normalised space as the effects slider. At
// amount = 1.0 the lateral offset is 3% of the frame width, clearly visible
// without destroying the composition. Lateral (not radial) offsets stay
// well inside [0,1]; the explicit clamp() is a belt-and-suspenders guard
// against rounding.
const FRAGMENT_SHADER = `
  precision highp float;
  uniform sampler2D tSource;
  uniform float chromaticAberration;
  varying vec2 vUv;

  void main() {
    float strength = chromaticAberration * 0.03;
    float r = texture2D(tSource, clamp(vUv - vec2(strength, 0.0), 0.0, 1.0)).r;
    float g = texture2D(tSource, vUv).g;
    float b = texture2D(tSource, clamp(vUv + vec2(strength, 0.0), 0.0, 1.0)).b;
    float alpha = texture2D(tSource, vUv).a;
    gl_FragColor = vec4(r, g, b, alpha);
  }
`;

export function createChromaticAberrationStage(): PostProcessStage {
  const material = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      tSource: { value: null },
      chromaticAberration: { value: 0 },
    },
    depthWrite: false,
    transparent: false,
    blending: THREE.NoBlending,
    depthTest: false,
  });

  return {
    id: 'chroma',
    material,
    isActive(effects: EffectsConfig, overrides?: StageOverrides): boolean {
      const value = overrides?.amount ?? effects.chromaticAberration ?? 0;
      return value > 0.01;
    },
    syncUniforms(effects: EffectsConfig, _time: number, _resolution: THREE.Vector2, overrides?: StageOverrides): void {
      material.uniforms.chromaticAberration.value = overrides?.amount ?? effects.chromaticAberration ?? 0;
    },
  };
}
