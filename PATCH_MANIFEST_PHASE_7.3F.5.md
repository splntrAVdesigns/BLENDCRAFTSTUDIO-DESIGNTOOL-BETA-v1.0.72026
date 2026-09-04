# BLENDCRAFT Phase 7.3F.5 — Public Finalization + Resolution Gate

Apply this patch over Phase 7.3F.4. It is intentionally limited to export lifecycle, telemetry, verification, and their tests. Phase 7.3F.4's corrected shader/color pipeline is unchanged.

## Completed corrections

1. Removed `MeasuredCanvasSource` and all access to Mediabunny's private `_closingPromise`.
2. Removed the manual `CanvasSource.close()` stage.
3. Finalization now follows the Visual Mood Labs contract exactly: await every `CanvasSource.add()`, then await the public `output.finalize()` API.
4. Hardware-first H.264 now uses realtime latency to bound frame reordering and completion-tail pressure; existing quality bitrate logic remains authoritative.
5. H.264 performance history was upgraded to v2 and now measures frame submission plus the complete public encoder-drain/mux tail.
6. Matching exports can select software-realtime when the measured hardware-requested path was slow and software is unmeasured or at least 10% faster.
7. Telemetry reports one honest `encoderDrainAndMux` boundary. Separate native-flush or mux claims are no longer made through unsupported private instrumentation.
8. The active WebCodecs encoder width and height are checked against the selected export dimensions before download handoff. A mismatch stops the mislabeled MP4 and enters the existing safe WebM recovery path.
9. Background artifact verification now reports decoded `videoWidth`, `videoHeight`, and `resolutionMatches` alongside duration and frame-fidelity results.
10. Visible-canvas `drawImage()` capture, deterministic timing, Loop Lock, codecs, bitrate tiers, aspect ratio, media compositing, post-processing parity, and Phase 7.3F.4 coloration remain intact.

## Verification completed

- `npm run typecheck` — passed
- `npm run test:export` — 63/63 passed
- `npm run test:mask` — 3/3 passed
- Phase 7.3F.0 contracts — 2/2 passed
- Phase 7.3F.1 contracts — 3/3 passed
- Phase 7.3F.2 contracts — 3/3 passed
- Phase 7.3F.4 contracts — 6/6 passed
- Phase 7.3F.5 contracts — 5/5 passed
- `npm run build` — passed
- `npm run verify:deploy` — passed

The build retains the existing Vite large-chunk and static/dynamic Three.js import warnings. They do not block compilation or this export correction.

## Install

From the Phase 7.3F.4 repository root:

```bash
unzip -o BLENDCRAFT_phase7.3F.5_public_finalize_resolution_PATCH_ONLY.zip -d .
nvm use 22
npm ci
npm run verify:deploy
```

## Field test

1. Hard-refresh the deployed application.
2. Export a 1920×1080, 30 fps, 5-second MP4 without changing browser focus.
3. Confirm progress advances from frame rendering to `Draining encoder and finalizing MP4...`, then downloads normally.
4. Open the original file in QuickTime Player and press Command-I; confirm 1920×1080 and the requested duration.
5. Repeat with Loop Lock and with an uploaded MP4 plus a gradient layer.
6. After background verification finishes, inspect `window.__exportTiming`. The completion tail is reported as `encoderDrainAndMuxSec`, and artifact metadata includes decoded resolution.

