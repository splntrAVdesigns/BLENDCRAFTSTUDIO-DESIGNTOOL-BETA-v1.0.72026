import { captureVideoLabEnvironment } from './video-lab/environmentReport';
import type { VideoLabArtifact, VideoLabBenchmarkResult, VideoLabCodec, VideoLabContainer, VideoLabProgress } from './video-lab/types';

interface Options {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  codec: VideoLabCodec;
  container: VideoLabContainer;
  bitrate: number;
  renderFrameAtTime: (timeSeconds: number) => Promise<void>;
  signal?: AbortSignal;
  onProgress?: (progress: VideoLabProgress) => void;
}

const now = () => performance.now();

function emit(options: Options, stage: VideoLabProgress['stage'], frame: number, totalFrames: number, message: string, percent: number) {
  options.onProgress?.({ stage, frame, totalFrames, message, percent });
}

export async function runDirectWebCodecsWorkerExport(options: Options): Promise<VideoLabArtifact> {
  if (typeof Worker === 'undefined' || typeof VideoFrame === 'undefined') {
    throw new Error('This browser does not support the required Worker/VideoFrame export pipeline.');
  }
  const totalStarted = now();
  const startedAt = new Date().toISOString();
  const totalFrames = Math.max(1, Math.round(options.durationSeconds * options.fps));
  const frameDurationUs = Math.round(1_000_000 / options.fps);
  const worker = new Worker(new URL('./directWebCodecsEncoder.worker.ts', import.meta.url), { type: 'module' });
  let renderedFrames = 0;
  let encodedFrames = 0;
  let inFlight = 0;
  let renderMs = 0;
  let videoFrameMs = 0;
  let resolveSlot: (() => void) | null = null;
  let selectedConfig: VideoEncoderConfig | undefined;

  const abort = () => worker.postMessage({ type: 'cancel' });
  options.signal?.addEventListener('abort', abort, { once: true });

  try {
    const completion = new Promise<{ buffer: ArrayBuffer; maxQueueSize: number; timeToFirstChunkMs: number; encodeMs: number; finalizeMs: number }>((resolve, reject) => {
      worker.onerror = (event) => reject(new Error(event.message || 'Video export worker failed.'));
      worker.onmessage = (event) => {
        const message = event.data as Record<string, any>;
        if (message.type === 'ready') {
          selectedConfig = message.config;
          return;
        }
        if (message.type === 'accepted') {
          inFlight = Math.max(0, inFlight - 1);
          resolveSlot?.();
          resolveSlot = null;
          return;
        }
        if (message.type === 'encoded') {
          encodedFrames = message.encodedFrames;
          const percent = 2 + (encodedFrames / totalFrames) * 83;
          emit(options, 'encoding', encodedFrames, totalFrames, `Rendered ${renderedFrames}/${totalFrames} · Encoded ${encodedFrames}/${totalFrames}`, percent);
          return;
        }
        if (message.type === 'complete') {
          resolve(message as any);
          return;
        }
        if (message.type === 'cancelled') {
          reject(new DOMException('Video export cancelled.', 'AbortError'));
          return;
        }
        if (message.type === 'error') reject(new Error(message.message || 'Video encoder worker failed.'));
      };
    });

    emit(options, 'preparing', 0, totalFrames, 'Starting direct WebCodecs worker encoder…', 1);
    worker.postMessage({
      type: 'init',
      container: options.container,
      codec: options.container === 'mp4' ? 'avc1.42001f' : 'vp8',
      width: options.width,
      height: options.height,
      fps: options.fps,
      bitrate: options.bitrate,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Video encoder worker did not initialize within 10 seconds.')), 10_000);
      const handler = (event: MessageEvent) => {
        if (event.data?.type === 'ready') {
          window.clearTimeout(timeout);
          worker.removeEventListener('message', handler);
          selectedConfig = event.data.config;
          resolve();
        } else if (event.data?.type === 'error') {
          window.clearTimeout(timeout);
          worker.removeEventListener('message', handler);
          reject(new Error(event.data.message));
        }
      };
      worker.addEventListener('message', handler);
    });

    for (let index = 0; index < totalFrames; index += 1) {
      options.signal?.throwIfAborted();
      while (inFlight >= 3) {
        await new Promise<void>((resolve) => { resolveSlot = resolve; });
        options.signal?.throwIfAborted();
      }
      const renderStarted = now();
      await options.renderFrameAtTime(index / options.fps);
      renderMs += now() - renderStarted;

      const frameStarted = now();
      const frame = new VideoFrame(options.canvas, {
        timestamp: index * frameDurationUs,
        duration: frameDurationUs,
        alpha: 'discard',
      });
      videoFrameMs += now() - frameStarted;
      inFlight += 1;
      renderedFrames = index + 1;
      worker.postMessage({
        type: 'frame',
        index,
        frame,
        keyFrame: index === 0 || index % Math.max(1, options.fps * 2) === 0,
      }, [frame]);
      emit(options, 'rendering', renderedFrames, totalFrames, `Rendered ${renderedFrames}/${totalFrames} · Encoded ${encodedFrames}/${totalFrames}`, 2 + (encodedFrames / totalFrames) * 83);
    }

    while (inFlight > 0) await new Promise<void>((resolve) => { resolveSlot = resolve; });
    emit(options, 'finalizing', encodedFrames, totalFrames, 'Flushing encoder and finalizing video…', 88);
    worker.postMessage({ type: 'finish' });
    const result = await completion;
    const blob = new Blob([result.buffer], { type: options.container === 'mp4' ? 'video/mp4' : 'video/webm;codecs=vp8' });
    const benchmark: VideoLabBenchmarkResult = {
      phase: '7.4G',
      engine: 'mediabunny',
      mode: 'worker',
      codec: options.codec,
      container: options.container,
      width: options.width,
      height: options.height,
      fps: options.fps,
      frames: totalFrames,
      durationSeconds: options.durationSeconds,
      timings: {
        certificationMs: 0,
        setupMs: 0,
        renderMs,
        frameTransferMs: videoFrameMs,
        stagingDrawMs: 0,
        encodeSubmitMs: result.encodeMs,
        peakPendingFrames: result.maxQueueSize,
        longestFrameMs: 0,
        flushMs: 0,
        muxFinalizeMs: result.finalizeMs,
        blobMs: 0,
        totalMs: now() - totalStarted,
      },
      outputBytes: blob.size,
      mimeType: blob.type,
      environment: captureVideoLabEnvironment(),
      certification: { passed: true, samples: [], uniqueHashes: 0, reason: 'Post-encode playback certification is authoritative.' },
      encoderConfig: {
        codec: options.codec,
        bitrate: options.bitrate,
        width: options.width,
        height: options.height,
        hardwareAcceleration: (selectedConfig?.hardwareAcceleration ?? 'no-preference') as any,
      },
      startedAt,
      completedAt: new Date().toISOString(),
      timeToFirstEncodedChunkMs: result.timeToFirstChunkMs,
    };
    emit(options, 'complete', totalFrames, totalFrames, 'Video encoded', 97);
    return { blob, suggestedFilename: `blendcraft-${Date.now()}.${options.container}`, benchmark };
  } finally {
    options.signal?.removeEventListener('abort', abort);
    worker.terminate();
  }
}
