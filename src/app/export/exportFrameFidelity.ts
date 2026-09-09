import {
  ALL_FORMATS,
  BlobSource,
  Input,
  VideoSampleSink,
} from 'mediabunny';
import { compareRgbaFrames, type FrameParityMetrics } from '../utils/exportRenderQuality';

const DETAIL_SIZE = 256;

type ExportVideoColorSpace = {
  primaries?: string | null;
  transfer?: string | null;
  matrix?: string | null;
  fullRange?: boolean | null;
};

export interface ExportFrameSample {
  width: number;
  height: number;
  sourceWidth?: number;
  sourceHeight?: number;
  timestamp?: number;
  regions?: Array<{ x: number; y: number; width: number; height: number }>;
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
  colorContractPassed?: boolean;
  detail?: ExportDetailMetrics | null;
  reason?: string;
  frames?: ExportFrameFidelityResult[];
  timestamp?: number;
}

export interface ExportDetailMetrics {
  referenceLumaEdgeEnergy: number;
  decodedLumaEdgeEnergy: number;
  edgeRetentionRatio: number;
  chromaMeanAbsoluteError: number;
  passed: boolean;
}

const luma = (r: number, g: number, b: number) => r * 0.2126 + g * 0.7152 + b * 0.0722;
const cb = (r: number, g: number, b: number) => -r * 0.1146 - g * 0.3854 + b * 0.5;
const cr = (r: number, g: number, b: number) => r * 0.5 - g * 0.4542 - b * 0.0458;

/** Native-pixel edge/chroma certification. Unlike global RGB averages, this
 * detects the softening and colored-edge loss characteristic of YUV codecs. */
export function compareExportDetail(
  reference: ExportFrameSample,
  candidate: ExportFrameSample,
): ExportDetailMetrics {
  const width = reference.width;
  const height = reference.height;
  const regionCount = Math.max(1, reference.regions?.length ?? 1);
  const regionWidth = Math.max(1, Math.floor(width / regionCount));
  let referenceEdges = 0;
  let candidateEdges = 0;
  let edgeSamples = 0;
  let chromaError = 0;
  let chromaSamples = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const rr = reference.rgba[i], rg = reference.rgba[i + 1], rb = reference.rgba[i + 2];
      const cr0 = candidate.rgba[i], cg = candidate.rgba[i + 1], cb0 = candidate.rgba[i + 2];
      chromaError += Math.abs(cb(rr, rg, rb) - cb(cr0, cg, cb0));
      chromaError += Math.abs(cr(rr, rg, rb) - cr(cr0, cg, cb0));
      chromaSamples += 2;

      // Exclude the artificial seams between packed detail regions.
      const atRegionEdge = x % regionWidth === regionWidth - 1;
      if (!atRegionEdge && x + 1 < width) {
        const n = i + 4;
        referenceEdges += Math.abs(luma(rr, rg, rb) - luma(reference.rgba[n], reference.rgba[n + 1], reference.rgba[n + 2]));
        candidateEdges += Math.abs(luma(cr0, cg, cb0) - luma(candidate.rgba[n], candidate.rgba[n + 1], candidate.rgba[n + 2]));
        edgeSamples++;
      }
      if (y + 1 < height) {
        const n = i + width * 4;
        referenceEdges += Math.abs(luma(rr, rg, rb) - luma(reference.rgba[n], reference.rgba[n + 1], reference.rgba[n + 2]));
        candidateEdges += Math.abs(luma(cr0, cg, cb0) - luma(candidate.rgba[n], candidate.rgba[n + 1], candidate.rgba[n + 2]));
        edgeSamples++;
      }
    }
  }

  const referenceLumaEdgeEnergy = referenceEdges / Math.max(1, edgeSamples);
  const decodedLumaEdgeEnergy = candidateEdges / Math.max(1, edgeSamples);
  const edgeRetentionRatio = decodedLumaEdgeEnergy / Math.max(0.0001, referenceLumaEdgeEnergy);
  const chromaMeanAbsoluteError = chromaError / Math.max(1, chromaSamples);
  return {
    referenceLumaEdgeEnergy,
    decodedLumaEdgeEnergy,
    edgeRetentionRatio,
    chromaMeanAbsoluteError,
    passed: edgeRetentionRatio >= 0.82 && edgeRetentionRatio <= 1.25 && chromaMeanAbsoluteError <= 10,
  };
}

export function isBt709DeliveryColorSpace(colorSpace: ExportVideoColorSpace | null): boolean {
  return colorSpace?.primaries === 'bt709'
    && colorSpace?.transfer === 'bt709'
    && colorSpace?.matrix === 'bt709'
    && colorSpace?.fullRange === false;
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

/** Five native-resolution detail regions: corners and center. No resampling. */
export function captureExportFrameSample(source: HTMLCanvasElement, timestamp = 0): ExportFrameSample | null {
  if (source.width <= 0 || source.height <= 0) return null;
  const w = Math.min(DETAIL_SIZE, source.width), h = Math.min(DETAIL_SIZE, source.height);
  const regions = [[0, 0], [source.width - w, 0], [0, source.height - h],
    [source.width - w, source.height - h], [Math.floor((source.width - w) / 2), Math.floor((source.height - h) / 2)]]
    .map(([x, y]) => ({ x, y, width: w, height: h }));
  const canvas = document.createElement('canvas');
  canvas.width = w * regions.length; canvas.height = h;
  const context = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' } as never);
  if (!context) return null;
  context.imageSmoothingEnabled = false;
  regions.forEach((region, index) => context.drawImage(source, region.x, region.y, w, h, index * w, 0, w, h));
  const result = readCanvas(canvas);
  canvas.width = canvas.height = 1;
  return result && { ...result, regions, sourceWidth: source.width, sourceHeight: source.height, timestamp };
}

export function isFidelitySampleFrame(index: number, totalFrames: number): boolean {
  return index === 0 || index === Math.floor(totalFrames / 2) || index === totalFrames - 1;
}

/**
 * Decodes the actual produced file at each reference timestamp and compares the
 * native-resolution detail regions from the exact staging canvas supplied to the encoder.
 * Non-throwing: verification failure is reported but never destroys a valid
 * user export.
 */
export async function verifyExportedFrameFidelity(
  blob: Blob,
  reference: ExportFrameSample | ExportFrameSample[] | null,
): Promise<ExportFrameFidelityResult> {
  if (Array.isArray(reference)) {
    if (!reference.length) return verifyExportedFrameFidelity(blob, null);
    const frames: ExportFrameFidelityResult[] = [];
    for (const frame of reference) frames.push(await verifyExportedFrameFidelity(blob, frame));
    return { ...frames[0], checked: frames.every(frame => frame.checked),
      passed: frames.every(frame => frame.checked && frame.passed), frames };
  }
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
    // WebM timestamps can be rounded to milliseconds. Query just inside the
    // requested frame rather than accidentally retrieving its predecessor.
    const sample = await sink.getSample((reference.timestamp ?? 0) + 0.001);
    if (!sample) throw new Error('The requested exported frame could not be decoded.');
    if (Math.abs(sample.timestamp - (reference.timestamp ?? 0)) > 0.001) {
      sample.close();
      throw new Error('Decoder returned a different frame timestamp.');
    }

    try {
      if (reference.sourceWidth && (sample.displayWidth !== reference.sourceWidth || sample.displayHeight !== reference.sourceHeight)) {
        throw new Error('Decoded frame dimensions differ from the captured reference.');
      }
      const canvas = document.createElement('canvas');
      canvas.width = reference.sourceWidth ?? reference.width;
      canvas.height = reference.sourceHeight ?? reference.height;
      const context = canvas.getContext('2d', {
        alpha: false,
        willReadFrequently: true,
        colorSpace: 'srgb',
      } as never);
      if (!context) throw new Error('Could not create the decoded-frame comparison canvas.');
      sample.draw(context, 0, 0, canvas.width, canvas.height);
      const decoded = reference.regions ? captureExportFrameSample(canvas, reference.timestamp) : readCanvas(canvas);
      canvas.width = 1;
      canvas.height = 1;
      if (!decoded) throw new Error('Could not read the decoded comparison frame.');

      const metrics = compareRgbaFrames(reference.rgba, decoded.rgba, {
        meanAbsoluteError: 8,
        rootMeanSquareError: 12,
        maximumChannelError: 96,
      });
      const lumaDelta = decoded.meanLuma - reference.meanLuma;
      const detail = compareExportDetail(reference, decoded);
      const colorContractPassed = isBt709DeliveryColorSpace(colorSpace);
      const passed = metrics.passed && Math.abs(lumaDelta) <= 6 && detail.passed && colorContractPassed;
      return {
        timestamp: reference.timestamp,
        checked: true,
        passed,
        metrics,
        referenceMeanRgb: reference.meanRgb,
        decodedMeanRgb: decoded.meanRgb,
        referenceMeanLuma: reference.meanLuma,
        decodedMeanLuma: decoded.meanLuma,
        lumaDelta,
        colorSpace,
        colorContractPassed,
        detail,
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
