import type { RecordingQuality, RecordingQualityCertification } from './types';

/**
 * PHASE 7.7: these were 0.015 / 0.02 / 0.025 — a 2% floor, which meant a
 * 16 Mbps target "passed" at 320 kbps. That is not a gate. VBR legitimately
 * undershoots on low-complexity content, so the floor is set to a realistic
 * fraction of target rather than a rubber stamp.
 */
const QUALITY_MINIMUM_RATIO: Record<RecordingQuality, number> = {
  standard: 0.30,
  high: 0.35,
  ultra: 0.40,
};

export interface CreateRecordingQualityCertificationInput {
  readonly blobBytes: number;
  readonly durationMs: number;
  readonly targetBitsPerSecond: number;
  readonly quality: RecordingQuality;
  readonly chunkCount: number;
  readonly publishedFrameCount: number;
  readonly totalFrameCount: number;
}

export function createRecordingQualityCertification(
  input: CreateRecordingQualityCertificationInput,
): RecordingQualityCertification {
  const durationSeconds = Math.max(0.001, input.durationMs / 1000);
  const actualBitsPerSecond = Math.round((Math.max(0, input.blobBytes) * 8) / durationSeconds);
  const targetUtilization = input.targetBitsPerSecond > 0
    ? actualBitsPerSecond / input.targetBitsPerSecond
    : 0;
  const frameCompletionRatio = input.totalFrameCount > 0
    ? input.publishedFrameCount / input.totalFrameCount
    : 0;
  const minimumUtilization = QUALITY_MINIMUM_RATIO[input.quality];
  const warnings: string[] = [];

  if (input.chunkCount <= 0) warnings.push('No encoded chunks were emitted.');
  if (frameCompletionRatio < 1) warnings.push('The recording did not publish every planned frame.');
  if (targetUtilization < minimumUtilization) {
    warnings.push('The encoded bitrate is unexpectedly low for the selected quality profile.');
  }

  return {
    passed: warnings.length === 0,
    actualBitsPerSecond,
    targetUtilization,
    frameCompletionRatio,
    warnings,
  };
}
