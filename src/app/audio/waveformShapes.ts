/**
 * audio/waveformShapes.ts — Stage 3.0.4
 *
 * Shared LFO waveform math. One authority for "what does a sine/triangle/etc.
 * look like", so the LFO modulator here and the app's existing per-layer
 * "LFO Pulse" animation type can mean the same thing by the same formula
 * rather than drifting apart over time.
 *
 * Every function maps phase (0–1, position within one cycle) → value (0–1).
 * Zero allocation, pure. Output is 0–1 rather than -1..1 because everything
 * downstream (mapping amounts, envelopes, uniform ranges) is unipolar.
 */

export type WaveformShape = 'sine' | 'triangle' | 'square' | 'sawUp' | 'sawDown' | 'pulse';

export const WAVEFORM_SHAPES: Array<{ id: WaveformShape; label: string }> = [
  { id: 'sine',     label: 'Sine' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'square',   label: 'Square' },
  { id: 'sawUp',    label: 'Saw Up' },
  { id: 'sawDown',  label: 'Saw Down' },
  { id: 'pulse',    label: 'Pulse' },
];

/**
 * Sample a waveform at `phase` (0–1). `pulseWidth` (0–1) only affects 'pulse'
 * and 'square'-family duty; default 0.5 is a symmetric square.
 */
export function sampleWaveform(shape: WaveformShape, phase: number, pulseWidth = 0.5): number {
  // Wrap defensively so callers can pass an unwrapped accumulating phase.
  const p = phase - Math.floor(phase);
  switch (shape) {
    case 'sine':
      // Cosine-based so phase 0 = trough, 0.5 = peak — reads as "rise then fall"
      // starting from rest, which matches how a pulse should feel.
      return 0.5 - 0.5 * Math.cos(p * Math.PI * 2);
    case 'triangle':
      return p < 0.5 ? p * 2 : 2 - p * 2;
    case 'square':
      return p < pulseWidth ? 1 : 0;
    case 'sawUp':
      return p;
    case 'sawDown':
      return 1 - p;
    case 'pulse':
      // Sharp attack, long silence — the "stutter" feel. A brief raised-cosine
      // blip within pulseWidth, flat zero after.
      return p < pulseWidth ? 0.5 - 0.5 * Math.cos((p / pulseWidth) * Math.PI * 2) : 0;
    default:
      return 0;
  }
}
