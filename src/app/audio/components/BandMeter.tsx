/**
 * audio/components/BandMeter.tsx — Stage 3.0.2a
 *
 * Three VERTICAL bars side by side — the standard EQ read.
 *
 * ── LAYOUT HISTORY, SO THIS DOESN'T OSCILLATE AGAIN ──────────────────────
 * 3.0.1 stacked tall bars in a tall single-column panel. 3.0.2 over-corrected
 * to horizontal rows, which fixed the height but lost the at-a-glance
 * comparison between bands that a meter exists to give. The stable answer is
 * vertical bars arranged HORIZONTALLY in a narrow column: compact in height,
 * and the three levels sit adjacent so their relative movement is readable
 * without comparing numbers.
 *
 * ── NO OWN SUBSCRIPTION ──────────────────────────────────────────────────
 * State arrives as a prop. Previously this component called the 15Hz polling
 * hook itself while its parent called the same hook — two independent RAF
 * loops doing identical work every tick. The parent reads once and passes down.
 */

export interface BandMeterProps {
  low: number;
  mid: number;
  high: number;
}

const BANDS: Array<{ key: keyof BandMeterProps; label: string }> = [
  { key: 'low', label: 'LOW' },
  { key: 'mid', label: 'MID' },
  { key: 'high', label: 'HIGH' },
];

export function BandMeter(props: BandMeterProps) {
  return (
    <div className="flex items-end gap-1.5">
      {BANDS.map(({ key, label }) => {
        const v = Math.max(0, Math.min(1, props[key]));
        const pct = Math.round(v * 100);
        return (
          <div key={key} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[9px] tabular-nums text-zinc-600">{pct}</span>
            <div className="relative h-16 w-full overflow-hidden rounded-sm bg-zinc-800">
              <div
                className="absolute bottom-0 left-0 w-full bg-blue-500"
                style={{ height: `${pct}%` }}
              />
            </div>
            <span className="text-[8px] font-medium tracking-wider text-zinc-500">
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
