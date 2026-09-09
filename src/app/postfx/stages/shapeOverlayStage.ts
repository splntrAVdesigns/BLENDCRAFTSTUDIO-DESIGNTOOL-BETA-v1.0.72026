import * as THREE from '../../lib/three';
import { EffectsConfig } from '../../components/controls/EffectsControls';
import { FULLSCREEN_VERTEX_SHADER, PostProcessStage } from '../types';

// Convert shape string to integer for shader — duplicated from
// effectsRenderer.ts intentionally: this stage module is meant to be
// self-contained, same convention VML's own effect files follow.
function shapeToInt(shape: string): number {
  const shapeMap: Record<string, number> = {
    square: 0, circle: 1, hexagon: 2, diamond: 3, triangle: 4, lines: 5,
  };
  return shapeMap[shape] ?? 0;
}

// Shape Overlay — cell-based shape mask (square/circle/hexagon/diamond/
// triangle/lines), ported unchanged from the pre-multipass finishing
// shader, including the edge-wrap handling for seamless cell boundaries.
const FRAGMENT_SHADER = `
  precision highp float;
  uniform sampler2D tSource;
  uniform float shapeOverlay;
  uniform int creativeShape;
  uniform vec2 resolution;
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

  float getTriangleTessellation(vec2 pixelPos, float size) {
    float triangleHeight = size * 0.866;
    float halfWidth = size * 0.5;
    float row = floor(pixelPos.y / triangleHeight);
    float col = floor(pixelPos.x / size);
    vec2 cellPos = vec2(mod(pixelPos.x, size), mod(pixelPos.y, triangleHeight));
    bool pointsUp = mod(row + col, 2.0) < 1.0;
    if (pointsUp) {
      float edgeLeft = cellPos.y * (halfWidth / triangleHeight);
      float edgeRight = size - (cellPos.y * (halfWidth / triangleHeight));
      return (cellPos.x >= edgeLeft && cellPos.x <= edgeRight) ? 1.0 : 0.0;
    } else {
      float edgeLeft = (triangleHeight - cellPos.y) * (halfWidth / triangleHeight);
      float edgeRight = size - ((triangleHeight - cellPos.y) * (halfWidth / triangleHeight));
      return (cellPos.x >= edgeLeft && cellPos.x <= edgeRight) ? 1.0 : 0.0;
    }
  }

  void main() {
    float pixelSize = max(pow(shapeOverlay / 10.0, 1.5) * 10.0, 1.0);
    vec2 pixelPos = vUv * resolution;
    float alpha = texture2D(tSource, vUv).a;

    if (creativeShape == 4) {
      float shapeMask = getTriangleTessellation(pixelPos, pixelSize);
      float triangleHeight = pixelSize * 0.866;
      float row = floor(pixelPos.y / triangleHeight);
      float col = floor(pixelPos.x / pixelSize);
      vec2 cellCenter = vec2((col + 0.5) * pixelSize, (row + 0.5) * triangleHeight);
      vec2 sampleUV = cellCenter / resolution;
      vec3 cellColor = texture2D(tSource, sampleUV).rgb;
      vec3 rgb = shapeMask > 0.5 ? cellColor : texture2D(tSource, vUv).rgb * 0.3;
      gl_FragColor = vec4(rgb, alpha);
      return;
    }

    vec2 cellIndex = floor(pixelPos / pixelSize);
    vec2 cellCenter = (cellIndex + 0.5) * pixelSize;
    vec2 sampleUV = cellCenter / resolution;
    vec3 cellColor = texture2D(tSource, sampleUV).rgb;
    float shapeMask = getShape(pixelPos, cellCenter, pixelSize, creativeShape);

    vec2 edgeDist = min(pixelPos, resolution - pixelPos);
    if (edgeDist.x < pixelSize || edgeDist.y < pixelSize) {
      vec2 wrappedCenter = cellCenter;
      if (pixelPos.x < pixelSize) {
        wrappedCenter.x += resolution.x;
      } else if (pixelPos.x > resolution.x - pixelSize) {
        wrappedCenter.x -= resolution.x;
      }
      if (pixelPos.y < pixelSize) {
        wrappedCenter.y += resolution.y;
      } else if (pixelPos.y > resolution.y - pixelSize) {
        wrappedCenter.y -= resolution.y;
      }
      float wrappedMask = getShape(pixelPos, wrappedCenter, pixelSize, creativeShape);
      shapeMask = max(shapeMask, wrappedMask);
    }

    vec3 rgb = shapeMask > 0.5 ? cellColor : texture2D(tSource, vUv).rgb * 0.3;
    gl_FragColor = vec4(rgb, alpha);
  }
`;

export function createShapeOverlayStage(): PostProcessStage {
  const material = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      tSource: { value: null },
      shapeOverlay: { value: 0 },
      creativeShape: { value: 0 },
      resolution: { value: new THREE.Vector2(1920, 1080) },
    },
    depthWrite: false,
    transparent: false,
    blending: THREE.NoBlending,
    depthTest: false,
  });

  return {
    id: 'shapeOverlay',
    material,
    isActive(effects: EffectsConfig): boolean {
      return !!effects.shapeOverlayEnabled && (effects.shapeOverlay || 0) > 0;
    },
    syncUniforms(effects: EffectsConfig, _time: number, resolution: THREE.Vector2): void {
      material.uniforms.shapeOverlay.value = effects.shapeOverlay || 0;
      material.uniforms.creativeShape.value = shapeToInt(effects.creativeShape || 'square');
      material.uniforms.resolution.value.copy(resolution);
    },
  };
}
