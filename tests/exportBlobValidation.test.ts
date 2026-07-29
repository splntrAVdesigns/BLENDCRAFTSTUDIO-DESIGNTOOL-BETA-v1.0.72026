import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExportBlob } from '../src/app/export/ExportBlobValidation.ts';

test('accepts a non-empty inactive WebM recording', () => {
  const blob = new Blob([new Uint8Array(2048)], { type: 'video/webm;codecs=vp9' });
  const result = validateExportBlob({ blob, expectedMimePrefix: 'video/webm', recorderState: 'inactive' });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('rejects empty, wrong-type, or still-recording results', () => {
  const blob = new Blob([], { type: 'text/plain' });
  const result = validateExportBlob({ blob, expectedMimePrefix: 'video/webm', recorderState: 'recording' });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 3);
});
