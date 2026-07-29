/**
 * audio/bandAnalysis.ts — Stage 3.0.0
 *
 * Turns an FFT magnitude array into three smoothed band envelopes.
 *
 * Two distinct jobs, deliberately kept separate:
 *
 *   1. BINNING — map Hz ranges to FFT bin indices and average them. Pure
 *      arithmetic, no state.
 *   2. ENVELOPE FOLLOWING — smooth those raw values over time with asymmetric
 *      attack/release. Stateful, and the reason band output looks like motion
 *      rather than noise.
 *
 * Both are allocation-free after construction: the bin boundaries are computed
 * once when the analyzer is created, and the per-frame path only reads from
 * the caller's existing Uint8Array and writes to preallocated fields.
 */

import { BAND_RANGES_HZ, DEFAULT_ENVELOPE, type BandName, type EnvelopeTiming } from './types';

interface BinRange {
  start: number;
  end: number;   // exclusive
}

export interface BandAnalyzer {
  /**
   * Analyze one frame. `freqData` is the caller's reusable Uint8Array from
   * `AnalyserNode.getByteFrequencyData` — never copied.
   * `dt` is seconds since the previous call, for time-correct smoothing.
   */
  analyze(freqData: Uint8Array, dt: number): void;

  // Results, read directly after analyze(). Fields rather than a returned
  // object, so calling this 60×/sec allocates nothing.
  subBass: number; subBassRaw: number;  // 20–60 Hz — 808s, sub-rumble, kick fundamental
  low: number; mid: number; high: number;
  lowRaw: number; midRaw: number; highRaw: number;
  level: number;
  peak: number;

  /** Clear envelope state (e.g. on stop) so old values don't bleed in later. */
  reset(): void;
}

/**
 * Map a frequency range in Hz to FFT bin indices.
 *
 * The FFT covers 0 → sampleRate/2 (Nyquist) across `binCount` bins, so each
 * bin spans (sampleRate/2)/binCount Hz. Clamped to at least one bin: at low
 * sample rates or small FFT sizes the "low" band can otherwise round to an
 * empty range and read as permanent silence.
 */
function hzRangeToBins(
  lowHz: number, highHz: number, sampleRate: number, binCount: number,
): BinRange {
  const nyquist = sampleRate / 2;
  const start = Math.max(0, Math.floor((lowHz / nyquist) * binCount));
  const end = Math.min(binCount, Math.ceil((highHz / nyquist) * binCount));
  return { start, end: Math.max(start + 1, end) };
}

/**
 * Asymmetric envelope follower.
 *
 * Rises toward `target` at the attack rate, falls at the release rate. The
 * coefficient is derived from dt so the perceived speed is the same whether
 * the browser is running at 60fps or has dropped to 24 — the same frame-rate
 * independence lesson that 2.8.3 fixed in the animation clock. A fixed
 * per-frame lerp factor would make audio response subtly speed up and slow
 * down with scene load, which is exactly the class of bug we just removed.
 */
function follow(current: number, target: number, dt: number, timing: EnvelopeTiming): number {
  const tau = target > current ? timing.attack : timing.release;
  if (tau <= 0) return target;
  // Exponential approach: 1 - e^(-dt/tau) is the fraction of the remaining
  // distance to cover this frame.
  const coeff = 1 - Math.exp(-dt / tau);
  return current + (target - current) * coeff;
}

export function createBandAnalyzer(
  sampleRate: number,
  binCount: number,
  timing: EnvelopeTiming = DEFAULT_ENVELOPE,
): BandAnalyzer {
  // Computed once — the per-frame path never recomputes bin boundaries.
  const ranges: Record<BandName, BinRange> = {
    subBass: hzRangeToBins(BAND_RANGES_HZ.subBass[0], BAND_RANGES_HZ.subBass[1], sampleRate, binCount),
    low: hzRangeToBins(BAND_RANGES_HZ.low[0], BAND_RANGES_HZ.low[1], sampleRate, binCount),
    mid: hzRangeToBins(BAND_RANGES_HZ.mid[0], BAND_RANGES_HZ.mid[1], sampleRate, binCount),
    high: hzRangeToBins(BAND_RANGES_HZ.high[0], BAND_RANGES_HZ.high[1], sampleRate, binCount),
  };

  const analyzer: BandAnalyzer = {
    subBass: 0, subBassRaw: 0,
    low: 0, mid: 0, high: 0,
    lowRaw: 0, midRaw: 0, highRaw: 0,
    level: 0,
    peak: 0,

    analyze(freqData: Uint8Array, dt: number): void {
      let total = 0;
      let peak = 0;

      // Single pass for level/peak across the whole spectrum.
      for (let i = 0; i < freqData.length; i++) {
        const v = freqData[i];
        total += v;
        if (v > peak) peak = v;
      }
      this.level = freqData.length > 0 ? total / (freqData.length * 255) : 0;
      this.peak = peak / 255;

      // Per-band means.
      this.subBassRaw = meanOfRange(freqData, ranges.subBass);
      this.lowRaw = meanOfRange(freqData, ranges.low);
      this.midRaw = meanOfRange(freqData, ranges.mid);
      this.highRaw = meanOfRange(freqData, ranges.high);

      // Clamp dt: a backgrounded tab can produce a multi-second gap, which
      // would snap every envelope straight to target and produce a visible
      // jolt on return. 100ms matches the spike guard used by the animation
      // clock for the same reason.
      const safeDt = Math.min(0.1, Math.max(0, dt));

      this.subBass = follow(this.subBass, this.subBassRaw, safeDt, timing);
      this.low = follow(this.low, this.lowRaw, safeDt, timing);
      this.mid = follow(this.mid, this.midRaw, safeDt, timing);
      this.high = follow(this.high, this.highRaw, safeDt, timing);
    },

    reset(): void {
      this.subBass = 0; this.subBassRaw = 0;
      this.low = 0; this.mid = 0; this.high = 0;
      this.lowRaw = 0; this.midRaw = 0; this.highRaw = 0;
      this.level = 0;
      this.peak = 0;
    },
  };

  return analyzer;
}

/** Mean of a bin range, normalized 0–1. */
function meanOfRange(freqData: Uint8Array, range: BinRange): number {
  let sum = 0;
  let count = 0;
  const end = Math.min(range.end, freqData.length);
  for (let i = range.start; i < end; i++) {
    sum += freqData[i];
    count++;
  }
  return count > 0 ? sum / (count * 255) : 0;
}

/** Exposed for the diagnostic readout — which bins each band actually covers. */
export function describeBands(sampleRate: number, binCount: number) {
  return {
    sampleRate,
    binCount,
    nyquist: sampleRate / 2,
    hzPerBin: +((sampleRate / 2) / binCount).toFixed(2),
    subBass: hzRangeToBins(BAND_RANGES_HZ.subBass[0], BAND_RANGES_HZ.subBass[1], sampleRate, binCount),
    low: hzRangeToBins(BAND_RANGES_HZ.low[0], BAND_RANGES_HZ.low[1], sampleRate, binCount),
    mid: hzRangeToBins(BAND_RANGES_HZ.mid[0], BAND_RANGES_HZ.mid[1], sampleRate, binCount),
    high: hzRangeToBins(BAND_RANGES_HZ.high[0], BAND_RANGES_HZ.high[1], sampleRate, binCount),
  };
}
