import * as THREE from '../../lib/three';
import { EffectsConfig } from '../../components/controls/EffectsControls';
import { FULLSCREEN_VERTEX_SHADER, PostProcessStage } from '../types';

// Quad Mirror — 4-way kaleidoscope fold around an adjustable center.
// Ported from Visual Mood Lab's VFX rack (family: mirror). Runs as its own
// ping-pong pass so it composes correctly with every other stage — see
// SPATIAL_FX_MULTIPASS.md for why a single shared shader couldn't do this.
const FRAGMENT_SHADER = `
  precision highp float;
  uniform sampler2D tSource;
  uniform vec2 quadMirrorCenter;
  varying vec2 vUv;

  void main() {
    // Fold all four quadrants' offsets from the center into one
    // positive-positive quadrant. Clamped to [0,1]: an off-center fold can
    // otherwise push the sample outside texture bounds (same guard the
    // finishing pass's Chromatic Aberration already uses for its offset).
    vec2 folded = clamp(quadMirrorCenter + abs(vUv - quadMirrorCenter), 0.0, 1.0);
    gl_FragColor = texture2D(tSource, folded);
  }
`;

export function createQuadMirrorStage(): PostProcessStage {
  const material = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      tSource: { value: null },
      quadMirrorCenter: { value: new THREE.Vector2(0.5, 0.5) },
    },
    depthWrite: false,
    transparent: false,
    blending: THREE.NoBlending,
    depthTest: false,
  });

  return {
    id: 'mirror',
    material,
    isActive(effects: EffectsConfig): boolean {
      return effects.quadMirrorEnabled || false;
    },
    syncUniforms(effects: EffectsConfig): void {
      material.uniforms.quadMirrorCenter.value.set(
        effects.quadMirrorCenterX ?? 0.5,
        effects.quadMirrorCenterY ?? 0.5
      );
    },
  };
}
