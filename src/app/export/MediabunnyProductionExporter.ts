import type { RenderApi } from '../types/gradient';
import { createOfflineExportRenderer } from './OfflineExportRenderer';
import { runDirectWebCodecsWorkerExport } from './DirectWebCodecsWorkerExporter';
import type { VideoLabCodec, VideoLabContainer, VideoLabProgress } from './video-lab/types';

export interface MediabunnyProductionExportOptions {
  api: RenderApi;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  container: VideoLabContainer;
  bitrate: number;
  filename: string;
  signal?: AbortSignal;
  onProgress?: (percent: number, message: string) => void;
}

export interface MediabunnyProductionExportResult {
  blob: Blob;
  filename: string;
  codec: VideoLabCodec;
  benchmark: Awaited<ReturnType<typeof runDirectWebCodecsWorkerExport>>['benchmark'];
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function mapProgress(progress: VideoLabProgress): { percent: number; message: string } {
  // Frame-truth progress: only frames accepted through Mediabunny backpressure
  // advance the main 90% of the bar.
  if (progress.stage === 'certifying') return { percent: 0, message: progress.message };
  if (progress.stage === 'preparing') return { percent: 1, message: progress.message };
  if (progress.stage === 'encoding') return { percent: 2 + progress.percent * 0.88, message: progress.message };
  if (progress.stage === 'finalizing') return { percent: 92, message: 'Finalizing video container…' };
  if (progress.stage === 'complete') return { percent: 97, message: 'Verifying video playback…' };
  return { percent: 1, message: progress.message };
}

async function certifyPlayableVideo(blob: Blob, expectedDurationSeconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Exported video could not be decoded within 15 seconds.')), 15_000);
      const cleanup = () => {
        window.clearTimeout(timeout);
        video.onloadedmetadata = null;
        video.onerror = null;
      };
      video.onloadedmetadata = () => {
        cleanup();
        if (!Number.isFinite(video.duration) || video.duration <= 0) {
          reject(new Error('Exported video has invalid duration metadata.'));
          return;
        }
        resolve();
      };
      video.onerror = () => {
        cleanup();
        reject(new Error('Browser could not decode the finalized video.'));
      };
      video.src = url;
      video.load();
    });

    const tolerance = Math.max(0.15, 2 / 30);
    if (Math.abs(video.duration - expectedDurationSeconds) > tolerance) {
      throw new Error(`Exported duration ${video.duration.toFixed(2)}s did not match expected ${expectedDurationSeconds.toFixed(2)}s.`);
    }

    if (video.duration > 0.25) {
      const target = Math.min(video.duration - 0.05, video.duration * 0.5);
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Exported video failed midpoint seek certification.')), 10_000);
        const cleanup = () => {
          window.clearTimeout(timeout);
          video.onseeked = null;
          video.onerror = null;
        };
        video.onseeked = () => { cleanup(); resolve(); };
        video.onerror = () => { cleanup(); reject(new Error('Exported video failed during seek certification.')); };
        video.currentTime = target;
      });
    }
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function exportVideoWithMediabunny(
  options: MediabunnyProductionExportOptions,
): Promise<MediabunnyProductionExportResult> {
  const { api, width, height, fps, durationMs, container, bitrate, filename, signal, onProgress } = options;
  const codec: VideoLabCodec = container === 'mp4' ? 'avc1.42001f' : 'vp8';
  const offline = createOfflineExportRenderer(width, height);

  throwIfAborted(signal);
  onProgress?.(1, 'Preparing independent offline renderer…');
  await api.waitForMaskTextures?.(4000);

  let lastProgressPercent = 1;
  try {
    // Phase 7.4F.1: capability selection happens inside the runner before the
    // first export frame is rendered. Do not warm or mutate the renderer until
    // the exact requested encoder profile has passed runtime probing.
    const artifact = await runDirectWebCodecsWorkerExport({
    canvas: offline.canvas,
    width,
    height,
    fps,
    durationSeconds: durationMs / 1000,
    codec,
    container,
    bitrate,
    signal,
    renderFrameAtTime: (timeSeconds) => api.renderAtTime(timeSeconds, offline.renderer, { seekMedia: true }),
    onProgress: (progress) => {
      const mapped = mapProgress(progress);
      lastProgressPercent = Math.max(lastProgressPercent, mapped.percent);
      onProgress?.(lastProgressPercent, mapped.message);
    },
  });

    onProgress?.(97, 'Verifying video playback…');
    await certifyPlayableVideo(artifact.blob, durationMs / 1000, signal);
    onProgress?.(100, 'Video export complete');

    const selectedContainer = artifact.benchmark.container;
    const selectedCodec = artifact.benchmark.codec;
    const baseName = filename.replace(/\.(webm|mp4)$/i, '');
    const selectedFilename = `${baseName}.${selectedContainer}`;
    console.info('[BLENDCRAFT Export 7.4H] Measured codec export complete', {
      encoder: artifact.benchmark.encoderConfig,
      selection: artifact.benchmark.measuredCodecSelection,
    });
    return { blob: artifact.blob, filename: selectedFilename, codec: selectedCodec, benchmark: artifact.benchmark };
  } finally {
    offline.dispose();
  }
}
