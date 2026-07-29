/**
 * audio/audioBus.ts — Stage 3.0.0
 *
 * ★ THE INTEGRATION SEAM ★
 *
 * A single mutable object that carries every audio-derived signal from the
 * analysis loop to whatever consumes it. This is the ONLY thing the render
 * loop will ever read from this module.
 *
 * WHY A MUTABLE REF AND NOT REACT STATE
 * ─────────────────────────────────────────────────────────────────────────
 * Band energies change every frame. Routing that through React state would
 * either throttle reactivity to React's render cadence, or — if forced
 * synchronous — trigger a re-render storm at 60fps. Neither is acceptable on
 * a path that sits next to a WebGL draw call.
 *
 * This codebase already proved the alternative works: `needsRenderRef`,
 * `cachedVisibleLayersRef`, and the media manager's frame gating are all
 * plain refs read directly by the RAF loop. The audio bus is the same
 * discipline applied to a new signal.
 *
 * HARD RULES — these are what keep it cheap:
 *   1. ZERO allocation per frame. The snapshot object is created once at
 *      module load and mutated in place, forever. No spreads, no new objects,
 *      no array literals in the update path.
 *   2. Readers never mutate. `readAudioBus()` hands back the live object by
 *      reference precisely BECAUSE copying it would allocate. Treat it as
 *      read-only; TypeScript enforces this via the Readonly return type.
 *   3. No subscriptions here. React components that want to show meters use
 *      `audioUIState.ts` (3.0.1+), which polls this on a
 *      throttled cadence. The bus itself has no notion of listeners — adding
 *      them would put callback dispatch back on the hot path.
 */

import type { AudioEngineStatus } from './types';

export interface AudioBusSnapshot {
  /** True when analysis is actively running and values are live. */
  active: boolean;
  status: AudioEngineStatus;

  // ── Smoothed band envelopes, 0–1. This is what consumers should use. ──
  subBass: number;  // 20–60 Hz — 808s, sub-rumble, kick fundamental
  low: number;
  mid: number;
  high: number;

  // ── Raw per-frame band energies, 0–1, unsmoothed. Diagnostics + tuning. ──
  subBassRaw: number;
  lowRaw: number;
  midRaw: number;
  highRaw: number;

  /** Overall loudness this frame, 0–1 (mean of the full spectrum). */
  level: number;
  /** Highest single-bin value this frame, 0–1. Useful for transient detection. */
  peak: number;

  // ── Reserved for later stages. Declared now so the shape never changes
  //    under consumers, but written by nothing yet in 3.0.0. ──
  /** 0→1 within the current beat. Populated in 3.0.3. */
  beatPhase: number;
  /** Detected/tapped tempo, 0 = unknown. Populated in 3.0.3. */
  bpm: number;
  /** 0→1 within the LFO's current cycle. Populated in 3.0.3. */
  lfoPhase: number;
  /** LFO output after shaping, 0–1. Populated in 3.0.3. */
  lfoValue: number;

  // ── Diagnostics ──
  /** performance.now() of the last update. */
  updatedAt: number;
  /** Total analysis frames since the engine started. */
  frameCount: number;
}

/**
 * The one instance. Module-scoped singleton, mutated in place.
 * Not exported directly — access is via read/write helpers so the mutation
 * points stay greppable.
 */
const bus: AudioBusSnapshot = {
  active: false,
  status: 'idle',
  subBass: 0, subBassRaw: 0,
  low: 0, mid: 0, high: 0,
  lowRaw: 0, midRaw: 0, highRaw: 0,
  level: 0,
  peak: 0,
  beatPhase: 0,
  bpm: 0,
  lfoPhase: 0,
  lfoValue: 0,
  updatedAt: 0,
  frameCount: 0,
};

/**
 * Read the live bus. Returns the SAME object every call, by reference —
 * copying would allocate on the hot path, which is the one thing this module
 * must never do. Readonly at the type level to make that contract explicit.
 */
export function readAudioBus(): Readonly<AudioBusSnapshot> {
  return bus;
}

/**
 * Write band results. Called once per analysis frame by audioEngine.
 * Every field is assigned — no object spread, no allocation.
 */
export function writeAudioBands(
  subBass: number, subBassRaw: number,
  low: number, mid: number, high: number,
  lowRaw: number, midRaw: number, highRaw: number,
  level: number, peak: number,
): void {
  bus.subBass = subBass;
  bus.subBassRaw = subBassRaw;
  bus.low = low;
  bus.mid = mid;
  bus.high = high;
  bus.lowRaw = lowRaw;
  bus.midRaw = midRaw;
  bus.highRaw = highRaw;
  bus.level = level;
  bus.peak = peak;
  bus.updatedAt = performance.now();
  bus.frameCount++;
}

/** Lifecycle updates from the engine. */
export function writeAudioStatus(status: AudioEngineStatus, active: boolean): void {
  bus.status = status;
  bus.active = active;
}

/**
 * Zero every signal without discarding the object.
 *
 * Called when audio stops. Consumers must see 0, not the last value frozen
 * forever — a paused track that leaves `low` pinned at 0.8 would hold whatever
 * it drives at full deflection indefinitely, which reads as a stuck effect
 * rather than a stopped one.
 */
export function resetAudioSignals(): void {
  bus.subBass = 0; bus.subBassRaw = 0;
  bus.low = 0; bus.mid = 0; bus.high = 0;
  bus.lowRaw = 0; bus.midRaw = 0; bus.highRaw = 0;
  bus.level = 0;
  bus.peak = 0;
  bus.beatPhase = 0;
  bus.lfoPhase = 0;
  bus.lfoValue = 0;
}

/**
 * Diagnostic mirror at `window.__audioBus`, matching the convention already
 * used by `__mediaDebug`, `__blobLog` and `__memory`.
 *
 * Deliberately a GETTER-backed snapshot rather than the live object: reading
 * `window.__audioBus` in DevTools should show values at the moment you read
 * it, not a reference that mutates while you're expanding it in the console.
 * This is the only place a copy is acceptable, because it runs on demand from
 * a human typing, never per frame.
 */
export function installAudioBusDiagnostic(): void {
  try {
    Object.defineProperty(window, '__audioBus', {
      configurable: true,
      get() {
        return {
          ...bus,
          // Rounded mirrors — the raw floats are noisy to read at a glance.
          _readable: {
            low: bus.low.toFixed(3),
            mid: bus.mid.toFixed(3),
            high: bus.high.toFixed(3),
            level: bus.level.toFixed(3),
            fps: bus.frameCount > 0 && bus.updatedAt > 0
              ? 'see frameCount delta over time'
              : 'not running',
          },
        };
      },
    });
  } catch {
    /* diagnostics must never break the app */
  }
}
