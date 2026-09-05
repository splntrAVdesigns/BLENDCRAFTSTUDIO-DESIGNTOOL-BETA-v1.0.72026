# BLENDCRAFT Phase 7.3F.6 — Browser-Default MP4 + Timeline Fidelity

Apply this patch over Phase 7.3F.5. It is intentionally limited to MP4
encoder policy, animation timeline continuation, diagnostics, and tests.
Phase 7.3F.4's corrected color/render graph and visible-canvas capture remain
unchanged.

## Completed corrections

1. Removed production H.264 hardware/software preference selection.
2. Removed explicit MP4 `latencyMode: "realtime"`.
3. MP4 `CanvasSource` now follows the Visual Mood Labs encoder contract:
   `codec: "avc"`, the selected bitrate, and passive config telemetry only.
4. Removed performance-history-driven encoder selection while retaining
   render, add/backpressure, public finalize, resolution, duration, decoded
   fidelity, and active encoder-config telemetry.
5. Added a narrowly scoped migration that deletes only obsolete
   `blendcraft:h264-encoder-performance:v2*` keys on the next MP4 export.
6. Export now snapshots each animated layer's actual `signedPhase` and
   `smoothedSpeed`, plus its committed target speed.
7. Preview and export now share a time-based speed smoother. Its behavior is
   identical to the established 0.15 EMA at 60 fps and stable at other frame
   rates.
8. Frame 0 preserves the exact captured preview phase/speed. Later frames
   deterministically continue the same speed transition and audio multiplier.
9. Added complete per-frame timeline certification: requested timestamp,
   rendered deterministic time, captured phase, effective speed, rendered
   phase, encoded timestamp, and encoded duration.
10. Timeline certification is published in `window.__exportTiming` and
    `window.__blendcraftLastTimelineCertification` for MP4 and WebM.
11. Preserved awaited `CanvasSource.add()`, public `output.finalize()`, codec
    bitrates, frame counts, Loop Lock, aspect ratio, BT.709 artifact checks,
    decoded-frame fidelity, download-first MP4 handoff, and cleanup.

## Verification commands

```bash
nvm use 22
npm ci
npm run verify:deploy
```

## Verification completed

- `npm run typecheck` — passed
- Full export suite — 66/66 passed
- Mask pipeline suite — 3/3 passed
- Phase 7.3F.0 contracts — 2/2 passed
- Phase 7.3F.1 contracts — 3/3 passed
- Phase 7.3F.2 contracts — 3/3 passed
- Phase 7.3F.4 contracts — 6/6 passed
- Phase 7.3F.5 contracts — 5/5 passed
- Phase 7.3F.6 contracts — 5/5 passed
- Targeted lint for new certification/math/tests — passed
- Production build — passed (2,039 modules, 22.46 seconds)

Repository-wide lint still reports the existing baseline of 580 unrelated
errors/warnings. Phase 7.3F.6 does not expand scope into that existing cleanup.
The established Vite Three.js import and large-chunk warnings remain non-blocking.

## Field test

1. Hard-refresh the deployed application.
2. Select a moving gradient and adjust its speed immediately before export.
3. Export 1920x1080, 30 fps, 5 seconds without changing window focus.
4. Confirm motion begins from the visible preview state and retains its speed.
5. Confirm the MP4 downloads without a prolonged 91% finalization stall.
6. Inspect `window.__exportTiming` and confirm:
   - `encoderPolicy` is `browser-default`;
   - no hardware/software preference appears in `encoderConfig`;
   - `timelineCertification.passed` is `true`;
   - artifact duration and resolution pass;
   - decoded-frame fidelity is reported.
7. Run the previous localStorage inspection command and confirm no
   `blendcraft:h264-encoder-performance:v2` keys remain.
