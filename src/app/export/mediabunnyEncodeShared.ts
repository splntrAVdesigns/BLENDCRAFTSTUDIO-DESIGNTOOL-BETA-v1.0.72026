/**
 * mediabunnyEncodeShared.ts — pure config shared by both encode paths
 * ===================================================================
 *
 * `mediabunnyExport.ts` runs the encode on the main thread (the original,
 * proven path — kept as the automatic fallback). `mediabunnyEncodeWorker.ts`
 * runs the identical Mediabunny `Output`/`CanvasSource` construction inside a
 * dedicated Worker, immune to the main document's page-visibility-based
 * throttling. Both call `buildCanvasSourceConfig()` below so the two paths
 * cannot silently drift in codec, bitrate, or keyframe policy — a bug fixed
 * in one path is fixed in both, mechanically.
 */

import type { VideoCodec } from 'mediabunny';

export type MediabunnyContainer = 'mp4' | 'webm';

export function mediaCodecFor(container: MediabunnyContainer): VideoCodec {
  return container === 'mp4' ? 'avc' : 'vp9';
}

/**
 * Default maximum seconds between keyframes.
 *
 * Was previously left unset for MP4 (silently falling back to Mediabunny's
 * internal 2-second default) and hardcoded to 2 for WebM. Lowered to 1s for
 * both after measuring real P-frame drift on this app's actual export
 * content: Laplacian-variance sharpness on a real 1080p30 export dropped
 * from 955 at the keyframe to 451 by frame 59 (just before the next
 * keyframe, ~2s in) — a >50% falloff. Dense, continuously-warping,
 * high-frequency gradient/moiré content like BlendCraft's is close to a
 * worst case for block-based motion compensation: the motion isn't simple
 * translation, so P-frames accumulate visible prediction error the longer
 * they run since the last true keyframe. Halving the interval trades a
 * larger file for keeping every frame within ~1s of a full-quality refresh.
 */
export const DEFAULT_KEYFRAME_INTERVAL_SECONDS = 1;

export interface CanvasSourceConfigInput {
  container: MediabunnyContainer;
  bitrate: number;
  keyFrameIntervalSeconds?: number;
  /**
   * WebM/VP9 only. Defaults to 'realtime' (unchanged behavior for standard
   * tiers). Should be 'quality' for any tier that also forces a short/full
   * -intra keyFrameIntervalSeconds — 'realtime' mode's simpler, faster rate
   * control fighting a forced all-keyframe pattern at very high bitrate is
   * the likely cause of a real, reproduced failure: WebM + Sharp Max got
   * stuck rendering 8/150 frames for 2+ minutes, never recovered even after
   * a window-switch (ruling out the page-visibility stall this project has
   * otherwise been chasing — this is genuinely slow/stuck encoder work, not
   * a throttling symptom). 'quality' mode is the WebCodecs default and is
   * what "Sharp Max — master / slow" already promises by name.
   */
  latencyMode?: 'quality' | 'realtime';
  onEncodedPacket: (packet: { timestamp: number; duration: number }) => void;
  onEncoderConfig: (config: {
    codec?: string;
    hardwareAcceleration?: string;
    width?: number;
    height?: number;
    latencyMode?: 'quality' | 'realtime';
  }) => void;
}

/**
 * Builds the exact second argument passed to `new CanvasSource(canvas, ...)`.
 *
 * BUG FIXED HERE: the MP4 branch previously omitted `keyFrameInterval`
 * entirely — even when a caller explicitly passed
 * `options.keyFrameIntervalSeconds`, MP4 exports silently ignored it and
 * always used Mediabunny's internal 2s default. WebM already read the
 * option correctly. Both containers now go through this one function, so
 * that class of divergence can't happen again.
 */
export function buildCanvasSourceConfig(input: CanvasSourceConfigInput) {
  const keyFrameInterval = input.keyFrameIntervalSeconds ?? DEFAULT_KEYFRAME_INTERVAL_SECONDS;
  if (input.container === 'mp4') {
    // MP4 mirrors Visual Mood Labs' known-good construction: codec, bitrate,
    // and keyframe interval are the only encoder-policy inputs. No
    // hardwareAcceleration or latencyMode preference is supplied, so the
    // browser selects its stable quality implementation.
    return {
      codec: 'avc' as const,
      bitrate: input.bitrate,
      keyFrameInterval,
      onEncodedPacket: input.onEncodedPacket,
      onEncoderConfig: (config: Parameters<CanvasSourceConfigInput['onEncoderConfig']>[0]) =>
        input.onEncoderConfig(config),
    };
  }
  return {
    codec: 'vp9' as const,
    bitrate: input.bitrate,
    keyFrameInterval,
    latencyMode: input.latencyMode ?? 'realtime',
    onEncodedPacket: input.onEncodedPacket,
    onEncoderConfig: (config: Parameters<CanvasSourceConfigInput['onEncoderConfig']>[0]) =>
      input.onEncoderConfig(config),
  };
}
