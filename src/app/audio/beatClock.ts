/**
 * audio/beatClock.ts — Stage 3.0.6
 *
 * "Beat-as-clock": lets the detected beat drive the animation clock, so tempo
 * directs the motion instead of a manually-set Speed slider fighting it.
 *
 * ── THE PROBLEM THIS SOLVES ──────────────────────────────────────────────
 * The animation clock advances by wall-clock time, and each layer multiplies it
 * by its own `speed`. Audio reactivity then modulates targets on top of that
 * free-running clock. Two independent motions at unrelated rates read as
 * competing — which is the "it feels like it's fighting the audio" report.
 *
 * ── THE MODEL ────────────────────────────────────────────────────────────
 * When enabled AND the beat is trustworthy (confident detection or tap tempo),
 * the per-frame clock delta handed to the animation accumulator is derived from
 * the beat period rather than raw wall time. One beat advances the clock by a
 * fixed reference amount, so the animation's cycle lands on the tempo grid.
 *
 * The Speed slider is NOT thrown away — it keeps its meaning as a multiplier,
 * which under this clock reads as a musical ratio (0.5× = half-time, 2× =
 * double-time). That's more expressive than disabling it, and it means the
 * change is fully reversible: turn the mode off, or let confidence drop, and
 * the clock returns to wall-time behaviour with the slider back to its original
 * meaning.
 *
 * ── WHY THIS DOESN'T TOUCH useLayerAnimations.ts ─────────────────────────
 * This ONLY changes the delta fed into the existing accumulator in the render
 * loop. The animation hooks still receive a monotonic, ever-increasing time and
 * apply `speed` exactly as before — they cannot tell whether the time came from
 * a wall clock or a beat clock. The do-not-modify invariant is preserved: the
 * seam is a single delta substitution at the accumulator, nothing downstream.
 *
 * ── GRACEFUL DEGRADATION ─────────────────────────────────────────────────
 * If the beat isn't trustworthy, `beatClockDelta` returns null and the caller
 * falls back to wall-clock delta. So ambient/rubato material — where tempo
 * locking would stutter — simply behaves as it does today. The UI reflects
 * which mode is live, so it's never a mystery.
 */

import { useSyncExternalStore } from 'react';
import { getBeatInfo } from './beatDetection';

const STORAGE_KEY = 'blendcraft-beatclock-v1';

/** Reference seconds of clock advance per beat. Chosen so that at Speed 1.0 and
 *  a 4-beat cycle, one bar maps to a natural-feeling amount of animation phase.
 *  This is the constant that ties "one beat" to "this much animation time". */
const SECONDS_PER_BEAT_REFERENCE = 0.5;

/** Minimum detection confidence before the beat clock takes over. Below this we
 *  fall back to wall time rather than lock to a tempo we don't trust. */
const CONFIDENCE_GATE = 0.5;

interface BeatClockState {
  enabled: boolean;
}

function load(): BeatClockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: false };
    const p = JSON.parse(raw);
    return { enabled: typeof p.enabled === 'boolean' ? p.enabled : false };
  } catch {
    return { enabled: false };
  }
}

let state: BeatClockState = load();
const listeners = new Set<() => void>();

function publish(next: BeatClockState): void {
  state = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  listeners.forEach((l) => { try { l(); } catch { /* isolate */ } });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const getSnapshot = () => state;

export function useBeatClock(): BeatClockState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setBeatClockEnabled(on: boolean): void {
  publish({ enabled: on });
}

/**
 * Is the beat clock actually conducting right now? True only when enabled AND
 * the beat is trustworthy. Drives the UI's "beat is driving Speed" state.
 */
export function isBeatClockActive(): boolean {
  if (!state.enabled) return false;
  const info = getBeatInfo();
  return info.usingTap || info.confidence >= CONFIDENCE_GATE;
}

/**
 * The clock delta to advance the animation accumulator by this frame, or null
 * to fall back to wall-clock time.
 *
 *  wallDelta — the real per-frame delta (seconds), used both as the fallback
 *              and to keep beat-clock advance proportional to real elapsed time
 *              (so a frame drop doesn't desync the grid).
 *
 * The returned delta already folds in the reference mapping; the per-layer
 * `speed` multiplier is applied downstream exactly as before, which is what
 * turns Speed into the half/double-time ratio under this clock.
 */
export function beatClockDelta(wallDelta: number): number | null {
  if (!isBeatClockActive()) return null;
  const info = getBeatInfo();
  if (info.bpm <= 0) return null;

  // Beats elapsed this frame = wall seconds × (beats per second).
  const beatsPerSecond = info.bpm / 60;
  const beatsThisFrame = wallDelta * beatsPerSecond;

  // Convert beats → reference animation-seconds. At Speed 1 downstream, this is
  // the clock rate; the layer's speed then scales it into a musical ratio.
  return beatsThisFrame * SECONDS_PER_BEAT_REFERENCE;
}
