import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSupportedRecordingCodecs,
  selectRecordingCodec,
} from '../src/app/export/recording/RecordingCodecPolicy.ts';
import { resolveRecordingProfile } from '../src/app/export/recording/RecordingProfiles.ts';
import { createRecordingQualityCertification } from '../src/app/export/recording/RecordingQualityCertification.ts';

test('codec policy preserves VP9, VP8, generic WebM fallback order', () => {
  class FakeRecorder {
    static isTypeSupported(type: string): boolean {
      return type.includes('vp8') || type === 'video/webm';
    }
  }
  const codecs = getSupportedRecordingCodecs(FakeRecorder as unknown as typeof MediaRecorder);
  assert.deepEqual(codecs.map((codec) => codec.codecLabel), ['VP8', 'WebM']);
  assert.equal(selectRecordingCodec(FakeRecorder as unknown as typeof MediaRecorder).codecLabel, 'VP8');
});

test('1080p high profile uses certified 40 Mbps and short chunk timeslices', () => {
  const profile = resolveRecordingProfile({
    width: 1920,
    height: 1080,
    fps: 30,
    quality: 'high',
    durationMs: 5_000,
  });
  assert.equal(profile.videoBitsPerSecond, 40_000_000);
  assert.equal(profile.dataTimesliceMs, 1_000);
});

test('non-exact resolutions scale bitrate without exceeding the production cap', () => {
  const profile = resolveRecordingProfile({
    width: 2560,
    height: 1440,
    fps: 30,
    quality: 'high',
    durationMs: 5_000,
  });
  assert.ok(profile.videoBitsPerSecond > 40_000_000);
  assert.ok(profile.videoBitsPerSecond <= 60_000_000);
});

test('quality certification reports frame completion and actual bitrate', () => {
  const certification = createRecordingQualityCertification({
    blobBytes: 12_000_000,
    durationMs: 5_000,
    targetBitsPerSecond: 40_000_000,
    quality: 'high',
    chunkCount: 20,
    publishedFrameCount: 150,
    totalFrameCount: 150,
  });
  assert.equal(certification.actualBitsPerSecond, 19_200_000);
  assert.equal(certification.frameCompletionRatio, 1);
  assert.equal(certification.passed, true);
});

test('quality certification warns on incomplete or implausibly tiny output', () => {
  const certification = createRecordingQualityCertification({
    blobBytes: 1_024,
    durationMs: 5_000,
    targetBitsPerSecond: 40_000_000,
    quality: 'high',
    chunkCount: 1,
    publishedFrameCount: 149,
    totalFrameCount: 150,
  });
  assert.equal(certification.passed, false);
  assert.ok(certification.warnings.length >= 2);
});
