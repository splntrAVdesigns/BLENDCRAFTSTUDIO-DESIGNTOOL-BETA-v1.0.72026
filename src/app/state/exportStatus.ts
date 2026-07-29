/**
 * state/exportStatus.ts — Stage 2.7.9 (C)
 *
 * A tiny external store carrying LIVE EXPORT STATE to any component that needs
 * it, without threading props through App.
 *
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────
 * Export state used to live entirely inside ExportPanel (right sidebar). The
 * canvas and the header had no idea an export was running. Two consequences,
 * both of which read as "the app is broken" to a user:
 *
 *  1. Video export renders deterministically — renderAtTime() walks exact
 *     timesteps and awaits each video seek. That is CORRECT (it is how After
 *     Effects, Premiere and every serious web exporter work; realtime capture
 *     drifts). But it means the on-screen canvas visibly stutters through
 *     slow-motion playback while encoding. Without a render-state overlay the
 *     user reads a professional deterministic pipeline as a performance
 *     failure.
 *  2. The Play button sat inert while the canvas was obviously animating,
 *     because export drives the canvas directly and the RAF loop is gated off
 *     (isExportingRef). It looked dead rather than busy.
 *
 * DESIGN
 * ─────────────────────────────────────────────────────────────────────────
 * useSyncExternalStore (React 18) — the sanctioned way to read mutable
 * external state without tearing. The snapshot is a frozen object replaced on
 * every publish, so getSnapshot() is referentially stable between publishes
 * and will not loop-render.
 *
 * Frame numbers are parsed out of the existing progress label rather than
 * changing ProgressCallback's signature across ~20 call sites in exportUtils.
 * The labels are ours ("Frame 12/240"), the parse is total and side-effect
 * free, and it is contained to this one function — a deliberate trade of a
 * little string-sniffing for a very small blast radius.
 */

import { useSyncExternalStore } from 'react';
import type { ExportMediaKind } from '../export/types';

export type ExportKind = ExportMediaKind;
export type ExportPhase = 'preparing' | 'rendering' | 'encoding' | 'saving' | 'cancelling' | 'complete';

export interface ExportStatus {
  /** True from the moment an export starts until its finally block runs. */
  active: boolean;
  /** Video exports get the full canvas render-state overlay; images do not. */
  kind: ExportKind;
  /** 0–100. */
  percent: number;
  /** Raw human-readable status from the export pipeline. */
  label: string;
  /** Current frame index (1-based), or 0 when not in a frame loop. */
  frame: number;
  /** Total frames in this export, or 0 when unknown. */
  totalFrames: number;
  phase: ExportPhase;
  /** True while the active export exposes a safe cancellation hook. */
  canCancel: boolean;
}

const IDLE: ExportStatus = Object.freeze({
  active: false,
  kind: 'video' as ExportKind,
  percent: 0,
  label: '',
  frame: 0,
  totalFrames: 0,
  phase: 'preparing' as ExportPhase,
  canCancel: false,
});

let snapshot: ExportStatus = IDLE;
let cancelActiveExport: (() => void) | null = null;
const listeners = new Set<() => void>();

function publish(next: ExportStatus): void {
  snapshot = Object.freeze(next);
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* a subscriber throwing must never break an in-flight export */
    }
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ExportStatus {
  return snapshot;
}

/** Derive frame position + phase from the pipeline's own progress label. */
function readLabel(label: string): { frame: number; totalFrames: number; phase: ExportPhase } {
  const m = /frame\s+(\d+)\s*\/\s*(\d+)/i.exec(label);
  if (m) {
    return { frame: Number(m[1]) || 0, totalFrames: Number(m[2]) || 0, phase: 'rendering' };
  }
  if (/cancelling|canceling/i.test(label)) {
    return { frame: 0, totalFrames: 0, phase: 'cancelling' };
  }
  if (/muxing|encoding|finalizing/i.test(label)) {
    return { frame: 0, totalFrames: 0, phase: 'encoding' };
  }
  // STAGE 2.8.3: 'complete' is its own phase so the overlay can show a real
  // finished state instead of disappearing mid-progress.
  if (/complete/i.test(label)) {
    return { frame: 0, totalFrames: 0, phase: 'complete' };
  }
  if (/saving|muxing/i.test(label)) {
    return { frame: 0, totalFrames: 0, phase: 'saving' };
  }
  return { frame: 0, totalFrames: 0, phase: 'preparing' };
}

/** Called when an export begins. */
export function beginExportStatus(kind: ExportKind, onCancel?: () => void): void {
  cancelActiveExport = onCancel ?? null;
  publish({ ...IDLE, active: true, kind, canCancel: Boolean(onCancel), label: 'Preparing export…' });
}

/** Requests cancellation through the active export's registered controller. */
export function requestExportCancellation(): void {
  if (!snapshot.active || !snapshot.canCancel || !cancelActiveExport) return;
  publish({ ...snapshot, phase: 'cancelling', canCancel: false, label: 'Cancelling export…' });
  cancelActiveExport();
}

/**
 * Called on every progress tick. Retains the last known frame/total while the
 * pipeline emits non-frame labels, so the overlay's counter does not flicker
 * back to zero between frames.
 */
export function updateExportStatus(percent: number, label?: string): void {
  if (!snapshot.active) return;
  const text = label ?? snapshot.label;
  const parsed = readLabel(text);
  publish({
    ...snapshot,
    percent: Math.max(0, Math.min(100, percent)),
    label: text,
    frame: parsed.frame || (parsed.phase === 'rendering' ? snapshot.frame : 0),
    totalFrames: parsed.totalFrames || snapshot.totalFrames,
    phase: parsed.phase,
  });
}

/** Called from the export's finally block. Always safe to call. */
export function endExportStatus(): void {
  cancelActiveExport = null;
  if (!snapshot.active) return;
  publish(IDLE);
}

/** Subscribe a component to live export state. */
export function useExportStatus(): ExportStatus {
  // getServerSnapshot === getSnapshot: this store is client-only and IDLE is a
  // stable frozen reference, so SSR/hydration reads are consistent.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}