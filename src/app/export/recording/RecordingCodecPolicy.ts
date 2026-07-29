import type { RecordingCodecSelection } from './types';

export const RECORDING_CODEC_CANDIDATES: readonly RecordingCodecSelection[] = [
  { mimeType: 'video/webm;codecs=vp9', codecLabel: 'VP9' },
  { mimeType: 'video/webm;codecs=vp8', codecLabel: 'VP8' },
  { mimeType: 'video/webm', codecLabel: 'WebM' },
] as const;

export interface ConfiguredRecorder {
  readonly recorder: MediaRecorder;
  readonly codec: RecordingCodecSelection;
  readonly fallbackIndex: number;
}

export function getSupportedRecordingCodecs(recorderCtor?: typeof MediaRecorder): readonly RecordingCodecSelection[] {
  if (!recorderCtor) return [];
  const isTypeSupported = recorderCtor.isTypeSupported?.bind(recorderCtor);
  return RECORDING_CODEC_CANDIDATES.filter((candidate) => !isTypeSupported || isTypeSupported(candidate.mimeType));
}

export function selectRecordingCodec(recorderCtor?: typeof MediaRecorder): RecordingCodecSelection {
  const supported = getSupportedRecordingCodecs(recorderCtor);
  if (supported.length === 0) throw new Error('No supported WebM recording codec is available.');
  return supported[0];
}


export function createRecorderForCodec(
  recorderCtor: typeof MediaRecorder,
  stream: MediaStream,
  codec: RecordingCodecSelection,
  videoBitsPerSecond: number,
): MediaRecorder {
  return new recorderCtor(stream, {
    mimeType: codec.mimeType,
    videoBitsPerSecond,
  });
}

export function createConfiguredRecorder(
  recorderCtor: typeof MediaRecorder,
  stream: MediaStream,
  videoBitsPerSecond: number,
): ConfiguredRecorder {
  const candidates = getSupportedRecordingCodecs(recorderCtor);
  if (candidates.length === 0) throw new Error('No supported WebM recording codec is available.');

  const failures: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const codec = candidates[index];
    try {
      const recorder = new recorderCtor(stream, {
        mimeType: codec.mimeType,
        videoBitsPerSecond,
      });
      return { recorder, codec, fallbackIndex: index };
    } catch (error) {
      failures.push(`${codec.codecLabel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`MediaRecorder rejected every supported WebM codec (${failures.join('; ')}).`);
}
