/**
 * VP9 level selection (VP9 Bitstream & Decoding Process Specification, Annex A).
 *
 * PHASE 7.7 — carried forward from the Stage 3.3 root cause. Software VP9
 * accepts ANY level string in the codec parameter, so an over-specified level
 * (for example the 4K-class 6.1) silently forces the encoder to plan for 4K
 * complexity even when the frames are 720p. That was the single largest
 * contributor to slow encodes. The correct behaviour is to compute the MINIMUM
 * adequate level from the real resolution and frame rate.
 *
 * Codec string format: vp09.<profile>.<level>.<bitDepth>
 *   profile 00 = 8-bit 4:2:0
 *   level    = major*10 + minor (e.g. 4.1 -> "41")
 *   bitDepth 08 = 8 bits
 */

export interface Vp9Level {
  /** Level id as it appears in the codec string, e.g. 41 for level 4.1. */
  readonly id: number;
  /** Max luma sample rate (samples/second). */
  readonly maxLumaSampleRate: number;
  /** Max luma picture size (samples). */
  readonly maxLumaPictureSize: number;
  /** Max average bitrate in kbps for the main profile. */
  readonly maxBitrateKbps: number;
}

export const VP9_LEVELS: readonly Vp9Level[] = [
  { id: 10, maxLumaSampleRate: 829_440, maxLumaPictureSize: 36_864, maxBitrateKbps: 200 },
  { id: 11, maxLumaSampleRate: 2_764_800, maxLumaPictureSize: 73_728, maxBitrateKbps: 800 },
  { id: 20, maxLumaSampleRate: 4_608_000, maxLumaPictureSize: 122_880, maxBitrateKbps: 1_800 },
  { id: 21, maxLumaSampleRate: 9_216_000, maxLumaPictureSize: 245_760, maxBitrateKbps: 3_600 },
  { id: 30, maxLumaSampleRate: 20_736_000, maxLumaPictureSize: 552_960, maxBitrateKbps: 7_200 },
  { id: 31, maxLumaSampleRate: 36_864_000, maxLumaPictureSize: 983_040, maxBitrateKbps: 12_000 },
  { id: 40, maxLumaSampleRate: 83_558_400, maxLumaPictureSize: 2_228_224, maxBitrateKbps: 18_000 },
  { id: 41, maxLumaSampleRate: 160_432_128, maxLumaPictureSize: 2_228_224, maxBitrateKbps: 30_000 },
  { id: 50, maxLumaSampleRate: 311_951_360, maxLumaPictureSize: 8_912_896, maxBitrateKbps: 60_000 },
  { id: 51, maxLumaSampleRate: 588_251_136, maxLumaPictureSize: 8_912_896, maxBitrateKbps: 120_000 },
  { id: 52, maxLumaSampleRate: 1_176_502_272, maxLumaPictureSize: 8_912_896, maxBitrateKbps: 180_000 },
  { id: 60, maxLumaSampleRate: 1_176_502_272, maxLumaPictureSize: 35_651_584, maxBitrateKbps: 180_000 },
  { id: 61, maxLumaSampleRate: 2_353_004_544, maxLumaPictureSize: 35_651_584, maxBitrateKbps: 240_000 },
  { id: 62, maxLumaSampleRate: 4_706_009_088, maxLumaPictureSize: 35_651_584, maxBitrateKbps: 480_000 },
];

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Returns the minimum VP9 level that can carry the given stream. */
export function selectMinimumVp9Level(width: number, height: number, fps: number, bitrate: number): Vp9Level {
  const pictureSize = Math.max(1, width) * Math.max(1, height);
  const sampleRate = pictureSize * Math.max(1, fps);
  const bitrateKbps = Math.ceil(Math.max(0, bitrate) / 1000);
  for (const level of VP9_LEVELS) {
    if (
      level.maxLumaPictureSize >= pictureSize
      && level.maxLumaSampleRate >= sampleRate
      && level.maxBitrateKbps >= bitrateKbps
    ) {
      return level;
    }
  }
  return VP9_LEVELS[VP9_LEVELS.length - 1];
}

/** Builds a fully-specified VP9 codec string sized to the actual stream. */
export function buildVp9CodecString(width: number, height: number, fps: number, bitrate: number): string {
  const level = selectMinimumVp9Level(width, height, fps, bitrate);
  return `vp09.00.${pad2(level.id)}.08`;
}
