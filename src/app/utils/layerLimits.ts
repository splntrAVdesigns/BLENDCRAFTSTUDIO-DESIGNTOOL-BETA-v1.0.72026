/**
 * layerLimits.ts — Stage 2.7.4
 *
 * Single source of truth for the per-session layer cap.
 *
 * WHY A CAP: every active layer is a full WebGL mesh + ShaderMaterial that the
 * per-frame uniform sweep, up to three animation systems, and the texture
 * pipeline all touch every tick. With media layers (large GPU textures) stacked
 * alongside animated gradients and live textures, the simultaneous work can
 * overrun the WebGL context — especially inside the Figma Make iframe — which is
 * what produced the "app crashed while changing textures with animations
 * playing" reports. Bounding the layer count bounds worst-case GPU load
 * deterministically.
 *
 * The chosen limit (3) still allows the meaningful composition combinations:
 *   • 3 gradient layers, or
 *   • media + gradient + mask, or
 *   • media + 2 gradients
 * i.e. enough for real blending/experimentation without unbounded load.
 */

export const MAX_LAYERS = 3;

/** True when another layer may be created. */
export function canAddLayer(currentCount: number): boolean {
  return currentCount < MAX_LAYERS;
}

/** User-facing message when the cap is reached. Kept in one place for consistency. */
export const LAYER_LIMIT_MESSAGE =
  `Layer limit reached (${MAX_LAYERS} max). Delete a layer to add another — ` +
  `this keeps rendering smooth when stacking media, gradients, and effects.`;
