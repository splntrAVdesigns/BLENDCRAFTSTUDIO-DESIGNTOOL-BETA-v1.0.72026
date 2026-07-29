/**
 * audio/types.ts — Stage 3.0.0
 *
 * Shared types for the audio-reactive module.
 *
 * SCOPE NOTE: 3.0.0 ships the ENGINE and the BUS only — no mapping, no
 * uniforms, no UI. Types for later stages (AudioMapping, LFOConfig) are
 * deliberately NOT declared here yet: writing a type before the code that
 * satisfies it is how a schema drifts from reality. They arrive with their
 * implementations in 3.0.2 / 3.0.3.
 */

/** Where audio is coming from. Mic deferred to a later stage (see plan §10). */
export type AudioSourceKind = 'file';

export interface AudioSourceInfo {
  kind: AudioSourceKind;
  fileName: string;
  /** Seconds. */
  duration: number;
  sampleRate: number;
  channels: number;
}

/**
 * The three analysis bands.
 *
 * Ranges are the conventional split used by essentially every visualizer, and
 * they matter more than they look: they are chosen so that a kick drum lands
 * squarely in `low`, vocals/leads in `mid`, and hats/cymbals in `high`. Getting
 * these boundaries wrong is the difference between "reacts to the music" and
 * "everything moves at once".
 */
export const BAND_RANGES_HZ = {
  subBass: [20, 60],    // 808s, sub-rumble, kick fundamental — isolated from the rest of low
  low: [20, 250],       // full low shelf (unchanged — existing mappings stay valid)
  mid: [250, 2000],
  high: [2000, 16000],
} as const;

export type BandName = keyof typeof BAND_RANGES_HZ;

export interface BandEnergies {
  low: number;
  mid: number;
  high: number;
}

/**
 * Attack/release envelope timings, in seconds.
 *
 * Attack = how fast the envelope rises toward a louder signal.
 * Release = how fast it falls when the signal drops.
 *
 * Asymmetry is the whole point: a fast attack with a slow release is what
 * makes a visual "hit" on the beat and then breathe back down, instead of
 * flickering on every sample of noise. Symmetric smoothing feels mushy.
 */
export interface EnvelopeTiming {
  attack: number;
  release: number;
}

export const DEFAULT_ENVELOPE: EnvelopeTiming = {
  attack: 0.02,   // 20ms — fast enough to catch a transient
  release: 0.18,  // 180ms — slow enough to read as a decay, not a flicker
};

/** Engine lifecycle. Mirrors AudioContext's own states plus our own gating. */
export type AudioEngineStatus =
  | 'idle'        // nothing loaded
  | 'loading'     // decoding a file
  | 'ready'       // decoded, not playing
  | 'playing'
  | 'suspended'   // context exists but is not running (autoplay gate)
  | 'error';
