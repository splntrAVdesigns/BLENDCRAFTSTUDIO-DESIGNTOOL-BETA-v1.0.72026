/**
 * PHASE 7.7 — Deterministic video encode worker.
 *
 * Encodes pre-rendered VideoFrames whose timestamps were AUTHORED by the caller
 * (index * frameDurationUs), not observed from a wall clock. The exported
 * duration is therefore exact by construction: N frames at F fps is always
 * N/F seconds regardless of how long encoding took.
 *
 * Deliberate design decisions:
 *  - latencyMode 'quality', never 'realtime'. Realtime mode is for video calls;
 *    it disables lookahead and makes the rate controller sacrifice quality to
 *    avoid falling behind. For file export that is exactly wrong.
 *  - No throughput benchmarking preflight. isConfigSupported() is cheap; probe
 *    encodes cost many seconds and directly fight the sub-60s export target.
 *  - Vendored WebMMuxer, not Mediabunny. Muxing stays under our control and the
 *    vendored muxer already writes Duration, DefaultDuration and BT.709 Colour.
 */

import { WebMMuxer } from '../../lib/vendored/webm-muxer';
import { buildVp9CodecString } from './vp9Levels';
import type {
  DeterministicEncoderSelection,
  WorkerFrameMessage,
  WorkerInbound,
  WorkerInitMessage,
} from './types';

const workerScope = globalThis as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

function post(message: Record<string, unknown>, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer);
}

let encoder: VideoEncoder | null = null;
let muxer: WebMMuxer | null = null;
let selection: DeterministicEncoderSelection | null = null;
let frameDurationUs = 33_333;
let encodedFrames = 0;
let maxQueueSize = 0;
let encodeStartedAt = 0;
let cancelled = false;
let encoderFailure: Error | null = null;
/** Serialises inbound frame handling so encode order always matches timeline order. */
let frameChain: Promise<void> = Promise.resolve();

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

interface Candidate {
  readonly codecLabel: 'VP9' | 'VP8';
  readonly codecString: string;
  readonly codecId: 'V_VP9' | 'V_VP8';
  readonly hardwareAcceleration: HardwareAcceleration;
}

function buildCandidates(message: WorkerInitMessage): Candidate[] {
  // The VP9 codec string is sized to the ACTUAL resolution and frame rate.
  const vp9 = buildVp9CodecString(message.width, message.height, message.fps, message.bitrate);
  return [
    { codecLabel: 'VP9', codecString: vp9, codecId: 'V_VP9', hardwareAcceleration: 'prefer-hardware' },
    { codecLabel: 'VP9', codecString: vp9, codecId: 'V_VP9', hardwareAcceleration: 'no-preference' },
    { codecLabel: 'VP8', codecString: 'vp8', codecId: 'V_VP8', hardwareAcceleration: 'no-preference' },
  ];
}

function createConfig(message: WorkerInitMessage, candidate: Candidate): VideoEncoderConfig {
  return {
    codec: candidate.codecString,
    width: message.width,
    height: message.height,
    bitrate: message.bitrate,
    framerate: message.fps,
    // Quality mode unlocks lookahead and proper rate control. This is the single
    // biggest visual-quality difference versus the MediaRecorder path.
    latencyMode: 'quality',
    bitrateMode: 'variable',
    hardwareAcceleration: candidate.hardwareAcceleration,
    alpha: 'discard',
  };
}

async function resolveEncoderConfig(
  message: WorkerInitMessage,
): Promise<{ config: VideoEncoderConfig; candidate: Candidate }> {
  const failures: string[] = [];
  for (const candidate of buildCandidates(message)) {
    const config = createConfig(message, candidate);
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) {
        return { config: support.config ?? config, candidate };
      }
      failures.push(`${candidate.codecLabel} (${candidate.hardwareAcceleration}): unsupported configuration`);
    } catch (error) {
      failures.push(`${candidate.codecLabel} (${candidate.hardwareAcceleration}): ${toError(error).message}`);
    }
  }
  throw new Error(`No WebCodecs video encoder accepted the export configuration. ${failures.join('; ')}`);
}

/**
 * Applies backpressure. Without this the render loop races ahead of the encoder
 * and the worker accumulates hundreds of uncompressed 1080p frames in GPU
 * memory, which stalls or crashes the tab.
 */
function waitForQueueSlot(limit: number): Promise<void> {
  const current = encoder;
  if (!current || current.encodeQueueSize < limit) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onDequeue = () => {
      if (cancelled || current.encodeQueueSize < limit) {
        current.removeEventListener('dequeue', onDequeue);
        resolve();
      }
    };
    current.addEventListener('dequeue', onDequeue);
  });
}

async function initialize(message: WorkerInitMessage): Promise<void> {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('WebCodecs VideoEncoder is unavailable in this host.');
  }
  frameDurationUs = Math.round(1_000_000 / Math.max(1, message.fps));
  encodedFrames = 0;
  maxQueueSize = 0;
  encoderFailure = null;

  const { config, candidate } = await resolveEncoderConfig(message);
  if (cancelled) throw new DOMException('Video export cancelled.', 'AbortError');

  selection = {
    codecLabel: candidate.codecLabel,
    codecString: config.codec,
    codecId: candidate.codecId,
    hardwareAcceleration: candidate.hardwareAcceleration,
    bitrate: message.bitrate,
  };

  muxer = new WebMMuxer({
    width: message.width,
    height: message.height,
    codecId: candidate.codecId,
    frameRate: message.fps,
  });

  encoder = new VideoEncoder({
    output: (chunk) => {
      if (cancelled || !muxer) return;
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      muxer.addChunk({
        data,
        // The chunk carries the timestamp we authored on the source VideoFrame.
        timestampUs: chunk.timestamp,
        durationUs: chunk.duration ?? frameDurationUs,
        keyFrame: chunk.type === 'key',
      });
      encodedFrames += 1;
      post({ type: 'encoded', encodedFrames, queueSize: encoder?.encodeQueueSize ?? 0 });
    },
    error: (error) => {
      encoderFailure = toError(error);
      post({ type: 'error', message: encoderFailure.message });
    },
  });

  encoder.configure(config);
  encodeStartedAt = performance.now();
  post({ type: 'ready', selection });
}

async function acceptFrame(message: WorkerFrameMessage): Promise<void> {
  if (cancelled || !encoder) {
    message.frame.close();
    return;
  }
  if (encoderFailure) {
    message.frame.close();
    throw encoderFailure;
  }
  await waitForQueueSlot(6);
  if (cancelled || !encoder) {
    message.frame.close();
    return;
  }
  try {
    encoder.encode(message.frame, { keyFrame: message.keyFrame });
    maxQueueSize = Math.max(maxQueueSize, encoder.encodeQueueSize);
  } finally {
    // VideoFrames hold GPU memory and MUST be closed or the export leaks until
    // the tab is killed.
    message.frame.close();
  }
  post({ type: 'accepted', index: message.index, queueSize: encoder.encodeQueueSize });
}

async function finish(): Promise<void> {
  if (!encoder || !muxer || !selection) throw new Error('The encoder was never initialized.');
  await frameChain;
  if (encoderFailure) throw encoderFailure;
  await encoder.flush();
  if (encoderFailure) throw encoderFailure;

  const bytes = muxer.finalize();
  const encodeMs = performance.now() - encodeStartedAt;
  try { encoder.close(); } catch { /* Best-effort teardown. */ }

  // Copy into a standalone ArrayBuffer so it can be transferred without
  // dragging along any unrelated pooled memory.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  post({
    type: 'complete',
    buffer,
    mimeType: selection.codecId === 'V_VP9' ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8',
    encodedFrames,
    maxQueueSize,
    encodeMs,
  }, [buffer]);
}

function teardown(): void {
  try { encoder?.reset(); } catch { /* Best-effort teardown. */ }
  try { encoder?.close(); } catch { /* Best-effort teardown. */ }
  encoder = null;
  muxer = null;
}

self.onmessage = (event: MessageEvent<WorkerInbound>) => {
  const message = event.data;

  if (message.type === 'cancel') {
    cancelled = true;
    teardown();
    post({ type: 'cancelled' });
    return;
  }

  if (message.type === 'init') {
    initialize(message).catch((error) => post({ type: 'error', message: toError(error).message }));
    return;
  }

  if (message.type === 'frame') {
    frameChain = frameChain.then(() => acceptFrame(message));
    frameChain.catch((error) => post({ type: 'error', message: toError(error).message }));
    return;
  }

  if (message.type === 'finish') {
    finish().catch((error) => post({ type: 'error', message: toError(error).message }));
  }
};
