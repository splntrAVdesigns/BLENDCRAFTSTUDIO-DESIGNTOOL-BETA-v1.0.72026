/**
 * audio/components/TimingControls.tsx — Stage 3.0.4
 *
 * The beat + LFO block for the Precision & Specialty column: the timing tools
 * that make routing feel musical rather than twitchy.
 *
 * Beat and LFO are already SOURCES in the routing dropdown (see audioMapping),
 * so this panel is about tuning and confirming them — it doesn't wire anything
 * itself. That reuse is the whole point of adding them as sources: everything
 * 3.0.3 built (curves, envelopes, targets, per-layer scope) applies unchanged.
 *
 * ── SPRINT 2.9 LAYOUT ─────────────────────────────────────────────────────
 * Every control here is stacked (label above, control below) instead of
 * label-left/control-right — that's what lets BPM, LFO, and Mapping each
 * get their own narrower column in AudioReactivePanel.tsx without anything
 * getting squeezed. Sprint 2.8 pulled the phase meters into one shared row
 * spanning two of the three columns, which fixed vertical alignment but
 * added a whole extra row of height and left the third column short — the
 * actual complaint. That shared row is gone: each meter is back under its
 * own section's header line, and they land in the same visual row because
 * both sit at the same consistent first position in same-height columns,
 * not because they're one shared component.
 */

import { useEffect, useState } from 'react';
import { getBeatInfo, getBeatPhase, tapTempo, clearTap } from '../beatDetection';
import { useBeatClock, setBeatClockEnabled, isBeatClockActive } from '../beatClock';
import { useLFOConfig, updateLFO, getLFOPhase } from '../lfoEngine';
import { WAVEFORM_SHAPES } from '../waveformShapes';
import { PhaseIndicator } from './PhaseIndicator';

export function BeatControls() {
  const beatClock = useBeatClock();
  const [beat, setBeat] = useState(() => getBeatInfo());
  const [beatPhase, setBeatPhase] = useState(0);
  const [clockActive, setClockActive] = useState(false);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last >= 50) {
        last = t;
        setBeat(getBeatInfo());
        setBeatPhase(getBeatPhase());
        setClockActive(isBeatClockActive());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleTap = () => {
    tapTempo(performance.now());
    setBeat(getBeatInfo());
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">BPM</span>
        <span className="text-[9px] tabular-nums text-zinc-500">
          {beat.bpm} bpm
          <span className={`ml-1 ${beat.confidence > 0.6 ? 'text-blue-400' : 'text-zinc-600'}`}>
            {beat.usingTap ? '· tap' : beat.confidence > 0.6 ? '· lock' : '· …'}
          </span>
        </span>
      </div>
      <PhaseIndicator phase={beatPhase} active={beat.confidence > 0.3 || beat.usingTap} />
      <button
        type="button"
        onClick={handleTap}
        className="w-full rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
      >
        Tap tempo
      </button>
      {beat.usingTap && (
        <button
          type="button"
          onClick={() => { clearTap(); setBeat(getBeatInfo()); }}
          className="w-full rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-500 transition-colors hover:text-zinc-300"
          title="Hand tempo back to auto-detection"
        >
          Auto
        </button>
      )}
      {/* STAGE 3.0.6: drive the animation clock from the beat. */}
      <button
        type="button"
        onClick={() => setBeatClockEnabled(!beatClock.enabled)}
        className={`flex w-full items-center justify-between rounded px-1.5 py-1 text-[9px] transition-colors ${
          beatClock.enabled ? 'bg-blue-500/15 text-blue-300' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
        }`}
        title="Drive the animation clock from the detected beat. Speed becomes a half/double-time ratio. Falls back to normal when the beat isn't confident."
        aria-pressed={beatClock.enabled}
      >
        <span>Sync anim</span>
        <span className={`h-2.5 w-2.5 rounded-sm border ${
          beatClock.enabled ? 'border-blue-400 bg-blue-400' : 'border-zinc-600'
        }`} />
      </button>
      {beatClock.enabled && (
        <p className={`text-[8px] leading-tight ${clockActive ? 'text-blue-400' : 'text-zinc-600'}`}>
          {clockActive ? 'Beat is driving Speed' : 'Waiting for confident beat…'}
        </p>
      )}
    </div>
  );
}

export function LFOControls() {
  const lfo = useLFOConfig();
  const [lfoPhase, setLfoPhase] = useState(0);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last >= 50) {
        last = t;
        setLfoPhase(getLFOPhase());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">LFO</span>
        <button
          type="button"
          onClick={() => updateLFO({ enabled: !lfo.enabled })}
          className={`h-3 w-3 rounded-sm border transition-colors ${
            lfo.enabled ? 'border-blue-500 bg-blue-500' : 'border-zinc-600'
          }`}
          title={lfo.enabled ? 'Disable LFO' : 'Enable LFO'}
          aria-pressed={lfo.enabled}
        />
      </div>
      <PhaseIndicator phase={lfoPhase} active={lfo.enabled} />

      <div className="space-y-0.5">
        <span className="text-[9px] text-zinc-500">Shape</span>
        <select
          value={lfo.shape}
          onChange={(e) => updateLFO({ shape: e.target.value as never })}
          className="w-full rounded bg-zinc-800 px-1.5 py-1 text-[10px] text-zinc-300 outline-none"
        >
          {WAVEFORM_SHAPES.map((w) => (
            <option key={w.id} value={w.id}>{w.label}</option>
          ))}
        </select>
      </div>

      <div className="space-y-0.5">
        <span className="text-[9px] text-zinc-500">Sync</span>
        <select
          value={lfo.syncMode}
          onChange={(e) => updateLFO({ syncMode: e.target.value as never })}
          className="w-full rounded bg-zinc-800 px-1.5 py-1 text-[10px] text-zinc-300 outline-none"
        >
          <option value="bpm">BPM-locked</option>
          <option value="free">Free (Hz)</option>
          <option value="exportLocked">Export-locked</option>
        </select>
      </div>

      {lfo.syncMode === 'bpm' && (
        <RateRow label="Per beat" value={lfo.bpmMultiplier}
          min={0.25} max={4} step={0.25}
          format={(v) => `${v}×`}
          onChange={(v) => updateLFO({ bpmMultiplier: v })} />
      )}
      {lfo.syncMode === 'free' && (
        <RateRow label="Rate" value={lfo.rateHz}
          min={0.05} max={8} step={0.05}
          format={(v) => `${v.toFixed(2)}Hz`}
          onChange={(v) => updateLFO({ rateHz: v })} />
      )}
      {lfo.syncMode === 'exportLocked' && (
        <RateRow label="Cycles" value={lfo.cyclesPerExport}
          min={1} max={32} step={1}
          format={(v) => `${v}`}
          onChange={(v) => updateLFO({ cyclesPerExport: v })} />
      )}
    </div>
  );
}

function RateRow({
  label, value, min, max, step, format, onChange,
}: {
  label: string;
  value: number;
  min: number; max: number; step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-zinc-500">{label}</span>
        <span className="text-[9px] tabular-nums text-zinc-600">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-zinc-700 accent-blue-500"
      />
    </div>
  );
}
