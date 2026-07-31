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
  addVideoTrack(source: MediabunnyVideoSampleSource, options?: { frameRate?: number }): void;
  start(): Promise<void>;
  finalize(): Promise<void>;
}

interface MediabunnyVideoSample {
  close(): void;
}

interface MediabunnyVideoSampleSource {
  add(sample: MediabunnyVideoSample): Promise<void>;
  close(): void;
}

interface MediabunnyRuntime {
  Output: Constructor<MediabunnyOutput>;
  Mp4OutputFormat: Constructor;
  WebMOutputFormat: Constructor;
  BufferTarget: Constructor<MediabunnyBufferTarget>;
  VideoSampleSource: new (
    config: { codec: 'avc' | 'vp9' | 'vp8'; bitrate: number },
  ) => MediabunnyVideoSampleSource;
  VideoSample: new (
    source: CanvasImageSource,
    init: { timestamp: number; duration: number; encodeOptions?: VideoEncoderEncodeOptions },
  ) => MediabunnyVideoSample;
}

type ExportSurface = {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
};

const now = () => globalThis.performance?.now?.() ?? Date.now();
const MAX_PENDING_FRAMES = 3;

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
  const required = ['Output', 'Mp4OutputFormat', 'WebMOutputFormat', 'BufferTarget', 'VideoSampleSource', 'VideoSample'] as const;
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

function createExportSurface(width: number, height: number): ExportSurface {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Could not create OffscreenCanvas export context.');
    return { canvas, context };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!context) throw new Error('Could not create hidden export canvas context.');
  return { canvas, context };
}

async function snapshotIntoSurface(
  sourceCanvas: HTMLCanvasElement,
  surface: ExportSurface,
  width: number,
  height: number,
): Promise<{ transferMs: number; drawMs: number }> {
  const transferStarted = now();
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(sourceCanvas);
    const transferMs = now() - transferStarted;
    const drawStarted = now();
    try {
      surface.context.clearRect(0, 0, width, height);
      surface.context.drawImage(bitmap, 0, 0, width, height);
    } finally {
      bitmap.close();
    }
    return { transferMs, drawMs: now() - drawStarted };
  }

  const drawStarted = now();
  surface.context.clearRect(0, 0, width, height);
  surface.context.drawImage(sourceCanvas, 0, 0, width, height);
  return { transferMs: now() - transferStarted, drawMs: now() - drawStarted };
}

export async function runMediabunnyMainThread(
  options: RunMediabunnyMainThreadOptions,
): Promise<VideoLabArtifact> {
  if (options.width <= 0 || options.height <= 0) throw new Error('Video Lab dimensions must be positive.');
  if (options.fps <= 0 || options.durationSeconds <= 0) throw new Error('Video Lab FPS and duration must be positive.');
  if (options.container === 'mp4' && options.codec !== 'avc1.42001f') throw new Error('MP4 production exports require H.264/AVC.');
  if (options.container === 'webm' && options.codec === 'avc1.42001f') throw new Error('WebM production exports require VP8 or VP9.');

  const totalStarted = now();
  const startedAt = new Date().toISOString();
  const totalFrames = Math.max(1, Math.round(options.durationSeconds * options.fps));
  const frameDuration = 1 / options.fps;

  abortIfNeeded(options.signal);
  const certificationStarted = now();
  const certification = options.certifyFrames === false
    ? { passed: true, samples: [], uniqueHashes: 0, reason: 'Production cutover uses post-encode playback certification.' }
    : await (async () => {
        emit(options.onProgress, { stage: 'certifying', frame: 0, totalFrames, message: 'Certifying animation frames…' });
        return certifyAnimationFrames({
          canvas: options.canvas,
          totalFrames,
          fps: options.fps,
          renderFrameAtTime: options.renderFrameAtTime,
          signal: options.signal,
        });
      })();
  const certificationMs = now() - certificationStarted;
  if (!certification.passed) throw new Error(certification.reason ?? 'Animation-frame certification failed.');

  abortIfNeeded(options.signal);
  emit(options.onProgress, { stage: 'preparing', frame: 0, totalFrames, message: 'Preparing dedicated Mediabunny export surfaces…' });
  const setupStarted = now();
  const runtime = assertRuntime(await loadMediabunny());
  const target = new runtime.BufferTarget();
  const format = options.container === 'mp4' ? new runtime.Mp4OutputFormat() : new runtime.WebMOutputFormat();
  const output = new runtime.Output({ format, target } as never);
  const source = new runtime.VideoSampleSource({
    codec: mapCodec(options.codec),
    bitrate: options.bitrate ?? defaultBitrate(options.width, options.height, options.fps),
  });
  output.addVideoTrack(source, { frameRate: options.fps });
  await output.start();
  const surfaces = Array.from({ length: MAX_PENDING_FRAMES }, () => createExportSurface(options.width, options.height));
  const setupMs = now() - setupStarted;

  let renderMs = 0;
  let frameTransferMs = 0;
  let stagingDrawMs = 0;
  let encodeSubmitMs = 0;
  let encodedFrames = 0;
  let peakPendingFrames = 0;
  const pending = new Set<Promise<void>>();

  const waitForCapacity = async (): Promise<void> => {
    if (pending.size < MAX_PENDING_FRAMES) return;
    await Promise.race(pending);
  };

  try {
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      abortIfNeeded(options.signal);
      await waitForCapacity();
      abortIfNeeded(options.signal);

      const timestamp = frameIndex * frameDuration;
      const renderStarted = now();
      await options.renderFrameAtTime(timestamp);
      renderMs += now() - renderStarted;
      emit(options.onProgress, { stage: 'rendering', frame: frameIndex + 1, totalFrames, message: `Rendering frame ${frameIndex + 1} of ${totalFrames}` });

      const surface = surfaces[frameIndex % surfaces.length];
      const staged = await snapshotIntoSurface(options.canvas, surface, options.width, options.height);
      frameTransferMs += staged.transferMs;
      stagingDrawMs += staged.drawMs;
      emit(options.onProgress, { stage: 'staging', frame: frameIndex + 1, totalFrames, message: `Staging frame ${frameIndex + 1} of ${totalFrames}` });

      const sample = new runtime.VideoSample(surface.canvas as CanvasImageSource, {
        timestamp,
        duration: frameDuration,
        encodeOptions: { keyFrame: frameIndex === 0 || frameIndex % Math.max(1, Math.round(options.fps * 2)) === 0 },
      });
      const encodeStarted = now();
      let task!: Promise<void>;
      task = source.add(sample)
        .then(() => {
          encodeSubmitMs += now() - encodeStarted;
          encodedFrames += 1;
          emit(options.onProgress, {
            stage: 'encoding',
            frame: encodedFrames,
            totalFrames,
            message: `Encoding frame ${encodedFrames} of ${totalFrames} · ${pending.size} pending`,
          });
        })
        .finally(() => {
          sample.close();
          pending.delete(task);
        });
      pending.add(task);
      peakPendingFrames = Math.max(peakPendingFrames, pending.size);
    }

    await Promise.all(pending);
  } finally {
    source.close();
  }

  abortIfNeeded(options.signal);
  emit(options.onProgress, { stage: 'finalizing', frame: totalFrames, totalFrames, message: 'Finalizing video container…' });
  const finalizeStarted = now();
  await output.finalize();
  const finalizeElapsed = now() - finalizeStarted;

  const blobStarted = now();
  const buffer = target.buffer;
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) throw new Error('Mediabunny finalized without producing an output buffer.');
  const type = mimeType(options.container, options.codec);
  const blob = new Blob([buffer], { type });
  const blobMs = now() - blobStarted;
  const completedAt = new Date().toISOString();

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
      frameTransferMs,
      stagingDrawMs,
      encodeSubmitMs,
      peakPendingFrames,
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
  emit(options.onProgress, { stage: 'complete', frame: totalFrames, totalFrames, message: 'Mediabunny export complete.' });
  return { blob, suggestedFilename: `blendcraft-video-lab-${options.codec.replaceAll('.', '-')}.${options.container}`, benchmark };
}
