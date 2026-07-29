import { WebMMuxer } from '../lib/vendored/webm-muxer';

export type WebMCodecId = 'V_VP9' | 'V_VP8';

export interface WebMEncoderChoice {
  codec: string;
  codecId: WebMCodecId;
}

export interface WebMEncoderSessionOptions {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  codec: WebMEncoderChoice;
  frameDurationUs: number;
  expectedFrames: number;
}

export interface WebMEncoderStats {
  attemptedFrames: number;
  encodedChunks: number;
  keyFrames: number;
  bytes: number;
  expectedFrames: number;
}

export class WebMEncoderSession {
  private readonly muxer: WebMMuxer;
  private readonly options: WebMEncoderSessionOptions;
  private encoder: VideoEncoder | null = null;
  private closed = false;
  private attemptedFrames = 0;
  private encodedChunks = 0;
  private keyFrames = 0;
  private encodedBytes = 0;
  private encoderError: Error | null = null;

  constructor(options: WebMEncoderSessionOptions) {
    this.options = options;
    this.muxer = new WebMMuxer({
      width: options.width,
      height: options.height,
      codecId: options.codec.codecId,
      frameRate: options.fps,
    });
  }

  async open(): Promise<void> {
    const Encoder = (globalThis as any).VideoEncoder;
    if (typeof Encoder !== 'function') {
      throw new Error('WebCodecs VideoEncoder is unavailable in this browser.');
    }

    this.encoder = new Encoder({
      output: (chunk: EncodedVideoChunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        this.encodedChunks++;
        this.encodedBytes += data.byteLength;
        if (chunk.type === 'key') this.keyFrames++;
        this.muxer.addChunk({
          data,
          timestampUs: chunk.timestamp,
          durationUs: chunk.duration ?? this.options.frameDurationUs,
          keyFrame: chunk.type === 'key',
        });
      },
      error: (error: Error) => {
        this.encoderError = error instanceof Error ? error : new Error(String(error));
      },
    });

    this.encoder.configure({
      codec: this.options.codec.codec,
      width: this.options.width,
      height: this.options.height,
      bitrate: this.options.bitrate,
      framerate: this.options.fps,
      latencyMode: 'quality',
      // bitrateMode: 'constant' — prevents bitrate spikes on static gradient regions
      // that a VBR encoder would reduce to near-zero, causing artifacts on playback.
      // Matches the config used by exportWebMFromCanvas (the primary export path).
      bitrateMode: 'constant',
      // hardwareAcceleration: 'prefer-software' — gradient content has many uniform
      // regions that hardware encoders can mishandle. Software VP9 (libvpx) is
      // well-tested on this content type and produces consistent quality.
      // Matches the config used by exportWebMFromCanvas.
      hardwareAcceleration: 'prefer-software',
    } as VideoEncoderConfig);
  }

  encodeCanvas(canvas: HTMLCanvasElement, frameIndex: number): void {
    if (!this.encoder || this.closed) {
      throw new Error('WebM encoder session is not open.');
    }

    const timestamp = frameIndex * this.options.frameDurationUs;
    const frame = new VideoFrame(canvas, {
      timestamp,
      duration: this.options.frameDurationUs,
    });

    const keyFrame = frameIndex === 0 || frameIndex % this.options.fps === 0;
    this.encoder.encode(frame, { keyFrame });
    this.attemptedFrames++;
    frame.close();
  }

  get encodeQueueSize(): number {
    return (this.encoder as any)?.encodeQueueSize ?? 0;
  }

  async finalize(): Promise<{ bytes: Uint8Array; stats: WebMEncoderStats }> {
    if (!this.encoder || this.closed) {
      throw new Error('WebM encoder session already finalized.');
    }

    await this.encoder.flush();
    if (this.encoderError) throw this.encoderError;
    try { this.encoder.close(); } catch {}
    this.encoder = null;
    this.closed = true;

    const bytes = this.muxer.finalize();
    const stats = this.getStats(bytes.byteLength);

    if (stats.attemptedFrames !== this.options.expectedFrames) {
      throw new Error(`WebM frame-count mismatch: rendered ${stats.attemptedFrames}/${this.options.expectedFrames} frames.`);
    }
    if (stats.encodedChunks < Math.max(1, Math.floor(this.options.expectedFrames * 0.85))) {
      throw new Error(`WebM encoder produced too few chunks: ${stats.encodedChunks}/${this.options.expectedFrames}.`);
    }
    if (stats.bytes < 1024) {
      throw new Error(`WebM encoder produced an empty/suspicious payload (${stats.bytes} bytes).`);
    }

    return { bytes, stats };
  }

  close(): void {
    try { this.encoder?.close(); } catch {}
    this.encoder = null;
    this.closed = true;
  }

  getStats(bytes = this.encodedBytes): WebMEncoderStats {
    return {
      attemptedFrames: this.attemptedFrames,
      encodedChunks: this.encodedChunks,
      keyFrames: this.keyFrames,
      bytes,
      expectedFrames: this.options.expectedFrames,
    };
  }
}