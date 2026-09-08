import * as THREE from '../../lib/three';
import { EffectsConfig } from '../../components/controls/EffectsControls';
import { FULLSCREEN_VERTEX_SHADER, PostProcessStage } from '../types';

// Film Grain — high-frequency per-pixel noise, ported unchanged from the
// finishing shader. Self-contained hash (own copy, not shared/imported)
// per convention — this is the classic sin()-based hash, safe here since
// it's fed uv*resolution/frequency, not raw large pixel coordinates.
const FRAGMENT_SHADER = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform vec2 resolution;
  uniform float filmGrain;
  uniform float filmGrainSize;
  varying vec2 vUv;

  float filmGrainNoise(vec2 uv) {
    return fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  void main() {
    vec4 src = texture2D(tSource, vUv);
    vec3 color = src.rgb;
    if (filmGrain > 0.01) {
      float frequency = 500.0 / max(filmGrainSize, 0.1);
      vec2 grainUV = vUv * resolution / frequency;
      float noise = filmGrainNoise(grainUV);
      float grainValue = (noise - 0.5) * filmGrain * 2.0;
      color = clamp(color + vec3(grainValue), 0.0, 1.0);
    }
    gl_FragColor = vec4(color, src.a);
  }
`;

export function createFilmGrainStage(): PostProcessStage {
  const material = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      tSource: { value: null },
      resolution: { value: new THREE.Vector2(1920, 1080) },
      filmGrain: { value: 0 },
      filmGrainSize: { value: 1 },
    },
    depthWrite: false,
    transparent: true,
  });

  return {
    id: 'filmGrain',
    material,
    isActive(effects: EffectsConfig): boolean {
      return (effects.filmGrain || 0) > 0.01;
    },
    syncUniforms(effects: EffectsConfig, _time: number, resolution: THREE.Vector2): void {
      material.uniforms.resolution.value.copy(resolution);
      material.uniforms.filmGrain.value = effects.filmGrain || 0;
      material.uniforms.filmGrainSize.value = effects.filmGrainSize || 1;
    },
  };
}
