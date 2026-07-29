/**
 * utils/frameProfile.ts — Stage 3.0.3
 *
 * Whole-frame timing breakdown.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * "Motion degrades after about a minute" is a real report that no amount of
 * code reading has settled. I audited the audio path and found two genuine
 * defects (a per-frame object literal, and ~3 allocations per animation-offset
 * call) — both worth fixing, but ~500–700 short-lived objects/sec is modest
 * for a modern young-generation GC, and I'm not confident it explains a
 * degradation that specifically worsens over time. `__audioPerf` already
 * scopes the audio path; this scopes EVERYTHING, so the answer stops depending
 * on which subsystem anyone happens to suspect.
 *
 * Same convention as `__exportTiming` and `__memory`.
 *
 * ── COST ─────────────────────────────────────────────────────────────────
 * One `performance.now()` per phase boundary and one ring-buffer write. All
 * buffers are FIXED SIZE and allocated once — an instrument built to
 * investigate a suspected leak must not be able to leak itself.
 */

const SAMPLES = 600; // ~10s at 60fps, ~25s at 24fps

export type FramePhase =
  | 'total'
  | 'audio'
  | 'layerAnim'
  | 'maskAnim'
  | 'effects'
  | 'render';

const PHASES: FramePhase[] = ['total', 'audio', 'layerAnim', 'maskAnim', 'effects', 'render'];

interface Channel {
  buf: Float32Array;
  i: number;
  count: number;
  t0: number;
}

const channels: Record<FramePhase, Channel> = PHASES.reduce((acc, p) => {
  acc[p] = { buf: new Float32Array(SAMPLES), i: 0, count: 0, t0: 0 };
  return acc;
}, {} as Record<FramePhase, Channel>);

let frames = 0;
let enabled = false;

/**
 * Off by default. Measuring costs a little, and a profiler that runs whether
 * or not anyone is looking is itself a small tax on every frame — exactly the
 * kind of thing this is meant to find.
 */
export function setFrameProfileEnabled(on: boolean): void {
  enabled = on;
}

export function phaseBegin(p: FramePhase): void {
  if (!enabled) return;
  channels[p].t0 = performance.now();
}

export function phaseEnd(p: FramePhase): void {
  if (!enabled) return;
  const c = channels[p];
  if (c.t0 === 0) return;
  const dt = performance.now() - c.t0;
  c.buf[c.i] = dt;
  c.i = (c.i + 1) % SAMPLES;
  if (c.count < SAMPLES) c.count++;
  c.t0 = 0;
  if (p === 'total') frames++;
}

function stats(c: Channel) {
  if (c.count === 0) return { avgMs: 0, p95Ms: 0, worstMs: 0, samples: 0 };
  let sum = 0;
  let worst = 0;
  const vals: number[] = [];
  for (let k = 0; k < c.count; k++) {
    const v = c.buf[k];
    vals.push(v);
    sum += v;
    if (v > worst) worst = v;
  }
  vals.sort((a, b) => a - b);
  return {
    avgMs: +(sum / c.count).toFixed(3),
    p95Ms: +vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.95))].toFixed(3),
    worstMs: +worst.toFixed(3),
    samples: c.count,
  };
}

function snapshot() {
  const out: Record<string, ReturnType<typeof stats>> = {};
  for (const p of PHASES) out[p] = stats(channels[p]);
  return out;
}

export function installFrameProfile(): void {
  try {
    (window as any).__frameProfile = {
      /** Start measuring. Off by default — see setFrameProfileEnabled. */
      start() {
        this.reset();
        setFrameProfileEnabled(true);
        console.info('[Frame] profiling ON — run __frameProfile.report() in a few seconds');
      },
      stop() {
        setFrameProfileEnabled(false);
        console.info('[Frame] profiling OFF');
      },
      report() {
        const s = snapshot();
        console.info('[Frame] per-phase (ms)', s);
        const t = s.total.avgMs;
        if (t > 0) {
          console.info(
            `[Frame] avg total ${t}ms → ${(1000 / t).toFixed(1)} fps ceiling from CPU work alone. ` +
            'Phases sum to less than total when the gap is GPU wait or browser overhead.',
          );
        }
        return s;
      },
      /**
       * The drift test: snapshot, wait, snapshot again.
       *
       * The question is not "what is the average" but "does any phase CLIMB".
       * A phase that is simply expensive looks completely different from one
       * that degrades — and only the second matches the reported symptom.
       */
      async drift(seconds = 60) {
        if (!enabled) {
          setFrameProfileEnabled(true);
          console.info('[Frame] profiling was off — enabled for this run');
        }
        const before = snapshot();
        const f0 = frames;
        console.info(`[Frame] sampling for ${seconds}s…`);
        await new Promise((r) => setTimeout(r, seconds * 1000));
        const after = snapshot();
        const f1 = frames;

        const rows: Record<string, unknown> = {};
        for (const p of PHASES) {
          rows[p] = {
            before: before[p].avgMs,
            after: after[p].avgMs,
            deltaMs: +(after[p].avgMs - before[p].avgMs).toFixed(3),
          };
        }
        const out = {
          phases: rows,
          framesInWindow: f1 - f0,
          effectiveFps: +((f1 - f0) / seconds).toFixed(1),
        };
        console.info('[Frame] drift', out);
        console.info(
          '[Frame] Read it this way: a phase whose deltaMs is clearly positive is ' +
          'the one degrading. If every deltaMs is ~0 but effectiveFps fell, the ' +
          'cost is outside the measured phases — GPU/shader or browser-level.',
        );
        return out;
      },
      reset() {
        for (const p of PHASES) {
          const c = channels[p];
          c.buf.fill(0); c.i = 0; c.count = 0; c.t0 = 0;
        }
        frames = 0;
        console.info('[Frame] reset');
      },
    };
    console.info('[Frame] profiler installed — __frameProfile.start() then .report() or .drift(60)');
  } catch {
    /* diagnostics must never break the app */
  }
}
