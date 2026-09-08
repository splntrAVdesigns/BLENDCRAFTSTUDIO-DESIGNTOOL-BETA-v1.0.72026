import * as THREE from '../lib/three';
import { EffectsConfig, SpatialStageId, DEFAULT_SPATIAL_CHAIN_ORDER } from '../components/controls/EffectsControls';
import { PostProcessStage } from './types';
import { createQuadMirrorStage } from './stages/quadMirrorStage';
import { createNoiseDisplaceStage } from './stages/noiseDisplaceStage';
import { createGraphicSliceStage } from './stages/graphicSliceStage';
import { createChromaticAberrationStage } from './stages/chromaticAberrationStage';
import { createBlurStage } from './stages/blurStage';
import { createPixelateStage } from './stages/pixelateStage';
import { createShapeOverlayStage } from './stages/shapeOverlayStage';
import { createVignetteStage } from './stages/vignetteStage';
import { createFilmGrainStage } from './stages/filmGrainStage';
import { createPosterizeStage } from './stages/posterizeStage';
import { createHalftoneStage } from './stages/halftoneStage';
import { createFresnelStage } from './stages/fresnelStage';

// The multi-pass replacement for Sprint 1.1's single-pass spatial-chain
// loop. Root cause of why that loop didn't actually deliver composability:
// Blur/Pixelate/Chroma/Shape Overlay each independently re-sampled the
// ORIGINAL source texture rather than the previous stage's output — a
// single fragment-shader invocation has no way to read a neighboring
// pixel's post-effect value unless that value exists as a real texture
// from an earlier render pass. This module is that earlier render pass,
// generalized to as many passes as there are active stages.
//
// Design (mirrors Visual Mood Lab's actual compositor, adapted to
// BlendCraft's existing render-target lifecycle conventions):
//   - Two ping-pong THREE.WebGLRenderTargets, reused every frame — created
//     once, resized alongside every other render target in this app
//     (resizeRenderTargets already accepts arbitrary targets).
//   - One compiled ShaderMaterial per stage type (7 total), created once.
//     Each pass just swaps which material the shared full-screen quad uses.
//   - Zero active stages -> zero extra passes: runSpatialChain returns the
//     input texture unchanged. This preserves the existing "no effects on"
//     fast path exactly — the common case during animation preview stays
//     exactly as cheap as it was before this module existed.

export interface SpatialChainCompositor {
  targetA: THREE.WebGLRenderTarget;
  targetB: THREE.WebGLRenderTarget;
  stages: Record<SpatialStageId, PostProcessStage>;
}

function createTarget(width: number, height: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.SRGBColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

export function createSpatialChainCompositor(width: number, height: number): SpatialChainCompositor {
  return {
    targetA: createTarget(width, height),
    targetB: createTarget(width, height),
    stages: {
      mirror: createQuadMirrorStage(),
      displace: createNoiseDisplaceStage(),
      slice: createGraphicSliceStage(),
      chroma: createChromaticAberrationStage(),
      blur: createBlurStage(),
      pixelate: createPixelateStage(),
      shapeOverlay: createShapeOverlayStage(),
      vignette: createVignetteStage(),
      filmGrain: createFilmGrainStage(),
      posterize: createPosterizeStage(),
      halftone: createHalftoneStage(),
      fresnel: createFresnelStage(),
    },
  };
}

export function resizeSpatialChainCompositor(
  compositor: SpatialChainCompositor | null,
  width: number,
  height: number
): void {
  if (!compositor) return;
  compositor.targetA.setSize(width, height);
  compositor.targetB.setSize(width, height);
}

export function disposeSpatialChainCompositor(compositor: SpatialChainCompositor | null): void {
  if (!compositor) return;
  compositor.targetA.dispose();
  compositor.targetB.dispose();
  Object.values(compositor.stages).forEach((stage) => stage.material.dispose());
}

// Resolves the user's configured chain order (falling back to default if
// missing/malformed, e.g. an older saved project) down to just the stages
// that are actually active this frame, in order. This list IS the pass
// count for this frame — an empty list means zero extra render passes.
export function getActiveSpatialStages(
  compositor: SpatialChainCompositor,
  effects: EffectsConfig,
  overrides?: Partial<Record<SpatialStageId, number>>
): SpatialStageId[] {
  const order = Array.isArray(effects.spatialChainOrder) && effects.spatialChainOrder.length === 12
    ? effects.spatialChainOrder
    : DEFAULT_SPATIAL_CHAIN_ORDER;

  return order.filter((id) => {
    const stage = compositor.stages[id];
    if (!stage) return false;
    return stage.isActive(effects, overrides?.[id]);
  });
}

// Runs every active stage in order, ping-ponging between the two render
// targets, and leaves `quad.material` set to `finishingMaterial` before
// returning so the caller's immediately-following finishing pass (color
// grading, grain, vignette, fresnel, flash — everything downstream of the
// spatial chain) renders with the right shader without having to remember
// to reset it itself.
//
// `overrides` carries this frame's final (base + audio delta) value for
// any stage that's audio-modulatable — currently chroma/blur/vignette.
// A single map rather than one positional param per stage: adding the
// next audio-reactive stage later is a new map key, not a new parameter
// threaded through every call site.
export function runSpatialChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  quad: THREE.Mesh,
  compositor: SpatialChainCompositor,
  finishingMaterial: THREE.Material,
  sourceTexture: THREE.Texture,
  effects: EffectsConfig,
  time: number,
  resolution: THREE.Vector2,
  overrides?: Partial<Record<SpatialStageId, number>>
): THREE.Texture {
  const activeIds = getActiveSpatialStages(compositor, effects, overrides);

  if (activeIds.length === 0) {
    return sourceTexture;
  }

  let currentSource = sourceTexture;
  const targets = [compositor.targetA, compositor.targetB];

  activeIds.forEach((id, i) => {
    const stage = compositor.stages[id];
    stage.syncUniforms(effects, time, resolution, overrides?.[id]);
    (stage.material.uniforms.tSource as { value: THREE.Texture }).value = currentSource;

    const target = targets[i % 2];
    quad.material = stage.material;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    currentSource = target.texture;
  });

  quad.material = finishingMaterial;
  return currentSource;
}
