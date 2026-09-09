/**
 * audio/components/AudioReactivePanel.tsx — Stage 3.0.2a
 *
 * Bottom-left canvas panel, FOUR columns:
 *   Source · Levels · Routing · Precision & Specialty
 *
 * ── WHY FOUR ─────────────────────────────────────────────────────────────
 * 3.0.2's three columns plus a full-width "Precision & Specialty" strip
 * underneath is what made the panel tall — the strip was a caption spanning
 * the whole width to say one sentence. Promoting it to a real column removes
 * the strip, uses horizontal space that was already there, and means 3.0.3's
 * beat/LFO controls land in a reserved home instead of forcing another layout
 * pass.
 *
 * Routing rows also gained a third picker (layer scope), so the panel is wider
 * and each row lays out on an explicit grid — 3.0.2's flex row let the sliders
 * be pushed off the right edge once the selects took their natural width.
 *
 * ── ONE SUBSCRIPTION ─────────────────────────────────────────────────────
 * This component polls the audio bus once at 15Hz and passes the values to
 * BandMeter. Both used to poll independently, which meant two RAF loops doing
 * the same work.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Play, Pause, Square, X, Music } from 'lucide-react';
import {
  loadAudioFile,
  playAudio,
  pauseAudio,
  stopPlayback,
  getAudioSourceInfo,
} from '../audioEngine';
import { setAudioReactiveEnabled, notifyPanelMounted } from '../audioReactiveState';
import { useAudioUIState } from '../audioUIState';
import {
  useAudioMappings,
  updateMapping,
  AUDIO_SOURCES,
  AUDIO_TARGETS,
  ALL_LAYERS,
  type AudioMapping,
} from '../audioMapping';
import { useLayerRoster } from '../audioLayerRoster';
import { requestMasterPlay } from '../audioTransport';
import { syncGatedEffectForTarget, syncGatedEffectAfterRouteChange } from '../audioEffectsGateSync';
import { BandMeter } from './BandMeter';
import { BeatControls, LFOControls } from './TimingControls';

interface AudioReactivePanelProps {
  /** Master transport state, so play can sync without toggling it off. */
  isPlaying: boolean;
}

export function AudioReactivePanel({ isPlaying }: AudioReactivePanelProps) {
  const ui = useAudioUIState();
  const mappings = useAudioMappings();
  const roster = useLayerRoster();
  const [fileName, setFileName] = useState<string | null>(
    () => getAudioSourceInfo()?.fileName ?? null,
  );
  const [dragOver, setDragOver] = useState(false);
  // Which mapping the Precision column edits. Defaults to the first, so the
  // column is never empty and the controls always have a subject.
  const [selectedId, setSelectedId] = useState<string>(() => mappings[0]?.id ?? 'm1');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    notifyPanelMounted(true);
    return () => notifyPanelMounted(false);
  }, []);

  const selected = mappings.find((m) => m.id === selectedId) ?? mappings[0] ?? null;
  const selectedTarget = selected ? AUDIO_TARGETS.find((t) => t.id === selected.target) : undefined;
  const audioPlaying = ui.status === 'playing';
  const hasSource = fileName !== null && (ui.status === 'ready' || ui.status === 'playing');

  // Load only. The click/drop that delivered the file is the gesture that
  // unlocks the AudioContext; starting playback is a separate, explicit act.
  const handleFile = useCallback(async (file: File) => {
    const info = await loadAudioFile(file);
    if (info) setFileName(info.fileName);
  }, []);

  const handlePlayPause = useCallback(() => {
    if (audioPlaying) {
      pauseAudio();
      return;
    }
    void playAudio();
    // Start the canvas too — audio against a paused canvas drives nothing.
    requestMasterPlay(isPlaying);
  }, [audioPlaying, isPlaying]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }, [handleFile]);

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-30 w-[1440px] max-w-[calc(100%-2rem)]">
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/95 shadow-2xl backdrop-blur-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
          <div className="flex items-center gap-2">
            <Music className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-[11px] font-semibold tracking-wide text-zinc-200">
              Audio Reactive
            </span>
            {hasSource && (
              <span className="flex items-center gap-1.5 pl-1">
                <span className={`h-1.5 w-1.5 rounded-full ${ui.active ? 'animate-pulse bg-blue-400' : 'bg-zinc-600'}`} />
                <span className="text-[9px] text-zinc-500">{ui.active ? 'analyzing' : ui.status}</span>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setAudioReactiveEnabled(false)}
            className="rounded p-1 text-zinc-500 transition-colors hover:text-zinc-300"
            title="Hide panel (audio keeps playing)"
            aria-label="Hide audio panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Four columns. Explicit widths so the routing sliders can't be
            squeezed off the edge as they were in 3.0.2. */}
        <div className="grid grid-cols-[168px_100px_minmax(0,440px)_minmax(0,1fr)] divide-x divide-zinc-800">
          {/* ── SOURCE ── */}
          <div className="space-y-2 px-3 py-2.5">
            <SectionLabel>Source</SectionLabel>
            {!hasSource ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={`flex w-full flex-col items-center gap-1 rounded-lg border border-dashed px-2 py-3 text-center transition-colors ${
                  dragOver ? 'border-blue-500/60 bg-blue-500/10' : 'border-zinc-700 hover:border-zinc-600'
                }`}
              >
                <Upload className="h-3.5 w-3.5 text-zinc-500" />
                <span className="text-[10px] text-zinc-400">Drop audio or click</span>
                <span className="text-[9px] text-zinc-600">MP3 · WAV · OGG · M4A</span>
              </button>
            ) : (
              <>
                <div className="flex items-center gap-1.5 rounded-md bg-zinc-800/60 px-2 py-1.5">
                  <Music className="h-3 w-3 flex-shrink-0 text-blue-400" />
                  <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-300" title={fileName ?? ''}>
                    {fileName}
                  </span>
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="flex-shrink-0 text-[9px] text-zinc-500 transition-colors hover:text-zinc-300"
                  >
                    Replace
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <TransportButton onClick={handlePlayPause} title={audioPlaying ? 'Pause' : 'Play (also starts canvas)'}>
                    {audioPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </TransportButton>
                  <TransportButton onClick={() => stopPlayback()} title="Stop">
                    <Square className="h-3 w-3" />
                  </TransportButton>
                </div>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = '';
              }}
            />
          </div>

          {/* ── LEVELS ── */}
          <div className="space-y-2 px-3 py-2.5">
            <SectionLabel>Levels</SectionLabel>
            <BandMeter low={ui.low} mid={ui.mid} high={ui.high} />
          </div>

          {/* ── ROUTING ── */}
          <div className="min-w-0 space-y-2 px-3 py-2.5">
            {/* STAGE 3.0.5a: the per-target info line moved up here, right of the
                header, so it no longer adds a row at the bottom that pushed the
                panel taller. Shows the SELECTED mapping's target hint. */}
            <div className="flex items-baseline justify-between gap-2">
              <SectionLabel>Routing</SectionLabel>
              {selectedTarget?.hint && (
                <span className="truncate text-[9px] leading-none text-zinc-600" title={selectedTarget.hint}>
                  {selectedTarget.hint}
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {mappings.map((m) => {
                const target = AUDIO_TARGETS.find((t) => t.id === m.target);
                // A stored layerId can outlive its layer. Flag it rather than
                // silently repointing the user's routing somewhere else.
                const dangling =
                  m.layerId !== ALL_LAYERS && !roster.some((r) => r.id === m.layerId);
                // Post-processing targets act on the composited frame, so a
                // layer scope would be a promise the pipeline can't keep.
                const isGlobal = !!target?.global;
                return (
                  <div
                    key={m.id}
                    onPointerDown={() => setSelectedId(m.id)}
                    className={`grid grid-cols-[14px_minmax(0,62px)_10px_minmax(0,84px)_minmax(0,96px)_minmax(56px,1fr)] items-center gap-1 rounded px-1 py-0.5 transition-colors ${
                      selectedId === m.id ? 'bg-blue-500/10' : 'hover:bg-zinc-800/40'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        const nowEnabled = !m.enabled;
                        updateMapping(m.id, { enabled: nowEnabled });
                        if (nowEnabled) {
                          // Re-enabling a mapping that already targets a
                          // gated effect syncs the toggle on — not just
                          // picking a new target (below).
                          syncGatedEffectForTarget(m.target);
                        } else {
                          // Sprint 2.7: disabling a mapping that targets a
                          // gated effect syncs the toggle back off, unless
                          // some OTHER enabled mapping still covers it.
                          syncGatedEffectAfterRouteChange(
                            m.target,
                            mappings.map((mm) => (mm.id === m.id ? { ...mm, enabled: false } : mm))
                          );
                        }
                      }}
                      className={`h-3 w-3 rounded-sm border transition-colors ${
                        m.enabled ? 'border-blue-500 bg-blue-500' : 'border-zinc-600 bg-transparent'
                      }`}
                      title={m.enabled ? 'Disable' : 'Enable'}
                      aria-pressed={m.enabled}
                    />
                    <Picker
                      value={m.source}
                      onChange={(v) => updateMapping(m.id, { source: v as never })}
                      options={AUDIO_SOURCES.map((s) => ({ value: s.id, label: s.label }))}
                    />
                    <span className="text-center text-[10px] text-zinc-600">→</span>
                    <Picker
                      value={m.target}
                      onChange={(v) => {
                        const previousTarget = m.target;
                        updateMapping(m.id, { target: v as never });
                        // Option A: selecting a gated target auto-enables
                        // its effect toggle — audio modulates, the user
                        // shouldn't also have to flip a second switch.
                        syncGatedEffectForTarget(v);
                        // Sprint 2.7: and moving AWAY from a gated target
                        // syncs the old one's toggle back off, unless some
                        // OTHER enabled mapping still targets it.
                        syncGatedEffectAfterRouteChange(
                          previousTarget,
                          mappings.map((mm) => (mm.id === m.id ? { ...mm, target: v } : mm))
                        );
                      }}
                      options={AUDIO_TARGETS.map((t) => ({ value: t.id, label: t.label }))}
                      title={target?.hint}
                    />
                    <Picker
                      value={isGlobal ? ALL_LAYERS : m.layerId}
                      onChange={(v) => updateMapping(m.id, { layerId: v })}
                      options={
                        isGlobal
                          ? [{ value: ALL_LAYERS, label: 'Whole frame' }]
                          : [
                              { value: ALL_LAYERS, label: 'All Layers' },
                              ...roster.map((r) => ({ value: r.id, label: r.name })),
                            ]
                      }
                      disabled={isGlobal}
                      title={
                        isGlobal
                          ? 'Post-processing — applies to the composited frame, not one layer'
                          : dangling ? 'This layer no longer exists' : 'Which layer this drives'
                      }
                      danger={dangling && !isGlobal}
                    />
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(m.amount * 100)}
                      onChange={(e) => updateMapping(m.id, { amount: Number(e.target.value) / 100 })}
                      className="h-1 w-full cursor-pointer appearance-none rounded-full bg-zinc-700 accent-blue-500"
                      title={`Amount ${Math.round(m.amount * 100)}%`}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── PRECISION & SPECIALTY — two sub-columns, no scroll ──
              STAGE 3.0.4a: 3.0.4 stacked Timing above Selected-Mapping and
              scrolled, which forced the whole panel tall. The panel has width
              to spare, so the two go SIDE BY SIDE instead: Beat/LFO on the
              left, the selected mapping's controls on the right. Height drops
              back to the 3.0.3 profile. */}
          {/* ── PRECISION & SPECIALTY — three sub-columns, no scroll ──
              STAGE 3.0.5: Beat | LFO | Selected Mapping, side by side. 3.0.4a
              stacked Beat above LFO in one sub-column, which was the last thing
              forcing height. Three flat columns keep the panel slim. */}
          <div className="px-3 py-2.5">
            <SectionLabel>Precision &amp; Specialty</SectionLabel>
            <div className="mt-2 grid grid-cols-[0.55fr_1fr_1fr] gap-x-3 divide-x divide-zinc-800">
              <div className="pr-1">
                <BeatControls />
              </div>
              <div className="pl-3 pr-1">
                <LFOControls />
              </div>
              <div className="pl-3">
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                  Selected mapping
                </div>
                {selected ? (
                  <PrecisionControls mapping={selected} />
                ) : (
                  <p className="text-[10px] text-zinc-600">Select a routing row to tune it.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
      {children}
    </div>
  );
}

function Picker({
  value, onChange, options, title, danger, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  title?: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={title}
      disabled={disabled}
      className={`min-w-0 truncate rounded bg-zinc-800 px-1 py-0.5 text-[10px] outline-none ${
        disabled ? 'text-zinc-600' : danger ? 'text-amber-400' : 'text-zinc-300'
      }`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
      {/* Keep a dangling selection visible instead of silently snapping the
          <select> to its first option, which would misreport the config. */}
      {danger && <option value={value}>(missing layer)</option>}
    </select>
  );
}

function TransportButton({
  children, onClick, title,
}: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-800 text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
    >
      {children}
    </button>
  );
}

/**
 * STAGE 3.0.3 — the tuning that makes the new signal usable.
 *
 * These four controls are the difference between "audio changes a number" and
 * "the visual dances". Ordered by how much they change the feel:
 *
 *  CURVE     — Exponential squashes the noise floor and exaggerates peaks; Gate
 *              is hard on/off. Linear is the old behaviour and is usually the
 *              least exciting on real music.
 *  RELEASE   — the single most important control for "breathing". A slow
 *              release turns a spike into a swell that decays.
 *  ATTACK    — how sharply it rises. Very short = percussive snap.
 *  THRESHOLD — gate only; where the gate opens.
 *
 * The live bar shows this mapping's actual post-envelope output, so the effect
 * of a change is visible immediately rather than inferred from the canvas.
 */
function PrecisionControls({ mapping }: { mapping: AudioMapping }) {
  // STAGE 3.0.4a: the live Output bar was removed here. Only Beat and LFO carry
  // phase indicators now — a per-mapping output meter was visual noise next to
  // them and was part of what made this column tall. This is controls only.
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <span className="w-12 text-[9px] text-zinc-500">Curve</span>
        <select
          value={mapping.curve}
          onChange={(e) => updateMapping(mapping.id, { curve: e.target.value as never })}
          className="min-w-0 flex-1 rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-300 outline-none"
        >
          <option value="exponential">Exponential</option>
          <option value="linear">Linear</option>
          <option value="gate">Gate</option>
        </select>
      </div>

      {mapping.curve === 'gate' && (
        <Knob
          label="Thresh"
          value={mapping.threshold}
          min={0} max={1} step={0.01}
          format={(v) => `${Math.round(v * 100)}`}
          onChange={(v) => updateMapping(mapping.id, { threshold: v })}
        />
      )}

      <Knob
        label="Attack"
        value={mapping.attack}
        min={0.001} max={0.4} step={0.001}
        format={(v) => `${Math.round(v * 1000)}ms`}
        onChange={(v) => updateMapping(mapping.id, { attack: v })}
      />
      <Knob
        label="Release"
        value={mapping.release}
        min={0.02} max={2} step={0.01}
        format={(v) => `${Math.round(v * 1000)}ms`}
        onChange={(v) => updateMapping(mapping.id, { release: v })}
      />
    </div>
  );
}

function Knob({
  label, value, min, max, step, format, onChange,
}: {
  label: string;
  value: number;
  min: number; max: number; step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-12 flex-shrink-0 text-[9px] text-zinc-500">{label}</span>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-700 accent-blue-500"
      />
      <span className="w-9 flex-shrink-0 text-right text-[9px] tabular-nums text-zinc-600">
        {format(value)}
      </span>
    </div>
  );
}
