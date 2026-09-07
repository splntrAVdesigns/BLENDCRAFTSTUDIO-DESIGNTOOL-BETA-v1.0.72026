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
 * CONFIRMED BUG, FOUND AND FIXED: the first version of this file drew each
 * frame onto a plain 2D `OffscreenCanvas` (`ctx.drawImage(bitmap, 0, 0)`)
 * and let Mediabunny's `CanvasSource` sample that canvas directly. Verified
 * with `ffprobe` on a real export: the resulting file was tagged
 * `color_primaries=smpte170m` while `color_transfer` stayed `bt709` — an
 * inconsistent pairing, and a real color shift versus the main-thread path's
 * output, which is consistently tagged `bt709`/`bt709`/`bt709`. Root cause:
 * `CanvasSource.add()` internally does `new VideoSample(canvas, {...})`
 * with no explicit color space, so the browser has to infer one. A 2D
 * canvas apparently doesn't carry strong enough "this is sRGB/Rec709
 * content" signal for that inference, unlike whatever canvas the
 * main-thread path was already sampling from — so it silently fell back to
 * a default.
 *
 * Fixed by not going through a 2D canvas at all: each received `ImageBitmap`
 * is wrapped directly in a `VideoSample` with an explicit
 * `colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709',
 * fullRange: false }` (matching the main-thread path's actual output,
 * confirmed via `ffprobe`), then handed to a `VideoSampleSource` instead of
 * a `CanvasSource`. Per the WebCodecs spec, an explicit `colorSpace` in a
 * `VideoFrame`'s init always wins over inference — this removes the
 * ambiguity instead of trying to work around it.
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
