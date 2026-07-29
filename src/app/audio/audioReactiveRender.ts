/**
 * audio/audioReactiveRender.ts — Stage 3.0.3
 *
 * The single entry point the render loop calls. Everything the audio module
 * exposes to GradientCanvas goes through here, so the canvas keeps one narrow,
 * greppable dependency on this feature.
 *
 * THREE calls per frame, in this order:
 *   1. tickAudioFrame(dt)          once — advances signal conditioning and
 *                                  every mapping's attack/release envelope
 *   2. getAudioDeltasForLayer(id)  per layer — sums what applies to that layer
 *   3. getGlobalAudioDeltas()      once — post-processing contributions
 *
 * Order matters: the envelopes must advance exactly once per frame, so step 1
 * cannot live inside the per-layer loop. Getting that wrong would make
 * smoothing speed depend on how many layers happen to be visible.
 */

import {
  tickMappings,
  tickMappingsFromBaked,
  clearDeterministicClock,
  resolveAudioDeltasForLayer,
  getGlobalAudioDeltas,
  type AudioDeltas,
} from './audioMapping';
import { beginResolve, endResolve } from './audioPerf';
import { sampleBakedEnvelope, hasBakedEnvelope } from './envelopeBaker';

export type { AudioDeltas };
export { getGlobalAudioDeltas };

/** Advance the audio signal chain one frame. `dt` in seconds. */
export function tickAudioFrame(dt: number): void {
  beginResolve();
  tickMappings(dt);
  endResolve();
}

/**
 * Per-frame audio deltas for one layer. Returned by reference — the same
 * object every call. Read it immediately; do not retain it across layers.
 */
export function getAudioDeltasForLayer(layerId: string): AudioDeltas {
  return resolveAudioDeltasForLayer(layerId);
}


/**
 * EXPORT tick — Stage 3.1. Advance the audio chain for one export frame from
 * the BAKED envelope at exact `timeSeconds`, so a rendered video reacts
 * identically every time. `dt` is the export frame delta (1/fps).
 *
 * Returns true if a baked frame drove the mappings; false if nothing is baked
 * (caller then renders a non-reactive frame). Never reads the live bus.
 */
export function tickAudioExportFrame(timeSeconds: number, dt: number): boolean {
  if (!hasBakedEnvelope()) { clearDeterministicClock(); return false; }
  const frame = sampleBakedEnvelope(timeSeconds);
  if (!frame) { clearDeterministicClock(); return false; }
  tickMappingsFromBaked(frame, dt, timeSeconds);
  return true;
}
