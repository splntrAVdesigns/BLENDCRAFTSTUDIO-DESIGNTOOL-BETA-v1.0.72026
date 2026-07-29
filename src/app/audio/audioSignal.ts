/**
 * audio/audioSignal.ts — Stage 3.0.3
 *
 * Turns raw band energy into signals that actually drive motion.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * Measured from a real session: the LOW meter sat at 86 for the whole track,
 * MID around 45–58, HIGH 4–57. With `Low → Scale @ 0.6` that resolves to
 *
 *     scaleMul = 1 + 0.35 × 0.86 × 0.6 = 1.18
 *
 * — a CONSTANT 18% zoom. A ±10-point wobble in the band moves it between 1.16
 * and 1.20: about 4%, which is below the threshold at which anyone reads it as
 * motion. The eye normalises a constant offset within a second or two and sees
 * "slightly bigger", never "pulsing".
 *
 * That single fact explained every complaint at once — motion, intensity, hue
 * and scale all received a near-constant offset where oscillation was expected.
 *
 * The problem is not the amount, and turning it up doesn't fix it: raising the
 * amount raises the plateau too. Music sustains energy, so ABSOLUTE LEVEL is
 * mostly DC. What reactive visuals map is the TRANSIENT — the departure from
 * the running average.
 *
 * Three stages, applied per band:
 *
 *   1. NORMALIZE — rolling min/max window, so 0.75…0.95 becomes a full 0→1
 *      swing instead of a 0.86 plateau. Quiet passages stay expressive, loud
 *      ones stop pinning.
 *   2. TRANSIENT — rectified difference between a fast and a slow envelope,
 *      self-scaled by its own rolling peak. Near zero at rest, spikes on every
 *      kick. This is what makes a visual *hit*.
 *   3. CURVE + ENVELOPE (per mapping, in audioMapping.ts) — exponential/gate
 *      response and asymmetric attack/release, which is what produces the
 *      "breathing" quality rather than a step change.
 *
 * ── ALLOCATION ───────────────────────────────────────────────────────────
 * Called once per frame. All state lives in preallocated objects mutated in
 * place; nothing here allocates after module load.
 */

/** Seconds for the rolling normalization window to forget an old extreme. */
const NORM_DECAY = 2.5;
/** Floor on the normalization span, so near-silence doesn't amplify noise. */
const MIN_SPAN = 0.04;

/** Envelope time constants for transient extraction (seconds). */
const FAST_ATTACK = 0.004;
const FAST_RELEASE = 0.070;
const SLOW_ATTACK = 0.150;
const SLOW_RELEASE = 0.400;
/** Decay for the transient's own auto-scaling peak. */
const HIT_PEAK_DECAY = 3.0;
const MIN_HIT_PEAK = 0.02;

interface BandState {
  min: number;
  max: number;
  fast: number;
  slow: number;
  hitPeak: number;
  /** Outputs, read after `updateBand`. */
  norm: number;
  hit: number;
}

function makeBand(): BandState {
  return { min: 1, max: 0, fast: 0, slow: 0, hitPeak: MIN_HIT_PEAK, norm: 0, hit: 0 };
}

export interface ConditionedSignals {
  subBassNorm: number; lowNorm: number; midNorm: number; highNorm: number; levelNorm: number;
  subBassHit: number; lowHit: number; midHit: number; highHit: number; levelHit: number;
}

const bands = {
  subBass: makeBand(),
  low: makeBand(),
  mid: makeBand(),
  high: makeBand(),
  level: makeBand(),
};

/** Single output object, mutated in place. */
const out: ConditionedSignals = {
  subBassNorm: 0, lowNorm: 0, midNorm: 0, highNorm: 0, levelNorm: 0,
  subBassHit: 0, lowHit: 0, midHit: 0, highHit: 0, levelHit: 0,
};

function follow(current: number, target: number, dt: number, tau: number): number {
  if (tau <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

function updateBand(b: BandState, raw: number, dt: number): void {
  // ── 1. Rolling min/max, each decaying back toward the current value so a
  // one-off extreme doesn't dominate the window forever.
  const decay = 1 - Math.exp(-dt / NORM_DECAY);
  if (raw < b.min) b.min = raw; else b.min += (raw - b.min) * decay;
  if (raw > b.max) b.max = raw; else b.max += (raw - b.max) * decay;

  const span = Math.max(MIN_SPAN, b.max - b.min);
  b.norm = Math.max(0, Math.min(1, (raw - b.min) / span));

  // ── 2. Transient: fast envelope pulling away from a slow one.
  b.fast = follow(b.fast, raw, dt, raw > b.fast ? FAST_ATTACK : FAST_RELEASE);
  b.slow = follow(b.slow, raw, dt, raw > b.slow ? SLOW_ATTACK : SLOW_RELEASE);

  const diff = Math.max(0, b.fast - b.slow);

  // Self-scaling: track the recent peak difference so the transient reads 0–1
  // regardless of how dynamic the material is. Without this, a compressed
  // master would produce hits so small they'd be invisible, and a sparse track
  // would clip constantly.
  const peakDecay = 1 - Math.exp(-dt / HIT_PEAK_DECAY);
  if (diff > b.hitPeak) b.hitPeak = diff;
  else b.hitPeak = Math.max(MIN_HIT_PEAK, b.hitPeak + (diff - b.hitPeak) * peakDecay);

  b.hit = Math.max(0, Math.min(1, diff / b.hitPeak));
}

/**
 * Condition one frame of band energy. `dt` is seconds since the previous call.
 * Returns the shared output object by reference — read immediately.
 */
export function conditionSignals(
  subBass: number, low: number, mid: number, high: number, level: number, dt: number,
): ConditionedSignals {
  // Clamp dt for the same reason the analyser does: a backgrounded tab can
  // hand back a multi-second gap, which would snap every envelope to target
  // and produce a jolt on return.
  const d = Math.min(0.1, Math.max(0.0001, dt));

  updateBand(bands.subBass, subBass, d);
  updateBand(bands.low, low, d);
  updateBand(bands.mid, mid, d);
  updateBand(bands.high, high, d);
  updateBand(bands.level, level, d);

  out.subBassNorm = bands.subBass.norm; out.subBassHit = bands.subBass.hit;
  out.lowNorm = bands.low.norm;         out.lowHit = bands.low.hit;
  out.midNorm = bands.mid.norm;         out.midHit = bands.mid.hit;
  out.highNorm = bands.high.norm;       out.highHit = bands.high.hit;
  out.levelNorm = bands.level.norm;     out.levelHit = bands.level.hit;
  return out;
}

/** Clear conditioning state — call when playback stops so old extremes don't
 *  carry into the next track. */
export function resetSignalConditioning(): void {
  for (const k of ['subBass', 'low', 'mid', 'high', 'level'] as const) {
    const b = bands[k];
    b.min = 1; b.max = 0; b.fast = 0; b.slow = 0;
    b.hitPeak = MIN_HIT_PEAK; b.norm = 0; b.hit = 0;
  }
  out.subBassNorm = 0; out.subBassHit = 0;
  out.lowNorm = 0; out.midNorm = 0; out.highNorm = 0; out.levelNorm = 0;
  out.lowHit = 0; out.midHit = 0; out.highHit = 0; out.levelHit = 0;
}

export function readConditionedSignals(): ConditionedSignals {
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// RESPONSE CURVES
// ─────────────────────────────────────────────────────────────────────────

export type ResponseCurve = 'linear' | 'exponential' | 'gate';

/**
 * Shape a 0–1 signal.
 *
 *  linear      — as-is.
 *  exponential — v^2.5. Squashes the noise floor and exaggerates peaks, which
 *                is what makes a hit read as a hit rather than a swell.
 *  gate        — hard on/off above threshold. The most percussive option.
 */
export function applyCurve(v: number, curve: ResponseCurve, threshold: number): number {
  switch (curve) {
    case 'exponential': return Math.pow(v, 2.5);
    case 'gate':        return v >= threshold ? 1 : 0;
    default:            return v;
  }
}
