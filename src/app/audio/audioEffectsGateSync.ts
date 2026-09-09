/**
 * audio/audioEffectsGateSync.ts
 *
 * Option A (routing-driven toggle sync): when a user routes audio to a
 * gated effect (Displace/Slice/Pixelate/Flash), the effect's own enable
 * toggle switches on automatically — no second manual step in the Effects
 * tab required.
 *
 * ── WHY A BRIDGE RATHER THAN PROPS THROUGH APP ───────────────────────────
 * Same reasoning as audioTransport.ts: EffectsConfig lives in App state,
 * and the audio module deliberately holds no App.tsx code (see
 * AudioReactiveMount). AppHeader already receives enough to reach
 * EffectsConfig one level down — the handler is handed down from there
 * rather than threaded through the whole app.
 *
 * ── SPRINT 2.7: NOW BIDIRECTIONAL ─────────────────────────────────────────
 * Originally enable-only. Blang's call after using it: switching a route
 * away from a gated target should turn the toggle back off too, same as
 * selecting it turns the toggle on — "if a user is switching to another
 * option that means they don't currently want [it]". The one-directional
 * version is gone; setGatedEffectHandler now takes an explicit on/off,
 * and syncGatedEffectAfterRouteChange checks whether ANY other enabled
 * mapping still covers the field before turning it off, so two routes
 * both targeting the same gated effect don't fight each other.
 */

// Which EffectsConfig toggle each gated AudioTargetId needs turned on/off.
// Kept here rather than in audioMapping.ts since this is about the
// EffectsConfig side of the bridge, not the routing data model itself.
export type GatedToggleField =
  | 'noiseDisplaceEnabled'
  | 'graphicSliceEnabled'
  | 'pixelateEnabled'
  | 'flashEnabled';

export const GATED_TARGET_TOGGLES: Partial<Record<string, GatedToggleField>> = {
  displaceAmount: 'noiseDisplaceEnabled',
  sliceAmount: 'graphicSliceEnabled',
  sliceRate: 'graphicSliceEnabled',
  pixelateAmount: 'pixelateEnabled',
  flashDark: 'flashEnabled',
  flashLight: 'flashEnabled',
  flashColorCycle: 'flashEnabled',
};

// Sprint 2.7: which EffectsConfig field(s) each global AudioTargetId
// actually drives the *value* of — used by EffectsControls.tsx to protect
// live-routed fields when a preset is applied, rather than the preset's
// full-replace silently overwriting whatever audio is currently doing.
// Per-layer targets (gradientScale/layerPunch/hue/intensity/speed/glitch)
// aren't here — presets don't touch per-layer state at all, so there's
// nothing for them to protect. `shake` isn't here either — it has no
// stored base value of its own to protect (audio-only, no manual slider).
export const TARGET_TO_PROTECTED_FIELDS: Partial<Record<string, string[]>> = {
  chroma: ['chromaticAberration'],
  brightness: ['brightness'],
  blur: ['blur'],
  saturation: ['saturation'],
  vignette: ['vignette'],
  strobe: ['brightness'], // strobe's delta lands on the same brightness uniform
  displaceAmount: ['noiseDisplaceEnabled', 'noiseDisplaceAmount'],
  sliceAmount: ['graphicSliceEnabled', 'graphicSliceAmount'],
  sliceRate: ['graphicSliceEnabled', 'graphicSliceRate'],
  pixelateAmount: ['pixelateEnabled', 'pixelate'],
  filmGrainAmount: ['filmGrain'],
  flashDark: ['flashEnabled'],
  flashLight: ['flashEnabled'],
  flashColorCycle: ['flashEnabled'],
};

type SetGatedEffectHandler = (field: GatedToggleField, enabled: boolean) => void;

let handler: SetGatedEffectHandler | null = null;

/** Registered by AudioReactiveMount from AppHeader's effects props. */
export function setGatedEffectHandler(h: SetGatedEffectHandler | null): void {
  handler = h;
}

/**
 * Called whenever a mapping's target becomes (or is re-enabled while
 * already set to) a gated target. No-ops for every non-gated target —
 * Chroma/Blur/Vignette/Film Grain/the six per-layer targets never had
 * this problem in the first place, since they don't have a separate
 * enable toggle to begin with.
 */
export function syncGatedEffectForTarget(targetId: string): void {
  const field = GATED_TARGET_TOGGLES[targetId];
  if (field) handler?.(field, true);
}

/**
 * Called after a mapping's target changes away from `previousTargetId`, or
 * after a mapping targeting it gets disabled. Turns the corresponding
 * toggle back off, but only if NO other currently-enabled mapping still
 * targets the same gated field — so routing two different sources at the
 * same gated effect (e.g. both Slice Amount and Slice Rate) doesn't have
 * the second one's removal turn off an effect the first one still needs.
 */
export function syncGatedEffectAfterRouteChange(
  previousTargetId: string | undefined,
  allMappingsAfterChange: Array<{ target: string; enabled: boolean }>,
): void {
  if (!previousTargetId) return;
  const field = GATED_TARGET_TOGGLES[previousTargetId];
  if (!field) return;
  const stillRouted = allMappingsAfterChange.some(
    (m) => m.enabled && GATED_TARGET_TOGGLES[m.target] === field
  );
  if (!stillRouted) handler?.(field, false);
}
