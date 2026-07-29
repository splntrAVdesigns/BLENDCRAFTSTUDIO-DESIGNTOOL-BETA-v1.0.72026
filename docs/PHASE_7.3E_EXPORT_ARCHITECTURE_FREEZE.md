# Phase 7.3E Export Architecture Freeze

**Frozen at:** Phase 7.3E.9

## Frozen production foundation

The following behavior is now architectural authority and must not be replaced by broad refactors:

- Timestamped offline WebCodecs is the normal WebM path.
- Every encoded frame has an explicit timestamp and duration.
- Rendering time is independent from playback duration.
- The encoder is flushed once, after frame submission.
- Queue backpressure uses bounded `encodeQueueSize`/`dequeue` handling, never per-frame flushes.
- WebM muxing uses encoded chunk timestamps.
- MediaRecorder remains compatibility fallback only.
- Loop Lock is forward-only and never shortens requested duration.
- Loop planning uses the same mapped animation-speed authority as deterministic rendering.
- PNG and video preserve display-referred color and professional grain fidelity.
- Preview isolation, cancellation, cleanup, renderer restoration, and repeat-export ownership remain intact.

## Why this is frozen

These systems now produce valid files, exact non-loop duration, smooth motion, professional grain, and reliable restoration. Earlier regressions were caused by replacing known-good ownership with real-time recording, repeated encoder flushing, raw framebuffer color assumptions, or separate timing authorities.

## Allowed future changes

Incremental improvements are allowed when they preserve contracts above, including codec tuning, GPU export render targets, shader antialiasing, tighter color metadata, memory disposal, and diagnostics.

## Prohibited regressions

Do not:

- restore MediaRecorder as the default production engine;
- call `VideoEncoder.flush()` inside the frame loop;
- derive encoded duration from wall-clock export time;
- use raw UI slider speed for Loop Lock while rendering uses mapped speed;
- let PNG/video export permanently resize or reconfigure the editor preview;
- delete fallback modules until field certification and repository import audits pass.
