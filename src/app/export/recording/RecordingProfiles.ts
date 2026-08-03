import type { RecordingProfile, RecordingQuality } from './types';

const MEBIBYTE = 1024 * 1024;
const DEFAULT_TIMESLICE_MS = 1_000;

export const RECORDING_PROFILES: readonly RecordingProfile[] = [
  {
    id: '720p-standard-30',
    quality: 'standard',
    width: 1280,
    height: 720,
    fps: 30,
    videoBitsPerSecond: 10_000_000,
    maxDurationMs: 120_000,
    maxEstimatedBytes: 180 * MEBIBYTE,
    dataTimesliceMs: DEFAULT_TIMESLICE_MS,
  },
  {
    id: '1080p-high-30',
    quality: 'high',
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitsPerSecond: 16_000_000,
    maxDurationMs: 120_000,
    maxEstimatedBytes: 420 * MEBIBYTE,
    dataTimesliceMs: DEFAULT_TIMESLICE_MS,
  },
  {
    id: '1080p-ultra-60',
    quality: 'ultra',
    width: 1920,
    height: 1080,
    fps: 60,
    videoBitsPerSecond: 24_000_000,
    maxDurationMs: 60_000,
    maxEstimatedBytes: 420 * MEBIBYTE,
    dataTimesliceMs: DEFAULT_TIMESLICE_MS,
  },
] as const;

export interface ResolveRecordingProfileInput {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly quality: RecordingQuality;
  readonly durationMs: number;
}

export function estimateRecordingBytes(videoBitsPerSecond: number, durationMs: number): number {
  return Math.ceil((Math.max(0, videoBitsPerSecond) * Math.max(0, durationMs)) / 8_000);
}

function scaleBitrate(quality: RecordingQuality, width: number, height: number, fps: number): number {
  const baseline1080p30: Record<RecordingQuality, number> = {
    standard: 10_000_000,
    high: 16_000_000,
    ultra: 24_000_000,
  };
  const pixelRate = Math.max(1, width * height * fps);
  const baselinePixelRate = 1920 * 1080 * 30;
  const scaled = baseline1080p30[quality] * Math.sqrt(pixelRate / baselinePixelRate);
  return Math.round(Math.max(4_000_000, Math.min(80_000_000, scaled)) / 100_000) * 100_000;
}

export function resolveRecordingProfile(input: ResolveRecordingProfileInput): RecordingProfile {
  const exact = RECORDING_PROFILES.find((profile) =>
    profile.width === input.width
    && profile.height === input.height
    && profile.fps === input.fps
    && profile.quality === input.quality,
  );
  const base = exact ?? RECORDING_PROFILES.find((profile) => profile.quality === input.quality) ?? RECORDING_PROFILES[1];
  const videoBitsPerSecond = scaleBitrate(input.quality, input.width, input.height, input.fps);
  const estimatedBytes = estimateRecordingBytes(videoBitsPerSecond, input.durationMs);
  if (input.durationMs <= 0 || input.durationMs > base.maxDurationMs) {
    throw new Error(`Recording duration must be between 1 ms and ${base.maxDurationMs} ms for ${base.id}.`);
  }
  if (estimatedBytes > base.maxEstimatedBytes) {
    throw new Error(`Estimated recording size exceeds the ${base.id} safety limit.`);
  }
  return {
    ...base,
    id: exact?.id ?? `${input.width}x${input.height}-${input.quality}-${input.fps}`,
    width: input.width,
    height: input.height,
    fps: input.fps,
    videoBitsPerSecond,
  };
}
