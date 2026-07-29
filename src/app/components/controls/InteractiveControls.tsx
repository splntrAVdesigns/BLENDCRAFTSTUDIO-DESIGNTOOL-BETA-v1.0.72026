import { Move } from 'lucide-react';
import { DisplacementConfig } from '../../types/gradient';

interface InteractiveControlsProps {
  displacement: DisplacementConfig;
  onUpdate: (config: Partial<DisplacementConfig>) => void;
  onClear: () => void;
  onResetWarp?: () => void;
  onFadeWarp?: () => void;
  sensitivity?: number;
  onSensitivityChange?: (value: number) => void;
}

export function InteractiveControls({
  displacement: _d,
  onUpdate: _u,
  onClear: _c,
  onResetWarp: _rw,
  onFadeWarp: _fw,
  sensitivity: _s,
  onSensitivityChange: _sc,
}: InteractiveControlsProps) {
  // Warp Mode disabled for beta — toggle removed from UI.
  // Displacement architecture stays in codebase for future use.
  return (
    // STAGE 3.0.5: moved to TOP-LEFT — it's a passive hint adjusted never, so
    // it belongs out of the way, and this frees the entire bottom edge for the
    // audio panel to run full-width.
    // STAGE 3.0.2: restyled to match the Audio Reactive panel so the canvas
    // overlays read as one system rather than three different design eras.
    // Shared vocabulary: rounded-xl, border-zinc-800, bg-zinc-900/95,
    // backdrop-blur-sm, a bordered header strip with an uppercase section
    // label, and blue (not cyan) as the accent — blue is the app's accent
    // everywhere else, and cyan here was the only holdout.
    <div className="pointer-events-none absolute top-4 left-4 z-30 w-[196px] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/95 shadow-2xl backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Move className="h-3.5 w-3.5 text-blue-400" />
        <span className="text-[11px] font-semibold tracking-wide text-zinc-200">
          Interactive Mode
        </span>
        <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
      </div>
      <div className="space-y-1 p-3">
        <Hint keys="Drag">Pan gradient position</Hint>
        <Hint keys="Shift + drag">Rotate gradient</Hint>
        <Hint keys="Scroll wheel">Zoom in / out</Hint>
      </div>
    </div>
  );
}

function Hint({ keys, children }: { keys: string; children: React.ReactNode }) {
  return (
    <p className="text-[10px] leading-relaxed text-zinc-500">
      <span className="font-medium text-blue-300">{keys}</span>
      <span className="text-zinc-600"> — </span>
      {children}
    </p>
  );
}