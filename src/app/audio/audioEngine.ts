/**
 * audio/audioEngine.ts — Stage 3.0.0
 *
 * AudioContext + AnalyserNode lifecycle, file decode, and the analysis loop
 * that feeds `audioBus`.
 *
 * STAGE SCOPE: this is the foundation only. Nothing reads the bus yet — no
 * mapping, no uniforms, no visual effect. The goal is narrow and worth stating
 * plainly: prove the signal exists, is stable, and is frame-rate independent
 * BEFORE anything depends on it. Building the mapping layer on an unverified
 * signal would mean debugging two unknowns at once.
 *
 * AUTOPLAY GATING
 * ─────────────────────────────────────────────────────────────────────────
 * Browsers refuse to start an AudioContext outside a user gesture. Rather than
 * creating a context at import time and hoping, the context is created lazily
 * on the first `loadFile()` — which is always reached from a click (a file
 * picker or a drop). That makes the gesture requirement structural instead of
 * something to remember.
 *
 * RAF OWNERSHIP
 * ─────────────────────────────────────────────────────────────────────────
 * This stage runs its own rAF loop, because nothing else is reading the bus
 * yet. When 3.0.1 wires the render loop, the analysis pull should move INTO
 * the existing canvas RAF rather than running a second competing loop — two
 * independent rAF loops in one app is exactly the kind of thing that shows up
 * later as unexplained jitter. Marked here so it isn't forgotten:
 * see `pumpAnalysisFrame()`, which is written to be callable from an external
 * loop for precisely that migration.
 */

import { createBandAnalyzer, describeBands, type BandAnalyzer } from './bandAnalysis';
import {
  writeAudioBands,
  writeAudioStatus,
  resetAudioSignals,
  installAudioBusDiagnostic,
  readAudioBus,
} from './audioBus';
import type { AudioEngineStatus, AudioSourceInfo } from './types';

/**
 * FFT size. 2048 gives 1024 bins ≈ 21Hz per bin at 44.1kHz — fine enough to
 * separate a kick from a bassline, coarse enough to stay cheap. Larger sizes
 * buy frequency resolution we have no use for when collapsing to three bands,
 * at the cost of more work per frame and more latency.
 */
const FFT_SIZE = 2048;

/**
 * AnalyserNode's own built-in smoothing. Kept LOW deliberately: we do our own
 * asymmetric attack/release in bandAnalysis, and stacking the browser's
 * symmetric smoothing on top of that would blur transients twice and make a
 * kick drum feel late. A small value still knocks off bin-to-bin jitter.
 */
const ANALYSER_SMOOTHING = 0.15;

interface EngineState {
  ctx: AudioContext | null;
  analyser: AnalyserNode | null;
  gain: GainNode | null;
  buffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null;
  /**
   * Typed as Uint8Array<ArrayBuffer> — getByteFrequencyData's lib.dom
   * signature requires it under TS 5.7+, and the bare `Uint8Array` alias
   * widens to ArrayBufferLike, which isn't assignable.
   */
  freqData: Uint8Array<ArrayBuffer> | null;
  analyzer: BandAnalyzer | null;
  rafId: number | null;
  lastFrameTime: number;
  status: AudioEngineStatus;
  info: AudioSourceInfo | null;
  /** Context time at which playback started, for position reporting. */
  startedAt: number;
  /** Offset into the buffer at the last start, for pause/resume. */
  startOffset: number;
  ownsRaf: boolean;
}

const state: EngineState = {
  ctx: null,
  analyser: null,
  gain: null,
  buffer: null,
  source: null,
  freqData: null,
  analyzer: null,
  rafId: null,
  lastFrameTime: 0,
  status: 'idle',
  info: null,
  startedAt: 0,
  startOffset: 0,
  ownsRaf: false,
};

function setStatus(status: AudioEngineStatus, active: boolean): void {
  state.status = status;
  writeAudioStatus(status, active);
}

/** Lazily create the context + graph. Safe to call repeatedly. */
function ensureContext(): AudioContext | null {
  if (state.ctx) return state.ctx;
  try {
    const Ctor: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) {
      console.warn('[Audio] Web Audio API unavailable in this browser.');
      setStatus('error', false);
      return null;
    }
    const ctx = new Ctor();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;

    const gain = ctx.createGain();
    gain.gain.value = 1;

    // source → analyser → gain → destination.
    // The analyser sits BEFORE the gain so that muting playback (gain 0) does
    // not silence the analysis. That matters more than it sounds: it's what
    // will let a user render audio-reactive visuals without hearing the track,
    // which is a normal working mode.
    analyser.connect(gain);
    gain.connect(ctx.destination);

    state.ctx = ctx;
    state.analyser = analyser;
    state.gain = gain;
    // Allocated over an explicit ArrayBuffer: getByteFrequencyData's lib.dom
    // signature requires Uint8Array<ArrayBuffer>, and the bare constructor
    // widens to Uint8Array<ArrayBufferLike> under TS 5.7+, which isn't
    // assignable. Being precise here beats an `as any` that would hide a real
    // mismatch later.
    state.freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    state.analyzer = createBandAnalyzer(ctx.sampleRate, analyser.frequencyBinCount);

    console.info('[Audio] Context created:', {
      sampleRate: ctx.sampleRate,
      fftSize: analyser.fftSize,
      bins: analyser.frequencyBinCount,
      bands: describeBands(ctx.sampleRate, analyser.frequencyBinCount),
    });
    return ctx;
  } catch (e) {
    console.error('[Audio] Failed to create AudioContext:', e);
    setStatus('error', false);
    return null;
  }
}

/**
 * Decode a file into an AudioBuffer.
 *
 * Must be reached from a user gesture (file picker / drop) — see the autoplay
 * note at the top. Decoding itself doesn't need the context running, but
 * creating it here means the gesture that picked the file is the gesture that
 * unlocks audio.
 */
export async function loadAudioFile(file: File): Promise<AudioSourceInfo | null> {
  const ctx = ensureContext();
  if (!ctx) return null;

  setStatus('loading', false);
  try {
    const bytes = await file.arrayBuffer();
    // decodeAudioData is the only reliable way to know a file is actually
    // decodable — extension and MIME both lie. Same decode-probe principle the
    // media pipeline already uses for video.
    const buffer = await ctx.decodeAudioData(bytes);

    stopPlayback();
    state.buffer = buffer;
    state.startOffset = 0;
    state.info = {
      kind: 'file',
      fileName: file.name,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
    };
    setStatus('ready', false);
    console.info('[Audio] Loaded:', state.info);
    return state.info;
  } catch (e) {
    console.error('[Audio] Decode failed — file may be corrupt or an unsupported codec:', e);
    setStatus('error', false);
    return null;
  }
}

/** Start (or restart) playback from `offset` seconds. */
export async function playAudio(offset = state.startOffset): Promise<boolean> {
  const ctx = state.ctx;
  if (!ctx || !state.buffer || !state.analyser) return false;

  // A context created before a gesture, or backgrounded by the browser, lands
  // in 'suspended' and produces silence with no error. Resume explicitly.
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      setStatus('suspended', false);
      return false;
    }
  }

  stopPlayback();

  const source = ctx.createBufferSource();
  source.buffer = state.buffer;
  source.connect(state.analyser);
  source.onended = () => {
    // Fires on natural end AND on our own stop() — only react to the former.
    if (state.source === source) {
      stopPlayback();
      state.startOffset = 0;
    }
  };
  source.start(0, Math.max(0, Math.min(offset, state.buffer.duration)));

  state.source = source;
  state.startedAt = ctx.currentTime;
  state.startOffset = offset;
  setStatus('playing', true);
  startAnalysisLoop();
  return true;
}

/** Stop playback and freeze the analysis loop. Idempotent. */
export function stopPlayback(): void {
  if (state.source) {
    try {
      state.source.onended = null;
      state.source.stop();
      state.source.disconnect();
    } catch {
      /* already stopped */
    }
    state.source = null;
  }
  stopAnalysisLoop();
  state.analyzer?.reset();
  resetAudioSignals();
  if (state.status === 'playing') setStatus(state.buffer ? 'ready' : 'idle', false);
}

/** Pause, retaining position so play() resumes where it left off. */
export function pauseAudio(): void {
  if (state.status !== 'playing' || !state.ctx) return;
  const elapsed = state.ctx.currentTime - state.startedAt;
  state.startOffset = Math.max(0, state.startOffset + elapsed);
  stopPlayback();
}

/** Current playhead position in seconds. */
export function getPlaybackPosition(): number {
  if (!state.ctx || !state.buffer) return 0;
  if (state.status !== 'playing') return state.startOffset;
  return Math.min(state.buffer.duration, state.startOffset + (state.ctx.currentTime - state.startedAt));
}

/** Monitoring volume. Does NOT affect analysis — see the graph note above. */
export function setMonitorVolume(volume: number): void {
  if (state.gain) state.gain.gain.value = Math.max(0, Math.min(1, volume));
}

/**
 * Pull one analysis frame.
 *
 * Exported so 3.0.1 can call this from the existing canvas RAF instead of
 * running a second loop — see the RAF ownership note at the top of this file.
 * `dt` is seconds since the last call; pass 0 to have it self-measure.
 */
export function pumpAnalysisFrame(dt = 0): void {
  const analyser = state.analyser;
  const freqData = state.freqData;
  const analyzer = state.analyzer;
  if (!analyser || !freqData || !analyzer) return;

  const now = performance.now();
  const delta = dt > 0
    ? dt
    : (state.lastFrameTime > 0 ? (now - state.lastFrameTime) / 1000 : 1 / 60);
  state.lastFrameTime = now;

  analyser.getByteFrequencyData(freqData);
  analyzer.analyze(freqData, delta);

  writeAudioBands(
    analyzer.subBass, analyzer.subBassRaw,
    analyzer.low, analyzer.mid, analyzer.high,
    analyzer.lowRaw, analyzer.midRaw, analyzer.highRaw,
    analyzer.level, analyzer.peak,
  );
}

/**
 * STAGE 3.0.1: when the canvas RAF drives analysis via pumpAnalysisFrame(), the
 * engine must NOT also run its own loop — that would analyze twice per frame
 * and double-advance frameCount. The canvas sets this true on mount. Until then
 * (e.g. the 3.0.0 console test with no reactive canvas), the engine self-drives.
 */
let externallyDriven = false;
export function setAnalysisExternallyDriven(v: boolean): void {
  externallyDriven = v;
  if (v) stopAnalysisLoop();          // hand off cleanly if we were self-driving
  else if (state.status === 'playing') startAnalysisLoop();
}

function startAnalysisLoop(): void {
  if (externallyDriven) return;       // canvas owns the pump
  if (state.rafId !== null) return;
  state.ownsRaf = true;
  state.lastFrameTime = 0;
  const tick = () => {
    pumpAnalysisFrame();
    state.rafId = requestAnimationFrame(tick);
  };
  state.rafId = requestAnimationFrame(tick);
}

function stopAnalysisLoop(): void {
  if (state.rafId !== null) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
  state.ownsRaf = false;
  state.lastFrameTime = 0;
}

/** Full teardown. Releases the context — the app should call this on unmount. */
export function disposeAudioEngine(): void {
  stopPlayback();
  try {
    state.analyser?.disconnect();
    state.gain?.disconnect();
    void state.ctx?.close();
  } catch {
    /* best-effort */
  }
  state.ctx = null;
  state.analyser = null;
  state.gain = null;
  state.buffer = null;
  state.freqData = null;
  state.analyzer = null;
  state.info = null;
  state.startOffset = 0;
  setStatus('idle', false);
}

/** STAGE 3.1: the decoded AudioBuffer for offline envelope baking, or null. */
export function getDecodedAudioBuffer(): AudioBuffer | null {
  return state.buffer;
}

export function getAudioSourceInfo(): AudioSourceInfo | null {
  return state.info;
}

export function getAudioEngineStatus(): AudioEngineStatus {
  return state.status;
}

// ─────────────────────────────────────────────────────────────────────────
// DIAGNOSTICS — 3.0.0's actual deliverable
// ─────────────────────────────────────────────────────────────────────────

/**
 * Install `window.__audioBus` and `window.__audioTest`.
 *
 * There is no UI in this stage by design, so console access IS the interface
 * for verifying the signal. `__audioTest.pickFile()` opens a real file picker
 * — the click on that dialog is the user gesture that unlocks the context, so
 * this path exercises the same gating the eventual UI will use rather than
 * bypassing it.
 */
export function installAudioEngine(): void {
  installAudioBusDiagnostic();
  try {
    (window as any).__audioTest = {
      /** Open a file picker, decode, and start playing + analyzing. */
      pickFile(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/*';
        input.style.display = 'none';
        input.onchange = async () => {
          const file = input.files?.[0];
          input.remove();
          if (!file) return;
          const info = await loadAudioFile(file);
          if (info) await playAudio(0);
        };
        document.body.appendChild(input);
        input.click();
      },
      play: () => playAudio(),
      pause: () => pauseAudio(),
      stop: () => stopPlayback(),
      position: () => getPlaybackPosition(),
      info: () => getAudioSourceInfo(),
      status: () => getAudioEngineStatus(),
      volume: (v: number) => setMonitorVolume(v),
      /** Print a live band readout once per second for `seconds`. */
      monitor(seconds = 10): void {
        let n = 0;
        const id = window.setInterval(() => {
          const b = readAudioBus();
          console.info(
            `[Audio] low=${b.low.toFixed(3)} mid=${b.mid.toFixed(3)} high=${b.high.toFixed(3)} ` +
            `level=${b.level.toFixed(3)} frames=${b.frameCount}`,
          );
          if (++n >= seconds) window.clearInterval(id);
        }, 1000);
      },
    };
    console.info(
      '[Audio] Engine installed. Verify with: __audioTest.pickFile() then __audioTest.monitor()',
    );
  } catch {
    /* diagnostics must never break the app */
  }
}
