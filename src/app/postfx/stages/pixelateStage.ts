import * as THREE from '../../lib/three';
import { EffectsConfig } from '../../components/controls/EffectsControls';
import { FULLSCREEN_VERTEX_SHADER, PostProcessStage, StageOverrides } from '../types';

// Pixelate — 4-tap supersampled grid snap, ported unchanged from the
// pre-multipass finishing shader. Needs `resolution` (pixel grid math), so
// unlike Chroma/Blur it takes an explicit resolution uniform.
const FRAGMENT_SHADER = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform float pixelate;
  uniform vec2 resolution;
  varying vec2 vUv;

  void main() {
    float pixelSize = max(pow(pixelate / 10.0, 1.5) * 10.0, 1.0);
    vec2 pixelatedUV = floor(vUv * resolution / pixelSize) * pixelSize / resolution;

    float offset = pixelSize / resolution.x * 0.25;
    vec3 color = vec3(0.0);
    color += texture2D(tSource, pixelatedUV + vec2(0.0, 0.0)).rgb;
    color += texture2D(tSource, pixelatedUV + vec2(offset, 0.0)).rgb;
    color += texture2D(tSource, pixelatedUV + vec2(0.0, offset)).rgb;
    color += texture2D(tSource, pixelatedUV + vec2(offset, offset)).rgb;

    float alpha = texture2D(tSource, vUv).a;
    gl_FragColor = vec4(color / 4.0, alpha);
  }
`;

export function createPixelateStage(): PostProcessStage {
  const material = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      tSource: { value: null },
      pixelate: { value: 0 },
      resolution: { value: new THREE.Vector2(1920, 1080) },
    },
    depthWrite: false,
    transparent: true,
  });

  return {
    id: 'pixelate',
    material,
    isActive(effects: EffectsConfig, overrides?: StageOverrides): boolean {
      if (!effects.pixelateEnabled) return false;
      const amount = overrides?.amount ?? effects.pixelate ?? 0;
      return amount > 0;
    },
    syncUniforms(effects: EffectsConfig, _time: number, resolution: THREE.Vector2, overrides?: StageOverrides): void {
      material.uniforms.pixelate.value = overrides?.amount ?? effects.pixelate ?? 0;
      material.uniforms.resolution.value.copy(resolution);
    },
  };
}
