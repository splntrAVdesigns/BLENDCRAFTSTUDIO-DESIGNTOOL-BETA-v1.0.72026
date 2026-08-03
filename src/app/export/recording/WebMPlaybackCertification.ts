export interface WebMPlaybackCertification {
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly durationSource: 'metadata' | 'seekable-range' | 'expected-duration-after-seek';
}

interface CertifyWebMPlaybackInput {
  readonly blob: Blob;
  readonly expectedDurationMs: number;
  readonly fps: number;
  readonly timeoutMs?: number;
}

function waitForEvent(
  target: HTMLMediaElement,
  eventNames: readonly string[],
  timeoutMs: number,
  errorMessage: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      eventNames.forEach((eventName) => target.removeEventListener(eventName, onEvent));
      target.removeEventListener('error', onError);
      window.clearTimeout(timeout);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onEvent = () => finish(resolve);
    const onError = () => finish(() => reject(new Error(errorMessage)));
    const timeout = window.setTimeout(
      () => finish(() => reject(new Error(`${errorMessage} Timed out after ${timeoutMs} ms.`))),
      timeoutMs,
    );
    eventNames.forEach((eventName) => target.addEventListener(eventName, onEvent, { once: true }));
    target.addEventListener('error', onError, { once: true });
  });
}

function finiteSeekableEnd(video: HTMLVideoElement): number | null {
  if (video.seekable.length <= 0) return null;
  const end = video.seekable.end(video.seekable.length - 1);
  return Number.isFinite(end) && end > 0 ? end : null;
}

async function resolveInfiniteWebMDuration(
  video: HTMLVideoElement,
  expectedDurationSeconds: number,
  fps: number,
  timeoutMs: number,
): Promise<{ durationSeconds: number; source: WebMPlaybackCertification['durationSource'] }> {
  // Chromium commonly reports MediaRecorder WebM files as Infinity because the
  // stream has no up-front Segment Duration. A far seek forces the demuxer to
  // scan the final cluster and exposes a finite duration/seekable end without
  // modifying the recorded bytes.
  const seekProbe = waitForEvent(
    video,
    ['durationchange', 'seeked', 'timeupdate', 'loadeddata'],
    timeoutMs,
    'The exported WebM could not resolve its final cluster during duration certification.',
  ).catch(() => undefined);

  try {
    video.currentTime = Number.MAX_SAFE_INTEGER;
  } catch {
    // Some hosts reject the enormous seek. A seek just beyond the expected end
    // still forces final-cluster discovery in Chromium/WebKit implementations.
    video.currentTime = expectedDurationSeconds + 1;
  }
  await seekProbe;

  if (Number.isFinite(video.duration) && video.duration > 0) {
    return { durationSeconds: video.duration, source: 'metadata' };
  }
  const seekableEnd = finiteSeekableEnd(video);
  if (seekableEnd !== null) {
    return { durationSeconds: seekableEnd, source: 'seekable-range' };
  }

  // Final verification for hosts that keep duration=Infinity even after a
  // successful seek: seek to the final expected frame and require the decoder
  // to acknowledge it. This certifies that the complete requested timeline is
  // present while avoiding a false failure caused only by missing WebM metadata.
  const finalFrameTime = Math.max(0, expectedDurationSeconds - 1 / Math.max(1, fps));
  const endProbe = waitForEvent(
    video,
    ['seeked', 'timeupdate', 'loadeddata'],
    timeoutMs,
    'The exported WebM could not decode its expected final frame.',
  );
  video.currentTime = finalFrameTime;
  await endProbe;

  if (video.readyState < HTMLMediaElement.HAVE_METADATA || video.currentTime + 0.25 < finalFrameTime) {
    throw new Error('The exported WebM did not expose the expected final frame during certification.');
  }
  return { durationSeconds: expectedDurationSeconds, source: 'expected-duration-after-seek' };
}

export async function certifyWebMPlayback(input: CertifyWebMPlaybackInput): Promise<WebMPlaybackCertification> {
  const timeoutMs = Math.max(1_000, input.timeoutMs ?? 8_000);
  const expectedDurationSeconds = input.expectedDurationMs / 1000;
  const url = URL.createObjectURL(input.blob);
  try {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    const metadataLoaded = waitForEvent(
      video,
      ['loadedmetadata'],
      timeoutMs,
      'The exported WebM could not be opened for playback certification.',
    );
    video.src = url;
    video.load();
    await metadataLoaded;

    if (video.videoWidth <= 0 || video.videoHeight <= 0) {
      throw new Error('Export playback certification reported an invalid video resolution.');
    }

    let durationSeconds = video.duration;
    let durationSource: WebMPlaybackCertification['durationSource'] = 'metadata';
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      const resolved = await resolveInfiniteWebMDuration(video, expectedDurationSeconds, input.fps, timeoutMs);
      durationSeconds = resolved.durationSeconds;
      durationSource = resolved.source;
    }

    const durationMs = durationSeconds * 1000;
    const toleranceMs = Math.max(250, 2_000 / Math.max(1, input.fps));
    if (Math.abs(durationMs - input.expectedDurationMs) > toleranceMs) {
      throw new Error(
        `Export duration certification failed: expected ${expectedDurationSeconds.toFixed(2)}s, received ${durationSeconds.toFixed(2)}s.`,
      );
    }

    return {
      durationSeconds,
      width: video.videoWidth,
      height: video.videoHeight,
      durationSource,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
