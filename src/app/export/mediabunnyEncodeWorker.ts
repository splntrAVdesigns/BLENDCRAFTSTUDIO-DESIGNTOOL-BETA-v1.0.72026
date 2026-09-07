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
 * COLOR CONTRACT
 * ----------------
 * `createImageBitmap()` on the caller side MUST be called with
 * `colorSpaceConversion: 'none'` (see mediabunnyExport.ts) and this worker's
 * OffscreenCanvas 2D context is created with `colorSpace: 'srgb'` to match.
 * Any mismatch here would silently reintroduce the color drift that was
 * already fixed once in the main-thread path — this is the single highest
 * -risk part of this change and should be visually re-verified against the
 * canvas (not just trusted from this comment).
 */

import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  CanvasSource,
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
    }
  | { type: 'error'; message: string; stage: string };

let output: Output | null = null;
let target: BufferTarget | null = null;
let videoSource: CanvasSource | null = null;
let offscreen: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
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
  offscreen = new OffscreenCanvas(msg.width, msg.height);
  // colorSpace: 'srgb' must match the colorSpaceConversion: 'none' used when
  // the main thread creates each frame's ImageBitmap — see file header.
  ctx = offscreen.getContext('2d', { alpha: true, colorSpace: 'srgb' }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Worker could not acquire a 2D context on its OffscreenCanvas.');

  const format = msg.container === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat();
  target = new BufferTarget();
  output = new Output({ format, target });

  const config = buildCanvasSourceConfig({
    container: msg.container,
    bitrate: msg.bitrate,
    keyFrameIntervalSeconds: msg.keyFrameIntervalSeconds,
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

  videoSource = new CanvasSource(offscreen, config);
  output.addVideoTrack(videoSource, { frameRate: msg.fps });
  await output.start();
  post({ type: 'ready' });
}

async function handleFrame(msg: FrameMessage): Promise<void> {
  if (!ctx || !videoSource) throw new Error('Worker received a frame before init completed.');
  if (aborted) { msg.bitmap.close(); return; }

  ctx.drawImage(msg.bitmap, 0, 0);
  msg.bitmap.close();
  // The real backpressure barrier — same contract as the main-thread path.
  await videoSource.add(msg.timestamp, msg.duration);
  post({ type: 'frame-ack', frameIndex: msg.frameIndex });
}

async function handleFinalize(): Promise<void> {
  if (!output || !target) throw new Error('Worker received finalize before init completed.');
  await output.finalize();
  const buffer = target.buffer;
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
    throw new Error('Worker finalized without producing an output buffer.');
  }
  post(
    { type: 'result', buffer, outputPackets, lastPacketTimestamp },
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
