/**
 * PHASE 7.7c — Main-thread deterministic encoder session.
 *
 * WHY THIS EXISTS (the actual root cause of the slow export):
 *
 * The 7.7 pipeline created a VideoFrame from the WebGL canvas on the main
 * thread and then TRANSFERRED it to a Web Worker for encoding. A VideoFrame
 * constructed from a canvas is backed by a GPU texture. The worker has no GL
 * context, so every transferred frame forced a GPU->CPU readback across a
 * process boundary before libvpx could touch it. On-device measurement:
 *
 *   Probe D (everything on main thread):  18.8 fps  -> 150 frames in ~8s
 *   Shipped 7.7 (transfer to worker):     ~0.06 fps -> 18 frames in 5 minutes
 *
 * That is a ~300x penalty, and it is invisible to main-thread timers: render
 * measured 1.5-4.4ms per frame while the export crawled, because the cost was
 * paid inside the worker's encode() call after the transfer.
 *
 * Keeping the encoder on the main thread lets the frame stay on the GPU next to
 * the context that produced it. The preview is paused during export anyway, so
 * the usual "don't block the main thread" argument does not apply here — there
 * is no interactive work to protect. Responsiveness is preserved by yielding
 * between frames instead.
 */

import { WebMMuxer } from '../../lib/vendored/webm-muxer';
import { buildVp9CodecString } from './vp9Levels';
import type { DeterministicEncoderSelection } from './types';

interface CreateSessionInput {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly bitrate: number;
}

interface Candidate {
  readonly codecLabel: 'VP9' | 'VP8';
  readonly codecString: string;
  readonly codecId: 'V_VP9' | 'V_VP8';
}

export interface FinishedEncode {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly encodedFrames: number;
  readonly encodeMs: number;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export class DeterministicEncoderSession {
  private encoder: VideoEncoder;
  private muxer: WebMMuxer;
  private frameDurationUs: number;
  private encodedFrames = 0;
  private failure: Error | null = null;
  private startedAt = performance.now();
  /** Cumulative time spent inside encode() — the number that exposed the bug. */
  private encodeCallMs = 0;
  private maxQueue = 0;

  readonly selection: DeterministicEncoderSelection;

  private constructor(
    encoder: VideoEncoder,
    muxer: WebMMuxer,
    frameDurationUs: number,
    selection: DeterministicEncoderSelection,
  ) {
    this.encoder = encoder;
    this.muxer = muxer;
    this.frameDurationUs = frameDurationUs;
    this.selection = selection;
  }

  static async create(input: CreateSessionInput): Promise<DeterministicEncoderSession> {
    if (typeof VideoEncoder === 'undefined') {
      throw new Error('WebCodecs VideoEncoder is unavailable in this browser.');
    }
    const frameDurationUs = Math.round(1_000_000 / Math.max(1, input.fps));
    const vp9 = buildVp9CodecString(input.width, input.height, input.fps, input.bitrate);
    const candidates: Candidate[] = [
      { codecLabel: 'VP9', codecString: vp9, codecId: 'V_VP9' },
      { codecLabel: 'VP8', codecString: 'vp8', codecId: 'V_VP8' },
    ];

    const failures: string[] = [];
    for (const candidate of candidates) {
      const config: VideoEncoderConfig = {
        codec: candidate.codecString,
        width: input.width,
        height: input.height,
        bitrate: input.bitrate,
        framerate: input.fps,
        latencyMode: 'quality',
        bitrateMode: 'variable',
        hardwareAcceleration: 'no-preference',
        alpha: 'discard',
      };
      try {
        const support = await VideoEncoder.isConfigSupported(config);
        if (!support.supported) {
          failures.push(`${candidate.codecLabel}: unsupported`);
          continue;
        }
        const resolved = support.config ?? config;
        const muxer = new WebMMuxer({
          width: input.width,
          height: input.height,
          codecId: candidate.codecId,
          frameRate: input.fps,
        });
        let session: DeterministicEncoderSession | null = null;
        const encoder = new VideoEncoder({
          output: (chunk) => session?.handleChunk(chunk),
          error: (error) => { if (session) session.failure = toError(error); },
        });
        encoder.configure(resolved);
        session = new DeterministicEncoderSession(encoder, muxer, frameDurationUs, {
          codecLabel: candidate.codecLabel,
          codecString: resolved.codec,
          codecId: candidate.codecId,
          hardwareAcceleration: 'no-preference',
          bitrate: input.bitrate,
        });
        return session;
      } catch (error) {
        failures.push(`${candidate.codecLabel}: ${toError(error).message}`);
      }
    }
    throw new Error(`No WebCodecs video encoder accepted the export configuration. ${failures.join('; ')}`);
  }

  private handleChunk(chunk: EncodedVideoChunk): void {
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.muxer.addChunk({
      data,
      timestampUs: chunk.timestamp,
      durationUs: chunk.duration ?? this.frameDurationUs,
      keyFrame: chunk.type === 'key',
    });
    this.encodedFrames += 1;
  }

  get encodedFrameCount(): number { return this.encodedFrames; }
  get queueSize(): number { return this.encoder.encodeQueueSize; }
  get maxQueueSize(): number { return this.maxQueue; }
  get totalEncodeCallMs(): number { return this.encodeCallMs; }

  /**
   * Encodes and closes the frame. Returns the wall-clock cost of the encode()
   * call itself so the caller can surface it — this is precisely the timing
   * that was hidden by the worker boundary.
   */
  encode(frame: VideoFrame, keyFrame: boolean): number {
    if (this.failure) { frame.close(); throw this.failure; }
    const startedAt = performance.now();
    try {
      this.encoder.encode(frame, { keyFrame });
    } finally {
      frame.close();
    }
    const cost = performance.now() - startedAt;
    this.encodeCallMs += cost;
    this.maxQueue = Math.max(this.maxQueue, this.encoder.encodeQueueSize);
    return cost;
  }

  /** Yields until the encoder queue drains below the limit. */
  async waitForQueue(limit: number): Promise<void> {
    if (this.encoder.encodeQueueSize < limit) return;
    await new Promise<void>((resolve) => {
      const onDequeue = () => {
        if (this.encoder.encodeQueueSize < limit) {
          this.encoder.removeEventListener('dequeue', onDequeue);
          resolve();
        }
      };
      this.encoder.addEventListener('dequeue', onDequeue);
    });
  }

  async finish(): Promise<FinishedEncode> {
    if (this.failure) throw this.failure;
    await this.encoder.flush();
    if (this.failure) throw this.failure;
    const bytes = this.muxer.finalize();
    const encodeMs = performance.now() - this.startedAt;
    try { this.encoder.close(); } catch { /* Best-effort teardown. */ }
    return {
      bytes,
      mimeType: this.selection.codecId === 'V_VP9' ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8',
      encodedFrames: this.encodedFrames,
      encodeMs,
    };
  }

  dispose(): void {
    try { this.encoder.reset(); } catch { /* Best-effort teardown. */ }
    try { this.encoder.close(); } catch { /* Best-effort teardown. */ }
  }
}
