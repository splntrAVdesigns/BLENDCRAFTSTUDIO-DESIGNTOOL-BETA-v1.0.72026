/**
 * audio/components/PhaseIndicator.tsx — Stage 3.0.4
 *
 * One component, two consumers: the beat indicator and the LFO meter. Both are
 * the same UI problem — show a cyclical 0→1 phase, live — so building it once
 * keeps them visually identical and halves the surface to maintain.
 *
 * Blue linear bar, as chosen. The fill traces the current phase; a thin marker
 * rides the leading edge so a fast cycle still reads as motion rather than a
 * blur.
 */

interface PhaseIndicatorProps {
  /** 0–1 position in the cycle. */
  phase: number;
  /** Optional label shown left of the bar. */
  label?: string;
  /** Optional right-aligned readout (e.g. BPM). */
  readout?: string;
  /** Dimmed when the source isn't active. */
  active?: boolean;
}

export function PhaseIndicator({ phase, label, readout, active = true }: PhaseIndicatorProps) {
  const pct = Math.max(0, Math.min(100, phase * 100));
  return (
    <div className="flex items-center gap-2">
      {label && <span className="w-10 flex-shrink-0 text-[9px] text-zinc-500">{label}</span>}
      <div className={`relative h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800 ${active ? '' : 'opacity-40'}`} style={{ maxWidth: 132 }}>
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-blue-500"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-0 h-full w-0.5 bg-blue-200"
          style={{ left: `${pct}%` }}
        />
      </div>
      {readout && (
        <span className="w-10 flex-shrink-0 text-right text-[9px] tabular-nums text-zinc-500">
          {readout}
        </span>
      )}
    </div>
  );
}
