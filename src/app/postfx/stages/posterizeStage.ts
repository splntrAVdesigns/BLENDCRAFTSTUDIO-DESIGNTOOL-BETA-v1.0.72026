import * as THREE from '../../lib/three';
import { EffectsConfig } from '../../components/controls/EffectsControls';
import { FULLSCREEN_VERTEX_SHADER, PostProcessStage } from '../types';

function ditheringToInt(dithering: string): number {
  const map: Record<string, number> = {
    none: 0, bayer: 1, noise: 2, blueNoise: 3, scanline: 4, dotDiffusion: 5, crosshatch: 6,
  };
  return map[dithering] ?? 0;
}

// Posterize — ported unchanged from the finishing shader, including all
// dithering helper functions. `random()` (and everything derived from it)
// is duplicated here per the self-contained-effect-file convention, not
// imported — Film Grain has its own separate copy for the same reason.
const FRAGMENT_SHADER = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform vec2 resolution;
  uniform float time;
  uniform float posterize;
  uniform int posterizeDithering;
  uniform float ditherStrength;
  uniform float ditherScale;
  varying vec2 vUv;

  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  float bayer4(vec2 pixel) {
    vec2 p = mod(pixel, 4.0);
    float x = p.x;
    float y = p.y;
    float row0 = mix(mix(0.0, 8.0, step(1.0, x)), mix(2.0, 10.0, step(3.0, x)), step(2.0, x));
    float row1 = mix(mix(12.0, 4.0, step(1.0, x)), mix(14.0, 6.0, step(3.0, x)), step(2.0, x));
    float row2 = mix(mix(3.0, 11.0, step(1.0, x)), mix(1.0, 9.0, step(3.0, x)), step(2.0, x));
    float row3 = mix(mix(15.0, 7.0, step(1.0, x)), mix(13.0, 5.0, step(3.0, x)), step(2.0, x));
    float upper = mix(row0, row1, step(1.0, y));
    float lower = mix(row2, row3, step(3.0, y));
    return (mix(upper, lower, step(2.0, y)) + 0.5) / 16.0;
  }

  float blueNoiseHash(vec2 pixel) {
    float a = random(pixel * vec2(0.754877, 0.569840));
    float b = random((pixel + vec2(37.0, 17.0)) * vec2(1.324718, 2.236068));
    return fract(a + b * 0.618034);
  }

  float scanlineDither(vec2 pixel) {
    float row = mod(pixel.y, 4.0);
    float rowBias = mix(-0.35, 0.35, step(2.0, row));
    float fine = random(vec2(pixel.x, floor(pixel.y * 0.5))) - 0.5;
    return clamp(0.5 + rowBias + fine * 0.35, 0.0, 1.0);
  }

  float dotDiffusionDither(vec2 pixel) {
    vec2 cell = mod(pixel, 6.0) - 3.0;
    float dot = smoothstep(3.2, 0.0, length(cell));
    float jitter = random(floor(pixel / 6.0)) * 0.25;
    return clamp(dot * 0.85 + jitter, 0.0, 1.0);
  }

  float crosshatchDither(vec2 pixel) {
    float a = step(0.5, mod(pixel.x + pixel.y, 8.0) / 8.0);
    float b = step(0.5, mod(pixel.x - pixel.y + 64.0, 8.0) / 8.0);
    float noise = random(floor(pixel / 2.0)) * 0.2;
    return clamp((a + b) * 0.35 + noise, 0.0, 1.0);
  }

  vec3 applyPosterize(vec3 color, vec2 uv, float amount, int dithering, float dStrength, float dScale) {
    if (amount <= 0.01) return color;

    float strength = clamp(amount / 100.0, 0.0, 1.0);
    float curvedStrength = pow(strength, 0.45);
    float l = floor(mix(24.0, 2.0, curvedStrength) + 0.5);
    float stepSize = 1.0 / max(1.0, l - 1.0);

    float density = mix(0.28, 2.4, clamp(dScale / 100.0, 0.0, 1.0));
    vec2 pixel = floor(uv * resolution * density);
    vec3 working = color;
    float threshold = 0.5;
    float amp = mix(0.0, 3.25, clamp(dStrength / 100.0, 0.0, 1.0));

    if (dithering == 1) {
      threshold = bayer4(pixel);
      amp *= 1.1;
    } else if (dithering == 2) {
      threshold = random(pixel + floor(time * 24.0));
      amp *= 1.35;
    } else if (dithering == 3) {
      threshold = blueNoiseHash(pixel);
      amp *= 1.25;
    } else if (dithering == 4) {
      threshold = scanlineDither(pixel);
      amp *= 1.2;
    } else if (dithering == 5) {
      threshold = dotDiffusionDither(pixel);
      amp *= 1.3;
    } else if (dithering == 6) {
      threshold = crosshatchDither(pixel);
      amp *= 1.25;
    }

    if (dithering > 0) {
      vec3 lumaBias = vec3(dot(color, vec3(0.299, 0.587, 0.114)));
      vec3 pushed = mix(color, lumaBias, clamp(strength * 0.24, 0.0, 0.24));
      working = clamp(pushed + (threshold - 0.5) * stepSize * amp, 0.0, 1.0);
    }

    return floor(working * (l - 1.0) + 0.5) / (l - 1.0);
  }

  void main() {
    vec4 src = texture2D(tSource, vUv);
    vec3 color = applyPosterize(src.rgb, vUv, posterize, posterizeDithering, ditherStrength, ditherScale);
    gl_FragColor = vec4(color, src.a);
  }
`;

export function createPosterizeStage(): PostProcessStage {
  const material = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      tSource: { value: null },
      resolution: { value: new THREE.Vector2(1920, 1080) },
      time: { value: 0 },
      posterize: { value: 0 },
      posterizeDithering: { value: 0 },
      ditherStrength: { value: 65 },
      ditherScale: { value: 50 },
    },
    depthWrite: false,
    transparent: true,
  });

  return {
    id: 'posterize',
    material,
    isActive(effects: EffectsConfig): boolean {
      return !!effects.posterizeEnabled && (effects.posterize || 0) > 0.01;
    },
    syncUniforms(effects: EffectsConfig, time: number, resolution: THREE.Vector2): void {
      material.uniforms.resolution.value.copy(resolution);
      material.uniforms.time.value = time;
      material.uniforms.posterize.value = effects.posterize || 0;
      material.uniforms.posterizeDithering.value = ditheringToInt(effects.posterizeDithering || 'none');
      material.uniforms.ditherStrength.value = effects.ditherStrength ?? 65;
      material.uniforms.ditherScale.value = effects.ditherScale ?? 50;
    },
  };
}
