import {
  ALL_FORMATS,
  BlobSource,
  Input,
  VideoSampleSink,
} from 'mediabunny';
import { compareRgbaFrames, type FrameParityMetrics } from '../utils/exportRenderQuality';

const SAMPLE_MAX_DIMENSION = 256;

type ExportVideoColorSpace = {
  primaries?: string | null;
  transfer?: string | null;
  matrix?: string | null;
  fullRange?: boolean | null;
};

export interface ExportFrameSample {
  width: number;
  height: number;
  rgba: Uint8Array;
  meanRgb: [number, number, number];
  meanLuma: number;
}

export interface ExportFrameFidelityResult {
  checked: boolean;
  passed: boolean;
  metrics: FrameParityMetrics | null;
  referenceMeanRgb: [number, number, number] | null;
  decodedMeanRgb: [number, number, number] | null;
  referenceMeanLuma: number | null;
  decodedMeanLuma: number | null;
  lumaDelta: number | null;
  colorSpace: ExportVideoColorSpace | null;
  reason?: string;
}

export function compareExportFrameSamples(
  reference: ExportFrameSample,
  candidate: ExportFrameSample,
): { passed: boolean; metrics: FrameParityMetrics; lumaDelta: number } {
  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    throw new Error('Export frame samples must have matching dimensions.');
  }
  const metrics = compareRgbaFrames(reference.rgba, candidate.rgba, {
    meanAbsoluteError: 1,
    rootMeanSquareError: 2,
    maximumChannelError: 16,
  });
  const lumaDelta = candidate.meanLuma - reference.meanLuma;
  return { passed: metrics.passed && Math.abs(lumaDelta) <= 1, metrics, lumaDelta };
}

function summarizeRgba(rgba: Uint8Array): Pick<ExportFrameSample, 'meanRgb' | 'meanLuma'> {
  let red = 0;
  let green = 0;
  let blue = 0;
  const pixels = Math.max(1, rgba.length / 4);

  for (let i = 0; i + 3 < rgba.length; i += 4) {
    red += rgba[i];
    green += rgba[i + 1];
    blue += rgba[i + 2];
  }

  const meanRgb: [number, number, number] = [red / pixels, green / pixels, blue / pixels];
  return {
    meanRgb,
    meanLuma: meanRgb[0] * 0.2126 + meanRgb[1] * 0.7152 + meanRgb[2] * 0.0722,
  };
}

function createAnalysisCanvas(sourceWidth: number, sourceHeight: number): HTMLCanvasElement {
  const scale = Math.min(1, SAMPLE_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  return canvas;
}

function readCanvas(canvas: HTMLCanvasElement): ExportFrameSample | null {
  const context = canvas.getContext('2d', {
    alpha: false,
    willReadFrequently: true,
    colorSpace: 'srgb',
  } as never);
  if (!context) return null;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const rgba = new Uint8Array(image.data);
  return { width: image.width, height: image.height, rgba, ...summarizeRgba(rgba) };
}

/** Capture a bounded, display-referred sample without retaining a full 4K frame. */
export function captureExportFrameSample(source: HTMLCanvasElement): ExportFrameSample | null {
  if (source.width <= 0 || source.height <= 0) return null;
  const canvas = createAnalysisCanvas(source.width, source.height);
  const context = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' } as never);
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.globalCompositeOperation = 'copy';
  context.drawImage(source, 0, 0, source.width, source.height, 0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'source-over';
  const result = readCanvas(canvas);
  canvas.width = 1;
  canvas.height = 1;
  return result;
}

/**
 * Decodes the actual produced file and compares its first frame with the
 * bounded snapshot of the exact staging canvas supplied to CanvasSource.
 * Non-throwing: verification failure is reported but never destroys a valid
 * user export.
 */
export async function verifyExportedFrameFidelity(
  blob: Blob,
  reference: ExportFrameSample | null,
): Promise<ExportFrameFidelityResult> {
  if (!reference) {
    return {
      checked: false, passed: false, metrics: null,
      referenceMeanRgb: null, decodedMeanRgb: null,
      referenceMeanLuma: null, decodedMeanLuma: null, lumaDelta: null,
      colorSpace: null, reason: 'No staging-frame reference was captured.',
    };
  }

  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('Exported artifact contains no video track.');
    const colorSpace = await track.getColorSpace();
    const sink = new VideoSampleSink(track, { hardwareAcceleration: 'no-preference' });
    const sample = await sink.getSample(0);
    if (!sample) throw new Error('The first exported frame could not be decoded.');

    try {
      const canvas = document.createElement('canvas');
      canvas.width = reference.width;
      canvas.height = reference.height;
      const context = canvas.getContext('2d', {
        alpha: false,
        willReadFrequently: true,
        colorSpace: 'srgb',
      } as never);
      if (!context) throw new Error('Could not create the decoded-frame comparison canvas.');
      sample.draw(context, 0, 0, canvas.width, canvas.height);
      const decoded = readCanvas(canvas);
      canvas.width = 1;
      canvas.height = 1;
      if (!decoded) throw new Error('Could not read the decoded comparison frame.');

      const metrics = compareRgbaFrames(reference.rgba, decoded.rgba, {
        meanAbsoluteError: 8,
        rootMeanSquareError: 12,
        maximumChannelError: 96,
      });
      const lumaDelta = decoded.meanLuma - reference.meanLuma;
      const passed = metrics.passed && Math.abs(lumaDelta) <= 6;
      return {
        checked: true,
        passed,
        metrics,
        referenceMeanRgb: reference.meanRgb,
        decodedMeanRgb: decoded.meanRgb,
        referenceMeanLuma: reference.meanLuma,
        decodedMeanLuma: decoded.meanLuma,
        lumaDelta,
        colorSpace,
      };
    } finally {
      sample.close();
    }
  } catch (error) {
    return {
      checked: false, passed: false, metrics: null,
      referenceMeanRgb: reference.meanRgb, decodedMeanRgb: null,
      referenceMeanLuma: reference.meanLuma, decodedMeanLuma: null, lumaDelta: null,
      colorSpace: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    input.dispose();
  }
}
