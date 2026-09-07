/**
 * mediabunnyEncodeWorker.ts — encode/finalize pipeline running in a Worker
 * ==========================================================================
 *
 * WHY THIS FILE EXISTS
 * ---------------------
 * Confirmed via Chromium's own background-tab documentation and via direct
 * testing on this app: `requestAnimationFrame` does not fire at all while a
 * page is hidden, and Screen Wake Lock is auto-released the instant the page
 * is hidden. Both were tried on the main thread (see mediabunnyExport.ts)
 * and the stall persisted — the user still had to switch windows away and
 * back to "unstick" `output.finalize()` after waiting 120+ seconds.
 *
 * This worker moves exactly the part of the pipeline that was stalling —
 * `CanvasSource`/`VideoEncoder`/`Output.finalize()` — off the main
 * document's thread entirely. A dedicated Worker's task queue is not gated
 * by the document's page-visibility state the way the main thread's rAF and
 * compositor-tied work is, so encode/finalize can keep progressing even
 * while BlendCraft's tab/window is not the visible one.
 *
 * WHAT DID NOT MOVE
 * ------------------
 * WebGL rendering (Three.js, all shaders, layers, masks, textures, audio
 * reactivity) stays exactly where it was, on the main thread, driven by the
 * same `runFrameLoopViaRAF` loop as before, calling the same `drawFrame`
 * callback. This worker never touches rendering — it only receives already
 * -rendered frames as transferred `ImageBitmap`s and hands them to
 * Mediabunny. That keeps this change scoped to the stalling half of the
 * pipeline and leaves the just-stabilized color-accurate render path
 * completely untouched.
 *
 * COLOR CONTRACT — UPDATE: FIX DID NOT TAKE, ROOT CAUSE NOW UNDERSTOOD
 * ----------------
 * The explicit `colorSpace: bt709` passed into `VideoSample` below was
 * intended to fix a smpte170m/bt709 tagging bug (see prior investigation).
 * Verified via the app's own `verifyExportedFrameFidelity()` check reading
 * the actual decoded file: it did NOT change the container's tagged color
 * space, which is still `{primaries: 'smpte170m', matrix: 'smpte170m'}`.
 *
 * Root cause, checked against Mediabunny's actual type surface: there is no
 * `colorSpace` field anywhere on `VideoEncodingConfig` or
 * `VideoEncodingAdditionalOptions` — the encoder-level config Mediabunny
 * passes to the browser's native `VideoEncoder`. A per-sample `colorSpace`
 * on an input `VideoFrame`/`VideoSample` affects color *management* during
 * encoding, not the VUI color-description fields the H.264 encoder itself
 * writes into the output bitstream — those come from the browser's own
 * encoder implementation, which isn't configurable through this API surface
 * at all. This looks like a real gap in Chromium's H.264 VideoEncoder
 * implementation, not something fixable from application code.
 *
 * This is being left as-is (not reverted) because it's harmless and, per
 * direct instruction, no longer the active priority — the remaining
 * complaint is specifically sharpness, not color.
 */

import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  VideoSampleSource,
  VideoSample,
} from 'mediabunny';
import { buildCanvasSourceConfig, type MediabunnyContainer } from './mediabunnyEncodeShared';

type InitMessage = {
  type: 'init';
  container: MediabunnyContainer;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  keyFrameIntervalSeconds?: number;
  latencyMode?: 'quality' | 'realtime';
};

type FrameMessage = {
  type: 'frame';
  frameIndex: number;
  timestamp: number;
  duration: number;
  bitmap: ImageBitmap;
};

type FinalizeMessage = { type: 'finalize' };
type AbortMessage = { type: 'abort' };

type InboundMessage = InitMessage | FrameMessage | FinalizeMessage | AbortMessage;

export type WorkerEncoderConfigInfo = {
  codec?: string;
  hardwareAcceleration?: string;
  width?: number;
  height?: number;
  latencyMode?: 'quality' | 'realtime';
};

export type OutboundMessage =
  | { type: 'ready' }
  | { type: 'frame-ack'; frameIndex: number }
  | { type: 'encoder-config'; config: WorkerEncoderConfigInfo }
  | {
      type: 'result';
      buffer: ArrayBuffer;
      outputPackets: number;
      lastPacketTimestamp: number | null;
      workerFinalizeMs: number;
    }
  | { type: 'error'; message: string; stage: string };

let output: Output | null = null;
let target: BufferTarget | null = null;
let videoSource: VideoSampleSource | null = null;
let outputPackets = 0;
let lastPacketTimestamp: number | null = null;
let aborted = false;

function post(message: OutboundMessage, transfer?: ArrayBuffer[]): void {
  if (transfer && transfer.length > 0) {
    (self as unknown as Worker).postMessage(message, transfer);
  } else {
    (self as unknown as Worker).postMessage(message);
  }
}

async function handleInit(msg: InitMessage): Promise<void> {
  const format = msg.container === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat();
  target = new BufferTarget();
  output = new Output({ format, target });

  const config = buildCanvasSourceConfig({
    container: msg.container,
    bitrate: msg.bitrate,
    keyFrameIntervalSeconds: msg.keyFrameIntervalSeconds,
    latencyMode: msg.latencyMode,
    onEncodedPacket: (packet) => {
      outputPackets++;
      lastPacketTimestamp = packet.timestamp;
    },
    onEncoderConfig: (config) => {
      post({
        type: 'encoder-config',
        config: {
          codec: config.codec,
          hardwareAcceleration: config.hardwareAcceleration,
          width: config.width,
          height: config.height,
          latencyMode: config.latencyMode,
        },
      });
    },
  });

  // buildCanvasSourceConfig() returns a plain VideoEncodingConfig — valid
  // for VideoSampleSource just as it was for CanvasSource; only the class
  // that consumes it (and therefore how frames get supplied) differs.
  videoSource = new VideoSampleSource(config);
  output.addVideoTrack(videoSource, { frameRate: msg.fps });
  await output.start();
  post({ type: 'ready' });
}

async function handleFrame(msg: FrameMessage): Promise<void> {
  if (!videoSource) throw new Error('Worker received a frame before init completed.');
  if (aborted) { msg.bitmap.close(); return; }

  // See file header — explicit colorSpace here is the fix for the
  // smpte170m/bt709 tagging bug. Values matched to the main-thread path's
  // actual output via ffprobe, not assumed.
  const sample = new VideoSample(msg.bitmap, {
    timestamp: msg.timestamp,
    duration: msg.duration,
    colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
  });
  msg.bitmap.close();
  try {
    // The real backpressure barrier — same contract as the main-thread path.
    await videoSource.add(sample);
  } finally {
    sample.close();
  }
  post({ type: 'frame-ack', frameIndex: msg.frameIndex });
}

async function handleFinalize(): Promise<void> {
  if (!output || !target) throw new Error('Worker received finalize before init completed.');
  // Measured entirely inside the worker, independent of anything the main
  // thread observes. This is the one piece of evidence still missing: does
  // output.finalize() itself take a long time *inside the worker* (meaning
  // the worker's own execution is being throttled too, not just message
  // delivery back to the main thread), or does it resolve quickly here and
  // the delay is entirely in the main thread receiving/acting on the result
  // message? Compare this to the main thread's own finalizeMs next time —
  // if they're close, the worker itself is being throttled despite being a
  // worker; if this is small and the main-thread-observed time is large,
  // it's specifically postMessage delivery being held up.
  const workerFinalizeStart = performance.now();
  await output.finalize();
  const workerFinalizeMs = performance.now() - workerFinalizeStart;
  const buffer = target.buffer;
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
    throw new Error('Worker finalized without producing an output buffer.');
  }
  post(
    { type: 'result', buffer, outputPackets, lastPacketTimestamp, workerFinalizeMs },
    [buffer],
  );
}

self.addEventListener('message', (event: MessageEvent<InboundMessage>) => {
  const msg = event.data;
  (async () => {
    try {
      switch (msg.type) {
        case 'init':
          await handleInit(msg);
          break;
        case 'frame':
          await handleFrame(msg);
          break;
        case 'finalize':
          await handleFinalize();
          break;
        case 'abort':
          aborted = true;
          break;
      }
    } catch (error) {
      post({ type: 'error', message: error instanceof Error ? error.message : String(error), stage: msg.type });
    }
  })();
});
