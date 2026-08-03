import type { RecordingDiagnostics } from './recording/types';

export interface DeterministicTimelineCertification {
  readonly expectedFrames: number;
  readonly publishedFrames: number;
  readonly fps: number;
  readonly durationSeconds: number;
  readonly firstTimestampSeconds: 0;
  readonly lastTimestampSeconds: number;
  readonly frameDurationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly playbackReadable: true;
}

interface Input {
  readonly blob: Blob;
  readonly expectedDurationMs: number;
  readonly fps: number;
  readonly expectedWidth: number;
  readonly expectedHeight: number;
  readonly diagnostics: RecordingDiagnostics;
  readonly timeoutMs?: number;
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
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const onReady = () => finish(resolve);
    const onError = () => finish(() => reject(new Error('The exported WebM could not be opened by the browser decoder.')));
    const timer = window.setTimeout(
      () => finish(() => reject(new Error(`The exported WebM decoder probe timed out after ${timeoutMs} ms.`))),
      timeoutMs,
    );
    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener('loadeddata', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

export function createDeterministicTimeline(fps: number, durationMs: number) {
  const safeFps = Math.max(1, Math.round(fps));
  const expectedFrames = Math.max(1, Math.round(durationMs / 1000 * safeFps));
  const frameDurationSeconds = 1 / safeFps;
  return {
    fps: safeFps,
    expectedFrames,
    durationSeconds: expectedFrames / safeFps,
    frameDurationSeconds,
    firstTimestampSeconds: 0 as const,
    lastTimestampSeconds: (expectedFrames - 1) / safeFps,
  };
}

export async function certifyDeterministicTimeline(input: Input): Promise<DeterministicTimelineCertification> {
  const timeline = createDeterministicTimeline(input.fps, input.expectedDurationMs);
  const publishedFrames = input.diagnostics.publishedFrameCount;

  if (publishedFrames !== timeline.expectedFrames) {
    throw new Error(
      `Export frame certification failed: expected ${timeline.expectedFrames} frames, received ${publishedFrames}.`,
    );
  }
  if (input.blob.size <= 0) throw new Error('Export certification received an empty WebM file.');
  if (!input.blob.type.toLowerCase().includes('webm')) {
    throw new Error(`Export certification expected WebM, received ${input.blob.type || 'unknown MIME type'}.`);
  }

  const url = URL.createObjectURL(input.blob);
  try {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const readable = waitForReadableVideo(video, Math.max(1_000, input.timeoutMs ?? 8_000));
    video.src = url;
    video.load();
    await readable;

    if (video.videoWidth !== input.expectedWidth || video.videoHeight !== input.expectedHeight) {
      throw new Error(
        `Export resolution certification failed: expected ${input.expectedWidth}×${input.expectedHeight}, `
        + `received ${video.videoWidth}×${video.videoHeight}.`,
      );
    }

    return {
      ...timeline,
      publishedFrames,
      width: video.videoWidth,
      height: video.videoHeight,
      playbackReadable: true,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
