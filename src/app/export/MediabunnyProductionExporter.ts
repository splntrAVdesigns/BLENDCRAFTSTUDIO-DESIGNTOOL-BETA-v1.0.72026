import type { RenderApi } from '../types/gradient';
import { createAuthoritativeExportFrameSource } from './AuthoritativeExportFrameSource';
import { runMediabunnyMainThread } from './video-lab/mainThreadRunner';
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
  benchmark: Awaited<ReturnType<typeof runMediabunnyMainThread>>['benchmark'];
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function mapProgress(progress: VideoLabProgress): { percent: number; message: string } {
  // Reserve the final 8% for mux finalization and playback certification.
  if (progress.stage === 'certifying') return { percent: Math.min(4, progress.percent * 0.04), message: progress.message };
  if (progress.stage === 'preparing') return { percent: 5, message: 'Preparing Mediabunny encoder…' };
  if (progress.stage === 'rendering') return { percent: 6 + progress.percent * 0.86, message: progress.message };
  if (progress.stage === 'finalizing') return { percent: 94, message: 'Finalizing video container…' };
  return { percent: 100, message: 'Video export complete' };
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
  if (!api.setExportSize || !api.restoreSize) throw new Error('Export-size renderer controls are unavailable.');

  const codec: VideoLabCodec = container === 'mp4' ? 'avc1.42001f' : 'vp8';
  const source = createAuthoritativeExportFrameSource(api);

  throwIfAborted(signal);
  onProgress?.(1, 'Preparing authoritative renderer…');
  await api.waitForMaskTextures?.(4000);
  api.setExportSize(width, height);

  // Let Three.js commit the resized drawing buffer before frame zero.
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    requestAnimationFrame(finish);
    window.setTimeout(finish, 50);
  });
  await source.renderFrame(0, true);
  throwIfAborted(signal);

  const artifact = await runMediabunnyMainThread({
    canvas: source.canvas,
    width,
    height,
    fps,
    durationSeconds: durationMs / 1000,
    codec,
    container,
    bitrate,
    certifyFrames: false,
    signal,
    renderFrameAtTime: (timeSeconds) => source.renderFrame(timeSeconds, true),
    onProgress: (progress) => {
      const mapped = mapProgress(progress);
      onProgress?.(mapped.percent, mapped.message);
    },
  });

  onProgress?.(97, 'Verifying video playback…');
  await certifyPlayableVideo(artifact.blob, durationMs / 1000, signal);
  onProgress?.(100, 'Video export complete');

  return { blob: artifact.blob, filename, codec, benchmark: artifact.benchmark };
}
