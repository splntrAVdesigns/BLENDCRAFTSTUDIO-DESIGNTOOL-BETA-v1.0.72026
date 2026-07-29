export interface ExportBlobValidationInput {
  readonly blob: Blob;
  readonly expectedMimePrefix?: string;
  readonly minimumBytes?: number;
  readonly recorderState?: RecordingState;
}

export interface ExportBlobValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateExportBlob(input: ExportBlobValidationInput): ExportBlobValidationResult {
  const errors: string[] = [];
  const minimumBytes = Math.max(1, input.minimumBytes ?? 1024);
  if (input.blob.size < minimumBytes) errors.push(`Recorded Blob is too small (${input.blob.size} bytes).`);
  if (input.expectedMimePrefix && !input.blob.type.startsWith(input.expectedMimePrefix)) {
    errors.push(`Unexpected Blob MIME type: ${input.blob.type || 'empty'}.`);
  }
  if (input.recorderState && input.recorderState !== 'inactive') {
    errors.push(`Recorder did not reach inactive state (${input.recorderState}).`);
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function assertValidExportBlob(input: ExportBlobValidationInput): void {
  const result = validateExportBlob(input);
  if (!result.valid) throw new Error(result.errors.join(' '));
}
