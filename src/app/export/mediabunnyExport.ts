/** Phase 7.3F.8: deterministic visible-canvas snapshots, with encoding and
 * container completion owned by an isolated worker. VideoSampleSource uses the
 * same Mediabunny encoder wrapper as CanvasSource, without another pixel copy.
 */
import { canEncodeVideo, type VideoCodec } from 'mediabunny';
import { ExportWorkerClient } from './exportWorkerClient';
import {
  certifyExportTimeline,
  type ExportTimelineCertificationResult,
  type ExportTimelineFrameCertification,
  type RenderedTimelineFrameState,
} from '../utils/exportTimelineCertification';

export type MediabunnyContainer = 'mp4' | 'webm';

export interface MediabunnyEncodeOptions {
  /** Canvas Mediabunny reads pixels from on each add() call. Caller is
   *  responsible for drawing the correct frame content into it before
   *  calling drawFrame's returned/awaited step — see drawFrame below. */
  stagingCanvas: HTMLCanvasElement;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  /** Target bitrate in bits/sec. */
  bitrate: number;
  container: MediabunnyContainer;
  /**
   * Called once per frame, before that frame is captured. Must render the
   * scene and draw the result onto `stagingCanvas` (synchronously or via
   * the returned promise) before resolving.
   */
  drawFrame: (frameIndex: number, timeSeconds: number) => Promise<RenderedTimelineFrameState | void> | RenderedTimelineFrameState | void;
  /** Maximum seconds between keyframes. Mediabunny defaults to 2s if omitted. */
  keyFrameIntervalSeconds?: number;
  signal?: AbortSignal;
  onProgress?: (progress: number, message?: string) => void;
  /** Called once Mediabunny supplies the active browser encoder config. */
  onEncoderConfig?: (info: {
    codec: string;
    hardwareAcceleration?: string;
    width: number;
    height: number;
    latencyMode?: 'quality' | 'realtime';
    policy: 'browser-default' | 'webm-realtime';
  }) => void;
}

export interface MediabunnyEncodeResult {
  blob: Blob;
  container: MediabunnyContainer;
  mimeType: string;
  /** Wall-clock time spent inside drawFrame across all frames, ms. */
  renderMs: number;
  /** Wall-clock time spent awaiting CanvasSource.add() across all
   *  frames, ms. This is the real encode + backpressure cost — the honest
   *  replacement for the old "queueWaitMs" watermark-drain metric. */
  encodeMs: number;
  /** Public Mediabunny completion boundary: encoder drain + mux/target finalize.
   *  Includes native flush, encoder closure and container completion. */
  finalizeMs: number;
  flushMs: number | null;
  containerCompletionMs: number | null;
  jobId: string;
  /** Frame-by-frame proof that render and CanvasSource consumed one timeline. */
  timelineCertification: ExportTimelineCertificationResult;
}

let activeExportJob: string | null = null;

const OBSOLETE_H264_PERFORMANCE_PREFIX = 'blendcraft:h264-encoder-performance:v2';
let obsoleteH264HistoryCleared = false;

/** Remove Phase 7.3F.5's preference-driving history once, without touching any
 * other saved project or application state. Encoder timings remain reported in
 * __exportTiming but never choose a production encoder configuration. */
export function clearObsoleteH264PerformanceHistory(): void {
  if (obsoleteH264HistoryCleared) return;
  obsoleteH264HistoryCleared = true;
  try {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(OBSOLETE_H264_PERFORMANCE_PREFIX))
      .forEach((key) => localStorage.removeItem(key));
  } catch {
    // Storage can be disabled. Encoder construction must remain available.
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

function mediaCodecFor(container: MediabunnyContainer): VideoCodec {
  return container === 'mp4' ? 'avc' : 'vp9';
}

/**
 * Capability probe: can this browser actually encode the given
 * container/codec/resolution/framerate combination right now? Replaces the
 * hand-rolled AVC level-table walk and the WebM VP9/VP8 candidate probing —
 * Mediabunny's canEncodeVideo() queries the browser's real WebCodecs support
 * directly instead of guessing from a static table.
 */
export async function canEncodeContainer(
  container: MediabunnyContainer,
  width: number,
  height: number,
  fps: number,
): Promise<boolean> {
  try {
    return await canEncodeVideo(mediaCodecFor(container), {
      width,
      height,
      framerate: fps,
    } as never);
  } catch {
    return false;
  }
}

/**
 * Core Mediabunny encode pass. Container-agnostic — MP4 and WebM take the
 * identical code path, differing only in which OutputFormat/codec gets
 * selected. This symmetry is itself a simplification: the previous code had
 * two largely-parallel ~250-line implementations (exportMP4FromCanvas,
 * exportWebMFromCanvas) that had independently drifted in behavior.
 */
export async function encodeVideoWithMediabunny(
  options: MediabunnyEncodeOptions,
): Promise<MediabunnyEncodeResult> {
  const {
    stagingCanvas,
    width,
    height,
    fps,
    totalFrames,
    bitrate,
    container,
    drawFrame,
    signal,
    onProgress,
    onEncoderConfig,
  } = options;

  throwIfAborted(signal);
  if (totalFrames <= 0) throw new Error(`totalFrames must be positive (got ${totalFrames}).`);
  if (stagingCanvas.width !== width || stagingCanvas.height !== height) {
    throw new Error(
      `stagingCanvas is ${stagingCanvas.width}\u00d7${stagingCanvas.height} but encode was requested at ${width}\u00d7${height} — caller must size the canvas before calling.`
    );
  }

  if (activeExportJob !== null) throw new DOMException('Another video export is active.', 'InvalidStateError');
  const jobId = crypto.randomUUID();
  const epochNow = () => performance.timeOrigin + performance.now();
  let finalizationStartedAt: number | null = null;
  let stoppedAt: number | null = null;
  const encoderProgress = {
    jobId, phase: 'encoding', submittedFrames: 0, outputPackets: 0,
    lastPacketTimestamp: null as number | null, lastPacketArrivedAt: null as number | null,
    get finalizationElapsedSec(): number {
      return finalizationStartedAt == null ? 0 : Math.max(0,
        ((this.boundaries.containerCompletedAt ?? stoppedAt ?? epochNow()) - finalizationStartedAt) / 1000);
    },
    get secondsSinceLastPacket(): number {
      return this.lastPacketArrivedAt == null ? 0 : Math.max(0,
        ((this.boundaries.containerCompletedAt ?? stoppedAt ?? epochNow()) - this.lastPacketArrivedAt) / 1000);
    },
    packets: [] as Array<{ timestamp: number; duration: number; arrivedAt: number }>,
    boundaries: {} as Record<string, number | null>,
  };
  (globalThis as any).__blendcraftEncoderProgress = encoderProgress;
  if (container === 'mp4') clearObsoleteH264PerformanceHistory();
  const worker = new Worker(new URL('./videoEncoder.worker.ts', import.meta.url), { type: 'module' });
  activeExportJob = jobId;
  const client = new ExportWorkerClient(worker, signal, event => {
    if (event.event === 'packet') {
      encoderProgress.outputPackets++;
      encoderProgress.lastPacketTimestamp = event.timestamp;
      encoderProgress.lastPacketArrivedAt = event.arrivedAt;
      encoderProgress.packets.push({ timestamp: event.timestamp, duration: event.duration, arrivedAt: event.arrivedAt });
    } else if (event.event === 'boundary') {
      encoderProgress.boundaries[event.phase] = event.at;
      encoderProgress.phase = event.phase;
      onProgress?.(event.phase === 'encoder-closed' ? 95 : 91,
        event.phase === 'native-flush' ? 'Draining encoder...' : 'Completing video container...');
    } else if (event.event === 'config') {
      onEncoderConfig?.({ ...event.config, policy: container === 'mp4' ? 'browser-default' : 'webm-realtime' });
    }
  });
  // Scoped to this job; restoration also runs on abort, timeout and worker failure.
  const quietStyle = document.createElement('style');
  quietStyle.textContent = '* { animation-play-state: paused !important; transition: none !important; }';
  document.head.appendChild(quietStyle);
  let finished = false;
  try {
    await client.request({ type: 'init', container, bitrate, fps, keyFrameInterval: options.keyFrameIntervalSeconds ?? 2 });
    let renderMs = 0;
    let encodeMs = 0;
    const timelineFrames: ExportTimelineFrameCertification[] = [];
    const progressStep = Math.max(1, Math.floor(totalFrames / 20));
    for (let i = 0; i < totalFrames; i++) {
      throwIfAborted(signal);
      const t = i / fps;
      const renderStart = performance.now();
      const rendered = await drawFrame(i, t);
      renderMs += performance.now() - renderStart;
      throwIfAborted(signal);
      const encodeStart = performance.now();
      // Snapshot synchronously before the renderer can advance. Transfer ownership;
      // no image resizing, second canvas draw, dropped frames or display-paced wait.
      const timestamp = Math.round(i * 1_000_000 / fps);
      const duration = Math.round((i + 1) * 1_000_000 / fps) - timestamp;
      const frame = new VideoFrame(stagingCanvas, { timestamp, duration, alpha: 'discard' });
      try { await client.request({ type: 'frame', frame }, [frame]); }
      finally { frame.close(); }
      throwIfAborted(signal);
      encodeMs += performance.now() - encodeStart;
      encoderProgress.submittedFrames = i + 1;
      timelineFrames.push({ frameIndex: i, requestedTimestamp: t,
        renderedDeterministicTime: rendered?.renderedDeterministicTime ?? Number.NaN,
        encodedTimestamp: timestamp / 1_000_000, encodedDuration: duration / 1_000_000,
        layers: rendered?.layers ?? [], motion: rendered?.motion ?? [],
      });
      if (i % progressStep === 0 || i === totalFrames - 1) {
        onProgress?.(5 + ((i + 1) / totalFrames) * 85, `Frame ${i + 1}/${totalFrames}`);
      }
    }
    throwIfAborted(signal);
    finalizationStartedAt = epochNow();
    encoderProgress.phase = 'finalizing';
    onProgress?.(91, 'Draining encoder...');
    const completion = await client.request({ type: 'finish' });
    throwIfAborted(signal);
    const boundaries = completion.boundaries;
    encoderProgress.boundaries = boundaries;
    const finalizeMs = boundaries.containerCompletedAt - boundaries.finalizeStartedAt;
    const flushMs = boundaries.flushCompletedAt == null || boundaries.flushStartedAt == null ? null
      : boundaries.flushCompletedAt - boundaries.flushStartedAt;
    const containerCompletionMs = boundaries.encoderClosedAt == null ? null
      : boundaries.containerCompletedAt - boundaries.encoderClosedAt;
    finalizationStartedAt = boundaries.finalizeStartedAt;
    encoderProgress.phase = 'completed';
    const mimeType = container === 'mp4' ? 'video/mp4' : 'video/webm';
    finished = true;
    return { blob: new Blob([completion.buffer], { type: mimeType }), container, mimeType,
      renderMs, encodeMs, finalizeMs, flushMs, containerCompletionMs, jobId,
      timelineCertification: certifyExportTimeline(timelineFrames, fps, totalFrames),
    };
  } finally {
    stoppedAt = epochNow();
    encoderProgress.boundaries.workerCleanupStartedAt = stoppedAt;
    client.stop();
    encoderProgress.boundaries.workerCleanupCompletedAt = epochNow();
    quietStyle.remove();
    if (activeExportJob === jobId) activeExportJob = null;
    if (!finished) encoderProgress.phase = signal?.aborted ? 'cancelled' : 'failed';
  }
}
