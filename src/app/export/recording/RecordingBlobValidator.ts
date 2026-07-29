export interface ValidateRecordingBlobInput {
  readonly blob: Blob;
  readonly mimeType: string;
  readonly chunkCount: number;
  readonly publishedFrameCount: number;
  readonly minimumBytes?: number;
}

export function validateRecordingBlob(input: ValidateRecordingBlobInput): void {
  const minimumBytes = Math.max(1, input.minimumBytes ?? 1024);
  if (input.chunkCount <= 0) throw new Error('Recording produced no encoded chunks.');
  if (input.publishedFrameCount <= 0) throw new Error('Recording published no video frames.');
  if (input.blob.size === 0) throw new Error('Recording produced a zero-byte Blob.');
  if (input.blob.size < minimumBytes) {
    throw new Error(`Recording Blob is unexpectedly small (${input.blob.size} bytes).`);
  }
  if (!input.blob.type.startsWith('video/webm') && !input.mimeType.startsWith('video/webm')) {
    throw new Error(`Unexpected recording MIME type: ${input.blob.type || input.mimeType || 'unknown'}.`);
  }
}
