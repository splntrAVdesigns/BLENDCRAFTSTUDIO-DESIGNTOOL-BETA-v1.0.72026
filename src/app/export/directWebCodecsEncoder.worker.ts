import {
  BufferTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from 'mediabunny';

type Container = 'webm' | 'mp4';
type Codec = 'vp8' | 'avc1.42001f';

interface InitMessage {
  type: 'init';
  container: Container;
  codec: Codec;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
}
interface FrameMessage { type: 'frame'; index: number; frame: VideoFrame; keyFrame: boolean }
interface FinishMessage { type: 'finish' }
interface CancelMessage { type: 'cancel' }
type Inbound = InitMessage | FrameMessage | FinishMessage | CancelMessage;

let encoder: VideoEncoder | null = null;
let output: Output | null = null;
let source: EncodedVideoPacketSource | null = null;
let target: BufferTarget | null = null;
let cancelled = false;
let encodedFrames = 0;
let firstChunk = true;
let packetChain: Promise<void> = Promise.resolve();
let frameChain: Promise<void> = Promise.resolve();
let firstChunkAt = 0;
let startedAt = 0;
let maxQueueSize = 0;

const workerScope = globalThis as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void };

function post(type: string, detail: Record<string, unknown> = {}, transfer: Transferable[] = []) {
  workerScope.postMessage({ type, ...detail }, transfer);
}

function waitForQueueSlot(limit = 3): Promise<void> {
  if (!encoder || encoder.encodeQueueSize < limit) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const current = encoder;
    if (!current) { reject(new Error('Video encoder is unavailable.')); return; }
    const onDequeue = () => {
      if (current.encodeQueueSize < limit) {
        current.removeEventListener('dequeue', onDequeue);
        resolve();
      }
    };
    current.addEventListener('dequeue', onDequeue);
  });
}

async function initialize(message: InitMessage) {
  if (typeof VideoEncoder === 'undefined') throw new Error('WebCodecs VideoEncoder is unavailable.');
  const config: VideoEncoderConfig = {
    codec: message.codec,
    width: message.width,
    height: message.height,
    bitrate: message.bitrate,
    framerate: message.fps,
    latencyMode: 'realtime',
    bitrateMode: 'variable',
    hardwareAcceleration: 'no-preference',
    alpha: 'discard',
  };
  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) throw new Error(`Unsupported encoder configuration: ${message.codec} ${message.width}×${message.height}.`);

  target = new BufferTarget();
  const format = message.container === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat();
  output = new Output({ format, target });
  source = new EncodedVideoPacketSource(message.container === 'mp4' ? 'avc' : 'vp8');
  output.addVideoTrack(source, { frameRate: message.fps });
  await output.start();

  startedAt = performance.now();
  encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      if (!source || cancelled) return;
      if (!firstChunkAt) firstChunkAt = performance.now();
      const packet = EncodedPacket.fromEncodedChunk(chunk);
      const meta = firstChunk ? metadata : undefined;
      firstChunk = false;
      packetChain = packetChain.then(async () => {
        if (cancelled || !source) return;
        await source.add(packet, meta);
        encodedFrames += 1;
        post('encoded', { encodedFrames, queueSize: encoder?.encodeQueueSize ?? 0 });
      });
    },
    error: (error) => post('error', { message: error.message || String(error) }),
  });
  const selectedConfig = support.config ?? config;
  encoder.configure(selectedConfig);
  post('ready', { config: selectedConfig });
}

async function acceptFrame(message: FrameMessage) {
  if (cancelled) { message.frame.close(); return; }
  if (!encoder) { message.frame.close(); throw new Error('Encoder has not been initialized.'); }
  await waitForQueueSlot(3);
  if (cancelled) { message.frame.close(); return; }
  encoder.encode(message.frame, { keyFrame: message.keyFrame });
  message.frame.close();
  maxQueueSize = Math.max(maxQueueSize, encoder.encodeQueueSize);
  post('accepted', { index: message.index, queueSize: encoder.encodeQueueSize });
}

async function finish() {
  if (!encoder || !output || !source || !target) throw new Error('Encoder has not been initialized.');
  await frameChain;
  await encoder.flush();
  await packetChain;
  source.close();
  const finalizeStarted = performance.now();
  await output.finalize();
  const buffer = target.buffer;
  if (!buffer) throw new Error('Mediabunny produced no output buffer.');
  post('complete', {
    buffer,
    encodedFrames,
    maxQueueSize,
    timeToFirstChunkMs: firstChunkAt ? firstChunkAt - startedAt : 0,
    encodeMs: finalizeStarted - startedAt,
    finalizeMs: performance.now() - finalizeStarted,
  }, [buffer]);
}

self.onmessage = (event: MessageEvent<Inbound>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    cancelled = true;
    try { encoder?.reset(); } catch {}
    try { encoder?.close(); } catch {}
    post('cancelled');
    return;
  }
  if (message.type === 'init') {
    initialize(message).catch((error) => post('error', { message: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (message.type === 'frame') {
    frameChain = frameChain.then(() => acceptFrame(message));
    frameChain.catch((error) => post('error', { message: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (message.type === 'finish') {
    finish().catch((error) => post('error', { message: error instanceof Error ? error.message : String(error) }));
  }
};
