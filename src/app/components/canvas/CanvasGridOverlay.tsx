/**
 * components/canvas/CanvasGridOverlay.tsx — Stage 2.9.1
 *
 * Dotted backdrop grid, rendered BEHIND the artwork.
 *
 * ── WHAT CHANGED FROM 2.9.0, AND WHY ──
 *
 * 1. DOTS, NOT LINES. A ruled grid is loud: at any useful opacity the lines
 *    compete with the work for attention, which is the opposite of what a
 *    reference should do. Plotting only the INTERSECTIONS carries the same
 *    positional information with a fraction of the ink — the eye reconstructs
 *    the lines without them being drawn.
 *
 * 2. BEHIND THE CANVAS, NOT OVER IT. Previously this sat above the artwork at
 *    z-20, so every dot was ink ON the composition. It's now a BACKDROP: it
 *    fills the workspace and the canvas paints on top, so the grid reads as the
 *    surface the artwork sits on and cannot visually contaminate the work.
 *    (Export was already safe — the grid was never in the framebuffer — but
 *    "can't leak into the export" and "doesn't sit on the art" are different
 *    problems, and 2.9.0 only solved the first.)
 *
 * 3. FULL COVERAGE — the real bug. The SVG was positioned by measuring the
 *    canvas rect relative to `canvas.parentElement`, but the overlay renders
 *    inside `main`. Two different origins, so the offsets were wrong: the grid
 *    ran off the top-left and stopped short of the bottom-right. Now the SVG
 *    fills its container with `inset-0` and the canvas is measured against the
 *    SVG's OWN box, so the two cannot disagree. Coverage became structural
 *    instead of arithmetic.
 *
 * Spacing still derives from the canvas divisions and the pattern is ANCHORED
 * to the canvas origin, so dots land on the artwork's own division points and
 * continue outward past its edges.
 */

import { useEffect, useRef, useState } from 'react';
import { useCanvasGrid, MINOR_SUBDIVISIONS } from './useCanvasGrid';

interface CanvasGridOverlayProps {
  canvasWidth: number;
  canvasHeight: number;
  /** Live WebGL canvas — used only to derive cell size and phase. */
  getCanvas?: () => HTMLCanvasElement | null;
}

interface Metrics {
  /** Canvas top-left relative to this overlay's own box. */
  originX: number;
  originY: number;
  cellW: number;
  cellH: number;
}

export function CanvasGridOverlay({ canvasWidth, canvasHeight, getCanvas }: CanvasGridOverlayProps) {
  const { enabled, divisions, rows, opacity, showMinor } = useCanvasGrid(canvasWidth, canvasHeight);
  const hostRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    if (!enabled) { setMetrics(null); return; }

    let raf = 0;
    let observer: ResizeObserver | null = null;

    const measure = () => {
      const host = hostRef.current;
      const canvas = getCanvas?.() ?? null;
      if (!host || !canvas) return;
      const h = host.getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      if (c.width < 2 || c.height < 2) return;

      // Measured against the OVERLAY's own box — the origin the SVG actually
      // draws in. This is the fix for the coverage bug.
      const next: Metrics = {
        originX: c.left - h.left,
        originY: c.top - h.top,
        cellW: c.width / divisions,
        cellH: c.height / rows,
      };
      setMetrics((prev) => {
        if (prev &&
            Math.abs(prev.originX - next.originX) < 0.5 &&
            Math.abs(prev.originY - next.originY) < 0.5 &&
            Math.abs(prev.cellW - next.cellW) < 0.25 &&
            Math.abs(prev.cellH - next.cellH) < 0.25) {
          return prev; // ignore sub-pixel jitter so measuring can't loop
        }
        return next;
      });
    };

    raf = requestAnimationFrame(measure);

    const canvas = getCanvas?.() ?? null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      if (canvas) observer.observe(canvas);
      if (hostRef.current) observer.observe(hostRef.current);
    }
    window.addEventListener('resize', measure);

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [enabled, getCanvas, divisions, rows, canvasWidth, canvasHeight]);

  if (!enabled) return null;

  const m = metrics;
  const cellW = m?.cellW ?? 60;
  const cellH = m?.cellH ?? 60;

  // Pattern phase: SVG tiles from the pattern origin, so shifting by the canvas
  // offset (mod cell size) makes dots land exactly on the artwork's division
  // points and continue outward from there.
  const phaseX = m ? ((m.originX % cellW) + cellW) % cellW : 0;
  const phaseY = m ? ((m.originY % cellH) + cellH) % cellH : 0;

  const minorW = cellW / MINOR_SUBDIVISIONS;
  const minorH = cellH / MINOR_SUBDIVISIONS;

  // Radii scale gently with cell size so a dense grid doesn't smear and a
  // sparse one doesn't vanish.
  const majorR = Math.max(0.9, Math.min(1.8, Math.min(cellW, cellH) * 0.022));
  const minorR = Math.max(0.6, majorR * 0.62);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      // zIndex 0, with the canvas wrapper raised above it: the grid is the
      // surface, the artwork sits on it.
      style={{ zIndex: 0 }}
    >
      <svg className="h-full w-full" width="100%" height="100%">
        <defs>
          {showMinor && (
            <pattern
              id="bc-grid-minor"
              width={minorW}
              height={minorH}
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${phaseX % minorW}, ${phaseY % minorH})`}
            >
              <circle cx={0} cy={0} r={minorR} fill="#ffffff" opacity={opacity * 0.35} />
              <circle cx={minorW} cy={0} r={minorR} fill="#ffffff" opacity={opacity * 0.35} />
              <circle cx={0} cy={minorH} r={minorR} fill="#ffffff" opacity={opacity * 0.35} />
              <circle cx={minorW} cy={minorH} r={minorR} fill="#ffffff" opacity={opacity * 0.35} />
            </pattern>
          )}
          <pattern
            id="bc-grid-major"
            width={cellW}
            height={cellH}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${phaseX}, ${phaseY})`}
          >
            {/* All four corners so the tile stays seamless at any phase. */}
            <circle cx={0} cy={0} r={majorR} fill="#ffffff" opacity={opacity} />
            <circle cx={cellW} cy={0} r={majorR} fill="#ffffff" opacity={opacity} />
            <circle cx={0} cy={cellH} r={majorR} fill="#ffffff" opacity={opacity} />
            <circle cx={cellW} cy={cellH} r={majorR} fill="#ffffff" opacity={opacity} />
          </pattern>
        </defs>

        {/* Full-bleed fills — the pattern tiles the whole workspace, so coverage
            no longer depends on getting an offset right. */}
        {showMinor && <rect x={0} y={0} width="100%" height="100%" fill="url(#bc-grid-minor)" />}
        <rect x={0} y={0} width="100%" height="100%" fill="url(#bc-grid-major)" />
      </svg>
    </div>
  );
}