import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateRecordingBytes, resolveRecordingProfile } from '../src/app/export/recording/RecordingProfiles.ts';
import { validateRecordingBlob } from '../src/app/export/recording/RecordingBlobValidator.ts';
import { RecordingSessionController } from '../src/app/export/recording/RecordingSessionController.ts';
import { selectRecordingCodec } from '../src/app/export/recording/RecordingCodecPolicy.ts';

test('resolves the 1080p high profile and estimates size', () => {
  const profile = resolveRecordingProfile({ width: 1920, height: 1080, fps: 30, quality: 'high', durationMs: 5_000 });
  assert.equal(profile.videoBitsPerSecond, 24_000_000);
  assert.equal(estimateRecordingBytes(profile.videoBitsPerSecond, 5_000), 15_000_000);
});

test('codec selection follows VP9, VP8, WebM fallback order', () => {
  class FakeRecorder {
    static isTypeSupported(type: string): boolean { return type.includes('vp8') || type === 'video/webm'; }
  }
  const codec = selectRecordingCodec(FakeRecorder as unknown as typeof MediaRecorder);
  assert.equal(codec.mimeType, 'video/webm;codecs=vp8');
});

test('blob validator rejects empty output and accepts valid WebM', () => {
  assert.throws(() => validateRecordingBlob({ blob: new Blob([], { type: 'video/webm' }), mimeType: 'video/webm', chunkCount: 0, publishedFrameCount: 0 }));
  assert.doesNotThrow(() => validateRecordingBlob({ blob: new Blob([new Uint8Array(2048)], { type: 'video/webm' }), mimeType: 'video/webm', chunkCount: 1, publishedFrameCount: 150 }));
});

test('session controller rejects invalid transitions', () => {
  const controller = new RecordingSessionController();
  assert.throws(() => controller.transition('recording'));
  controller.transition('preparing');
  controller.transition('recording');
  controller.transition('stopping');
  controller.transition('finalizing');
  controller.transition('restoring');
  controller.transition('completed');
  assert.equal(controller.state, 'completed');
});
