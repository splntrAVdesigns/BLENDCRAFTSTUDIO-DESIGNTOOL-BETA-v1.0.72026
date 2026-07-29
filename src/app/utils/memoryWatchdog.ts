/**
 * utils/memoryWatchdog.ts — Stage 2.8.4
 *
 * Watches JS heap pressure and warns BEFORE the renderer is killed.
 *
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────
 * The app has force-refreshed mid-session during testing, with no error and no
 * dialog. That signature is the Chromium renderer process being killed, and the
 * cause is almost always memory. Inside an iframe host the budget is tighter
 * than a normal tab, and this app legitimately holds a lot: full-resolution
 * video textures, mask render targets, encoder queues, blob rehydration.
 *
 * 2.8.2 removed the largest single offender (an unbounded encoder queue holding
 * ~460MB of 1080p VideoFrames). This is the general guard: the app should be
 * able to SEE pressure building and say so, instead of vanishing.
 *
 * WHAT IT CAN AND CANNOT DO — stated plainly:
 *  • `performance.memory` is Chromium-only and NON-STANDARD. On other engines
 *    this module reports `supported: false` and does nothing. It is a
 *    diagnostic aid, not a guarantee.
 *  • It measures the JS heap. GPU-side allocations (textures, render targets)
 *    are NOT counted, so real pressure can exceed what this reports. Treat the
 *    numbers as a floor.
 *  • It cannot prevent a kill. It can warn early enough for the user to export,
 *    save, or close layers first — which is the difference between losing work
 *    and merely being inconvenienced.
 */

interface PerfMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export type MemoryPressure = 'ok' | 'elevated' | 'critical';

export interface MemorySample {
  supported: boolean;
  usedBytes: number;
  limitBytes: number;
  /** usedBytes / limitBytes, 0..1. */
  ratio: number;
  pressure: MemoryPressure;
  at: number;
}

const IDLE: MemorySample = Object.freeze({
  supported: false, usedBytes: 0, limitBytes: 0, ratio: 0, pressure: 'ok' as MemoryPressure, at: 0,
});

/**
 * Thresholds. Chromium typically kills well before 100% of jsHeapSizeLimit, and
 * a GC can reclaim a lot, so these are deliberately conservative — the point is
 * to warn while there is still room to act.
 */
const ELEVATED_RATIO = 0.70;
const CRITICAL_RATIO = 0.85;

/** Don't nag: minimum gap between warnings of the same severity. */
const WARN_COOLDOWN_MS = 60_000;

function readMemory(): MemorySample {
  try {
    const mem = (performance as unknown as { memory?: PerfMemory }).memory;
    if (!mem || !mem.jsHeapSizeLimit) return { ...IDLE, at: Date.now() };
    const usedBytes = mem.usedJSHeapSize || 0;
    const limitBytes = mem.jsHeapSizeLimit;
    const ratio = limitBytes > 0 ? usedBytes / limitBytes : 0;
    const pressure: MemoryPressure =
      ratio >= CRITICAL_RATIO ? 'critical' : ratio >= ELEVATED_RATIO ? 'elevated' : 'ok';
    return { supported: true, usedBytes, limitBytes, ratio, pressure, at: Date.now() };
  } catch {
    return { ...IDLE, at: Date.now() };
  }
}

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`;
};

let timer: number | null = null;
let lastWarnAt: Partial<Record<MemoryPressure, number>> = {};
let onWarn: ((sample: MemorySample) => void) | null = null;

/** Latest sample; also mirrored to window.__memory for console inspection. */
export function getMemorySample(): MemorySample {
  return readMemory();
}

/**
 * Start periodic sampling. Idempotent — calling twice does not double-schedule.
 *
 * @param warn  Invoked when pressure first reaches elevated/critical, rate
 *              limited per severity. Deliberately a callback rather than a
 *              hardcoded toast so the caller owns presentation.
 */
export function startMemoryWatchdog(
  warn?: (sample: MemorySample) => void,
  intervalMs = 15_000,
): void {
  onWarn = warn ?? null;
  if (timer !== null) return;

  const tick = () => {
    const sample = readMemory();
    try {
      (window as unknown as Record<string, unknown>).__memory = {
        ...sample,
        used: formatBytes(sample.usedBytes),
        limit: formatBytes(sample.limitBytes),
        percent: `${(sample.ratio * 100).toFixed(1)}%`,
      };
    } catch { /* diagnostics must never throw */ }

    if (!sample.supported || sample.pressure === 'ok') return;
    const last = lastWarnAt[sample.pressure] ?? 0;
    if (Date.now() - last < WARN_COOLDOWN_MS) return;
    lastWarnAt[sample.pressure] = Date.now();
    try {
      onWarn?.(sample);
    } catch { /* a warning handler must never break the app */ }
  };

  tick();
  timer = window.setInterval(tick, intervalMs);
}

export function stopMemoryWatchdog(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
  onWarn = null;
  lastWarnAt = {};
}

/**
 * Message for a pressure warning. Concrete about what to do — a warning the
 * user can't act on is just anxiety.
 */
export function describeMemoryWarning(sample: MemorySample): string {
  const used = `${formatBytes(sample.usedBytes)} of ${formatBytes(sample.limitBytes)}`;
  return sample.pressure === 'critical'
    ? `Memory is running high (${used}). Export or save your work soon — ` +
      `removing an unused media layer or reloading will free the most.`
    : `Memory use is elevated (${used}). Long sessions with several video ` +
      `layers can build up; consider exporting soon.`;
}