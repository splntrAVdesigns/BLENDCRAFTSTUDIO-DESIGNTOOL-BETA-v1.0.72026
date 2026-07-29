import type { VideoLabCapability, VideoLabCodec } from './types';

const CODECS: Array<{ codec: VideoLabCodec; container: 'mp4' | 'webm' }> = [
  { codec: 'avc1.42001f', container: 'mp4' },
  { codec: 'vp09.00.10.08', container: 'webm' },
  { codec: 'vp8', container: 'webm' },
];

export async function probeVideoLabCapabilities(width = 1920, height = 1080, fps = 30): Promise<VideoLabCapability[]> {
  const Encoder = globalThis.VideoEncoder;
  if (!Encoder?.isConfigSupported) {
    return CODECS.map(({ codec, container }) => ({ codec, container, supported: false, reason: 'WebCodecs VideoEncoder is unavailable.' }));
  }

  return Promise.all(CODECS.map(async ({ codec, container }) => {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      framerate: fps,
      bitrate: Math.max(8_000_000, Math.round(width * height * fps * 0.18)),
      latencyMode: 'realtime',
    };
    try {
      const result = await Encoder.isConfigSupported(config);
      return { codec, container, supported: result.supported, config: result.config ?? config };
    } catch (error) {
      return { codec, container, supported: false, config, reason: error instanceof Error ? error.message : String(error) };
    }
  }));
}
