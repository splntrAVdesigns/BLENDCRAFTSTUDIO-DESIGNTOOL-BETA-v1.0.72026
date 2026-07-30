# Phase 7.4D.1 — Mediabunny Bundle Loader Fix

## Root cause

The prior loader used `new Function('specifier', 'return import(specifier)')`. Vite/Rollup cannot statically analyze that expression, so Mediabunny was not included in the production bundle. The deployed browser attempted to resolve the bare string `mediabunny` directly and failed.

## Correction

`mediabunnyLoader.ts` now uses a static namespace import:

```ts
import * as mediabunny from 'mediabunny';
```

This makes the dependency visible to Vite, allows normal tree/chunk processing, and removes runtime bare-specifier resolution.

## Production effect

No legacy exporter is reconnected. The normal Video Export action remains routed to the Mediabunny production exporter.
