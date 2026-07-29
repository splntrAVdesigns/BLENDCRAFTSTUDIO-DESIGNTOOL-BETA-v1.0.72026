/**
 * utils/loopVerification.ts — Stage 2.8.4
 *
 * MEASURES whether a loop-locked export actually loops.
 *
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────
 * Loop lock has had the machinery to snap a duration to a whole number of
 * animation cycles for several stages, and the UI has reported things like
 * "Snapping to 5.00s (12 cycles of 0.42s)". But nothing ever CHECKED the
 * result. "It should loop" is a claim about arithmetic; "it loops" is a claim
 * about pixels, and only one of those is worth telling a user.
 *
 * Worth noting why this wasn't built earlier: until 2.8.3 the live preview
 * clock was frame-rate throttled, so any loop measurement taken before that fix
 * would have been comparing against a polluted reference. Measuring first would
 * have produced a confident, wrong number.
 *
 * WHAT "SEAMLESS" MEANS PRECISELY
 * ─────────────────────────────────────────────────────────────────────────
 * The frame AFTER the last exported frame must be identical to frame 0. If the
 * export runs frames 0..N-1, then the frame at t = N/fps is what a player shows
 * immediately after wrapping — so rendering that frame and diffing it against
 * frame 0 is the exact test. Any animated subsystem that fails to return to its
 * start state (gradient phase, mask animation, texture motion, effects, video
 * position) shows up as a mismatch.
 *
 * COST: one extra rendered frame per export, plus one pixel diff. Negligible
 * against a 150-frame encode, and it converts a belief into a number.
 */

export interface LoopFrameSample {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface LoopVerificationResult {
  /** Fraction of channel samples within tolerance, 0..1. */
  matchRatio: number;
  /** Human-facing percentage, e.g. "99.98%". */
  matchLabel: string;
  /** Mean absolute per-channel difference, 0..255. */
  meanDelta: number;
  /** Largest single-channel difference seen. */
  maxDelta: number;
  /** Fraction of pixels whose perceptual RGB distance is below threshold. */
  perceptualMatchRatio?: number;
  /** True when the wrap is visually seamless. */
  seamless: boolean;
  /** Set when the comparison could not be performed (never throws). */
  error?: string;
}

/**
 * Per-channel tolerance. Not zero, deliberately: VP9/H.264 are lossy and the
 * renderer itself has float jitter, so demanding bit-equality would flag every
 * export as broken. 2/255 is below the perceptual floor while still catching a
 * real phase discontinuity, which typically shows deltas in the tens or higher.
 */
const CHANNEL_TOLERANCE = 3;
const PERCEPTUAL_PIXEL_TOLERANCE = 8;

/** Fraction of samples that must be within tolerance to call a loop seamless. */
const SEAMLESS_THRESHOLD = 0.985;

/**
 * Copy a frame sample. The caller's buffer is reused across frames by the
 * renderer, so the reference frame MUST be cloned or it will be overwritten
 * before the comparison happens.
 */
export function cloneLoopSample(sample: LoopFrameSample | null): LoopFrameSample | null {
  if (!sample || !sample.data || sample.width <= 0 || sample.height <= 0) return null;
  return {
    data: new Uint8Array(sample.data), // copy, not a view
    width: sample.width,
    height: sample.height,
  };
}

/**
 * Compare the wrap frame against the loop reference (frame 0).
 *
 * Samples on a stride rather than every pixel: at 1920×1080 a full compare is
 * 8.3M channel reads, and a phase discontinuity is a GLOBAL property — it does
 * not hide in the pixels a stride skips. The stride is prime-ish relative to
 * the row width so samples don't land in a column pattern.
 */
export function compareLoopFrames(
  reference: LoopFrameSample | null,
  wrapFrame: LoopFrameSample | null,
): LoopVerificationResult {
  const fail = (error: string): LoopVerificationResult => ({
    matchRatio: 0, matchLabel: 'n/a', meanDelta: 0, maxDelta: 0, seamless: false, error,
  });

  if (!reference) return fail('no reference frame captured');
  if (!wrapFrame) return fail('no wrap frame captured');
  if (reference.width !== wrapFrame.width || reference.height !== wrapFrame.height) {
    return fail('frame dimensions differ');
  }

  const a = reference.data;
  const b = wrapFrame.data;
  const len = Math.min(a.length, b.length);
  if (len === 0) return fail('empty frame data');

  // ~200k samples regardless of resolution, stepping in whole RGBA pixels.
  const targetSamples = 200_000;
  const pixelCount = Math.floor(len / 4);
  const pixelStride = Math.max(1, Math.floor(pixelCount / targetSamples));
  const step = pixelStride * 4;

  let within = 0;
  let perceptualWithin = 0;
  let pixelsCompared = 0;
  let total = 0;
  let sumDelta = 0;
  let maxDelta = 0;

  for (let i = 0; i + 3 < len; i += step) {
    // RGB only — alpha is constant in our pipeline and would dilute the ratio.
    let pixelDistanceSquared = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[i + c] - b[i + c]);
      sumDelta += d;
      pixelDistanceSquared += d * d;
      if (d > maxDelta) maxDelta = d;
      if (d <= CHANNEL_TOLERANCE) within++;
      total++;
    }
    if (Math.sqrt(pixelDistanceSquared / 3) <= PERCEPTUAL_PIXEL_TOLERANCE) perceptualWithin++;
    pixelsCompared++;
  }

  if (total === 0) return fail('no samples compared');

  const matchRatio = within / total;
  const perceptualMatchRatio = pixelsCompared > 0 ? perceptualWithin / pixelsCompared : 0;
  return {
    matchRatio,
    matchLabel: `${(matchRatio * 100).toFixed(2)}%`,
    meanDelta: sumDelta / total,
    maxDelta,
    perceptualMatchRatio,
    seamless: matchRatio >= SEAMLESS_THRESHOLD || perceptualMatchRatio >= 0.995,
  };
}

/**
 * One-line summary for the export toast / console. Deliberately states the
 * measurement rather than a verdict adjective — a user who sees "99.98% match"
 * can judge it; one who sees "looks good" cannot.
 */
export function describeLoopResult(result: LoopVerificationResult): string {
  if (result.error) return `Loop check unavailable (${result.error})`;
  return result.seamless
    ? `Loop verified — wrap matches frame 0 (${result.matchLabel})`
    : `Loop NOT seamless — wrap differs from frame 0 (${result.matchLabel}, perceptual ${((result.perceptualMatchRatio ?? 0) * 100).toFixed(2)}%, max delta ${result.maxDelta})`;
}