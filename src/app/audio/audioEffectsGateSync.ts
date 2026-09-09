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
 * ── ENABLE-ONLY, ON PURPOSE ───────────────────────────────────────────────
 * Selecting a gated target (or re-enabling a mapping that already targets
 * one) turns the effect's toggle on. Removing/disabling the route never
 * turns it back off — the user's slider values might still be meaningful
 * on their own, so silently switching the effect off would be a more
 * surprising failure mode than leaving a now-unrouted toggle on. Turning
 * it off, if wanted, is one manual click either way.
 */

// Which EffectsConfig toggle each gated AudioTargetId needs turned on.
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

type EnableGatedEffectHandler = (field: GatedToggleField) => void;

let handler: EnableGatedEffectHandler | null = null;

/** Registered by AudioReactiveMount from AppHeader's effects props. */
export function setGatedEffectEnableHandler(h: EnableGatedEffectHandler | null): void {
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
  if (field) handler?.(field);
}
