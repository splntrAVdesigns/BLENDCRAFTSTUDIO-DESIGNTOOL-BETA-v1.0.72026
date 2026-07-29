/**
 * audio/envelopeBaker.ts — Stage 3.1 (deterministic export)
 *
 * Pre-computes the audio-derived signals for the WHOLE track, offline, into a
 * time-indexed table. Export then samples that table at each frame's exact
 * timestamp — so a rendered video reacts identically no matter the machine,
 * frame rate, or how many times you export it.
 *
 * ── WHY BAKE, RATHER THAN ANALYSE LIVE DURING EXPORT ─────────────────────
 * The live path reads an AnalyserNode in real time from the canvas RAF. Export
 * renders frames as fast (or slow) as the GPU allows, decoupled from wall
 * time — there is no real-time audio to poll. Worse, real-time analysis is
 * inherently non-reproducible: the same track polled twice yields slightly
 * different frames. A rendered file must be identical every time, so the audio
 * response has to be a pure function of timestamp. That's what a baked table is.
 *
 * ── WHY OfflineAudioContext ──────────────────────────────────────────────
 * It renders the decoded buffer through the same Web Audio graph
 * deterministically and faster than real time. We tap an AnalyserNode via a
 * ScriptProcessor to pull FFT frames at a fixed cadence, then run them through
 * the EXACT SAME band-analysis, signal-conditioning and beat-detection code the
 * live path uses — so baked and live signals match rather than merely resemble
 * each other. The beat and signal modules already take their timing as
 * parameters (no internal performance.now), which is what makes replaying them
 * on a synthetic clock produce identical output.
 *
 * ── WHAT'S BAKED ─────────────────────────────────────────────────────────
 * The raw BUS signals — all five conditioned bands (subBass/low/mid/high/level,
 * both norm and hit) plus the six beat pulses (every/downbeat/offbeat/bar/
 * beat8/beat16) — sampled at a fixed step. The per-mapping curve/attack/release
 * envelopes are NOT baked; they run during export from the baked bus exactly as
 * they run live from the real bus, so all the mapping logic stays in one place
 * (audioMapping.ts) and can't drift between preview and export.
 */

import { createBandAnalyzer } from './bandAnalysis';
import { conditionSignals, resetSignalConditioning, type ConditionedSignals } from './audioSignal';
import { updateBeat, getBeatPulse, resetBeat } from './beatDetection';

/** Seconds between baked samples. ~200Hz target — well above any frame rate,
 *  so export sampling interpolates within a dense table rather than
 *  extrapolating. Actual cadence rounds to a power-of-two block size. */
const BAKE_STEP = 1 / 200;

/** FFT size for offline analysis — matches the live engine's analyser. */
const FFT_SIZE = 2048;

export interface BakedFrame {
  subBass: number; low: number; mid: number; high: number; level: number;
  subBassNorm: number; lowNorm: number; midNorm: number; highNorm: number; levelNorm: number;
  subBassHit: number; lowHit: number; midHit: number; highHit: number; levelHit: number;
  beat: number; beatDown: number; beatOff: number; beatBar: number; beat8: number; beat16: number;
}

export interface BakedEnvelope {
  step: number;
  duration: number;
  frames: BakedFrame[];
  sampleRate: number;
  analyzedSeconds: number;
}

let baked: BakedEnvelope | null = null;

/**
 * Bake `buffer` into an envelope table. Returns the table and also stores it
 * for `sampleBakedEnvelope`. Re-baking replaces the stored table.
 */
export async function bakeEnvelope(buffer: AudioBuffer): Promise<BakedEnvelope> {
  const duration = buffer.duration;
  const sampleRate = buffer.sampleRate;

  const OfflineCtx: typeof OfflineAudioContext =
    (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const ctx = new OfflineCtx(buffer.numberOfChannels, Math.ceil(duration * sampleRate), sampleRate);

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.8; // match the live analyser's smoothing

  // Block size chosen so a tap fires at roughly BAKE_STEP spacing. The
  // ScriptProcessor is only a metronome to pull analyser frames; it passes
  // audio through untouched.
  const blockSize = Math.max(256, Math.min(16384, 1 << Math.round(Math.log2(sampleRate * BAKE_STEP))));
  const processor = ctx.createScriptProcessor(blockSize, buffer.numberOfChannels, buffer.numberOfChannels);

  source.connect(analyser);
  analyser.connect(processor);
  processor.connect(ctx.destination);

  const freq = new Uint8Array(analyser.frequencyBinCount);
  const analyzer = createBandAnalyzer(sampleRate, analyser.frequencyBinCount);

  // Fresh conditioning + beat state, so a previous bake or the live session
  // can't bleed in.
  resetSignalConditioning();
  resetBeat();

  const frames: BakedFrame[] = [];
  let lastTapTime = 0;

  processor.onaudioprocess = (e) => {
    const t = e.playbackTime;
    const dt = t - lastTapTime;
    lastTapTime = t;
    if (dt <= 0) return;

    analyser.getByteFrequencyData(freq as Uint8Array<ArrayBuffer>);
    analyzer.analyze(freq as Uint8Array<ArrayBuffer>, dt);

    const sig: ConditionedSignals = conditionSignals(
      analyzer.subBass, analyzer.low, analyzer.mid, analyzer.high, analyzer.level, dt,
    );

    // Beat detection on the same synthetic clock (t in ms). Deterministic
    // because updateBeat takes the timestamp as a parameter.
    updateBeat(analyzer.low, analyzer.mid, dt * 1000, t * 1000);

    frames.push({
      subBass: analyzer.subBass, low: analyzer.low, mid: analyzer.mid, high: analyzer.high, level: analyzer.level,
      subBassNorm: sig.subBassNorm, lowNorm: sig.lowNorm, midNorm: sig.midNorm, highNorm: sig.highNorm, levelNorm: sig.levelNorm,
      subBassHit: sig.subBassHit, lowHit: sig.lowHit, midHit: sig.midHit, highHit: sig.highHit, levelHit: sig.levelHit,
      beat: getBeatPulse('every'),
      beatDown: getBeatPulse('downbeat'),
      beatOff: getBeatPulse('offbeat'),
      beatBar: getBeatPulse('bar'),
      beat8: getBeatPulse('beat8'),
      beat16: getBeatPulse('beat16'),
    });
  };

  source.start(0);
  await ctx.startRendering();

  // Restore live state so the preview after an export behaves normally.
  resetSignalConditioning();
  resetBeat();

  baked = {
    step: frames.length > 1 ? duration / frames.length : BAKE_STEP,
    duration,
    frames,
    sampleRate,
    analyzedSeconds: duration,
  };
  return baked;
}

export function hasBakedEnvelope(): boolean {
  return baked !== null && baked.frames.length > 0;
}

export function getBakedInfo(): { analyzedSeconds: number; frames: number } | null {
  if (!baked) return null;
  return { analyzedSeconds: baked.analyzedSeconds, frames: baked.frames.length };
}

export function clearBakedEnvelope(): void {
  baked = null;
}

/**
 * Sample the baked table at `time` (seconds), linearly interpolated between the
 * two nearest samples. Returns null when nothing is baked, so the caller can
 * fall back to a non-reactive frame.
 */
export function sampleBakedEnvelope(time: number): BakedFrame | null {
  if (!baked || baked.frames.length === 0) return null;
  const { frames, step } = baked;

  const x = Math.max(0, time) / step;
  const i0 = Math.min(frames.length - 1, Math.floor(x));
  const i1 = Math.min(frames.length - 1, i0 + 1);
  const f = x - i0;

  const a = frames[i0];
  const b = frames[i1];
  const L = (p: number, q: number) => p + (q - p) * f;
  // Beat pulses are sharp; interpolating would smear the transient, so take the
  // nearer sample rather than blending.
  const N = (p: number, q: number) => (f < 0.5 ? p : q);

  return {
    subBass: L(a.subBass, b.subBass), low: L(a.low, b.low), mid: L(a.mid, b.mid), high: L(a.high, b.high), level: L(a.level, b.level),
    subBassNorm: L(a.subBassNorm, b.subBassNorm), lowNorm: L(a.lowNorm, b.lowNorm), midNorm: L(a.midNorm, b.midNorm),
    highNorm: L(a.highNorm, b.highNorm), levelNorm: L(a.levelNorm, b.levelNorm),
    subBassHit: L(a.subBassHit, b.subBassHit), lowHit: L(a.lowHit, b.lowHit), midHit: L(a.midHit, b.midHit),
    highHit: L(a.highHit, b.highHit), levelHit: L(a.levelHit, b.levelHit),
    beat: N(a.beat, b.beat), beatDown: N(a.beatDown, b.beatDown), beatOff: N(a.beatOff, b.beatOff),
    beatBar: N(a.beatBar, b.beatBar), beat8: N(a.beat8, b.beat8), beat16: N(a.beat16, b.beat16),
  };
}
