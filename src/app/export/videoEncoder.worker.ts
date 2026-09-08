/** One worker owns one export. Native instrumentation is confined to this realm. */
import { Output, BufferTarget, Mp4OutputFormat, WebMOutputFormat, VideoSampleSource, VideoSample } from 'mediabunny';

const host = globalThis as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((event: MessageEvent) => void) | null };
const now = () => performance.timeOrigin + performance.now();
let flushStartedAt: number | null = null;
let flushCompletedAt: number | null = null;
let encoderClosedAt: number | null = null;
const NativeEncoder = globalThis.VideoEncoder;
// Preserve the native API, support probing and browser-default codec policy.
class MeasuredEncoder extends NativeEncoder {
  async flush(): Promise<void> {
    flushStartedAt = now();
    host.postMessage({ event: 'boundary', phase: 'native-flush', at: flushStartedAt });
    await super.flush();
    flushCompletedAt = now();
    host.postMessage({ event: 'boundary', phase: 'native-flush-complete', at: flushCompletedAt });
  }
  close(): void {
    super.close();
    encoderClosedAt = now();
    host.postMessage({ event: 'boundary', phase: 'encoder-closed', at: encoderClosedAt });
  }
}
globalThis.VideoEncoder = MeasuredEncoder;
let output: Output;
let target: BufferTarget;
let source: VideoSampleSource;
let tail = Promise.resolve();
host.onmessage = ({ data }) => {
  // Serialize frame requests even if a caller accidentally posts concurrently.
  tail = tail.then(async () => {
    try {
      if (data.type === 'init') {
        target = new BufferTarget();
        output = new Output({ target, format: data.container === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat() });
        source = new VideoSampleSource({
          codec: data.container === 'mp4' ? 'avc' : 'vp9', bitrate: data.bitrate,
          ...(data.container === 'webm' ? { latencyMode: 'realtime' as const, keyFrameInterval: data.keyFrameInterval } : {}),
          onEncoderConfig: config => host.postMessage({ event: 'config', config }),
          onEncodedPacket: packet => host.postMessage({ event: 'packet', timestamp: packet.timestamp, duration: packet.duration, arrivedAt: now() }),
        });
        output.addVideoTrack(source, { frameRate: data.fps });
        await output.start();
        host.postMessage({ id: data.id });
      } else if (data.type === 'frame') {
        const sample = new VideoSample(data.frame as VideoFrame);
        try { await source.add(sample); } finally { sample.close(); data.frame.close(); }
        host.postMessage({ id: data.id });
      } else if (data.type === 'finish') {
        const finalizeStartedAt = now();
        await output.finalize();
        const containerCompletedAt = now();
        if (!target.buffer?.byteLength) throw new Error('Encoder produced an empty file.');
        host.postMessage({ id: data.id, buffer: target.buffer, boundaries: {
          finalizeStartedAt, flushStartedAt, flushCompletedAt, encoderClosedAt, containerCompletedAt,
        } }, [target.buffer]);
      }
    } catch (error) {
      host.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
      // Main thread terminates this realm before any fallback is launched.
    }
  });
};
