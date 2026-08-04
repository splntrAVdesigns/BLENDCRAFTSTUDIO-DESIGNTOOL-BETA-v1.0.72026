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
import { yieldToBrowser } from './DeterministicFrameSource';
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
        // PHASE 7.8 — matched to the working Stage 3.3 engine. For SOFTWARE
        // encode: 'realtime' + variable bitrate. Its rationale, verified
        // against your own probe (VP9 measured 45.5fps quality vs 35.2fps
        // realtime — the preset is not the bottleneck): at 16-24 Mbps the
        // encoder is nowhere near bitrate-starved, so 'quality' mode's slower
        // search buys almost nothing visible. Generous bitrate is what
        // protects quality. CBR is actively harmful here — it forces
        // re-quantisation until each frame lands in budget, and pads simple
        // frames to keep the rate up. VBR spends bits where content needs them.
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

        // PHASE 7.9: the canary GATE was removed. It was added in 7.7e as a
        // diagnostic, but it became the blocker: it consumed 12s (6s per
        // codec) and aborted the export before the restored render loop ran a
        // single frame. Two things make it wrong to keep:
        //
        //  1. The working Stage 3.3 engine has NO such gate. It configures the
        //     encoder and starts encoding. That engine produced good exports
        //     on this exact hardware.
        //  2. The canary encodes 2 frames back-to-back and immediately awaits
        //     flush(), which is NOT how the real loop behaves — the real loop
        //     yields between every frame and only flushes at the end. A probe
        //     that does not reproduce the real control flow cannot validate
        //     it, and here it produced a false negative that masked the fix.
        //
        // The stall watchdog in waitForQueue() remains as the safety net, and
        // it now reports queue depth, encoder state and yield count.

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
    const { signal, deadlineMs = 30_000 } = options;
    if (signal?.aborted) throw abortErrorFrom(signal);

    // PHASE 7.8 — THE STARVATION FIX. Restored from the working Stage 3.3
    // engine, replacing the `dequeue`-event wait introduced in 7.7c.
    //
    // The event version could not work: it awaited an event that only fires
    // if the encoder makes progress, while holding the main thread the encoder
    // needs in order to make that progress. Software VP9 is a MAIN-THREAD
    // codec — it requires actual turns, not a listener.
    //
    // yieldToBrowser() is setTimeout(0), a MACROTASK. Unlike awaiting a
    // promise (which only drains microtasks), it genuinely returns control to
    // the event loop so the encoder can run. That single distinction is the
    // difference between this working and hanging forever.
    //
    // The 2000-iteration guard is carried over verbatim: a bounded loop can
    // never park the export permanently the way the event wait did.
    const startedAt = performance.now();
    let iterations = 0;
    let lastLoggedAt = startedAt;

    while (this.encoder.encodeQueueSize > limit && iterations < 2000) {
      if (signal?.aborted) throw abortErrorFrom(signal);
      await yieldToBrowser();
      iterations += 1;

      const now = performance.now();
      if (now - lastLoggedAt >= 5_000) {
        lastLoggedAt = now;
        console.warn(
          `[BLENDCRAFT Video Export] drain wait ${((now - startedAt) / 1000).toFixed(0)}s — `
          + `queue=${this.encoder.encodeQueueSize}, encoder.state=${this.encoder.state}, `
          + `encodedFrames=${this.encodedFrames}, yields=${iterations}`,
        );
      }
      if (now - startedAt > deadlineMs) {
        throw new Error(
          `Video encoder stalled: the queue stayed above ${limit} frames for `
          + `${deadlineMs} ms across ${iterations} yields. `
          + `queue=${this.encoder.encodeQueueSize}, encoder.state=${this.encoder.state}.`,
        );
      }
    }
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
