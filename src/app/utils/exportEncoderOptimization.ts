export type ExportVideoQuality = 'standard' | 'high' | 'ultra' | 'max' | 'sharpMax';

export interface WebMCodecCandidate {
  codec: string;
  codecId: 'V_VP9' | 'V_VP8';
}

/**
 * Phase 4 encoder policy.
 * In Chromium iframe hosts, software VP9 can be dramatically slower than VP8.
 * Use VP8 first for interactive export tiers while preserving VP9-first for
 * master-quality tiers and standalone/hardware-capable environments.
 */
export function orderWebMCodecCandidates(
  vp9Candidates: WebMCodecCandidate[],
  vp8Candidate: WebMCodecCandidate,
  options: { iframe: boolean; quality: ExportVideoQuality },
): WebMCodecCandidate[] {
  const masterTier = options.quality === 'max' || options.quality === 'sharpMax';
  if (options.iframe && !masterTier) return [vp8Candidate, ...vp9Candidates];
  return [...vp9Candidates, vp8Candidate];
}

export function getOptimizedEncoderBitrate(
  baseBitrate: number,
  codecId: 'V_VP9' | 'V_VP8',
  quality: ExportVideoQuality,
): number {
  // VP8 needs a little more headroom than VP9 for smooth gradients.
  const vp8Factor = quality === 'standard' ? 1.1 : 1.18;
  return Math.round(baseBitrate * (codecId === 'V_VP8' ? vp8Factor : 1));
}

export function getKeyFrameIntervalFrames(fps: number, totalFrames: number): number {
  const safeFps = Math.max(1, Math.round(fps));
  // Two-second GOP reduces expensive intra-frame work while retaining seeking.
  return Math.max(1, Math.min(totalFrames, safeFps * 2));
}

export function shouldEncodeKeyFrame(frameIndex: number, intervalFrames: number): boolean {
  return frameIndex === 0 || frameIndex % Math.max(1, intervalFrames) === 0;
}

export type EncoderQueueWatermarks = {
  low: number;
  high: number;
};

export function getOptimizedQueueWatermarks(
  width: number,
  height: number,
  codecId: 'V_VP9' | 'V_VP8',
  softwareEncode: boolean,
): EncoderQueueWatermarks {
  const pixels = width * height;

  // Phase 7.1A: use hysteresis rather than serialising render and encode.
  // Rendering may run until the HIGH watermark, then waits only until the
  // encoder falls to LOW. This gives Chromium useful batches of work while
  // keeping queued surfaces bounded.
  if (!softwareEncode) {
    if (pixels >= 3840 * 2160) return { low: 3, high: 8 };
    if (pixels >= 2560 * 1440) return { low: 5, high: 12 };
    return { low: 8, high: 18 };
  }

  if (pixels >= 3840 * 2160) {
    return codecId === 'V_VP8' ? { low: 1, high: 4 } : { low: 1, high: 3 };
  }
  if (pixels >= 2560 * 1440) {
    return codecId === 'V_VP8' ? { low: 2, high: 7 } : { low: 1, high: 5 };
  }
  if (pixels >= 1920 * 1080) {
    return codecId === 'V_VP8' ? { low: 4, high: 10 } : { low: 2, high: 6 };
  }
  return codecId === 'V_VP8' ? { low: 6, high: 14 } : { low: 3, high: 8 };
}

/** Backwards-compatible high watermark used by older callers/tests. */
export function getOptimizedQueueWatermark(
  width: number,
  height: number,
  codecId: 'V_VP9' | 'V_VP8',
  softwareEncode: boolean,
): number {
  return getOptimizedQueueWatermarks(width, height, codecId, softwareEncode).high;
}


/**
 * Phase 7.1B known-good scheduling policy. encodeQueueSize is diagnostic only
 * inside Figma; it must never become a blocking low-watermark condition. This
 * threshold merely decides when to yield one browser turn before continuing.
 */
export function getFigmaSafeQueueYieldThreshold(
  width: number,
  height: number,
  codecId: 'V_VP9' | 'V_VP8',
  softwareEncode: boolean,
): number {
  const pixels = width * height;
  if (!softwareEncode) return pixels >= 3840 * 2160 ? 12 : 24;
  if (pixels >= 3840 * 2160) return codecId === 'V_VP8' ? 8 : 6;
  if (pixels >= 2560 * 1440) return codecId === 'V_VP8' ? 12 : 8;
  if (pixels >= 1920 * 1080) return codecId === 'V_VP8' ? 16 : 10;
  return codecId === 'V_VP8' ? 24 : 14;
}
