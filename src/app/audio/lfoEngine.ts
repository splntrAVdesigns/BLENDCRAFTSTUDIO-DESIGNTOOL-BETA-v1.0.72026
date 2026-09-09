/**
 * audio/lfoEngine.ts — Stage 3.0.4
 *
 * One LFO: a generated modulation source that runs on its own clock and needs
 * no audio at all.
 *
 * ── WHY IT'S A SEPARATE CATEGORY FROM BANDS/BEAT ─────────────────────────
 * Bands and beat are DERIVED from audio. An LFO is GENERATED. That earns it
 * separate treatment: it gives audio-reactive-style motion before any track is
 * loaded (useful for building a mapping against a predictable signal), and it
 * is the only source that can be guaranteed loop-exact by construction —
 * because its period is a number the user sets, not something extracted from a
 * file that may not loop cleanly.
 *
 * ── SYNC MODES ───────────────────────────────────────────────────────────
 *  free         — a raw rate in Hz. For motion unrelated to the music.
 *  bpm          — rides the beat clock; "pulse twice per beat" is one control
 *                 rather than manual Hz arithmetic.
 *  exportLocked — snaps the rate so a whole number of cycles fits the export
 *                 duration exactly. The same loop-exactness fix that closed
 *                 Vortex in 2.9.3, offered as a default rather than discovered.
 *                 (The export half lands with deterministic export; here it
 *                 behaves like 'free' at the snapped rate.)
 *
 * ── ALLOCATION ───────────────────────────────────────────────────────────
 * One phase advance per frame on a single module object. Nothing allocates.
 */

import { useSyncExternalStore } from 'react';
import { sampleWaveform, type WaveformShape } from './waveformShapes';
import { getExportDurationSeconds } from './exportDurationBridge';

export type LFOSyncMode = 'free' | 'bpm' | 'exportLocked';

export interface LFOConfig {
  enabled: boolean;
  shape: WaveformShape;
  syncMode: LFOSyncMode;
  /** free mode: cycles per second. */
  rateHz: number;
  /** bpm mode: cycles per beat. 1 = one cycle per beat, 0.5 = per two beats. */
  bpmMultiplier: number;
  /** exportLocked: cycles across the export duration. */
  cyclesPerExport: number;
  /** pulse/square duty, 0–1. */
  pulseWidth: number;
}

const STORAGE_KEY = 'blendcraft-lfo-v1';

const DEFAULT: LFOConfig = {
  enabled: false,
  shape: 'sine',
  syncMode: 'bpm',
  rateHz: 1,
  bpmMultiplier: 1,
  cyclesPerExport: 4,
  pulseWidth: 0.35,
};

function load(): LFOConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const p = JSON.parse(raw);
    return {
      enabled: typeof p.enabled === 'boolean' ? p.enabled : false,
      shape: p.shape ?? 'sine',
      syncMode: (['free', 'bpm', 'exportLocked'] as const).includes(p.syncMode) ? p.syncMode : 'bpm',
      rateHz: Number.isFinite(p.rateHz) ? Math.max(0.05, Math.min(10, p.rateHz)) : 1,
      bpmMultiplier: Number.isFinite(p.bpmMultiplier) ? Math.max(0.25, Math.min(4, p.bpmMultiplier)) : 1,
      cyclesPerExport: Number.isFinite(p.cyclesPerExport) ? Math.max(1, Math.min(64, p.cyclesPerExport)) : 4,
      pulseWidth: Number.isFinite(p.pulseWidth) ? Math.max(0.05, Math.min(0.95, p.pulseWidth)) : 0.35,
    };
  } catch {
    return DEFAULT;
  }
}

let config: LFOConfig = load();
const listeners = new Set<() => void>();

function publish(next: LFOConfig): void {
  config = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  listeners.forEach((l) => { try { l(); } catch { /* isolate */ } });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const getSnapshot = () => config;

export function useLFOConfig(): LFOConfig {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function updateLFO(patch: Partial<LFOConfig>): void {
  publish({ ...config, ...patch });
}

// ── Runtime phase ──
let phase = 0;   // 0–1
let value = 0;   // shaped output 0–1

/**
 * Advance the LFO one frame.
 *  dtMs   — ms since last frame.
 *  bpm    — current tempo, for bpm sync mode.
 */
export function updateLFO_frame(dtMs: number, bpm: number): void {
  if (!config.enabled) { value = 0; return; }

  let hz: number;
  switch (config.syncMode) {
    case 'bpm':
      // cycles/sec = (beats/sec) × (cycles/beat)
      hz = (bpm / 60) * config.bpmMultiplier;
      break;
    case 'exportLocked':
      // Sprint 2.8: was hardcoded to a "nominal 5s window" regardless of the
      // user's actual configured export duration — reads live from
      // ExportPanel.tsx now, so what you see while tuning matches what
      // actually renders. Still an approximation of the true export-time
      // snap (real export math lives elsewhere), but now correctly scoped
      // to the real duration instead of a fixed guess.
      hz = config.cyclesPerExport / getExportDurationSeconds();
      break;
    default:
      hz = config.rateHz;
  }

  phase += (dtMs / 1000) * hz;
  phase -= Math.floor(phase);
  value = sampleWaveform(config.shape, phase, config.pulseWidth);
}

export function getLFOValue(): number { return value; }
export function getLFOPhase(): number { return phase; }

export function resetLFO(): void { phase = 0; value = 0; }

/** For the panel's live indicator without a store subscription on the hot path. */
export function getLFOShape(): WaveformShape { return config.shape; }
