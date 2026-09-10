import type { AnimationType } from '../types/gradient';

/**
 * SPRINT 3.1.0 — CONSOLIDATED SOURCE OF TRUTH.
 *
 * Maps an animation type to the uAnimType value that selects its shader-field
 * distortion in applySharedAnimationField() (see animationHelpers.ts). Pure-
 * transform types (rotation, pulse, scale, drift, etc.) are absent and
 * default to 0.0 — JS handles them fully via uRotation/uScale/center/etc,
 * and shader distortion would double the effect.
 *
 * Previously this table existed as two hand-written copies: a module-scope
 * constant in GradientCanvas.tsx's live preview loop, and an inline literal
 * rebuilt every frame inside the export render loop. They had already begun
 * to matter for correctness (kaleidoscope needed adding to both) and the
 * export copy reintroduced a per-frame allocation the preview copy had
 * already been hoisted to avoid. Both call sites now import this one table.
 *
 * 'kaleidoscope' is newly added here — its shader field (applyKaleidoField)
 * was fully implemented but unreachable because nothing ever set uAnimType
 * to 4.0. See animationHelpers.ts for the harmonic retune that went with
 * activating it.
 */
export const SHADER_ANIM_TYPE_MAP: Readonly<Record<string, number>> = Object.freeze({
  wave:         1.0, // applyWaveField — travelling wave sheet
  morph:        2.0, // applyMorphField — organic UV morphing
  liquid:       2.0, // applyMorphField — liquid uses morph UV field
  vortex:       3.0, // applyVortexField — spiral whirlpool swirl
  kaleidoscope: 4.0, // applyKaleidoField — crystalline facet distortion
  fractalZoom:  5.0, // applyFractalZoomField — recursive zoom texture
  turbulence:   6.0, // applyTurbulenceField — multi-freq liquid chaos
  ripple:       7.0, // applyRippleField — expanding point-source rings
  glitch:       8.0, // applyGlitchField — digital datamosh block-tearing (SPRINT 3.1.1)
});

export function getShaderAnimType(animationType: AnimationType | string): number {
  return SHADER_ANIM_TYPE_MAP[animationType] ?? 0.0;
}
