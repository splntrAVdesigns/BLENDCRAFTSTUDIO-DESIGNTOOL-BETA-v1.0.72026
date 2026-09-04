# BLENDCRAFT Phase 7.3F.4 Production Color + Export Repair

Apply this patch over Phase 7.3F.3 (the current `main` build), preserving the paths in this archive.

## Production corrections completed

1. Removed the Phase 7.3F.3 `withOutputColorSpace()` injection from gradient, mesh-gradient, effects, and media custom shaders, restoring BLENDCRAFT's established visual transfer.
2. Kept the renderer output configuration and visible WebGL-canvas `drawImage()` capture contract.
3. Unified procedural color-stop writes through `hexToShaderRgb()`, including material creation, material swaps, live palette changes, and stop edits.
4. Replaced zero-sensitive gradient and advanced-control defaults with nullish defaults so valid `0` values survive UI, state, and render synchronization.
5. Kept the shared preview/export `shouldUsePostProcess()` predicate.
6. Kept raw-framebuffer capture as fallback-only; it is not the production source.
7. Split export timings into render, encode/backpressure, native encoder flush, mux/finalize, duration check, fidelity decode, download handoff, and cleanup.
8. Moved MP4 duration/fidelity self-verification behind the browser download handoff and made it non-blocking.
9. Routed MP4 through the same staged browser download handoff used by WebM.
10. Added an explicit hardware-first H.264 capability probe plus a 24-hour, profile-specific measured fallback. Actual encode milliseconds per frame determine whether a matching subsequent export uses software-realtime; the browser's preference hint is never treated as proof of hardware execution. Iframe export retains its known-safe software policy.

## Files in this patch

- `package.json`
- `package-lock.json`
- `src/app/components/controls/GradientControls.tsx`
- `src/app/components/gradient/GradientCanvas.tsx`
- `src/app/export/mediabunnyExport.ts`
- `src/app/media/mediaShader.ts`
- `src/app/utils/colors.ts`
- `src/app/utils/effectsRenderer.ts`
- `src/app/utils/exportStressCertification.ts`
- `src/app/utils/exportUtils.ts`
- `src/app/utils/gradientRenderer.ts`
- `src/app/utils/meshGradientRenderer.ts`
- `tests/exportPhase73F1Contracts.test.ts`
- `tests/exportPhase73F4Contracts.test.ts`
- `tests/exportRenderScheduler.test.ts`
- `tests/maskTexturePipeline.test.ts`

## Verification performed

- `npm run typecheck` — passed
- `npm run test:export` — 63/63 passed
- `npm run test:mask` — 3/3 passed
- `npm run test:phase73f0` — 2/2 passed
- `npm run test:phase73f1` — 3/3 passed
- `npm run test:phase73f2` — 3/3 passed
- `npm run test:phase73f4` — 6/6 passed
- `npm run verify:deploy` — passed, including the production Vite build

The repository-wide lint command still reports substantial pre-existing lint debt outside this patch. TypeScript, export contracts, mask contracts, phase contracts, and the production build pass.

## Install and verify

From the root of the Phase 7.3F.3 repository:

```bash
unzip -o BLENDCRAFT_phase7.3F.4_color_export_production_repair_PATCH_ONLY.zip
nvm use 22
npm ci
npm run verify:deploy
```

Then commit and push the changed files to `main` through the normal Git workflow.

## Production field check

1. Hard-refresh the deployment to clear the prior shader bundle.
2. Load a known preset and compare dark stops, highlights, shadows, and palette swaps with the pre-7.3F.3 visual appearance.
3. Confirm `0` values for intensity, center X/Y, wave amplitude, angle, and twist remain at zero after playback and export.
4. Export one 1920x1080, 30 fps, 5-second MP4 and one matching WebM.
5. Confirm the MP4 downloads immediately after mux completion without requiring a tab/window focus change.
6. After background diagnostics finish, inspect `window.__exportTiming`, `window.__blendcraftLastCaptureFidelity`, and `window.__blendcraftLastFrameFidelity` in the browser console.
