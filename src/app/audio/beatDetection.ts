/**
 * audio/beatDetection.ts — Stage 3.0.4
 *
 * Onset/beat detection with a tap-tempo fallback, plus a continuous beat-phase
 * clock and per-beat "pulse" envelopes at musical subdivisions.
 *
 * ── WHY THIS MATTERS FOR THE "NOT WORKING" TARGETS ───────────────────────
 * Layer Punch driven by a raw transient produced a ~40ms spike every kick —
 * technically correct, but 2–3 frames wide, so it read as a flicker rather
 * than a punch. Driving it from a BEAT is different in kind: the detector
 * fires a clean onset, and this module turns that into a held, shaped envelope
 * on the musical grid (every beat / the 1 & 3 / the 2 & 4 / every bar). That's
 * what makes the movement feel deliberately in time rather than twitchy.
 *
 * ── APPROACH ─────────────────────────────────────────────────────────────
 * Spectral-flux onset detection on the low+low-mid bands (kick/snare energy),
 * with an adaptive threshold. Detected inter-onset intervals feed a tempo
 * estimate; tap-tempo overrides it when the user knows better than the
 * detector (ambient/organic material defeats onset detection, and a manual
 * tap is the honest answer rather than a confident wrong guess).
 *
 * A free-running phase clock advances at the estimated BPM and is gently
 * nudged toward detected onsets, so the grid stays locked even through a
 * missed or spurious hit.
 *
 * ── ALLOCATION ───────────────────────────────────────────────────────────
 * One update per frame, all state preallocated. The IOI history is a fixed
 * ring buffer. Nothing here grows.
 */

import { sampleWaveform } from './waveformShapes';

/** Musical subdivision a pulse source fires on. */
export type BeatSubdivision = 'every' | 'downbeat' | 'offbeat' | 'bar' | 'beat8' | 'beat16';

export const BEAT_SUBDIVISIONS: Array<{ id: BeatSubdivision; label: string; hint: string }> = [
  { id: 'every',    label: 'Every beat', hint: '1 2 3 4' },
  { id: 'downbeat', label: '1 & 3',      hint: 'Downbeats' },
  { id: 'offbeat',  label: '2 & 4',      hint: 'Backbeat' },
  { id: 'bar',      label: 'Every bar',  hint: 'Once per 4 beats' },
  { id: 'beat8',    label: '8th note',   hint: 'Twice per beat — hi-hat feel' },
  { id: 'beat16',   label: '16th note',  hint: 'Four times per beat — rapid stutter' },
];

// Sprint 2.8: widened from 70–180. That range clipped slower material
// (ballads/ambient sit around 60–80) and pushed against the ceiling for
// faster genres (drum & bass/hardcore run 170–200+). 60–200 covers the
// large majority of real-world tempos while still being tight enough to
// resist half/double-tempo octave errors, which get more likely the wider
// this range gets — this is the practical ceiling before that tradeoff
// starts to bite.
const MIN_BPM = 60;
const MAX_BPM = 200;
const IOI_HISTORY = 8;

interface BeatState {
  // Onset detection
  prevFlux: number;
  fluxAvg: number;        // adaptive threshold baseline
  lastOnsetAt: number;    // ms
  // Tempo
  iois: Float32Array;     // recent inter-onset intervals (ms)
  ioiIndex: number;
  ioiCount: number;
  bpm: number;
  confidence: number;     // 0–1
  // Phase clock
  beatPhase: number;      // 0–1 within the current beat
  beatCounter: number;    // which beat in the bar (0–3)
  tapTimes: number[];     // ms of recent taps
  usingTap: boolean;
  /** User-supplied timing trim, ±50ms. Shifts when the pulse fires without
   *  changing detected BPM. Survives track changes. */
  beatOffsetMs: number;
}

const s: BeatState = {
  prevFlux: 0,
  fluxAvg: 0,
  lastOnsetAt: 0,
  iois: new Float32Array(IOI_HISTORY),
  ioiIndex: 0,
  ioiCount: 0,
  bpm: 120,
  confidence: 0,
  beatPhase: 0,
  beatCounter: 0,
  tapTimes: [],
  usingTap: false,
  beatOffsetMs: 0,
};

/** Pulse envelope outputs at each subdivision, 0–1. Read after update(). */
const pulses = {
  every: 0,
  downbeat: 0,
  offbeat: 0,
  bar: 0,
  beat8: 0,   // fires twice per beat (8th-note grid)
  beat16: 0,  // fires four times per beat (16th-note grid)
};

function beatPeriodMs(): number {
  return 60000 / s.bpm;
}

function registerOnset(nowMs: number): void {
  if (s.lastOnsetAt > 0) {
    const ioi = nowMs - s.lastOnsetAt;
    // Only accept intervals in a plausible beat range — this rejects double
    // hits (hi-hats) and long gaps without polluting the tempo estimate.
    if (ioi > 60000 / MAX_BPM && ioi < 60000 / MIN_BPM) {
      s.iois[s.ioiIndex] = ioi;
      s.ioiIndex = (s.ioiIndex + 1) % IOI_HISTORY;
      if (s.ioiCount < IOI_HISTORY) s.ioiCount++;
      recomputeTempo();
    }
    // Nudge the phase clock so beat 0 aligns with strong onsets — keeps the
    // grid locked without hard-resetting on every hit (which would jitter).
    // Sprint 2.8: was a 50% pull (`*= 0.5`) — correct in direction but heavy
    // in practice: a strong onset arriving late in the beat (phase near 1)
    // yanked the clock back by nearly half a beat's worth of visual motion
    // in one frame, which reads as a jump rather than a lock. Retaining 85%
    // of the existing phase (a 15% pull toward the boundary) is a standard,
    // gentler correction strength for this kind of phase-lock nudge — same
    // mechanism, softer pull, so a slightly early or late onset settles the
    // grid instead of visibly kicking it.
    if (!s.usingTap) {
      s.beatPhase *= 0.85;
    }
  }
  s.lastOnsetAt = nowMs;
}

function recomputeTempo(): void {
  if (s.ioiCount < 2) return;
  // Median IOI is robust to the occasional bad interval.
  const vals: number[] = [];
  for (let i = 0; i < s.ioiCount; i++) vals.push(s.iois[i]);
  vals.sort((a, b) => a - b);
  const median = vals[Math.floor(vals.length / 2)];
  const bpm = Math.max(MIN_BPM, Math.min(MAX_BPM, 60000 / median));

  // Confidence = how tightly the IOIs cluster around the median.
  let spread = 0;
  for (const v of vals) spread += Math.abs(v - median);
  spread /= vals.length;
  s.confidence = Math.max(0, Math.min(1, 1 - spread / median));

  if (!s.usingTap) s.bpm = bpm;
}

/**
 * Advance detection + phase clock one frame.
 *  low, mid  — current band energies (0–1) from the bus.
 *  dtMs      — ms since last update.
 */
export function updateBeat(low: number, mid: number, dtMs: number, nowMs: number): void {
  // ── Spectral flux: positive change in low/low-mid energy ──
  const energy = low * 0.7 + mid * 0.3;
  const flux = Math.max(0, energy - s.prevFlux);
  s.prevFlux = energy;

  // Adaptive threshold — trails the recent flux so quiet and loud passages both
  // detect, instead of a fixed threshold that only works at one volume.
  s.fluxAvg += (flux - s.fluxAvg) * Math.min(1, dtMs / 200);
  const threshold = s.fluxAvg * 1.6 + 0.008;

  const sinceLast = nowMs - s.lastOnsetAt;
  // Refractory period: no two onsets closer than the fastest allowed beat.
  if (flux > threshold && sinceLast > 60000 / MAX_BPM) {
    registerOnset(nowMs);
  }

  // Confidence decays if onsets stop arriving, so a stalled detector doesn't
  // keep claiming a lock it no longer has.
  if (sinceLast > beatPeriodMs() * 2.5 && !s.usingTap) {
    s.confidence *= 0.98;
  }

  // ── Phase clock ──
  const period = beatPeriodMs();
  const prevPhase = s.beatPhase;
  s.beatPhase += dtMs / period;
  if (s.beatPhase >= 1) {
    s.beatPhase -= 1;
    s.beatCounter = (s.beatCounter + 1) % 4;
  }

  // ── Pulse envelopes: a decaying blip at the start of each active beat ──
  // Built from the waveform 'pulse' shape so it shares the LFO's vocabulary.
  const beatJustStarted = s.beatPhase < prevPhase;
  // Beat offset: shift phase forward/back by the user's trim value (±50ms),
  // expressed as a fraction of the current beat period. Wraps safely into [0,1].
  const offsetFraction = s.beatOffsetMs / beatPeriodMs();
  const decayPhase = ((s.beatPhase - offsetFraction) % 1 + 1) % 1;
  const blip = sampleWaveform('pulse', decayPhase, 0.35);

  const onDown = s.beatCounter === 0 || s.beatCounter === 2;
  const onOff = s.beatCounter === 1 || s.beatCounter === 3;
  const onBar = s.beatCounter === 0;

  pulses.every = blip;
  pulses.downbeat = onDown ? blip : 0;
  pulses.offbeat = onOff ? blip : 0;
  pulses.bar = onBar ? blip : 0;

  // 8th-note grid: two pulses per beat. Phase wraps at 0.5 instead of 1.
  // The offset scales proportionally so an absolute-time trim (ms) stays
  // perceptually consistent across all subdivision rates.
  const decayPhase8 = (((s.beatPhase * 2) % 1) - offsetFraction * 2 + 2) % 1;
  pulses.beat8 = sampleWaveform('pulse', decayPhase8, 0.35);

  // 16th-note grid: four pulses per beat.
  const decayPhase16 = (((s.beatPhase * 4) % 1) - offsetFraction * 4 + 4) % 1;
  pulses.beat16 = sampleWaveform('pulse', decayPhase16, 0.35);

  void beatJustStarted;
}

/** Pulse value for a subdivision, 0–1. */
export function getBeatPulse(sub: BeatSubdivision): number {
  return pulses[sub];
}

export function getBeatInfo() {
  return {
    bpm: Math.round(s.bpm),
    confidence: s.confidence,
    beatPhase: s.beatPhase,
    beatInBar: s.beatCounter,
    usingTap: s.usingTap,
    beatOffsetMs: s.beatOffsetMs,
  };
}

/** Adjust the pulse timing trim (clamped ±50ms). Does not affect BPM. */
export function setBeatOffset(ms: number): void {
  s.beatOffsetMs = Math.max(-50, Math.min(50, ms));
}

/** Continuous 0–1 phase for the beat indicator. */
export function getBeatPhase(): number {
  return s.beatPhase;
}

/**
 * Register a manual tap. Four taps establish a tempo; taps override detection
 * until reset, because a user tapping is a stronger signal than onset
 * detection guessing.
 */
export function tapTempo(nowMs: number): void {
  s.tapTimes.push(nowMs);
  // Keep only recent taps (within 3s), so an old stray tap doesn't skew it.
  s.tapTimes = s.tapTimes.filter((t) => nowMs - t < 3000);
  if (s.tapTimes.length >= 2) {
    let sum = 0;
    for (let i = 1; i < s.tapTimes.length; i++) sum += s.tapTimes[i] - s.tapTimes[i - 1];
    const avg = sum / (s.tapTimes.length - 1);
    const bpm = Math.max(MIN_BPM, Math.min(MAX_BPM, 60000 / avg));
    s.bpm = bpm;
    s.usingTap = true;
    s.confidence = 1;
    // Align the grid to the most recent tap.
    s.beatPhase = 0;
    s.beatCounter = 0;
  }
}

/** Drop tap override, hand tempo back to the detector. */
export function clearTap(): void {
  s.usingTap = false;
  s.tapTimes = [];
}

/** Reset everything — call when a new track loads or playback stops. */
export function resetBeat(): void {
  s.prevFlux = 0; s.fluxAvg = 0; s.lastOnsetAt = 0;
  s.iois.fill(0); s.ioiIndex = 0; s.ioiCount = 0;
  s.bpm = 120; s.confidence = 0;
  s.beatPhase = 0; s.beatCounter = 0;
  s.tapTimes = []; s.usingTap = false;
  pulses.every = 0; pulses.downbeat = 0; pulses.offbeat = 0; pulses.bar = 0;
  pulses.beat8 = 0; pulses.beat16 = 0;
  // beatOffsetMs intentionally NOT reset — survives track changes.
}
