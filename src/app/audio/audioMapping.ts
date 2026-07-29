/**
 * audio/audioMapping.ts — Stage 3.0.3
 *
 * Routes conditioned audio signals to render targets.
 *
 * ── WHY uAnimIntensity WAS THE WRONG FIRST TARGET (kept as a warning) ─────
 * 3.0.1 boosted `uAnimIntensity`, which looked safe — it exists and is written
 * every frame — but it is only ever READ inside the shader's animation FIELD
 * functions, gated by `uAnimType`:
 *
 *     if (uAnimType < 0.5) return uv;   // animationHelpers.ts
 *
 * `uAnimType` is non-zero for exactly seven animation types. For the rest the
 * app sets it to 0 deliberately, because JS transforms own animation there. So
 * the boost was multiplied into a branch that never ran. A uniform being
 * WRITTEN every frame says nothing about whether it is READ — every target
 * below was checked against shader/render source for actual consumption.
 *
 * ── PER-FRAME vs PER-LAYER (3.0.3 restructure) ───────────────────────────
 * Mappings now carry their own attack/release envelope, which must advance
 * exactly ONCE per frame. The old design resolved everything inside the
 * per-layer loop, which would have stepped each envelope N times per frame and
 * made smoothing depend on layer count.
 *
 * Split into two phases:
 *   tickMappings(dt)              once per frame — signal → curve → envelope
 *   resolveAudioDeltasForLayer(id) per layer     — sum precomputed values
 *
 * That's both correct and cheaper than what it replaces.
 */

import { useSyncExternalStore } from 'react';
import { readAudioBus } from './audioBus';
import {
  conditionSignals,
  applyCurve,
  resetSignalConditioning,
  type ResponseCurve,
} from './audioSignal';
import {
  updateBeat, getBeatPulse, resetBeat, getBeatInfo,
} from './beatDetection';
import { updateLFO_frame, getLFOValue, resetLFO } from './lfoEngine';
import type { BakedFrame } from './envelopeBaker';

/**
 * Signal sources.
 *
 * `*Hit` are TRANSIENTS — near zero at rest, spiking on each onset. These are
 * what make visuals dance; the continuous bands mostly carry DC (see
 * audioSignal.ts). Hits are the recommended default for anything percussive.
 */
export type AudioSourceId =
  | 'subBass' | 'low' | 'mid' | 'high' | 'level'
  | 'subBassHit' | 'lowHit' | 'midHit' | 'highHit' | 'levelHit'
  // STAGE 3.0.4 — generated/derived timing sources. These are what make the
  // motion feel deliberately IN TIME rather than twitchy: a beat pulse is a
  // held, shaped envelope on the musical grid, not a raw 40ms transient spike.
  | 'beat' | 'beatDown' | 'beatOff' | 'beatBar'
  // STAGE 3.0.5 — sub-beat grids and sub-bass freq band
  | 'beat8' | 'beat16'
  | 'lfo';

export type AudioTargetId =
  | 'gradientScale'   // uScale/scale — the gradient PATTERN only
  | 'layerPunch'      // mesh.scale   — the ENTIRE layer, media and mask included
  | 'shake'           // post-process UV jolt
  | 'hue'
  | 'intensity'
  | 'glitch'          // UV glitch/tear (renamed from 'motion'; kept same shader path)
  | 'speed'           // animation phase-rate multiplier — surges on beat, returns to 1
  | 'chroma'          // post FX: chromatic aberration (RGB split)
  | 'brightness'      // post FX
  | 'blur'            // post FX: gaussian blur radius
  | 'saturation'      // post FX: colour saturation boost/crush
  | 'vignette'        // post FX: edge darkening
  | 'strobe';         // post FX: flash-to-white on beat

export interface AudioMapping {
  id: string;
  source: AudioSourceId;
  target: AudioTargetId;
  /**
   * Which layer this drives. `ALL_LAYERS` (the default, and what every
   * pre-3.0.2a config migrates to) applies to every layer.
   *
   * A stored id can outlive the layer it names. That resolves to "contributes
   * nothing" rather than being auto-repaired — silently repointing someone's
   * routing at a different layer is worse than a mapping that visibly does
   * nothing until they fix it.
   *
   * Ignored by `chroma` and `brightness`, which are POST-PROCESSING and apply
   * to the composited frame rather than to any single layer.
   */
  layerId: string;
  /** 0–1 strength. Scales the target's full-swing range. */
  amount: number;
  curve: ResponseCurve;
  /** Gate threshold, 0–1. Only meaningful when curve === 'gate'. */
  threshold: number;
  /** Envelope attack in seconds — how fast it rises. */
  attack: number;
  /** Envelope release in seconds — how fast it falls. Slow = "breathing". */
  release: number;
  enabled: boolean;
}

export const ALL_LAYERS = '__all__';

export const AUDIO_SOURCES: Array<{ id: AudioSourceId; label: string; hit: boolean }> = [
  { id: 'subBassHit', label: 'Sub Hit',  hit: true },
  { id: 'lowHit',     label: 'Low Hit',  hit: true },
  { id: 'midHit',     label: 'Mid Hit',  hit: true },
  { id: 'highHit',    label: 'High Hit', hit: true },
  { id: 'levelHit',   label: 'Any Hit',  hit: true },
  { id: 'beat',       label: 'Beat',      hit: true },
  { id: 'beatDown',   label: 'Beat 1&3',  hit: true },
  { id: 'beatOff',    label: 'Beat 2&4',  hit: true },
  { id: 'beatBar',    label: 'Bar',       hit: true },
  { id: 'beat8',      label: '8th Note',  hit: true },
  { id: 'beat16',     label: '16th Note', hit: true },
  { id: 'lfo',        label: 'LFO',       hit: false },
  { id: 'subBass',    label: 'Sub Bass',  hit: false },
  { id: 'low',        label: 'Low',       hit: false },
  { id: 'mid',        label: 'Mid',       hit: false },
  { id: 'high',       label: 'High',      hit: false },
  { id: 'level',      label: 'Level',     hit: false },
];

export const AUDIO_TARGETS: Array<{
  id: AudioTargetId;
  label: string;
  hint: string;
  /** False = only applies under some conditions; the UI says so. */
  universal: boolean;
  /** True = post-processing, applies to the whole frame not one layer. */
  global?: boolean;
}> = [
  { id: 'layerPunch',    label: 'Layer Punch',    hint: 'Scales the WHOLE layer — gradient, media, textures and mask together', universal: true },
  { id: 'shake',         label: 'Shake',          hint: 'Jolts the whole frame\u2019s imagery and settles back', universal: true, global: true },
  { id: 'gradientScale', label: 'Gradient Scale', hint: 'Scales the gradient PATTERN only — not media or masks', universal: true },
  { id: 'hue',           label: 'Hue',            hint: 'Colour rotation', universal: true },
  { id: 'intensity',     label: 'Intensity',      hint: 'Gradient energy / contrast', universal: true },
  { id: 'chroma',        label: 'RGB Split',      hint: 'Chromatic aberration — whole frame', universal: true, global: true },
  { id: 'brightness',    label: 'Brightness',     hint: 'Whole frame', universal: true, global: true },
  { id: 'blur',          label: 'Blur',           hint: 'Gaussian blur radius — whole frame', universal: true, global: true },
  { id: 'saturation',    label: 'Saturation',     hint: 'Colour saturation boost — whole frame', universal: true, global: true },
  { id: 'vignette',      label: 'Vignette',       hint: 'Edge darkening — whole frame', universal: true, global: true },
  { id: 'strobe',        label: 'Strobe',         hint: 'Flash-to-white on beat — whole frame', universal: true, global: true },
  { id: 'speed',         label: 'Speed',          hint: 'Surges animation rate on hit then returns to normal — works on any animated layer', universal: false },
  { id: 'glitch',        label: 'Glitch',         hint: 'UV tear/slice distortion — works on any visible layer', universal: false },
];

/**
 * Full-swing range per target, at amount = 1 and source = 1.
 * Tuned so a hit reads clearly without destroying the composition.
 */
const RANGE = {
  // STAGE 3.0.4 — ranges opened up after testing reported every target except
  // Hue as too weak. The old values were tuned for continuous bands (which sit
  // high and vary little); driven by a HELD beat/LFO envelope that returns to
  // rest, a bigger range reads as punch rather than as a permanent offset.
  gradientScale: 0.60,  // up to +60% pattern zoom on a hit
  layerPunch: 0.45,     // up to +45% whole-layer scale; a real punch
  shake: 0.030,         // STAGE 3.0.5: now UV-space (post-process). 0.03 =
                        // a 3%-of-frame content jolt. Was pixel-space mesh move.
  hue: 200,             // Hue was already the strongest, nudged only
  intensity: 2.20,      // "intensity" now actually intensifies
  glitch: 0.10,         // UV-glitch magnitude (renamed from 'motion'). 0.10 UV
                        // shove + slice on a full hit.
  speed: 2.0,           // Animation phase-rate boost. speedMul = 1 + RANGE.speed * e,
                        // so a full hit at amount=1 → 3× speed surge that decays with
                        // the mapping's release envelope. amount slider scales it down.
  chroma: 1.0,          // RGB split — UV-space lateral offset. slider is 0–1,
                        // so +1.0 on a full hit equals moving the slider from
                        // zero to max. Matches the convention of every other target.
  brightness: 0.70,
  blur: 4.0,            // pixels (passed to shader as uniform). 4px = visible without destroying detail.
  saturation: 1.0,      // additive saturation multiplier. 1.0 = doubles saturation on full hit.
  vignette: 0.50,       // 0–1 vignette strength. 0.5 = clear centre, dark corners on full hit.
  strobe: 1.0,          // 0–1 white flash. Multiplied by amount; 1.0 full-white on full hit.
};

// ─────────────────────────────────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'blendcraft-audio-mappings-v2';

/**
 * Defaults now lead with TRANSIENTS and Layer Punch, because that combination
 * is what actually reads as "reacting to the music" on first play. The old
 * continuous-band default produced a constant offset (see audioSignal.ts).
 *
 * NOTE: these persist to localStorage. Per the plan the mapping table becomes
 * DOCUMENT state travelling with sessions/.blendcraft in a later stage; this
 * store is the staging ground for that move.
 */
const DEFAULTS: AudioMapping[] = [
  // Beat → Layer Punch is the headline: a musically-timed pulse of the whole
  // layer, which is the effect the whole feature has been building toward.
  // Linear curve here because the beat pulse is ALREADY shaped — squashing it
  // again with exponential just makes it small (the 3.0.3 lesson).
  { id: 'm1', source: 'beat',    target: 'layerPunch', layerId: ALL_LAYERS, amount: 0.75, curve: 'linear',      threshold: 0.5, attack: 0.006, release: 0.180, enabled: true },
  { id: 'm2', source: 'lowHit',  target: 'intensity',  layerId: ALL_LAYERS, amount: 0.55, curve: 'exponential', threshold: 0.5, attack: 0.010, release: 0.240, enabled: false },
  { id: 'm3', source: 'highHit', target: 'chroma',     layerId: ALL_LAYERS, amount: 0.50, curve: 'exponential', threshold: 0.5, attack: 0.008, release: 0.180, enabled: false },
];

const SOURCE_IDS: AudioSourceId[] = ['subBass','low','mid','high','level','subBassHit','lowHit','midHit','highHit','levelHit','beat','beatDown','beatOff','beatBar','beat8','beat16','lfo'];
const TARGET_IDS: AudioTargetId[] = ['gradientScale','layerPunch','shake','hue','intensity','glitch','speed','chroma','brightness','blur','saturation','vignette','strobe'];
const CURVES: ResponseCurve[] = ['linear','exponential','gate'];

function load(): AudioMapping[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return migrateV1() ?? DEFAULTS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULTS;
    return parsed.map((m: Partial<AudioMapping>, i: number) => normalize(m, i));
  } catch {
    return DEFAULTS;
  }
}

/**
 * Pull forward a v1 config if one exists.
 *
 * v1's `scale` target is v2's `gradientScale` — same uniform, clearer name. The
 * rename would otherwise silently reset a user's routing to the default, which
 * is exactly the kind of quiet data loss that erodes trust in a tool.
 */
function migrateV1(): AudioMapping[] | null {
  try {
    const raw = localStorage.getItem('blendcraft-audio-mappings-v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.map((m: Record<string, unknown>, i: number) =>
      normalize({ ...m, target: m.target === 'scale' ? 'gradientScale' : m.target } as Partial<AudioMapping>, i));
  } catch {
    return null;
  }
}

function normalize(m: Partial<AudioMapping>, i: number): AudioMapping {
  const num = (v: unknown, lo: number, hi: number, dflt: number) =>
    Number.isFinite(v) ? Math.max(lo, Math.min(hi, v as number)) : dflt;
  return {
    id: typeof m.id === 'string' ? m.id : `m${i + 1}`,
    source: SOURCE_IDS.includes(m.source as AudioSourceId) ? (m.source as AudioSourceId) : 'lowHit',
    target: TARGET_IDS.includes(m.target as AudioTargetId) ? (m.target as AudioTargetId) : 'layerPunch',
    layerId: typeof m.layerId === 'string' && m.layerId ? m.layerId : ALL_LAYERS,
    amount: num(m.amount, 0, 1, 0.6),
    curve: CURVES.includes(m.curve as ResponseCurve) ? (m.curve as ResponseCurve) : 'exponential',
    threshold: num(m.threshold, 0, 1, 0.5),
    attack: num(m.attack, 0.001, 1, 0.012),
    release: num(m.release, 0.02, 3, 0.24),
    enabled: typeof m.enabled === 'boolean' ? m.enabled : true,
  };
}

let mappings: AudioMapping[] = load();
const listeners = new Set<() => void>();

function publish(next: AudioMapping[]): void {
  mappings = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  listeners.forEach((l) => { try { l(); } catch { /* isolate subscribers */ } });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const getSnapshot = () => mappings;

export function useAudioMappings(): AudioMapping[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function updateMapping(id: string, patch: Partial<AudioMapping>): void {
  publish(mappings.map((m) => (m.id === id ? { ...m, ...patch } : m)));
}

// ─────────────────────────────────────────────────────────────────────────
// PER-FRAME TICK
// ─────────────────────────────────────────────────────────────────────────

/**
 * Smoothed output per mapping id. Preallocated Map, values overwritten in
 * place — no allocation per frame.
 */
const envelopes = new Map<string, number>();

export interface AudioDeltas {
  active: boolean;
  gradientScaleMul: number;
  layerPunchMul: number;
  hueAdd: number;
  intensityMul: number;
  /** Animation phase-rate multiplier. 1 = no change; >1 = faster on beat. */
  speedMul: number;
  glitchX: number;
  glitchY: number;
}

const deltas: AudioDeltas = {
  active: false,
  gradientScaleMul: 1,
  layerPunchMul: 1,
  hueAdd: 0,
  intensityMul: 1,
  speedMul: 1,
  glitchX: 0,
  glitchY: 0,
};

/** Global (post-processing) contributions — not per layer. */
const globalDeltas = {
  chromaAdd: 0, brightnessAdd: 0, shakeX: 0, shakeY: 0,
  blurAdd: 0, saturationAdd: 0, vignetteAdd: 0, strobeAdd: 0,
};

let anyActive = false;

// STAGE 3.1: when >= 0, resolveAudioDeltasForLayer uses this (ms) for the glitch
// direction phase instead of performance.now(), making export deterministic.
// tickMappingsFromBaked sets it per frame; the live path leaves it at -1.
let deterministicClockMs = -1;
export function setDeterministicClock(ms: number): void { deterministicClockMs = ms; }
export function clearDeterministicClock(): void { deterministicClockMs = -1; }

/**
 * Advance every mapping's signal → curve → envelope. Once per frame.
 *
 * Pass `dt` in seconds. Returns nothing; results are read by
 * `resolveAudioDeltasForLayer` and `getGlobalAudioDeltas`.
 */
export function tickMappings(dt: number): void {
  const bus = readAudioBus();

  if (!bus.active) {
    if (anyActive) {
      envelopes.clear();
      resetSignalConditioning();
      resetBeat();
      resetLFO();
      globalDeltas.chromaAdd = 0;
      globalDeltas.brightnessAdd = 0;
      globalDeltas.shakeX = 0;
      globalDeltas.shakeY = 0;
      globalDeltas.blurAdd = 0;
      globalDeltas.saturationAdd = 0;
      globalDeltas.vignetteAdd = 0;
      globalDeltas.strobeAdd = 0;
      anyActive = false;
    }
    return;
  }

  const sig = conditionSignals(bus.subBass, bus.low, bus.mid, bus.high, bus.level, dt);
  anyActive = true;

  // STAGE 3.0.4: advance the timing sources once per frame, alongside the band
  // conditioning. Beat detection reads the same bus; the LFO reads the beat's
  // tempo for its bpm-sync mode.
  const dtMs = dt * 1000;
  const nowMs = performance.now();
  updateBeat(bus.low, bus.mid, dtMs, nowMs);
  updateLFO_frame(dtMs, getBeatInfo().bpm);

  // `shakeClock` (ms) drives the shake direction phase — a real clock live, a
  // deterministic frame time in export — so the two paths share all math and
  // differ only in where the source numbers come from.
  stepAllMappings(dt, performance.now(), (m) => (
    m.source === 'beat'        ? getBeatPulse('every') :
    m.source === 'beatDown'    ? getBeatPulse('downbeat') :
    m.source === 'beatOff'     ? getBeatPulse('offbeat') :
    m.source === 'beatBar'     ? getBeatPulse('bar') :
    m.source === 'beat8'       ? getBeatPulse('beat8') :
    m.source === 'beat16'      ? getBeatPulse('beat16') :
    m.source === 'lfo'         ? getLFOValue() :
    m.source === 'subBassHit'  ? sig.subBassHit :
    m.source === 'lowHit'      ? sig.lowHit :
    m.source === 'midHit'      ? sig.midHit :
    m.source === 'highHit'     ? sig.highHit :
    m.source === 'levelHit'    ? sig.levelHit :
    m.source === 'subBass'     ? sig.subBassNorm :
    m.source === 'low'         ? sig.lowNorm :
    m.source === 'mid'         ? sig.midNorm :
    m.source === 'high'        ? sig.highNorm :
                                 sig.levelNorm
  ));
}

/**
 * The shared per-mapping stepping loop. Both the live tick and the baked
 * (export) tick call this; they differ ONLY in `sourceValue`, so the curve,
 * envelope and global-target math can never drift between preview and export.
 *
 * `shakeClock` (ms) drives the shake direction phase — a real clock live, a
 * deterministic frame time in export.
 */
function stepAllMappings(
  dt: number,
  shakeClock: number,
  sourceValue: (m: AudioMapping) => number,
): void {
  let chroma = 0;
  let brightness = 0;
  let shakeMag = 0;
  let blur = 0;
  let saturation = 0;
  let vignette = 0;
  let strobe = 0;

  for (let i = 0; i < mappings.length; i++) {
    const m = mappings[i];
    if (!m.enabled || m.amount <= 0) {
      envelopes.set(m.id, 0);
      continue;
    }

    const v = sourceValue(m);
    const shaped = applyCurve(v, m.curve, m.threshold) * m.amount;

    const prev = envelopes.get(m.id) ?? 0;
    const tau = shaped > prev ? m.attack : m.release;
    const next = tau <= 0 ? shaped : prev + (shaped - prev) * (1 - Math.exp(-dt / tau));
    envelopes.set(m.id, next);

    if (m.target === 'chroma') chroma += RANGE.chroma * next;
    else if (m.target === 'brightness') brightness += RANGE.brightness * next;
    else if (m.target === 'blur') blur += RANGE.blur * next;
    else if (m.target === 'saturation') saturation += RANGE.saturation * next;
    else if (m.target === 'vignette') vignette += RANGE.vignette * next;
    else if (m.target === 'strobe') strobe += RANGE.strobe * next;
    else if (m.target === 'shake') shakeMag += RANGE.shake * next;
  }

  globalDeltas.chromaAdd = chroma;
  globalDeltas.brightnessAdd = brightness;
  globalDeltas.blurAdd = blur;
  globalDeltas.saturationAdd = saturation;
  globalDeltas.vignetteAdd = vignette;
  globalDeltas.strobeAdd = strobe;
  if (shakeMag > 0.0001) {
    globalDeltas.shakeX = shakeMag * Math.sin(shakeClock * 0.045);
    globalDeltas.shakeY = shakeMag * Math.sin(shakeClock * 0.037 + 1.7);
  } else {
    globalDeltas.shakeX = 0;
    globalDeltas.shakeY = 0;
  }
}

/**
 * EXPORT tick — advance mappings from a BAKED envelope frame instead of the
 * live bus. `timeSeconds` is the frame's exact timestamp, used both to advance
 * the LFO deterministically and to drive the shake phase.
 */
export function tickMappingsFromBaked(
  frame: BakedFrame,
  dt: number,
  timeSeconds: number,
): void {
  anyActive = true;
  // Pin the glitch direction phase to frame time so resolveAudioDeltasForLayer
  // is reproducible during export.
  deterministicClockMs = timeSeconds * 1000;
  // Deterministic LFO: advance by the frame dt. Across a fixed-rate export this
  // reproduces exactly (phase is a pure function of accumulated frame time).
  updateLFO_frame(dt * 1000, getBeatInfo().bpm);

  stepAllMappings(dt, timeSeconds * 1000, (m) => (
    m.source === 'beat'        ? frame.beat :
    m.source === 'beatDown'    ? frame.beatDown :
    m.source === 'beatOff'     ? frame.beatOff :
    m.source === 'beatBar'     ? frame.beatBar :
    m.source === 'beat8'       ? frame.beat8 :
    m.source === 'beat16'      ? frame.beat16 :
    m.source === 'lfo'         ? getLFOValue() :
    m.source === 'subBassHit'  ? frame.subBassHit :
    m.source === 'lowHit'      ? frame.lowHit :
    m.source === 'midHit'      ? frame.midHit :
    m.source === 'highHit'     ? frame.highHit :
    m.source === 'levelHit'    ? frame.levelHit :
    m.source === 'subBass'     ? frame.subBassNorm :
    m.source === 'low'         ? frame.lowNorm :
    m.source === 'mid'         ? frame.midNorm :
    m.source === 'high'        ? frame.highNorm :
                                 frame.levelNorm
  ));
}

/** Post-processing contributions. Read once per frame, after tickMappings. */
export function getGlobalAudioDeltas(): Readonly<{
  chromaAdd: number; brightnessAdd: number; shakeX: number; shakeY: number;
  blurAdd: number; saturationAdd: number; vignetteAdd: number; strobeAdd: number;
}> {
  return globalDeltas;
}

function identity(): AudioDeltas {
  deltas.active = false;
  deltas.gradientScaleMul = 1;
  deltas.layerPunchMul = 1;
  deltas.hueAdd = 0;
  deltas.intensityMul = 1;
  deltas.speedMul = 1;
  deltas.glitchX = 0;
  deltas.glitchY = 0;
  return deltas;
}

/**
 * Sum the precomputed envelopes that apply to one layer.
 *
 * Returns the identity set (no visual change) when audio isn't running, so a
 * project not using audio renders bit-for-bit as before.
 *
 * DELIBERATELY NOT gated on panel visibility: hiding the panel is a view
 * preference and must not silence audio that is playing.
 */
export function resolveAudioDeltasForLayer(layerId: string): AudioDeltas {
  if (!anyActive) return identity();

  let gradientScaleMul = 1;
  let layerPunchMul = 1;
  let hueAdd = 0;
  let intensityMul = 1;
  let speedMul = 1;
  let glitchMag = 0;
  let any = false;

  for (let i = 0; i < mappings.length; i++) {
    const m = mappings[i];
    if (!m.enabled) continue;
    if (m.layerId !== ALL_LAYERS && m.layerId !== layerId) continue;

    const e = envelopes.get(m.id) ?? 0;
    if (e <= 0.0001) continue;
    any = true;

    // Multiple mappings onto one target COMPOUND rather than last-write-wins.
    switch (m.target) {
      case 'gradientScale': gradientScaleMul += RANGE.gradientScale * e; break;
      case 'layerPunch':    layerPunchMul    += RANGE.layerPunch * e;    break;
      case 'hue':           hueAdd           += RANGE.hue * e;           break;
      case 'intensity':     intensityMul     += RANGE.intensity * e;     break;
      // Speed: additive accumulation same as intensityMul. At amount=1, a full
      // envelope hit adds RANGE.speed (2.0) → speedMul = 3× for that frame.
      // Multiple speed mappings compound (e.g. beat + LFO = even faster surge).
      case 'speed':         speedMul         += RANGE.speed * e;         break;
      case 'glitch':        glitchMag        += RANGE.glitch * e;        break;
      default: break; // chroma/brightness/shake are global, handled in tickMappings
    }
  }

  deltas.active = any;
  deltas.gradientScaleMul = gradientScaleMul;
  deltas.layerPunchMul = layerPunchMul;
  deltas.hueAdd = hueAdd;
  deltas.intensityMul = intensityMul;
  deltas.speedMul = speedMul;
  // Split accumulated glitch magnitude into shader's two components.
  // X = directional shove (time-varying so it kicks around rather than drifting
  // one way); Y = slice/tear amount (steady, so bands read cleanly).
  // Both zero when no Glitch mapping contributes — non-audio renders unchanged.
  if (glitchMag > 0.0001) {
    const t = deterministicClockMs >= 0 ? deterministicClockMs : performance.now();
    deltas.glitchX = glitchMag * Math.sin(t * 0.05) * 0.5;
    deltas.glitchY = glitchMag;
  } else {
    deltas.glitchX = 0;
    deltas.glitchY = 0;
  }
  return deltas;
}

/** Live envelope value for a mapping, for UI meters. */
export function getMappingEnvelope(id: string): number {
  return envelopes.get(id) ?? 0;
}
