# Phase 7.3F.1 — Mediabunny Main-Thread Proof Runner

## Status

Superseded by Phase 7.3F.3. Mediabunny is now the production MP4/WebM engine;
this document remains as historical evidence for the original proof runner.

The lab now:

- certifies five deterministic animation checkpoints before opening the encoder;
- creates MP4/H.264, WebM/VP9 or WebM/VP8 outputs through `CanvasSource`;
- awaits every `CanvasSource.add()` call to respect encoder and writer backpressure;
- records certification, setup, render, encode-submit, finalization and blob timings;
- captures Figma/local/Vercel environment data;
- persists the latest 30 benchmark results in local storage;
- returns a Blob and benchmark report without routing normal Export UI actions to the lab.

## Required dependency activation

The app remains build-safe before activation. On the Mac project copy, run:

```bash
npm install mediabunny@1.51.0
npm run verify:deploy
```

Commit both `package.json` and `package-lock.json` after npm completes. Do not hand-edit the lockfile.

## Supported proof matrix

- MP4 + `avc1.42001f`
- WebM + `vp09.00.10.08`
- WebM + `vp8`

The caller must first run `probeVideoLabCapabilities()` and only invoke a supported pairing.

## Production contract after promotion

Normal MP4 and WebM actions call the shared `mediabunnyExport.ts` engine. Each
deterministic `renderAtTime()` frame is copied from the final presentation
canvas into a fixed sRGB staging canvas, then submitted through awaited
`CanvasSource.add(timestamp, duration)`. Raw render-target readback is a
compatibility fallback only. The lab remains available for benchmarking but is
no longer the architectural authority.

## Vercel comparison

After deployment, export the benchmark JSON from `createVideoLabBenchmarkBlob()` and compare:

- `environment.environment`
- `timings.renderMs`
- `timings.encodeSubmitMs`
- `timings.muxFinalizeMs`
- `timings.totalMs`
- `outputBytes`

The production decision must use measured deployed results, not Figma-only behavior.
