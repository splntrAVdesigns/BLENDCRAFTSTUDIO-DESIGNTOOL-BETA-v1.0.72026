export const WEBM_MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
] as const;

export interface MediaRecorderCapabilityResult {
  readonly supported: boolean;
  readonly mimeType: string | null;
  readonly reason?: string;
}

export function detectMediaRecorderCapability(
  recorderCtor: typeof MediaRecorder | undefined = typeof MediaRecorder === 'undefined' ? undefined : MediaRecorder,
): MediaRecorderCapabilityResult {
  if (!recorderCtor) {
    return { supported: false, mimeType: null, reason: 'MediaRecorder is unavailable.' };
  }
  const mimeType = WEBM_MIME_CANDIDATES.find((candidate) => recorderCtor.isTypeSupported(candidate)) ?? null;
  return mimeType
    ? { supported: true, mimeType }
    : { supported: false, mimeType: null, reason: 'No supported WebM MediaRecorder MIME type was found.' };
}
