import * as THREE from '../../lib/three';
import { EffectsConfig } from '../../components/controls/EffectsControls';
import { FULLSCREEN_VERTEX_SHADER, PostProcessStage } from '../types';

// Vignette — radial darkening toward the frame edges, ported unchanged
// from the pre-expansion finishing shader. Pure per-pixel color transform
// (only reads this pixel's own color + uv), so unlike Blur/Pixelate this
// never needed multi-pass to compose correctly — it's included as its own
// stage so it can be freely reordered relative to the other 11 in the
// unified Effects Layering list.
const FRAGMENT_SHADER = `
  precision highp float;
  uniform sampler2D tSource;
  uniform float vignette;
  varying vec2 vUv;

  void main() {
    vec4 src = texture2D(tSource, vUv);
    vec3 color = src.rgb;
    if (vignette > 0.01) {
      vec2 position = vUv - vec2(0.5);
      float dist = length(position);
      float vig = smoothstep(0.8, 0.4, dist);
      vig = mix(1.0, vig, vignette);
      color *= vig;
    }
    gl_FragColor = vec4(color, src.a);
  }
`;

export function createVignetteStage(): PostProcessStage {
  const material = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      tSource: { value: null },
      vignette: { value: 0 },
    },
    depthWrite: false,
    transparent: false,
    blending: THREE.NoBlending,
    depthTest: false,
  });

  return {
    id: 'vignette',
    material,
    isActive(effects: EffectsConfig, liveOverride?: number): boolean {
      const value = liveOverride ?? effects.vignette ?? 0;
      return value > 0.01;
    },
    syncUniforms(effects: EffectsConfig, _time: number, _resolution: THREE.Vector2, liveOverride?: number): void {
      material.uniforms.vignette.value = liveOverride ?? effects.vignette ?? 0;
    },
  };
}
