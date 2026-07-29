import { saveVideoLabBenchmark } from './benchmarkStore';
import { captureVideoLabEnvironment } from './environmentReport';
import { certifyAnimationFrames } from './frameCertification';
import { loadMediabunny } from './mediabunnyLoader';
import type {
  RunMediabunnyMainThreadOptions,
  VideoLabArtifact,
  VideoLabCodec,
  VideoLabProgress,
} from './types';

type Constructor<T = object> = new (...args: never[]) => T;

interface MediabunnyBufferTarget {
  buffer: ArrayBuffer | null;
}

interface MediabunnyOutput {
  target: MediabunnyBufferTarget;
  addVideoTrack(source: MediabunnyCanvasSource, options?: { frameRate?: number }): void;
  start(): Promise<void>;
  finalize(): Promise<void>;
}

interface MediabunnyCanvasSource {
  add(timestamp: number, duration?: number, options?: VideoEncoderEncodeOptions): Promise<void>;
}

interface MediabunnyRuntime {
  Output: Constructor<MediabunnyOutput>;
  Mp4OutputFormat: Constructor;
  WebMOutputFormat: Constructor;
  BufferTarget: Constructor<MediabunnyBufferTarget>;
  CanvasSource: new (
    canvas: HTMLCanvasElement | OffscreenCanvas,
    config: { codec: 'avc' | 'vp9' | 'vp8'; bitrate: number },
  ) => MediabunnyCanvasSource;
}

const now = () => globalThis.performance?.now?.() ?? Date.now();

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Video Export Lab cancelled.', 'AbortError');
}

function emit(
  callback: RunMediabunnyMainThreadOptions['onProgress'],
  progress: Omit<VideoLabProgress, 'percent'>,
): void {
  callback?.({
    ...progress,
    percent: progress.totalFrames > 0
      ? Math.min(100, Math.max(0, Math.round((progress.frame / progress.totalFrames) * 100)))
      : 0,
  });
}

function assertRuntime(module: Record<string, unknown>): MediabunnyRuntime {
  const required = ['Output', 'Mp4OutputFormat', 'WebMOutputFormat', 'BufferTarget', 'CanvasSource'] as const;
  for (const key of required) {
    if (typeof module[key] !== 'function') {
      throw new Error(`Installed Mediabunny build is missing the required ${key} export.`);
    }
  }
  return module as unknown as MediabunnyRuntime;
}

function mapCodec(codec: VideoLabCodec): 'avc' | 'vp9' | 'vp8' {
  if (codec === 'avc1.42001f') return 'avc';
  if (codec === 'vp09.00.10.08') return 'vp9';
  return 'vp8';
}

function defaultBitrate(width: number, height: number, fps: number): number {
  const raw = width * height * fps * 0.16;
  return Math.max(6_000_000, Math.min(40_000_000, Math.round(raw)));
}

function mimeType(container: 'mp4' | 'webm', codec: VideoLabCodec): string {
  if (container === 'mp4') return 'video/mp4';
  return codec === 'vp8' ? 'video/webm;codecs=vp8' : 'video/webm;codecs=vp9';
}

export async function runMediabunnyMainThread(
  options: RunMediabunnyMainThreadOptions,
): Promise<VideoLabArtifact> {
  if (options.width <= 0 || options.height <= 0) throw new Error('Video Lab dimensions must be positive.');
  if (options.fps <= 0 || options.durationSeconds <= 0) throw new Error('Video Lab FPS and duration must be positive.');
  if (options.container === 'mp4' && options.codec !== 'avc1.42001f') {
    throw new Error('Phase 7.3F.1 MP4 proof runs require H.264/AVC.');
  }
  if (options.container === 'webm' && options.codec === 'avc1.42001f') {
    throw new Error('Phase 7.3F.1 WebM proof runs require VP8 or VP9.');
  }

  const totalStarted = now();
  const startedAt = new Date().toISOString();
  const totalFrames = Math.max(1, Math.round(options.durationSeconds * options.fps));
  const frameDuration = 1 / options.fps;

  abortIfNeeded(options.signal);
  emit(options.onProgress, {
    stage: 'certifying', frame: 0, totalFrames, message: 'Certifying animation frames…',
  });
  const certificationStarted = now();
  const certification = await certifyAnimationFrames({
    canvas: options.canvas,
    totalFrames,
    fps: options.fps,
    renderFrameAtTime: options.renderFrameAtTime,
    signal: options.signal,
  });
  const certificationMs = now() - certificationStarted;
  if (!certification.passed) throw new Error(certification.reason ?? 'Animation-frame certification failed.');

  abortIfNeeded(options.signal);
  emit(options.onProgress, {
    stage: 'preparing', frame: 0, totalFrames, message: 'Preparing isolated Mediabunny encoder…',
  });
  const setupStarted = now();
  const runtime = assertRuntime(await loadMediabunny());
  const target = new runtime.BufferTarget();
  const format = options.container === 'mp4'
    ? new runtime.Mp4OutputFormat()
    : new runtime.WebMOutputFormat();
  const output = new runtime.Output({ format, target } as never);
  const source = new runtime.CanvasSource(options.canvas, {
    codec: mapCodec(options.codec),
    bitrate: options.bitrate ?? defaultBitrate(options.width, options.height, options.fps),
  });
  output.addVideoTrack(source, { frameRate: options.fps });
  await output.start();
  const setupMs = now() - setupStarted;

  let renderMs = 0;
  let encodeSubmitMs = 0;
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    abortIfNeeded(options.signal);
    const timestamp = frameIndex * frameDuration;

    const renderStarted = now();
    await options.renderFrameAtTime(timestamp);
    renderMs += now() - renderStarted;

    abortIfNeeded(options.signal);
    const encodeStarted = now();
    await source.add(timestamp, frameDuration, {
      keyFrame: frameIndex === 0 || frameIndex % Math.max(1, Math.round(options.fps * 2)) === 0,
    });
    encodeSubmitMs += now() - encodeStarted;

    emit(options.onProgress, {
      stage: 'rendering',
      frame: frameIndex + 1,
      totalFrames,
      message: `Encoding certified frame ${frameIndex + 1} of ${totalFrames}`,
    });
  }

  abortIfNeeded(options.signal);
  emit(options.onProgress, {
    stage: 'finalizing', frame: totalFrames, totalFrames, message: 'Finalizing video container…',
  });
  const finalizeStarted = now();
  await output.finalize();
  const finalizeElapsed = now() - finalizeStarted;

  const blobStarted = now();
  const buffer = target.buffer;
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
    throw new Error('Mediabunny finalized without producing an output buffer.');
  }
  const type = mimeType(options.container, options.codec);
  const blob = new Blob([buffer], { type });
  const blobMs = now() - blobStarted;
  const completedAt = new Date().toISOString();
  const extension = options.container;

  const benchmark = {
    phase: '7.3F.1' as const,
    engine: 'mediabunny' as const,
    mode: 'main-thread' as const,
    codec: options.codec,
    container: options.container,
    width: options.width,
    height: options.height,
    fps: options.fps,
    frames: totalFrames,
    durationSeconds: totalFrames / options.fps,
    timings: {
      certificationMs,
      setupMs,
      renderMs,
      encodeSubmitMs,
      flushMs: 0,
      muxFinalizeMs: finalizeElapsed,
      blobMs,
      totalMs: now() - totalStarted,
    },
    outputBytes: blob.size,
    mimeType: type,
    environment: captureVideoLabEnvironment(),
    certification,
    startedAt,
    completedAt,
  };

  saveVideoLabBenchmark(benchmark);
  emit(options.onProgress, {
    stage: 'complete', frame: totalFrames, totalFrames, message: 'Mediabunny proof export complete.',
  });

  return {
    blob,
    suggestedFilename: `blendcraft-video-lab-${options.codec.replaceAll('.', '-')}.${extension}`,
    benchmark,
  };
}
