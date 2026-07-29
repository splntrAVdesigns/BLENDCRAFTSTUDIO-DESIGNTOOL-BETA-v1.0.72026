export type RecordingFrameSource = 'gpu-readback' | 'canvas';

export interface RecordingPixelFrame {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface RecordingFrameCompositorInput {
  readonly sourceCanvas: HTMLCanvasElement;
  readonly outputCanvas: HTMLCanvasElement;
  readonly outputContext: CanvasRenderingContext2D;
  readonly readFramePixels?: () => RecordingPixelFrame | null;
}

export interface RecordingFrameCompositeResult {
  readonly source: RecordingFrameSource;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly exactResolution: boolean;
}

/**
 * Owns the fidelity-critical transfer from GradientCanvas into the exact-size
 * recording canvas. The exact-size live WebGL presentation canvas is preferred
 * because drawImage keeps the transfer GPU-accelerated. GPU readback is retained
 * as a correctness fallback when the presentation canvas is not at target size.
 */
export class RecordingFrameCompositor {
  private flippedPixels: Uint8ClampedArray | null = null;
  private imageData: ImageData | null = null;
  private pixelWidth = 0;
  private pixelHeight = 0;

  composite(input: RecordingFrameCompositorInput): RecordingFrameCompositeResult {
    const sourceWidth = Math.max(1, input.sourceCanvas.width);
    const sourceHeight = Math.max(1, input.sourceCanvas.height);
    const canvasIsExact = sourceWidth === input.outputCanvas.width
      && sourceHeight === input.outputCanvas.height;

    if (canvasIsExact) {
      input.outputContext.save();
      input.outputContext.globalCompositeOperation = 'copy';
      input.outputContext.imageSmoothingEnabled = false;
      input.outputContext.drawImage(input.sourceCanvas, 0, 0);
      input.outputContext.restore();
      return {
        source: 'canvas',
        sourceWidth,
        sourceHeight,
        exactResolution: true,
      };
    }

    const pixels = input.readFramePixels?.() ?? null;
    if (pixels && this.isValidPixelFrame(pixels)) {
      this.copyGpuPixels(input.outputContext, input.outputCanvas, pixels);
      return {
        source: 'gpu-readback',
        sourceWidth: pixels.width,
        sourceHeight: pixels.height,
        exactResolution: pixels.width === input.outputCanvas.width && pixels.height === input.outputCanvas.height,
      };
    }

    return {
      source: 'canvas',
      sourceWidth,
      sourceHeight,
      exactResolution: false,
    };
  }

  dispose(): void {
    this.flippedPixels = null;
    this.imageData = null;
    this.pixelWidth = 0;
    this.pixelHeight = 0;
  }

  private isValidPixelFrame(frame: RecordingPixelFrame): boolean {
    return frame.width > 0
      && frame.height > 0
      && frame.data.byteLength >= frame.width * frame.height * 4;
  }

  private ensurePixelBuffer(width: number, height: number): void {
    if (this.flippedPixels && this.pixelWidth === width && this.pixelHeight === height) return;
    this.pixelWidth = width;
    this.pixelHeight = height;
    this.flippedPixels = new Uint8ClampedArray(width * height * 4);
    this.imageData = new ImageData(this.flippedPixels, width, height);
  }

  private copyGpuPixels(
    context: CanvasRenderingContext2D,
    outputCanvas: HTMLCanvasElement,
    frame: RecordingPixelFrame,
  ): void {
    this.ensurePixelBuffer(frame.width, frame.height);
    const destination = this.flippedPixels;
    if (!destination || !this.imageData) throw new Error('Unable to allocate recording pixel buffer.');

    const rowBytes = frame.width * 4;
    for (let sourceY = 0; sourceY < frame.height; sourceY += 1) {
      const destinationY = frame.height - 1 - sourceY;
      const sourceOffset = sourceY * rowBytes;
      destination.set(frame.data.subarray(sourceOffset, sourceOffset + rowBytes), destinationY * rowBytes);
    }

    if (frame.width === outputCanvas.width && frame.height === outputCanvas.height) {
      context.putImageData(this.imageData, 0, 0);
      return;
    }

    const staging = document.createElement('canvas');
    staging.width = frame.width;
    staging.height = frame.height;
    const stagingContext = staging.getContext('2d', { alpha: false, willReadFrequently: false });
    if (!stagingContext) throw new Error('Unable to create recording fidelity staging context.');
    stagingContext.putImageData(this.imageData, 0, 0);
    context.save();
    context.globalCompositeOperation = 'copy';
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(staging, 0, 0, outputCanvas.width, outputCanvas.height);
    context.restore();
    staging.width = 1;
    staging.height = 1;
  }
}
