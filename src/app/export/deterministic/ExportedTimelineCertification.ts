/**
 * PHASE 7.7 — Exported timeline certification.
 *
 * REPLACES the Phase 7.6 certification, which computed
 *   durationSeconds = expectedFrames / fps
 * from its own INPUT and never read `video.duration`. That made it
 * self-fulfilling: it logged `playbackDurationSec: 5` on files that were
 * actually 14 seconds long, which is why the duration defect survived
 * every QA pass.
 *
 * This module reads the duration back off the decoded file and FAILS on drift.
 */

export interface ExportedTimelineCertification {
  readonly expectedFrames: number;
  readonly encodedFrames: number;
  readonly fps: number;
  /** Timeline length the export was asked to produce. */
  readonly expectedDurationSeconds: number;
  /** Duration reported by the browser decoder for the real file. */
  readonly measuredDurationSeconds: number;
  readonly durationDriftMs: number;
  readonly width: number;
  readonly height: number;
  readonly playbackReadable: true;
}

export interface CertifyExportedTimelineInput {
  readonly blob: Blob;
  readonly expectedDurationMs: number;
  readonly fps: number;
  readonly expectedWidth: number;
  readonly expectedHeight: number;
  readonly encodedFrames: number;
  readonly timeoutMs?: number;
  /** Allowed drift. Defaults to 1.5 frame intervals. */
  readonly toleranceMs?: number;
}

function waitForReadableVideo(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
    };
    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      run();
    };
    const onReady = () => finish(resolve);
    const onError = () => finish(() => reject(new Error('The exported video could not be opened by the browser decoder.')));
    const timer = window.setTimeout(
      () => finish(() => reject(new Error(`The exported video decoder probe timed out after ${timeoutMs} ms.`))),
      timeoutMs,
    );
    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener('loadeddata', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

/**
 * Some hosts report Infinity for a freshly-muxed WebM until the file is seeked.
 * Seeking far past the end forces the decoder to resolve the real duration.
 */
function resolveDurationSeconds(video: HTMLVideoElement, timeoutMs: number): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    return Promise.resolve(video.duration);
  }
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      video.removeEventListener('durationchange', onDurationChange);
      resolve(Number.isFinite(video.duration) ? video.duration : Number.NaN);
    }, timeoutMs);
    const onDurationChange = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      window.clearTimeout(timer);
      video.removeEventListener('durationchange', onDurationChange);
      resolve(video.duration);
    };
    video.addEventListener('durationchange', onDurationChange);
    try { video.currentTime = 1e6; } catch { /* Optional host operation. */ }
  });
}

export async function certifyExportedTimeline(
  input: CertifyExportedTimelineInput,
): Promise<ExportedTimelineCertification> {
  const fps = Math.max(1, Math.round(input.fps));
  const expectedFrames = Math.max(1, Math.round((input.expectedDurationMs / 1000) * fps));
  const expectedDurationSeconds = expectedFrames / fps;
  const toleranceMs = input.toleranceMs ?? (1500 / fps);
  const timeoutMs = Math.max(1_000, input.timeoutMs ?? 8_000);

  if (input.encodedFrames !== expectedFrames) {
    throw new Error(
      `Export frame certification failed: expected ${expectedFrames} frames, encoded ${input.encodedFrames}.`,
    );
  }
  if (input.blob.size <= 0) throw new Error('Export certification received an empty video file.');

  const url = URL.createObjectURL(input.blob);
  try {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const readable = waitForReadableVideo(video, timeoutMs);
    video.src = url;
    video.load();
    await readable;

    if (video.videoWidth !== input.expectedWidth || video.videoHeight !== input.expectedHeight) {
      throw new Error(
        `Export resolution certification failed: expected ${input.expectedWidth}×${input.expectedHeight}, `
        + `received ${video.videoWidth}×${video.videoHeight}.`,
      );
    }

    const measuredDurationSeconds = await resolveDurationSeconds(video, 2_000);
    const durationDriftMs = Number.isFinite(measuredDurationSeconds)
      ? (measuredDurationSeconds - expectedDurationSeconds) * 1000
      : Number.NaN;

    // The whole point of the deterministic engine: drift is now an error, not
    // an unreported side effect.
    if (Number.isFinite(durationDriftMs) && Math.abs(durationDriftMs) > toleranceMs) {
      throw new Error(
        `Export duration certification failed: requested ${expectedDurationSeconds.toFixed(3)}s, `
        + `file reports ${measuredDurationSeconds.toFixed(3)}s `
        + `(drift ${durationDriftMs.toFixed(1)} ms, tolerance ±${toleranceMs.toFixed(1)} ms).`,
      );
    }

    return {
      expectedFrames,
      encodedFrames: input.encodedFrames,
      fps,
      expectedDurationSeconds,
      measuredDurationSeconds,
      durationDriftMs,
      width: video.videoWidth,
      height: video.videoHeight,
      playbackReadable: true,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
