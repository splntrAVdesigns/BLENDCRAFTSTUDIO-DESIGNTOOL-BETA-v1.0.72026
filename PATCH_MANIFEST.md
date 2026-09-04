# BLENDCRAFT Export Color Fidelity — Phase 7.3F.3

This archive contains only patched and new files. Apply it over the supplied
BLENDCRAFT beta build while preserving the relative paths.

## Production correction implemented

1. `renderAtTime()` remains BLENDCRAFT's deterministic frame authority.
2. Preview and export now select the same single-pass/post-process render graph.
3. The visible presentation WebGL canvas is copied into one dedicated sRGB
   staging canvas with `drawImage()` for every frame.
4. MP4 and WebM both give that staging canvas to Mediabunny `CanvasSource`.
5. Every `CanvasSource.add(timestamp, duration)` call is awaited before the
   next deterministic frame is rendered.
6. Existing codec selection, bitrate presets, frame timing, duration,
   loop-count, aspect-ratio, progress, cancellation and download logic remain.

## Five root causes corrected

- Raw framebuffer readback is no longer the primary video/PNG color source.
- Deterministic export no longer forces a different render graph from preview.
- The invalid manual `VideoFrame` canvas color-space override was removed.
- Custom final-output shaders now participate in Three.js output color-space
  conversion; intermediate render targets are explicitly linear and renderer
  tone mapping is explicitly disabled.
- Export tests now lock the real CanvasSource/capture/render-graph contract and
  the app decodes the completed artifact for first-frame luma/RGB fidelity
  telemetry on browsers that support the selected codec.

## Secondary engineering corrections

- Synchronized `package.json` and `package-lock.json`; Mediabunny resolves to
  `1.51.0` and required React/Node type packages are pinned.
- Repaired the centralized Three.js export so class and type namespaces remain
  intact under strict TypeScript.
- Removed a runtime-undefined `layer` access in deterministic blob sizing and
  mapped the real `InteractionState.intensity` field into shader uniforms.
- Fixed strict typing defects exposed by the clean toolchain, including mask
  texture dimensions, legacy gradient aliases, animation defaults, WebGL
  diagnostic contexts, sparse raster-mask entries and required UI props.
- Updated architecture documents and replaced stale export contract tests.

## Runtime fidelity telemetry

After an export, the app records:

- `window.__blendcraftLastCaptureFidelity`: presentation canvas versus the
  exact CanvasSource staging frame.
- `window.__blendcraftLastFrameFidelity`: decoded first encoded frame versus
  that staging reference, including mean RGB, luma delta and track color-space
  metadata when available.

The verification sample is bounded to 256 px on its longest side, so it does
not retain a second full-resolution 4K frame.

## Verification completed

- `npm run typecheck` — passed with zero TypeScript errors.
- `npm run test:export` — 63/63 passed.
- Phase 7.3F.0/F.1/F.2 contract suites — 8/8 passed.
- `npm run build` — passed (2,039 modules transformed).
- Dependency resolution — `mediabunny@1.51.0`.

The build environment has no installed graphical browser, so hardware
WebCodecs encode/decode could not be executed here. The runtime decoded-frame
check above is intentionally wired into the real browser export path to make
that last mile measurable rather than assumed.

## Apply and verify

1. Extract the archive at the application root and allow these files to
   replace their counterparts.
2. Use Node 22 as declared by the project, then run `npm ci`.
3. Run `npm run typecheck`, `npm run test:export`, all three phase tests, and
   `npm run build`.
4. In Chrome/Edge, export a high-contrast reference scene to MP4 and WebM and
   inspect the two fidelity telemetry objects above. Capture parity should pass;
   decoded parity allows normal lossy-codec error but rejects a systematic
   washed-out luma shift.
