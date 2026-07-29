/**
 * Phase 5 — Render Quality Certification
 *
 * Shared, dependency-free policy and pixel comparison helpers used to keep PNG
 * captures and WebM staging frames on the same sRGB/straight-alpha contract.
 */

export const EXPORT_COLOR_CONTRACT = Object.freeze({
  workingSpace: 'linear-srgb',
  outputSpace: 'srgb',
  alphaMode: 'straight',
  channelDepthBits: 8,
  ditherAmplitude: 1 / 255,
} as const);

export interface TextureQualityOptions {
  colorSpace: unknown;
  minFilter: unknown;
  magFilter: unknown;
  wrapS: unknown;
  wrapT: unknown;
  anisotropy?: number;
  generateMipmaps?: boolean;
}

/** Apply one authoritative texture sampling policy without replacing the texture. */
export function applyTextureQualityPolicy(texture: any, options: TextureQualityOptions): any {
  if (!texture) return texture;
  texture.colorSpace = options.colorSpace;
  texture.minFilter = options.minFilter;
  texture.magFilter = options.magFilter;
  texture.wrapS = options.wrapS;
  texture.wrapT = options.wrapT;
  texture.generateMipmaps = options.generateMipmaps ?? false;
  texture.anisotropy = Math.max(1, Math.floor(options.anisotropy ?? 1));
  texture.needsUpdate = true;
  return texture;
}

export interface FrameParityMetrics {
  comparedPixels: number;
  meanAbsoluteError: number;
  rootMeanSquareError: number;
  maximumChannelError: number;
  alphaMismatchPixels: number;
  passed: boolean;
}

export interface FrameParityThresholds {
  meanAbsoluteError?: number;
  rootMeanSquareError?: number;
  maximumChannelError?: number;
  alphaMismatchRatio?: number;
}

const DEFAULT_THRESHOLDS: Required<FrameParityThresholds> = {
  // WebM is lossy, so certification allows tiny codec error but rejects visible drift.
  meanAbsoluteError: 3.0,
  rootMeanSquareError: 5.0,
  maximumChannelError: 32,
  alphaMismatchRatio: 0,
};

/** Compare equal-sized RGBA8 PNG/WebM frame buffers. */
export function compareRgbaFrames(
  reference: ArrayLike<number>,
  candidate: ArrayLike<number>,
  thresholds: FrameParityThresholds = {},
): FrameParityMetrics {
  if (reference.length !== candidate.length || reference.length % 4 !== 0) {
    throw new Error('RGBA frame buffers must have equal lengths divisible by four.');
  }

  const limits = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const pixels = reference.length / 4;
  let absoluteTotal = 0;
  let squaredTotal = 0;
  let maximum = 0;
  let alphaMismatchPixels = 0;

  for (let i = 0; i < reference.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const delta = Math.abs(Number(reference[i + c]) - Number(candidate[i + c]));
      absoluteTotal += delta;
      squaredTotal += delta * delta;
      maximum = Math.max(maximum, delta);
    }
    if (Number(reference[i + 3]) !== Number(candidate[i + 3])) alphaMismatchPixels++;
  }

  const channels = Math.max(1, pixels * 3);
  const meanAbsoluteError = absoluteTotal / channels;
  const rootMeanSquareError = Math.sqrt(squaredTotal / channels);
  const alphaMismatchRatio = alphaMismatchPixels / Math.max(1, pixels);

  return {
    comparedPixels: pixels,
    meanAbsoluteError,
    rootMeanSquareError,
    maximumChannelError: maximum,
    alphaMismatchPixels,
    passed:
      meanAbsoluteError <= limits.meanAbsoluteError &&
      rootMeanSquareError <= limits.rootMeanSquareError &&
      maximum <= limits.maximumChannelError &&
      alphaMismatchRatio <= limits.alphaMismatchRatio,
  };
}

/** Stable sub-LSB dither sample for certification and CPU-side fallbacks. */
export function qualityDither(x: number, y: number, frameIndex = 0): number {
  const n = Math.imul((x | 0) ^ Math.imul(y | 0, 374761393), 668265263) ^ Math.imul(frameIndex | 0, 2246822519);
  const mixed = Math.imul(n ^ (n >>> 13), 1274126177) ^ (n >>> 16);
  return (((mixed >>> 0) / 0xffffffff) - 0.5) * EXPORT_COLOR_CONTRACT.ditherAmplitude;
}
