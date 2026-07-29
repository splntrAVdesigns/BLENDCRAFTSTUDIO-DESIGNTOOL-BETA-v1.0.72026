import test from 'node:test';
import assert from 'node:assert/strict';
import { detectMediaRecorderCapability } from '../src/app/export/MediaRecorderCapability.ts';

test('chooses VP9 before VP8 and generic WebM', () => {
  const fake = { isTypeSupported: (type: string) => type.includes('vp8') || type.includes('vp9') } as typeof MediaRecorder;
  const result = detectMediaRecorderCapability(fake);
  assert.equal(result.supported, true);
  assert.equal(result.mimeType, 'video/webm;codecs=vp9');
});

test('returns a clear unsupported result', () => {
  const fake = { isTypeSupported: () => false } as unknown as typeof MediaRecorder;
  const result = detectMediaRecorderCapability(fake);
  assert.equal(result.supported, false);
  assert.equal(result.mimeType, null);
});
