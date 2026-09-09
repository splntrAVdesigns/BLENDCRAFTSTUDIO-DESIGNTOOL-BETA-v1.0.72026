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

// Audio-delta overrides for one stage this frame. Most stages have exactly
// one audio-modulatable parameter and use the `amount` key; Graphic Slice
// is the first stage with two independent ones (amount AND rate), which is
// why this is a small bag rather than a single number — a single number
// covered every case through Sprint 1.4, but stopped being enough here.
export interface StageOverrides {
  amount?: number;
  rate?: number;
}

// One compiled full-screen pass. Each stage module (stages/*.ts) builds one
// of these. The compositor (pingPongCompositor.ts) owns sequencing —
// individual stage modules only know their own math, never the chain order
// or which other stages exist, mirroring the self-contained-effect-file
// convention documented in VFX_RACK_ARCHITECTURE.md §8.5.
export interface PostProcessStage {
  id: SpatialStageId;
  material: THREE.ShaderMaterial;

  // Whether this stage should run at all this frame. `overrides`, when
  // provided, carries the final post-audio-delta value(s) to test instead
  // of the raw EffectsConfig field(s) — only audio-modulatable stages read
  // it; stages with no audio routing ignore it entirely.
  isActive(effects: EffectsConfig, overrides?: StageOverrides): boolean;

  // Push this frame's uniform values into `material`. Every stage receives
  // `time` and `resolution` even if it doesn't use them, for a uniform
  // call signature shared across every stage module.
  syncUniforms(
    effects: EffectsConfig,
    time: number,
    resolution: THREE.Vector2,
    overrides?: StageOverrides
  ): void;
}
