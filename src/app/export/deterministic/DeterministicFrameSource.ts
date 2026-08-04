/**
 * PHASE 7.8 — Restored frame-capture and pacing mechanics from the last
 * export engine that DEMONSTRABLY worked on this hardware (Stage 3.3).
 *
 * WHY THIS EXISTS
 *
 * Phases 7.7c–7.7f built a capture path that constructs VideoFrame DIRECTLY
 * from the live WebGL canvas, and a backpressure loop that waits on the
 * encoder's `dequeue` event. Both were regressions against the working engine,
 * and together they starved the encoder:
 *
 *   Working (Stage 3.3)                  Broken (7.7c-f)
 *   -------------------------------      ------------------------------------
 *   GPU readback -> 2D staging canvas     VideoFrame direct from WebGL canvas
 *   -> VideoFrame                         (frame 0 capture cost: 972 ms)
 *   `await yieldToBrowser()` on queue     `await` on a `dequeue` EVENT
 *   pressure AND every 30 frames          (fires only if the encoder runs)
 *   watermark 16, 2000-iteration guard    watermark 4, unbounded
 *
 * The encoder is a main-thread software codec. It needs main-thread TURNS to
 * make progress. The broken version encodes and then immediately blocks on an
 * event that can only fire if the encoder runs — but the encoder cannot run,
 * because nothing ever yields. That is a self-inflicted starvation deadlock,
 * and it is why even a 2-frame canary hung: it encoded twice and awaited
 * flush() without a single yield in between.
 *
 * The proof it is starvation and not a broken encoder: the same WebCodecs code
 * resolves instantly in a blank tab AND on the loaded BlendCraft page at rest.
 * It only fails once the export loop monopolises the main thread.
 */

/** Cooperative yield. setTimeout(0) is a MACROTASK — it lets the encoder run. */
export async function yieldToBrowser(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

let flipBuffer: Uint8Array | null = null;
let readbackCanvas: HTMLCanvasElement | null = null;
let readbackContext: CanvasRenderingContext2D | null = null;
let readbackWidth = 0;
let readbackHeight = 0;

/**
 * WebGL readback arrives bottom-up; canvas ImageData is top-down. Reuses a
 * single scratch buffer so a 150-frame export doesn't allocate ~1.2 GB and
 * thrash GC (the Stage 3.3 flip-buffer-reuse win, preserved).
 */
function flipRgbaBuffer(source: Uint8Array, width: number, height: number): Uint8Array {
  const rowBytes = width * 4;
  const expected = rowBytes * height;
  if (!source || source.length < expected) {
    throw new Error(`Invalid RGBA readback buffer: expected ${expected} bytes, got ${source?.length ?? 0}`);
  }
  if (!flipBuffer || flipBuffer.length !== expected) flipBuffer = new Uint8Array(expected);
  const flipped = flipBuffer;
  for (let y = 0; y < height; y += 1) {
    const srcStart = (height - 1 - y) * rowBytes;
    flipped.set(source.subarray(srcStart, srcStart + rowBytes), y * rowBytes);
  }
  return flipped;
}

export interface StagingDrawInput {
  readonly stagingCanvas: HTMLCanvasElement;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly liveCanvas: HTMLCanvasElement | null;
  readonly readFramePixels?: () => { data: Uint8Array; width: number; height: number } | null;
}

/**
 * Draws the current rendered frame into a 2D staging canvas.
 *
 * PRIMARY source is the export-size GPU readback, NOT the live canvas. That is
 * deliberate and carried over verbatim from the working engine: the readback
 * preserves the exact full-resolution render produced by renderAtTime(), which
 * is what dense gradients, masks, dither and textures depend on. The live
 * canvas is a fallback only, because it may be preview-sized.
 */
export function drawFrameToStagingCanvas(input: StagingDrawInput): void {
  const { stagingCanvas, targetWidth, targetHeight, liveCanvas, readFramePixels } = input;
  const ctx = stagingCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
  if (!ctx) throw new Error('Failed to get 2D staging context for video export.');

  ctx.clearRect(0, 0, targetWidth, targetHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const frame = readFramePixels?.();
  if (frame && frame.data.length === frame.width * frame.height * 4) {
    const flipped = flipRgbaBuffer(frame.data, frame.width, frame.height);
    if (!readbackCanvas || readbackWidth !== frame.width || readbackHeight !== frame.height) {
      readbackCanvas = document.createElement('canvas');
      readbackCanvas.width = frame.width;
      readbackCanvas.height = frame.height;
      readbackContext = readbackCanvas.getContext('2d', { alpha: false });
      readbackWidth = frame.width;
      readbackHeight = frame.height;
    }
    if (!readbackContext) throw new Error('Failed to create readback canvas context for video export.');
    // Copy into an exactly-sized Uint8ClampedArray. The flip buffer is reused
    // across frames and may be a view over a larger allocation, which the
    // ImageData constructor rejects.
    const clamped = new Uint8ClampedArray(frame.width * frame.height * 4);
    clamped.set(flipped.subarray(0, clamped.length));
    readbackContext.putImageData(new ImageData(clamped, frame.width, frame.height), 0, 0);
    // Only pay for high-quality resampling when sizes actually differ. At 1:1
    // — the common case — smoothing is pure per-frame CPU cost for a same-size
    // copy.
    const sameSize = frame.width === targetWidth && frame.height === targetHeight;
    ctx.imageSmoothingEnabled = !sameSize;
    if (!sameSize) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(readbackCanvas, 0, 0, frame.width, frame.height, 0, 0, targetWidth, targetHeight);
    return;
  }

  if (liveCanvas) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(liveCanvas, 0, 0, liveCanvas.width, liveCanvas.height, 0, 0, targetWidth, targetHeight);
    return;
  }

  throw new Error('No canvas source available for frame capture.');
}

/** Releases the module-level scratch buffers between exports. */
export function releaseStagingScratch(): void {
  flipBuffer = null;
  if (readbackCanvas) {
    readbackCanvas.width = 1;
    readbackCanvas.height = 1;
  }
  readbackCanvas = null;
  readbackContext = null;
  readbackWidth = 0;
  readbackHeight = 0;
}
