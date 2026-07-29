import type { RecordingQuality, RecordingQualityCertification } from './types';

const QUALITY_MINIMUM_RATIO: Record<RecordingQuality, number> = {
  standard: 0.015,
  high: 0.02,
  ultra: 0.025,
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
