/**
 * components/canvas/useCanvasGrid.ts — Stage 2.9.0
 *
 * Canvas grid state + division math.
 *
 * SCOPE DECISION: the grid is a GLOBAL VIEW PREFERENCE, not document state.
 * A grid describes how you're *looking* at the work, not the work itself — the
 * same reason Tooltips and Interactive live in the header rather than in the
 * layer stack. Concretely this means it stays out of SessionDocument entirely:
 * saving a slot or exporting a .blendcraft never records a grid, and loading
 * someone else's session never changes your view settings. It also means the
 * session schema doesn't grow a field that would need migrating forever.
 *
 * Persisted to localStorage under its own key, deliberately NOT via
 * useGradientState's STORAGE_KEYS — those are document keys, and Dismiss
 * ("start a fresh session") clears them. Wiping your grid preference because
 * you discarded an unsaved document would be wrong.
 */

import { useSyncExternalStore, useCallback, useMemo } from 'react';

const STORAGE_KEY = 'blendcraft-canvas-grid-v1';

export interface CanvasGridState {
  enabled: boolean;
  /** Number of columns across the canvas. Cell size derives from this. */
  divisions: number;
  /** 0–1. Does all the visual-weight work; the colour is fixed. */
  opacity: number;
  /** Minor subdivision lines between major cells. */
  showMinor: boolean;
}

const DEFAULTS: CanvasGridState = {
  enabled: false,
  divisions: 16,
  opacity: 0.25,
  showMinor: true,
};

/** Minor lines per major cell. 2 = one line through the middle of each cell. */
export const MINOR_SUBDIVISIONS = 2;

function load(): CanvasGridState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULTS.enabled,
      divisions: Number.isFinite(parsed.divisions) ? parsed.divisions : DEFAULTS.divisions,
      opacity: Number.isFinite(parsed.opacity)
        ? Math.max(0.02, Math.min(1, parsed.opacity))
        : DEFAULTS.opacity,
      showMinor: typeof parsed.showMinor === 'boolean' ? parsed.showMinor : DEFAULTS.showMinor,
    };
  } catch {
    return DEFAULTS;
  }
}

let snapshot: CanvasGridState = load();
const listeners = new Set<() => void>();

function publish(next: CanvasGridState): void {
  snapshot = Object.freeze(next);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* private mode */ }
  listeners.forEach((l) => { try { l(); } catch { /* a subscriber must not break others */ } });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const getSnapshot = () => snapshot;

export function setGridEnabled(enabled: boolean): void { publish({ ...snapshot, enabled }); }
export function setGridDivisions(divisions: number): void { publish({ ...snapshot, divisions }); }
export function setGridOpacity(opacity: number): void {
  publish({ ...snapshot, opacity: Math.max(0.02, Math.min(1, opacity)) });
}
export function setGridShowMinor(showMinor: boolean): void { publish({ ...snapshot, showMinor }); }
export function toggleGrid(): void { publish({ ...snapshot, enabled: !snapshot.enabled }); }

/** Raw state subscription (header toggle, overlay, controls). */
export function useCanvasGridState(): CanvasGridState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ─────────────────────────────────────────────────────────────────────────
// DIVISION MATH
// ─────────────────────────────────────────────────────────────────────────

function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b));
  while (b) { const t = b; b = a % b; a = t; }
  return a || 1;
}

function divisorsOf(n: number): number[] {
  const out: number[] = [];
  for (let i = 1; i * i <= n; i++) {
    if (n % i === 0) {
      out.push(i);
      if (i !== n / i) out.push(n / i);
    }
  }
  return out.sort((a, b) => a - b);
}

/**
 * Column counts that produce SQUARE cells with no sliver row or column.
 *
 * The requirement is stricter than "divides the width": for cells to be square
 * AND tile both axes exactly, the CELL SIZE must be a common divisor of width
 * and height. 1920×1080 has gcd 120, so cell sizes 120/60/40/24… give
 * 16/32/48/80 columns — all clean, all square. Column counts are what the user
 * sees; cell size is what the math actually picks.
 *
 * FALLBACK, stated honestly: resolutions with a small gcd (a 1337×900 custom
 * canvas has gcd 1) admit no clean common divisor. Rather than refuse to draw a
 * grid, we fall back to a fixed column ladder and allow a partial final row —
 * the overlay is clipped to the canvas, so it reads as a cropped cell rather
 * than a rendering error. Square, clean grids are the common case because
 * standard resolutions have large gcds; the fallback exists so custom sizes
 * still get a usable reference.
 */
export function computeDivisionOptions(width: number, height: number): number[] {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  const common = divisorsOf(gcd(w, h));
  const clean = common
    .map((cell) => w / cell)          // cell size → column count
    .filter((cols) => Number.isInteger(cols) && cols >= 4 && cols <= 64)
    .sort((a, b) => a - b);

  const unique = Array.from(new Set(clean));
  if (unique.length >= 3) return unique;

  // Fallback ladder — partial final row/column is possible and is clipped.
  return [8, 12, 16, 24, 32, 48];
}

/**
 * Snap a desired column count to the nearest available option.
 *
 * Used on resolution change so the grid RESIZES rather than resetting: your
 * visual reference survives switching canvas size, landing on the closest legal
 * division instead of jumping back to a default.
 */
export function snapDivisions(desired: number, options: number[]): number {
  if (options.length === 0) return desired;
  return options.reduce((best, opt) =>
    Math.abs(opt - desired) < Math.abs(best - desired) ? opt : best, options[0]);
}

/** Everything the overlay and controls need for the current canvas size. */
export function useCanvasGrid(canvasWidth: number, canvasHeight: number) {
  const state = useCanvasGridState();

  const options = useMemo(
    () => computeDivisionOptions(canvasWidth, canvasHeight),
    [canvasWidth, canvasHeight],
  );

  // Snapped, not reset — see snapDivisions.
  const divisions = useMemo(
    () => snapDivisions(state.divisions, options),
    [state.divisions, options],
  );

  const rows = useMemo(() => {
    const cell = canvasWidth / divisions;
    return Math.max(1, Math.round(canvasHeight / cell));
  }, [canvasWidth, canvasHeight, divisions]);

  const setDivisionsSnapped = useCallback((next: number) => {
    setGridDivisions(snapDivisions(next, options));
  }, [options]);

  return { ...state, divisions, rows, options, setDivisionsSnapped };
}