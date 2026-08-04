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

/**
 * PHASE 7.7e DIAGNOSTIC — result of a canary encode.
 *
 * The Phase 7.7d fix (hardwareAcceleration: 'prefer-software') was tested and
 * DID NOT resolve the stall — the queue still parks at 4 frames with zero
 * output, even with no GPU path available to contend with. That falsifies the
 * GPU-contention theory. This canary exists to narrow the search: it tests
 * whether the encoder can produce ANY output at all, using synthetic frames
 * that have nothing to do with the live WebGL canvas, on a throwaway encoder
 * instance that cannot contaminate the real muxer or frame count.
 *
 * - Canary fails  -> the encoder itself is non-functional for this config in
 *   this browser session, independent of capture. Not a capture bug.
 * - Canary succeeds, but the real run still stalls -> the fault is specific to
 *   frames built from the live canvas, not the encoder in general.
 */
export interface CanaryResult {
  readonly ok: boolean;
  readonly outputCount: number;
  readonly elapsedMs: number;
  readonly finalEncoderState: string;
  readonly error?: string;
}

const CANARY_TIMEOUT_MS = 4_000;
const CANARY_FRAME_COUNT = 2;

/**
 * Encodes a couple of solid-color synthetic frames on an isolated encoder
 * instance. Matches the real config's width/height exactly, since WebCodecs
 * behavior around mismatched frame/config dimensions is not something worth
 * introducing as a second variable here.
 */
async function runEncoderCanary(config: VideoEncoderConfig, label: string): Promise<CanaryResult> {
  const startedAt = performance.now();
  let outputCount = 0;
  let settledError: string | undefined;

  const canaryCanvas = document.createElement('canvas');
  canaryCanvas.width = config.width;
  canaryCanvas.height = config.height;
  const ctx = canaryCanvas.getContext('2d', { alpha: false });
  if (ctx) {
    ctx.fillStyle = '#3060c0';
    ctx.fillRect(0, 0, config.width, config.height);
  }

  const encoder = new VideoEncoder({
    output: () => { outputCount += 1; },
    error: (error) => { settledError = toError(error).message; },
  });

  try {
    encoder.configure(config);
    const frameDurationUs = Math.round(1_000_000 / (config.framerate ?? 30));
    for (let i = 0; i < CANARY_FRAME_COUNT; i += 1) {
      const frame = new VideoFrame(canaryCanvas, {
        timestamp: i * frameDurationUs,
        duration: frameDurationUs,
        alpha: 'discard',
      });
      try {
        encoder.encode(frame, { keyFrame: i === 0 });
      } finally {
        frame.close();
      }
    }

    await Promise.race([
      new Promise<void>((resolve) => {
        const onDequeue = () => {
          if (outputCount >= 1) { encoder.removeEventListener('dequeue', onDequeue); resolve(); }
        };
        encoder.addEventListener('dequeue', onDequeue);
        if (outputCount >= 1) resolve();
      }),
      new Promise<void>((resolve) => window.setTimeout(resolve, CANARY_TIMEOUT_MS)),
    ]);
  } catch (error) {
    settledError = toError(error).message;
  }

  const finalEncoderState = encoder.state;
  try { encoder.close(); } catch { /* Best-effort teardown. */ }
  canaryCanvas.width = 1;
  canaryCanvas.height = 1;

  const elapsedMs = performance.now() - startedAt;
  const ok = outputCount >= 1 && !settledError;
  console.info(
    `[BLENDCRAFT Video Export] canary(${label}): ${ok ? 'OK' : 'FAILED'} — `
    + `output ${outputCount}/${CANARY_FRAME_COUNT}, ${elapsedMs.toFixed(0)}ms, `
    + `encoder.state=${finalEncoderState}${settledError ? `, error=${settledError}` : ''}`,
  );
  return { ok, outputCount, elapsedMs, finalEncoderState, error: settledError };
}

export interface FinishedEncode {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly encodedFrames: number;
  readonly encodeMs: number;
}

export interface WaitForQueueOptions {
  readonly signal?: AbortSignal;
  /** Fail rather than park if the queue does not drain within this window. */
  readonly deadlineMs?: number;
}

function abortErrorFrom(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  return reason instanceof Error
    ? reason
    : new DOMException(String(reason ?? 'Video export cancelled.'), 'AbortError');
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
        // STAGE 1 DEADLOCK FIX — do not change this to 'quality' without
        // reading the note below.
        //
        // libvpx-vp9 in 'quality' mode runs a lag-in-frames lookahead of ~25
        // frames: it accumulates that many frames before emitting OR draining
        // anything. Combined with the render loop's backpressure limit, that
        // deadlocks — the encoder waits for ~25 frames, the loop refuses to
        // submit past its limit, and neither side can move. Observed in
        // production as "queue 1, 2, 3 ... encoded 0" and a permanently frozen
        // progress bar.
        //
        // 'realtime' sets lag-in-frames to 0, so every submitted frame yields a
        // chunk. Output is 1:1 with input, which is what makes queue-based
        // backpressure sound and progress monotonic. There is no limit value
        // that can deadlock in this mode.
        //
        // Quality cost is negligible here: large-area, low-detail,
        // high-temporal-change gradients at 10-16 Mbps are the regime where
        // lookahead buys least.
        latencyMode: 'realtime',
        bitrateMode: 'variable',
        // PHASE 7.7d STALL FIX — was 'no-preference'. Production evidence:
        // frame 0's capture cost 972ms (vs ~1ms for every later frame), the
        // encoder then accepted exactly MAX_FRAMES_IN_FLIGHT (4) frames and
        // produced ZERO output for the full 10s stall deadline before this fix
        // existed to catch it. That signature — one abnormally expensive first
        // frame, then a hard stop — matches GPU resource contention: Chrome is
        // free under 'no-preference' to attempt a hardware VP9 encode path on
        // the SAME GPU the live WebGLRenderer is actively rendering on. VP9
        // hardware encode already measured as unsupported in isolation on this
        // hardware (a GT 750M under Optimus) — "unsupported alone" does not
        // rule out "attempts and hangs once a WebGL context already holds the
        // GPU". 'prefer-software' removes the ambiguity entirely: libvpx does
        // not touch the GPU, so it cannot contend with the renderer.
        // The actually-configured value is read back from isConfigSupported()
        // and logged below, so if a stall recurs we know for certain rather
        // than inferring.
        hardwareAcceleration: 'prefer-software',
        alpha: 'discard',
      };
      try {
        const support = await VideoEncoder.isConfigSupported(config);
        if (!support.supported) {
          failures.push(`${candidate.codecLabel}: unsupported`);
          continue;
        }
        const resolved = support.config ?? config;

        // PHASE 7.7e: isConfigSupported() already told us VP9 is "supported"
        // once and turned out to be wrong at runtime — the API answered a
        // static capability question, not "will this actually produce output
        // right now, in this session". The canary asks the real question
        // before we commit to a real capture run. On failure this candidate
        // is skipped exactly like an unsupported config, so the loop falls
        // through to the next one (VP8) automatically.
        const canary = await runEncoderCanary(resolved, candidate.codecLabel);
        if (!canary.ok) {
          failures.push(
            `${candidate.codecLabel}: canary failed — output ${canary.outputCount}/${CANARY_FRAME_COUNT}, `
            + `encoder.state=${canary.finalEncoderState}${canary.error ? `, error=${canary.error}` : ''}`,
          );
          continue;
        }

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
        // PHASE 7.7d: report what was ACTUALLY resolved, not the value we
        // requested. Chrome may silently normalise hardwareAcceleration
        // inside isConfigSupported(); the previous code hardcoded
        // 'no-preference' into this field regardless of the request or the
        // resolution, which would have hidden this very fix from the export
        // log even after applying it.
        const resolvedAcceleration = resolved.hardwareAcceleration ?? config.hardwareAcceleration ?? 'no-preference';
        session = new DeterministicEncoderSession(encoder, muxer, frameDurationUs, {
          codecLabel: candidate.codecLabel,
          codecString: resolved.codec,
          codecId: candidate.codecId,
          hardwareAcceleration: resolvedAcceleration,
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

  /**
   * Yields until the encoder queue drains below the limit.
   *
   * STAGE 1: this wait is now BOUNDED and ABORTABLE. The previous version
   * awaited a bare `dequeue` listener with no reject path, no signal and no
   * deadline. When the encoder stalled it parked forever, and because every
   * `signal.aborted` check lives at the top of the render loop, Cancel could
   * not take effect either — that is why cancelling took minutes.
   *
   * A stalled encoder must surface as a fast, named error. It must never
   * present as a frozen progress bar.
   */
  async waitForQueue(limit: number, options: WaitForQueueOptions = {}): Promise<void> {
    const { signal, deadlineMs = 10_000 } = options;
    if (signal?.aborted) throw abortErrorFrom(signal);
    if (this.encoder.encodeQueueSize < limit) return;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (run: () => void) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        window.clearInterval(pollTimer);
        signal?.removeEventListener('abort', onAbort);
        this.encoder.removeEventListener('dequeue', onDequeue);
        run();
      };
      const onDequeue = () => {
        if (this.encoder.encodeQueueSize < limit) finish(resolve);
      };
      const onAbort = () => finish(() => reject(abortErrorFrom(signal)));
      const timer = window.setTimeout(() => finish(() => reject(new Error(
        `Video encoder stalled: the queue stayed at ${this.encoder.encodeQueueSize} frames `
        + `for ${deadlineMs} ms without draining. The encoder accepted frames but produced no output. `
        + `encoder.state at failure = ${this.encoder.state}.`,
      ))), deadlineMs);

      // PHASE 7.7e DIAGNOSTIC: Chrome has a documented failure mode where
      // VideoEncoder silently transitions to 'closed' without ever firing its
      // error callback. That would look EXACTLY like this stall and we would
      // have zero visibility into it. Poll and log state during any real wait
      // so the next report shows whether that's what happened here.
      let pollCount = 0;
      const pollTimer = window.setInterval(() => {
        pollCount += 1;
        console.warn(
          `[BLENDCRAFT Video Export] stall watch ${pollCount * 2}s — `
          + `queue=${this.encoder.encodeQueueSize}, encoder.state=${this.encoder.state}, `
          + `encodedFrames=${this.encodedFrames}`,
        );
      }, 2_000);

      this.encoder.addEventListener('dequeue', onDequeue);
      signal?.addEventListener('abort', onAbort, { once: true });
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
