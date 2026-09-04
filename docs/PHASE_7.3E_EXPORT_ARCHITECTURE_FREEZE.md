# Phase 7.3E Export Architecture Freeze

**Frozen at:** Phase 7.3E.9; production capture contract amended by Phase 7.3F.3

## Frozen production foundation

The following behavior is now architectural authority and must not be replaced by broad refactors:

- Timestamped offline WebCodecs is the normal WebM path.
- Every encoded frame has an explicit timestamp and duration.
- Rendering time is independent from playback duration.
- MP4 and WebM share the Mediabunny `CanvasSource` engine.
- Every `CanvasSource.add(timestamp, duration)` is awaited for encoder/writer backpressure.
- `Output.finalize()` is the single completion barrier after all frames.
- MediaRecorder remains compatibility fallback only.
- Loop Lock is forward-only and never shortens requested duration.
- Loop planning uses the same mapped animation-speed authority as deterministic rendering.
- PNG and video capture the final display-referred presentation canvas first.
- Raw framebuffer readback is compatibility fallback only and may not override a valid presentation canvas.
- Preview and deterministic export use the same post-process selection authority.
- Custom ShaderMaterials apply Three.js' final output color-space conversion; intermediate targets remain Linear-sRGB.
- The actual decoded first video frame is compared with the CanvasSource staging frame.
- Preview isolation, cancellation, cleanup, renderer restoration, and repeat-export ownership remain intact.

## Why this is frozen

These systems now produce valid files, exact non-loop duration, smooth motion, professional grain, and reliable restoration. Earlier regressions were caused by replacing known-good ownership with real-time recording, repeated encoder flushing, raw framebuffer color assumptions, or separate timing authorities.

## Allowed future changes

Incremental improvements are allowed when they preserve contracts above, including codec tuning, shader antialiasing, memory disposal, and diagnostics.

## Prohibited regressions

Do not:

- restore MediaRecorder as the default production engine;
- call `VideoEncoder.flush()` inside the frame loop;
- construct canvas-sourced `VideoFrame`s with unsupported manually-cast color metadata;
- make raw render-target bytes the normal PNG or video source;
- derive encoded duration from wall-clock export time;
- use raw UI slider speed for Loop Lock while rendering uses mapped speed;
- let PNG/video export permanently resize or reconfigure the editor preview;
- delete fallback modules until field certification and repository import audits pass.
