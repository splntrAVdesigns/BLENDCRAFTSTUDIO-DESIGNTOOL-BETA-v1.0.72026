import * as THREE from '../../lib/three';
import { EffectsConfig } from '../../components/controls/EffectsControls';
import { FULLSCREEN_VERTEX_SHADER, PostProcessStage } from '../types';

// Fresnel Edge Glow — edge lighting based on distance from center, ported
// unchanged from the finishing shader. Pure per-pixel color transform, no
// neighbor sampling.
const FRAGMENT_SHADER = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform bool fresnelEnabled;
  uniform float fresnelPower;
  uniform float fresnelIntensity;
  varying vec2 vUv;

  vec3 applyFresnelEffect(vec3 color, vec2 uv, float power, float intensity) {
    vec2 centered = uv - 0.5;
    float dist = length(centered);
    float edgeDist = clamp(dist * 2.0, 0.0, 1.0);
    float fresnel = pow(edgeDist, power);
    vec3 edgeColor = color * (1.0 + fresnel * intensity * 4.0);
    edgeColor += vec3(fresnel * fresnel * intensity * 1.5);
    return mix(color, edgeColor, intensity);
  }

  void main() {
    vec4 src = texture2D(tSource, vUv);
    vec3 color = fresnelEnabled ? applyFresnelEffect(src.rgb, vUv, fresnelPower, fresnelIntensity) : src.rgb;
    gl_FragColor = vec4(color, src.a);
  }
`;

export function createFresnelStage(): PostProcessStage {
  const material = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      tSource: { value: null },
      fresnelEnabled: { value: false },
      fresnelPower: { value: 2 },
      fresnelIntensity: { value: 0.5 },
    },
    depthWrite: false,
    transparent: true,
  });

  return {
    id: 'fresnel',
    material,
    isActive(effects: EffectsConfig): boolean {
      return !!effects.fresnelEnabled;
    },
    syncUniforms(effects: EffectsConfig): void {
      material.uniforms.fresnelEnabled.value = effects.fresnelEnabled || false;
      material.uniforms.fresnelPower.value = effects.fresnelPower || 2;
      material.uniforms.fresnelIntensity.value = effects.fresnelIntensity || 0.5;
    },
  };
}
