# Phase 7.3F.1 — Mediabunny Main-Thread Proof Runner

## Purpose

This sprint adds the first real Mediabunny proof engine while preserving the frozen production PNG and WebM exporters.

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

## Integration contract

Call `runMediabunnyMainThread()` only from a development-only Video Export Lab control. Pass the same deterministic `renderAtTime` callback used by the established export bridge and the exact export canvas.

Do not call this runner from the normal PNG, WebM or MP4 actions. Promotion remains blocked until Liquid, animated texture, animated mask, independent layer speeds, ping-pong, Loop Lock on/off, cancellation, duration, memory recovery and deployed Vercel tests pass.

## Vercel comparison

After deployment, export the benchmark JSON from `createVideoLabBenchmarkBlob()` and compare:

- `environment.environment`
- `timings.renderMs`
- `timings.encodeSubmitMs`
- `timings.muxFinalizeMs`
- `timings.totalMs`
- `outputBytes`

The production decision must use measured deployed results, not Figma-only behavior.
