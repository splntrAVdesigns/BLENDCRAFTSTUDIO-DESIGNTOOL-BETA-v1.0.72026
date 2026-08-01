import {
  BufferTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from 'mediabunny';

type Container = 'webm' | 'mp4';
type WebCodec = 'vp8' | 'vp09.00.10.08' | 'avc1.42001f';
type MediaCodec = 'vp8' | 'vp9' | 'avc';
type Acceleration = 'no-preference' | 'prefer-hardware' | 'prefer-software';

interface InitMessage {
  type: 'init';
  container: Container;
  codec: WebCodec;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
}
interface FrameMessage { type: 'frame'; index: number; frame: VideoFrame; keyFrame: boolean }
interface FinishMessage { type: 'finish' }
interface CancelMessage { type: 'cancel' }
type Inbound = InitMessage | FrameMessage | FinishMessage | CancelMessage;

interface Candidate {
  webCodec: WebCodec;
  mediaCodec: MediaCodec;
  container: Container;
  acceleration: Acceleration;
  label: string;
}

interface CandidateResult extends Candidate {
  config: VideoEncoderConfig;
  supported: boolean;
  passed: boolean;
  encodedFrames: number;
  firstChunkMs: number;
  elapsedMs: number;
  fps: number;
  reason?: string;
}

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
let selectedCandidate: CandidateResult | null = null;

const workerScope = globalThis as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void };

function post(type: string, detail: Record<string, unknown> = {}, transfer: Transferable[] = []) {
  workerScope.postMessage({ type, ...detail }, transfer);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(id); resolve(value); },
      (error) => { clearTimeout(id); reject(error); },
    );
  });
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

function createConfig(message: InitMessage, candidate: Candidate): VideoEncoderConfig {
  const config: VideoEncoderConfig = {
    codec: candidate.webCodec,
    width: message.width,
    height: message.height,
    bitrate: message.bitrate,
    framerate: message.fps,
    latencyMode: 'realtime',
    bitrateMode: 'variable',
    hardwareAcceleration: candidate.acceleration,
    alpha: 'discard',
  };
  if (candidate.mediaCodec === 'avc') config.avc = { format: 'avc' };
  return config;
}

function createProbeFrames(width: number, height: number, fps: number, count = 12): VideoFrame[] {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Could not create codec preflight canvas.');
  const frames: VideoFrame[] = [];
  const frameDurationUs = Math.round(1_000_000 / fps);

  for (let index = 0; index < count; index += 1) {
    const phase = index / Math.max(1, count - 1);
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, `hsl(${Math.round(220 + phase * 80)} 90% 45%)`);
    gradient.addColorStop(0.5, `hsl(${Math.round(280 + phase * 60)} 85% 58%)`);
    gradient.addColorStop(1, `hsl(${Math.round(20 + phase * 100)} 88% 52%)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'screen';
    context.fillStyle = `rgba(255,255,255,${0.05 + phase * 0.08})`;
    const stripe = Math.max(12, Math.floor(width / 96));
    for (let x = -height; x < width; x += stripe * 3) {
      context.fillRect(x + index * stripe, 0, stripe, height);
    }
    context.globalCompositeOperation = 'source-over';
    frames.push(new VideoFrame(canvas, {
      timestamp: index * frameDurationUs,
      duration: frameDurationUs,
      alpha: 'discard',
    }));
  }
  return frames;
}

async function benchmarkCandidate(message: InitMessage, candidate: Candidate, probeFrames: VideoFrame[]): Promise<CandidateResult> {
  const config = createConfig(message, candidate);
  const base: CandidateResult = {
    ...candidate,
    config,
    supported: false,
    passed: false,
    encodedFrames: 0,
    firstChunkMs: 0,
    elapsedMs: 0,
    fps: 0,
  };

  try {
    const support = await VideoEncoder.isConfigSupported(config);
    if (!support.supported) return { ...base, reason: 'Configuration unsupported.' };
    const selectedConfig = support.config ?? config;
    let chunks = 0;
    let firstChunkAt = 0;
    let encoderError: Error | null = null;
    const started = performance.now();
    const testEncoder = new VideoEncoder({
      output: () => {
        if (!firstChunkAt) firstChunkAt = performance.now();
        chunks += 1;
      },
      error: (error) => { encoderError = error; },
    });
    testEncoder.configure(selectedConfig);
    for (let index = 0; index < probeFrames.length; index += 1) {
      const clone = probeFrames[index].clone();
      testEncoder.encode(clone, { keyFrame: index === 0 });
      clone.close();
    }
    await withTimeout(testEncoder.flush(), 5_000, candidate.label);
    const elapsedMs = performance.now() - started;
    try { testEncoder.close(); } catch {}
    if (encoderError) throw encoderError;
    const firstChunkMs = firstChunkAt ? firstChunkAt - started : elapsedMs;
    const fps = chunks / Math.max(0.001, elapsedMs / 1000);
    const passed = chunks === probeFrames.length && firstChunkMs <= 2_500 && elapsedMs <= 5_000 && fps >= 6;
    return {
      ...base,
      config: selectedConfig,
      supported: true,
      passed,
      encodedFrames: chunks,
      firstChunkMs,
      elapsedMs,
      fps,
      reason: passed ? undefined : `Too slow (${fps.toFixed(1)} fps, first chunk ${Math.round(firstChunkMs)} ms).`,
    };
  } catch (error) {
    return { ...base, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function selectMeasuredCodec(message: InitMessage): Promise<{ selected: CandidateResult; results: CandidateResult[] }> {
  const candidates: Candidate[] = [
    { webCodec: 'avc1.42001f', mediaCodec: 'avc', container: 'mp4', acceleration: 'no-preference', label: 'H.264 · automatic acceleration' },
    { webCodec: 'avc1.42001f', mediaCodec: 'avc', container: 'mp4', acceleration: 'prefer-hardware', label: 'H.264 · prefer hardware' },
    { webCodec: 'vp09.00.10.08', mediaCodec: 'vp9', container: 'webm', acceleration: 'no-preference', label: 'VP9 · automatic acceleration' },
    { webCodec: 'vp8', mediaCodec: 'vp8', container: 'webm', acceleration: 'no-preference', label: 'VP8 · automatic acceleration' },
  ];
  const probeFrames = createProbeFrames(message.width, message.height, message.fps);
  const results: CandidateResult[] = [];
  try {
    for (const candidate of candidates) {
      if (cancelled) throw new DOMException('Video export cancelled.', 'AbortError');
      post('probe-progress', { message: `Measuring ${candidate.label}…`, candidate: candidate.label });
      const result = await benchmarkCandidate(message, candidate, probeFrames);
      results.push(result);
      // H.264 is the preferred Apple/tablet production path. Once it clears
      // the real throughput threshold, avoid wasting time benchmarking slower codecs.
      if (candidate.mediaCodec === 'avc' && result.passed) return { selected: result, results };
    }
  } finally {
    probeFrames.forEach((frame) => frame.close());
  }

  const passing = results.filter((result) => result.passed).sort((a, b) => b.fps - a.fps);
  if (!passing.length) {
    const detail = results.map((result) => `${result.label}: ${result.reason ?? 'failed'}`).join(' | ');
    throw new Error(`No encoder met BLENDCRAFT's minimum throughput requirement. ${detail}`);
  }
  return { selected: passing[0], results };
}

async function initialize(message: InitMessage) {
  if (typeof VideoEncoder === 'undefined') throw new Error('WebCodecs VideoEncoder is unavailable.');
  post('probing', { message: 'Measuring available video encoders…' });
  const selection = await selectMeasuredCodec(message);
  selectedCandidate = selection.selected;
  if (cancelled) throw new DOMException('Video export cancelled.', 'AbortError');

  target = new BufferTarget();
  const format = selectedCandidate.container === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat();
  output = new Output({ format, target });
  source = new EncodedVideoPacketSource(selectedCandidate.mediaCodec);
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
  encoder.configure(selectedCandidate.config);
  post('ready', {
    config: selectedCandidate.config,
    selected: {
      webCodec: selectedCandidate.webCodec,
      mediaCodec: selectedCandidate.mediaCodec,
      container: selectedCandidate.container,
      acceleration: selectedCandidate.acceleration,
      label: selectedCandidate.label,
      measuredFps: selectedCandidate.fps,
      firstChunkMs: selectedCandidate.firstChunkMs,
      elapsedMs: selectedCandidate.elapsedMs,
    },
    candidates: selection.results.map((result) => ({
      label: result.label,
      passed: result.passed,
      supported: result.supported,
      fps: result.fps,
      firstChunkMs: result.firstChunkMs,
      elapsedMs: result.elapsedMs,
      reason: result.reason,
    })),
  });
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
  if (!encoder || !output || !source || !target || !selectedCandidate) throw new Error('Encoder has not been initialized.');
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
    selected: {
      webCodec: selectedCandidate.webCodec,
      mediaCodec: selectedCandidate.mediaCodec,
      container: selectedCandidate.container,
      acceleration: selectedCandidate.acceleration,
      label: selectedCandidate.label,
      measuredFps: selectedCandidate.fps,
    },
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
