/**
 * audio/audioPerf.ts — Stage 3.0.2a
 *
 * Frame-timing instrumentation for the audio hot path.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * A "motion degrades after about a minute of playback" report can't be fixed
 * by reading code — I audited every path the audio integration added and found
 * no unbounded growth, no per-frame logging, and bounded hue math, which rules
 * out the usual suspects but doesn't identify the actual cost. Guessing at a
 * fix from there produces something plausible rather than something correct.
 *
 * So: measure. Same convention as `__exportTiming` and `__memory` already
 * established for exactly this class of question.
 *
 * ── COST OF MEASURING ────────────────────────────────────────────────────
 * Two `performance.now()` calls and two ring-buffer writes per frame. The
 * buffers are FIXED SIZE and allocated once — deliberately, since an
 * instrument built to investigate a suspected leak must not be able to leak
 * itself. Nothing here grows, ever.
 */

const SAMPLES = 600; // ~10s at 60fps

interface Channel {
  buf: Float32Array;
  i: number;
  count: number;
  t0: number;
}

function makeChannel(): Channel {
  return { buf: new Float32Array(SAMPLES), i: 0, count: 0, t0: 0 };
}

const analysis = makeChannel();
const resolve = makeChannel();

/** Frames since the engine started producing samples — for drift-over-time. */
let framesSeen = 0;

function begin(c: Channel): void {
  c.t0 = performance.now();
}

function end(c: Channel): void {
  if (c.t0 === 0) return;
  const dt = performance.now() - c.t0;
  c.buf[c.i] = dt;
  c.i = (c.i + 1) % SAMPLES;
  if (c.count < SAMPLES) c.count++;
  c.t0 = 0;
}

export function beginAnalysis(): void { begin(analysis); }
export function endAnalysis(): void { end(analysis); framesSeen++; }
export function beginResolve(): void { begin(resolve); }
export function endResolve(): void { end(resolve); }

function stats(c: Channel) {
  if (c.count === 0) return { avgMs: 0, worstMs: 0, p95Ms: 0, samples: 0 };
  let sum = 0;
  let worst = 0;
  // Copy only the populated slice, once, on demand — this runs when a human
  // types in the console, never per frame.
  const vals: number[] = [];
  for (let k = 0; k < c.count; k++) {
    const v = c.buf[k];
    vals.push(v);
    sum += v;
    if (v > worst) worst = v;
  }
  vals.sort((a, b) => a - b);
  return {
    avgMs: +(sum / c.count).toFixed(4),
    worstMs: +worst.toFixed(4),
    p95Ms: +vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.95))].toFixed(4),
    samples: c.count,
  };
}

/**
 * Install `window.__audioPerf`.
 *
 * `report()` gives the rolling picture. The key number is not the average but
 * whether avg/p95 CLIMB across a long playback — a constant cost that's simply
 * too high looks completely different from something degrading over time, and
 * only the second matches the reported symptom.
 */
export function installAudioPerf(): void {
  try {
    (window as any).__audioPerf = {
      report() {
        const a = stats(analysis);
        const r = stats(resolve);
        const budget60 = 16.67;
        const out = {
          analysis: a,
          resolve: r,
          combinedAvgMs: +(a.avgMs + r.avgMs).toFixed(4),
          percentOf60fpsBudget: +(((a.avgMs + r.avgMs) / budget60) * 100).toFixed(2),
          framesSeen,
        };
        console.info('[Audio perf]', out);
        if (out.percentOf60fpsBudget < 5) {
          console.info(
            '[Audio perf] Audio is using under 5% of a 60fps frame budget. ' +
            'If motion is still degrading, the cost is very likely NOT in the ' +
            'audio path — compare __memory and try the same scene with audio ' +
            'stopped but the canvas still playing.',
          );
        }
        return out;
      },
      /** Snapshot now, wait, snapshot again — the drift test. */
      async drift(seconds = 60) {
        const before = { a: stats(analysis), r: stats(resolve), f: framesSeen };
        console.info(`[Audio perf] Sampling for ${seconds}s…`);
        await new Promise((res) => setTimeout(res, seconds * 1000));
        const after = { a: stats(analysis), r: stats(resolve), f: framesSeen };
        const out = {
          analysisAvgBefore: before.a.avgMs,
          analysisAvgAfter: after.a.avgMs,
          resolveAvgBefore: before.r.avgMs,
          resolveAvgAfter: after.r.avgMs,
          framesInWindow: after.f - before.f,
          effectiveFps: +((after.f - before.f) / seconds).toFixed(1),
        };
        console.info('[Audio perf] drift', out);
        console.info(
          '[Audio perf] If effectiveFps dropped but the avg times did NOT rise, ' +
          'the frame budget is being consumed somewhere other than audio.',
        );
        return out;
      },
      reset() {
        analysis.buf.fill(0); analysis.i = 0; analysis.count = 0;
        resolve.buf.fill(0); resolve.i = 0; resolve.count = 0;
        framesSeen = 0;
        console.info('[Audio perf] reset');
      },
    };
    console.info('[Audio perf] installed — run __audioPerf.report() or __audioPerf.drift(60)');
  } catch {
    /* diagnostics must never break the app */
  }
}
