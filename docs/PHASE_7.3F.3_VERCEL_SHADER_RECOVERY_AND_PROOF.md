# Phase 7.3F.3 — Vercel Runtime Baseline, Gradient Shader Recovery, and Mediabunny Deployment Proof

## Frozen production contracts

- Phase 7.3E.10 PNG remains unchanged.
- The current production WebM path remains unchanged.
- Loop Lock and deterministic animation timing remain unchanged.
- Mediabunny remains accessible only through `?videoLab=1`.

## Blob recovery

Blob no longer applies the segmented twist field to metaball coordinates. The field remains deterministic through stable per-layer blob sizes, rotation, scale, turbulence, texture, hue, displacement, and animation uniforms. A guarded scale denominator prevents invalid coordinates on low or transient scale values.

## Wave recovery

The four-tap derivative sampling around a wrapped `fract()` coordinate was removed from Wave only. Wave now performs one authoritative gradient lookup at the wrapped coordinate, avoiding cross-boundary color mixing and the observed staircase/pixel edge corruption.

## Vercel proof protocol

Open the deployed app with `?videoLab=1` and run:

1. Runtime codec probe.
2. VP9 proof at 1280×720, 30 fps, 5 seconds.
3. VP8 proof with the same preset.
4. H.264 proof only if the runtime probe reports support.
5. Record total, render, encode-submit, finalize, output size, playback fidelity, cancellation, and post-export recovery.

The production exporter must remain untouched until a deployed Mediabunny path passes fidelity, duration, cancellation, memory, and timing criteria.
