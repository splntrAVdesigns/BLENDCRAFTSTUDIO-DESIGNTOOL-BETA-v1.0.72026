import * as THREE from '../../lib/three';
import { EffectsConfig } from '../../components/controls/EffectsControls';
import { FULLSCREEN_VERTEX_SHADER, PostProcessStage } from '../types';

function shapeToInt(shape: string): number {
  const map: Record<string, number> = {
    square: 0, circle: 1, hexagon: 2, diamond: 3, triangle: 4, lines: 5,
  };
  return map[shape] ?? 0;
}

// Halftone — classic rotated-dot pattern with luminance-based dot sizing,
// ported unchanged from the finishing shader. Distinct from Shape Overlay
// (postfx/stages/shapeOverlayStage.ts), which is a straight grid-cell
// overlay with no rotation or luminance response. Each has its own copy
// of getShape() per the self-contained-effect-file convention.
const FRAGMENT_SHADER = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform vec2 resolution;
  uniform float halftone;
  uniform float halftoneAngle;
  uniform int creativeShape;
  varying vec2 vUv;

  float getShape(vec2 cellPos, vec2 cellCenter, float size, int shape) {
    vec2 delta = cellPos - cellCenter;
    float dist = length(delta);

    if (shape == 0) { // Square
      return (abs(delta.x) < size * 0.4 && abs(delta.y) < size * 0.4) ? 1.0 : 0.0;
    } else if (shape == 1) { // Circle
      return (dist < size * 0.4) ? 1.0 : 0.0;
    } else if (shape == 2) { // Hexagon
      float angle = atan(delta.y, delta.x);
      float hexDist = cos(floor(0.5 + angle / 1.047197) * 1.047197 - angle) * dist;
      return (hexDist < size * 0.4) ? 1.0 : 0.0;
    } else if (shape == 3) { // Diamond
      float diamondDist = abs(delta.x) + abs(delta.y);
      return (diamondDist < size * 0.5) ? 1.0 : 0.0;
    } else if (shape == 4) { // Triangle - handled specially in tessellation
      return 1.0;
    } else if (shape == 5) { // Lines (horizontal)
      return (abs(delta.y) < size * 0.1) ? 1.0 : 0.0;
    }
    return 1.0;
  }

  vec3 applyHalftone(vec3 color, vec2 uv, float amount, float angle, int shape) {
    if (amount < 1.0) return color;

    float gray = dot(color, vec3(0.299, 0.587, 0.114));

    float angleRad = radians(angle);
    vec2 center = vec2(0.5, 0.5);
    vec2 uvCentered = uv - center;
    mat2 rotation = mat2(cos(angleRad), -sin(angleRad), sin(angleRad), cos(angleRad));
    vec2 rotatedUV = rotation * uvCentered + center;

    vec2 pixelPos = rotatedUV * resolution;
    float dotSize = amount;
    vec2 cellIndex = floor(pixelPos / dotSize);
    vec2 cellCenter = (cellIndex + 0.5) * dotSize;

    float dotScale = 1.0 - gray;
    float adjustedDotSize = dotSize * dotScale;

    float shapeMask = getShape(pixelPos, cellCenter, adjustedDotSize, shape);

    return mix(color, vec3(0.0), 1.0 - shapeMask);
  }

  void main() {
    vec4 src = texture2D(tSource, vUv);
    vec3 color = applyHalftone(src.rgb, vUv, halftone, halftoneAngle, creativeShape);
    gl_FragColor = vec4(color, src.a);
  }
`;

export function createHalftoneStage(): PostProcessStage {
  const material = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      tSource: { value: null },
      resolution: { value: new THREE.Vector2(1920, 1080) },
      halftone: { value: 0 },
      halftoneAngle: { value: 0 },
      creativeShape: { value: 0 },
    },
    depthWrite: false,
    transparent: true,
  });

  return {
    id: 'halftone',
    material,
    isActive(effects: EffectsConfig): boolean {
      return !!effects.halftoneEnabled && (effects.halftone || 0) > 0.01;
    },
    syncUniforms(effects: EffectsConfig, _time: number, resolution: THREE.Vector2): void {
      material.uniforms.resolution.value.copy(resolution);
      material.uniforms.halftone.value = effects.halftone || 0;
      material.uniforms.halftoneAngle.value = effects.halftoneAngle || 0;
      material.uniforms.creativeShape.value = shapeToInt(effects.creativeShape || 'square');
    },
  };
}
