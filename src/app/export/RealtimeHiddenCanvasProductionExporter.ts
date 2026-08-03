import { exportWithProductionRecordingEngine, type ProductionRecordingRenderApi } from './recording/ProductionRecordingExportBridge';
import { certifyWebMPlayback, type WebMPlaybackCertification } from './recording/WebMPlaybackCertification';
import type { RecordingQuality, RecordingSessionResult } from './recording/types';

export interface RealtimeHiddenCanvasExportInput {
  readonly api: ProductionRecordingRenderApi;
  readonly sourceCanvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationMs: number;
  readonly quality: RecordingQuality;
  readonly resetExportPhase: boolean;
  readonly filename: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: number, message: string) => void;
}

type PlaybackCertification = WebMPlaybackCertification;

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
  }
}

export async function exportRealtimeHiddenCanvasVideo(
  input: RealtimeHiddenCanvasExportInput,
): Promise<RecordingSessionResult & { playback: PlaybackCertification }> {
  const startedAt = performance.now();
  console.info('[BLENDCRAFT Video Export] Started', {
    engine: 'realtime-hidden-canvas-media-recorder',
    width: input.width,
    height: input.height,
    fps: input.fps,
    durationMs: input.durationMs,
    quality: input.quality,
  });

  try {
    const result = await exportWithProductionRecordingEngine({
      api: input.api,
      sourceCanvas: input.sourceCanvas,
      width: input.width,
      height: input.height,
      fps: input.fps,
      durationMs: input.durationMs,
      quality: input.quality,
      resetExportPhase: input.resetExportPhase,
      signal: input.signal,
      onProgress: input.onProgress,
    });

    input.onProgress?.(97, 'Certifying video playback…');
    const playback = await certifyWebMPlayback({
      blob: result.blob,
      expectedDurationMs: input.durationMs,
      fps: input.fps,
    });
    input.onProgress?.(99, 'Preparing download…');
    downloadBlob(result.blob, input.filename);

    const totalDurationSec = (performance.now() - startedAt) / 1000;
    console.info('[BLENDCRAFT Video Export] Complete', {
      engine: 'realtime-hidden-canvas-media-recorder',
      totalDurationSec,
      blobBytes: result.blob.size,
      mimeType: result.mimeType,
      playbackDurationSec: playback.durationSeconds,
      playbackWidth: playback.width,
      playbackHeight: playback.height,
      playbackDurationSource: playback.durationSource,
      diagnostics: result.diagnostics,
    });
    return { ...result, playback };
  } catch (error) {
    console.error('[BLENDCRAFT Video Export] Failed', {
      engine: 'realtime-hidden-canvas-media-recorder',
      totalDurationSec: (performance.now() - startedAt) / 1000,
      error,
    });
    throw error;
  }
}
