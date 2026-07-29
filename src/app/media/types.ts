/**
 * media/types.ts — Stage 1 (Media Upload Foundation)
 *
 * Type contract for the Media Layer System: user-uploaded images / SVGs /
 * videos rendered as a layer source, parallel to gradient/texture/mask.
 *
 * DESIGN NOTES
 * ─────────────────────────────────────────────────────────────────────────
 * • `src` holds an Object URL (video/image) or data URL (small SVG raster).
 *   It is RUNTIME-ONLY — sanitizeLayer strips it before autosave/history
 *   persistence, mirroring the mask imageUrl/svgText sanitization pattern.
 *   Metadata (fileName, natural size, kind) survives so the UI can show a
 *   "re-upload to restore" state after reload.
 * • Tone controls are stored in UI-friendly integer units and converted to
 *   shader units (lift/gamma/gain) inside the uniform sweep:
 *     shadows    -50..50   → lift  -0.5..0.5
 *     midtones    20..300  → gamma  0.2..3.0   (100 = neutral 1.0)
 *     highlights   0..200  → gain   0.0..2.0   (100 = neutral 1.0)
 * • Stage 1 renders videos as a static poster frame (first decodable frame)
 *   so exports stay deterministic. Live playback + export seek protocol is
 *   Stage 2 scope. `posterOnly` records this so Stage 2 can migrate cleanly.
 */

import type { MediaLayerConfig } from '../types/gradient';

export type MediaSourceKind = MediaLayerConfig['sourceKind'];

export type MediaFitMode = MediaLayerConfig['fit'];

/**
 * Canonical media config — aliases the structural type on Layer so the two
 * can never diverge. See types/gradient.ts → MediaLayerConfig for field docs.
 */
export type MediaConfig = MediaLayerConfig;

export const MEDIA_TONE_DEFAULTS = {
  shadows: 0,
  midtones: 100,
  highlights: 100,
  invert: false,
} as const;

export const MEDIA_TRANSFORM_DEFAULTS = {
  mediaScale: 100,
  rotationDeg: 0,
  offsetX: 0,
  offsetY: 0,
  flipH: false,
  flipV: false,
  tileRepeat: 3,
} as const;

/** 2.7E — video playback defaults. Muted by default (Stage 3 unmutes for audio). */
export const MEDIA_VIDEO_DEFAULTS = {
  playbackRate: 1,
  loopMode: 'loop' as const,
  trimStart: 0,
  freeze: false,
  freezeTime: 0,
  muted: true,
  volume: 0.8,
};

export const MEDIA_LUT_DEFAULTS = {
  lutIntensity: 0,
  lutPreserveLuma: false,
} as const;

export function createDefaultMediaConfig(): MediaConfig {
  return {
    enabled: false,
    sourceKind: 'image',
    fit: 'cover',
    ...MEDIA_TONE_DEFAULTS,
    ...MEDIA_TRANSFORM_DEFAULTS,
    ...MEDIA_LUT_DEFAULTS,
    ...MEDIA_VIDEO_DEFAULTS,
  };
}

/** Convert UI tone units → shader uniform units. Single source of truth. */
export function toneToShaderUnits(media: Pick<MediaConfig, 'shadows' | 'midtones' | 'highlights'>) {
  return {
    lift: Math.max(-0.5, Math.min(0.5, (media.shadows ?? 0) / 100)),
    gamma: Math.max(0.2, Math.min(3.0, (media.midtones ?? 100) / 100)),
    gain: Math.max(0.0, Math.min(2.0, (media.highlights ?? 100) / 100)),
  };
}

/**
 * Encode all media properties consumed by the media uniform sweep.
 * MUST be included in GradientCanvas's layersDataKey mediaStr — any property
 * read by the uniform effect that is missing here becomes a silently-dropped
 * slider (established layersDataKey invariant).
 */
export function encodeMediaForLayersDataKey(media?: MediaConfig): string {
  if (!media) return 'none';
  return [
    media.enabled ? '1' : '0',
    media.sourceKind,
    // STAGE 2.7.9 (A): source identity must survive an autosave restore. On
    // restore `src` is stripped and only the Blob is rehydrated — keying on
    // src.length alone left the restored layer with the SAME key as the
    // "no source" state, so no downstream memo ever invalidated and the media
    // uniform sweep never ran. Blob byte-size is the stable identity here.
    media.blob instanceof Blob ? `b${media.blob.size}` : (media.src ? media.src.length : 0),
    media.fit,
    media.shadows ?? 0,
    media.midtones ?? 100,
    media.highlights ?? 100,
    media.invert ? '1' : '0',
    // Stage 2B transforms — read by the media uniform effect
    media.mediaScale ?? 100,
    media.rotationDeg ?? 0,
    media.offsetX ?? 0,
    media.offsetY ?? 0,
    // Stage 2C LUT — read by the media uniform effect
    media.lutIntensity ?? 0,
    media.lutPreserveLuma ? '1' : '0',
    // Stage 2.7 — flip + tile (uniform-swept; INVARIANT: every field the media
    // uniform effect reads MUST appear here or its slider silently stops working)
    media.flipH ? '1' : '0',
    media.flipV ? '1' : '0',
    media.tileRepeat ?? 3,
    // Stage 2.7E — video playback (read by MediaVideoManager sync effect)
    media.playbackRate ?? 1,
    media.loopMode ?? 'loop',
    media.trimStart ?? 0,
    media.trimEnd ?? -1,
    media.freeze ? '1' : '0',
    media.freezeTime ?? 0,
    media.muted === false ? '0' : '1',
    media.volume ?? 0.8,
  ].join('-');
}
