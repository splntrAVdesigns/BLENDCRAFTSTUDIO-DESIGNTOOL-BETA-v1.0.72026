# BLENDCRAFT Phase 7.3F.7 — Shared motion evaluation and media rate correction

Base: e79dd805c6d1d106c27446622d6d7f2e05f4221e (Phase 7.3F.6).
Apply to the same repository checkout. Patch only: 8 source/metadata files plus this document.

## Completed
- One shared mask evaluator wired into preview and export. All existing mask animation mappings now use the preview implementation; rotate/spin angles are converted to radians consistently. Zero-valued mask controls remain zero.
- Removed duplicate elapsed-time accumulation when pausing for export. The saved master phase now represents the visible preview.
- Preview/export layer speed transitions use the same analytic integral. Non-audio deterministic frames evaluate directly from their captured phase, smoothed speed, target speed and requested time.
- Foreground preview time and texture advancement no longer discard elapsed intervals longer than 100ms. Hidden preview and live animation clocks during export remain paused; existing visibility handling resets the resume timestamp.
- Uploaded-video export uses captured playhead, playback rate, trim interval, freeze, and once/loop behavior. Loop Lock phase reset begins media at trim start. Preview playhead is restored after export. Existing preview pingpong behavior is restart-loop, and export matches that existing behavior; true reverse video playback is not introduced.
- Timeline records include actual mask uniforms, texture time, media currentTime and configured speed settings. Missing renderer timing now fails certification instead of substituting the requested timestamp. Finite-state checks are not a decoded visual-parity guarantee.
- Added actual encoded-packet timestamp/duration records and finalization elapsed time through the public onEncodedPacket callback. Inspect window.__blendcraftEncoderProgress. The finalization status now shows elapsed seconds; no simulated percentage advancement.
- Version metadata updated to 0.1.0-phase7.3f.7. No dependency changes.

## Preserved
Visible WebGL canvas -> drawImage staging canvas -> awaited CanvasSource.add; custom shader coloration; browser-default H.264 configuration; MP4/WebM formats; bitrate settings; frame rate and output duration selection; Loop Lock duration/cycle selection; aspect ratio; decoded-frame fidelity verification.

## Limits and risk
No tests, typecheck, or build were run, per request. Static source review only. Runtime playback and export performance are not certified by this package. The multi-minute finalize delay is not claimed fixed: output.finalize still owns encoder drain and mux completion. Packet telemetry distinguishes continued encoder output from a quiet finalize tail without private library hooks. Full foreground elapsed-time accounting can expose choppy motion on a slow GPU instead of silently slowing animation. Beat-clock/audio export parity beyond the existing baked-audio path is not expanded here.

## Files
- package-lock.json
- package.json
- src/app/components/gradient/GradientCanvas.tsx
- src/app/components/gradient/gradientMath.ts
- src/app/export/mediabunnyExport.ts
- src/app/media/mediaVideoManager.ts
- src/app/utils/exportTimelineCertification.ts
- src/app/components/gradient/maskAnimation.ts

## Install on Mac
In Terminal, stay in your local BLENDCRAFT repository root.
Type `unzip -o ` (including the trailing space), drag this ZIP from Finder into Terminal, then append ` -d .` and press Return. This supplies the exact downloaded path, including any duplicate-download suffix.
Run `git status --short` to review the extracted changes. Do not push if unzip reports an error.

To commit these exact files on main:

```sh
git branch --show-current
git add package.json package-lock.json src/app/components/gradient/GradientCanvas.tsx src/app/components/gradient/gradientMath.ts src/app/components/gradient/maskAnimation.ts src/app/export/mediabunnyExport.ts src/app/media/mediaVideoManager.ts src/app/utils/exportTimelineCertification.ts PATCH_NOTES_7.3F.7.md
git commit -m "Phase 7.3F.7: unify export motion and honor media playback rate"
git push origin main
```

Only use the push commands when the branch shown is main. If Git rejects the push, stop and inspect its message; do not force-push.
