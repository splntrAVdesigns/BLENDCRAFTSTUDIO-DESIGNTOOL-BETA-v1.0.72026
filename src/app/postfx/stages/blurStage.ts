import * as THREE from '../../lib/three';
import { EffectsConfig } from '../../components/controls/EffectsControls';
import { FULLSCREEN_VERTEX_SHADER, PostProcessStage } from '../types';

// Blur — simple 5x5 box blur, ported unchanged from the pre-multipass
// finishing shader. This is the effect that made multi-pass unavoidable:
// a box blur needs to read NEIGHBORING pixels of whatever the previous
// stage produced, which is only possible if that previous output exists
// as an actual texture (this pass's tSource) — a single-pass shader has no
// way to ask "what did the pixel next to me end up as after Mirror ran".
const FRAGMENT_SHADER = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform float blur;
  varying vec2 vUv;

  void main() {
    float radius = blur * 0.005;
    vec3 color = vec3(0.0);
    float total = 0.0;
    for (float x = -2.0; x <= 2.0; x++) {
      for (float y = -2.0; y <= 2.0; y++) {
        vec2 offset = vec2(x, y) * radius;
        color += texture2D(tSource, vUv + offset).rgb;
        total += 1.0;
      }
    }
    float alpha = texture2D(tSource, vUv).a;
    gl_FragColor = vec4(color / total, alpha);
  }
`;

export function createBlurStage(): PostProcessStage {
  const material = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      tSource: { value: null },
      blur: { value: 0 },
    },
    depthWrite: false,
    transparent: true,
  });

  return {
    id: 'blur',
    material,
    isActive(effects: EffectsConfig, liveOverride?: number): boolean {
      const value = liveOverride ?? effects.blur ?? 0;
      return value > 0.01;
    },
    syncUniforms(effects: EffectsConfig, _time: number, _resolution: THREE.Vector2, liveOverride?: number): void {
      material.uniforms.blur.value = liveOverride ?? effects.blur ?? 0;
    },
  };
}
