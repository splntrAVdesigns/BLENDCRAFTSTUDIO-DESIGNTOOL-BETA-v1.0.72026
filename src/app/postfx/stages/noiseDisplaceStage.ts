import * as THREE from '../../lib/three';
import { EffectsConfig } from '../../components/controls/EffectsControls';
import { FULLSCREEN_VERTEX_SHADER, PostProcessStage } from '../types';

// Noise Displacement — smooth animated 2D value-noise field offsets the
// sample position. Ported from Visual Mood Lab's VFX rack (family: warp).
//
// Precision-safe hash: a sin()/dot()-based hash (as used elsewhere in this
// codebase for grain/dither) collapses into coherent banding once fed
// pixel-scale coordinates (values in the thousands) — float32 only carries
// ~7 decimal digits. This one only ever sees normalized-ish UV*scale
// inputs, but uses the precision-safe idiom regardless as a standing
// principle for new GPU noise work. See VFX_RACK_ARCHITECTURE.md §8.1.
const FRAGMENT_SHADER = `
  precision highp float;
  uniform sampler2D tSource;
  uniform float time;
  uniform float noiseDisplaceAmount;
  uniform float noiseDisplaceScale;
  uniform float noiseDisplaceSpeed;
  varying vec2 vUv;

  vec2 safeHash2(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.13);
    p3 += dot(p3, p3.yzx + 3.333);
    return fract(vec2((p3.x + p3.y) * p3.z, (p3.y + p3.z) * p3.x));
  }

  // Bilinear-interpolated (smoothstep-eased) hash-grid value noise —
  // deliberately self-contained (own hash pair, not shared/imported)
  // per the same self-contained-effect-file convention every stage here
  // follows.
  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = safeHash2(i).x;
    float b = safeHash2(i + vec2(1.0, 0.0)).x;
    float c = safeHash2(i + vec2(0.0, 1.0)).x;
    float d = safeHash2(i + vec2(1.0, 1.0)).x;
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    vec2 field = vUv * noiseDisplaceScale + time * noiseDisplaceSpeed;
    float nx = valueNoise(field);
    float ny = valueNoise(field + vec2(37.2, 91.7));
    vec2 offset = (vec2(nx, ny) - 0.5) * 2.0 * noiseDisplaceAmount;
    vec2 displaced = clamp(vUv + offset, 0.0, 1.0);
    gl_FragColor = texture2D(tSource, displaced);
  }
`;

export function createNoiseDisplaceStage(): PostProcessStage {
  const material = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      tSource: { value: null },
      time: { value: 0 },
      noiseDisplaceAmount: { value: 0.1 },
      noiseDisplaceScale: { value: 2 },
      noiseDisplaceSpeed: { value: 0.5 },
    },
    depthWrite: false,
    transparent: false,
    blending: THREE.NoBlending,
    depthTest: false,
  });

  return {
    id: 'displace',
    material,
    isActive(effects: EffectsConfig): boolean {
      return !!effects.noiseDisplaceEnabled && (effects.noiseDisplaceAmount || 0) > 0.001;
    },
    syncUniforms(effects: EffectsConfig, time: number): void {
      material.uniforms.time.value = time;
      material.uniforms.noiseDisplaceAmount.value = effects.noiseDisplaceAmount ?? 0.1;
      material.uniforms.noiseDisplaceScale.value = effects.noiseDisplaceScale ?? 2;
      material.uniforms.noiseDisplaceSpeed.value = effects.noiseDisplaceSpeed ?? 0.5;
    },
  };
}
