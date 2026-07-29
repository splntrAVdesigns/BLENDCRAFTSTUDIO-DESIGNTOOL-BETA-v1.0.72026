/**
 * Beta upload validation guardrails.
 * Keeps user-provided files from stalling the UI, exhausting memory, or slipping unsafe SVG payloads into mask/image flows.
 */

export type UploadKind = 'mask-image' | 'color-image' | 'json-import';

export interface UploadValidationResult {
  ok: boolean;
  error?: string;
}

export const UPLOAD_LIMITS = {
  maskImageMaxBytes: 8 * 1024 * 1024,      // 8MB
  colorImageMaxBytes: 6 * 1024 * 1024,     // 6MB
  svgMaxBytes: 500 * 1024,                 // 500KB
  jsonMaxBytes: 2 * 1024 * 1024,           // 2MB
  maxBitmapPixels: 4096 * 4096,            // 16.7MP
  maxSvgElements: 1200,
  maxSvgPathChars: 240_000,
  maxSvgDataUrlChars: 1_500_000,
} as const;

const ALLOWED_MASK_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
]);

const ALLOWED_BITMAP_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

export function getFileExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index >= 0 ? fileName.slice(index + 1).toLowerCase() : '';
}

export function validateUploadFile(file: File, kind: UploadKind): UploadValidationResult {
  const ext = getFileExtension(file.name);
  const type = (file.type || '').toLowerCase();

  if (kind === 'json-import') {
    if (file.size > UPLOAD_LIMITS.jsonMaxBytes) {
      return { ok: false, error: 'JSON import is too large. Max size is 2MB.' };
    }
    if (type && type !== 'application/json' && type !== 'text/json') {
      return { ok: false, error: 'Please upload a valid JSON file.' };
    }
    if (ext !== 'json') {
      return { ok: false, error: 'Please upload a .json file.' };
    }
    return { ok: true };
  }

  const isSvg = type === 'image/svg+xml' || ext === 'svg';
  const maxBytes = kind === 'mask-image'
    ? (isSvg ? UPLOAD_LIMITS.svgMaxBytes : UPLOAD_LIMITS.maskImageMaxBytes)
    : UPLOAD_LIMITS.colorImageMaxBytes;

  if (file.size > maxBytes) {
    const mb = maxBytes / (1024 * 1024);
    const label = maxBytes < 1024 * 1024 ? `${Math.round(maxBytes / 1024)}KB` : `${mb}MB`;
    return { ok: false, error: `File is too large. Max size is ${label}.` };
  }

  if (kind === 'color-image' && (isSvg || !ALLOWED_BITMAP_IMAGE_TYPES.has(type))) {
    return { ok: false, error: 'Please upload a PNG, JPG, or WebP image.' };
  }

  if (kind === 'mask-image') {
    const allowedByType = ALLOWED_MASK_IMAGE_TYPES.has(type);
    const allowedByExt = ['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext);
    if (!allowedByType && !allowedByExt) {
      return { ok: false, error: 'Please upload a PNG, JPG, WebP, or SVG mask file.' };
    }
  }

  return { ok: true };
}

export async function validateBitmapDimensions(file: File): Promise<UploadValidationResult> {
  if ((file.type || '').toLowerCase() === 'image/svg+xml' || getFileExtension(file.name) === 'svg') {
    return { ok: true };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Unable to read image dimensions.'));
      img.src = objectUrl;
    });

    const pixels = img.naturalWidth * img.naturalHeight;
    if (!img.naturalWidth || !img.naturalHeight || pixels > UPLOAD_LIMITS.maxBitmapPixels) {
      return {
        ok: false,
        error: 'Image dimensions are too large. Max bitmap size is 4096×4096.',
      };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to validate image.' };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function validateJsonImportText(text: string): UploadValidationResult {
  if (text.length > UPLOAD_LIMITS.jsonMaxBytes) {
    return { ok: false, error: 'JSON import payload is too large. Max size is 2MB.' };
  }
  try {
    JSON.parse(text);
    return { ok: true };
  } catch {
    return { ok: false, error: 'JSON import is malformed.' };
  }
}