/**
 * components/canvas/CanvasGridControls.tsx — Stage 2.9.0
 *
 * Floating grid sliders, shown at the bottom of the canvas while the grid is on.
 * Matches the interactive-controls pattern: a compact bar over the artwork
 * rather than a sidebar panel, so adjusting the grid never costs a tab switch
 * away from what you're looking at.
 *
 * Self-gating — returns null when the grid is off.
 */

import { Grid3x3, X } from 'lucide-react';
import {
  useCanvasGrid,
  setGridOpacity,
  setGridShowMinor,
  setGridEnabled,
} from './useCanvasGrid';

interface CanvasGridControlsProps {
  canvasWidth: number;
  canvasHeight: number;
}

export function CanvasGridControls({ canvasWidth, canvasHeight }: CanvasGridControlsProps) {
  const { enabled, divisions, rows, opacity, showMinor, options, setDivisionsSnapped } =
    useCanvasGrid(canvasWidth, canvasHeight);

  if (!enabled) return null;

  // Slider moves through the LEGAL options by index rather than by raw number.
  // Dragging can therefore never land on a division that would produce sliver
  // cells — the constraint lives in the control, not in a validation step after.
  const index = Math.max(0, options.indexOf(divisions));

  // STAGE 3.0.2a: TOP-RIGHT. (3.0.2 moved it bottom-centre → top-left; the
  // audio panel then grew wider and top-left sits directly above it.) The
  // wide bottom-left element, and two floating bars sharing the bottom edge
  // crowded each other. Grid is a setup control adjusted rarely, so it yields
  // the prime bottom real estate to the panel that's used continuously.
  return (
    <div className="pointer-events-auto absolute top-4 right-4 z-30">
      <div className="flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/95 px-3 py-2 shadow-xl backdrop-blur-sm">
        <div className="flex items-center gap-1.5 text-zinc-400">
          <Grid3x3 className="h-3.5 w-3.5" />
          <span className="text-[11px] font-medium">Grid</span>
        </div>

        {/* Size — labelled by the resulting cell count, which is what the user
            actually sees on the canvas. */}
        <label className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-500">Size</span>
          <input
            type="range"
            min={0}
            max={Math.max(0, options.length - 1)}
            step={1}
            value={index}
            onChange={(e) => setDivisionsSnapped(options[Number(e.target.value)] ?? divisions)}
            className="h-1 w-28 cursor-pointer appearance-none rounded-full bg-zinc-700 accent-blue-500"
            aria-label="Grid size"
          />
          <span className="w-14 text-right text-[11px] tabular-nums text-zinc-400">
            {divisions}×{rows}
          </span>
        </label>

        <label className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-500">Opacity</span>
          <input
            type="range"
            min={2}
            max={100}
            step={1}
            value={Math.round(opacity * 100)}
            onChange={(e) => setGridOpacity(Number(e.target.value) / 100)}
            className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-zinc-700 accent-blue-500"
            aria-label="Grid opacity"
          />
          <span className="w-9 text-right text-[11px] tabular-nums text-zinc-400">
            {Math.round(opacity * 100)}%
          </span>
        </label>

        <button
          type="button"
          onClick={() => setGridShowMinor(!showMinor)}
          className={`rounded px-2 py-1 text-[11px] transition-colors ${
            showMinor ? 'bg-blue-500/20 text-blue-300' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
          }`}
          title="Toggle minor subdivision lines"
        >
          Subdiv
        </button>

        <button
          type="button"
          onClick={() => setGridEnabled(false)}
          className="rounded p-1 text-zinc-500 transition-colors hover:text-zinc-300"
          title="Hide grid"
          aria-label="Hide grid"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}