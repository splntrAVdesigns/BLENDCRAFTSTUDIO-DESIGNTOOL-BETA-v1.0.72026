import * as THREE from '../lib/three';
import { EffectsConfig, SpatialStageId } from '../components/controls/EffectsControls';

// Shared full-screen-quad vertex shader — identical to every pass in this
// pipeline (and to the existing finishing-pass shader in effectsRenderer.ts).
// Defined once here so every stage module imports the same string instead
// of re-declaring it.
export const FULLSCREEN_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// One compiled full-screen pass. Each stage module (stages/*.ts) builds one
// of these. The compositor (pingPongCompositor.ts) owns sequencing —
// individual stage modules only know their own math, never the chain order
// or which other stages exist, mirroring the self-contained-effect-file
// convention documented in VFX_RACK_ARCHITECTURE.md §8.5.
export interface PostProcessStage {
  id: SpatialStageId;
  material: THREE.ShaderMaterial;

  // Whether this stage should run at all this frame. `liveOverride`, when
  // provided, is the final post-audio-delta numeric value to test instead
  // of the raw EffectsConfig field — only Chromatic Aberration and Blur are
  // audio-modulatable today, so only their stage modules read it.
  isActive(effects: EffectsConfig, liveOverride?: number): boolean;

  // Push this frame's uniform values into `material`. Every stage receives
  // `time` and `resolution` even if it doesn't use them, for a uniform
  // call signature across all seven stage modules.
  syncUniforms(
    effects: EffectsConfig,
    time: number,
    resolution: THREE.Vector2,
    liveOverride?: number
  ): void;
}
