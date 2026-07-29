/**
 * media/mediaValidation.ts — Stage 1
 *
 * Upload guardrails for the Media Layer System. Extends the beta validation
 * philosophy in utils/uploadValidation.ts (size caps, MIME allowlists,
 * decode-before-accept) with a video decode probe.
 *
 * WHY A DECODE PROBE FOR VIDEO
 * ─────────────────────────────────────────────────────────────────────────
 * `.mov` is a container, not a codec. An H.264 .mov decodes fine in every
 * Chromium build; a ProRes .mov does not — and extension/MIME checks cannot
 * tell them apart. The only reliable acceptance test is to hand the file to
 * an HTMLVideoElement and wait for metadata + a decodable first frame.
 */

import type { MediaSourceKind } from './types';

export const MEDIA_UPLOAD_LIMITS = {
  imageMaxBytes: 12 * 1024 * 1024,   // 12MB — generous for stills
  svgMaxBytes: 1 * 1024 * 1024,      // 1MB
  videoMaxBytes: 150 * 1024 * 1024,  // 150MB
  videoMaxDurationSec: 300,          // 5 min — beta guardrail
  maxBitmapPixels: 4096 * 4096,      // decode ceiling (matches app-wide limit)
  probeTimeoutMs: 8000,              // video metadata/decode probe timeout
} as const;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const SVG_TYPES = new Set(['image/svg+xml']);
const VIDEO_TYPES = new Set(['video/webm', 'video/mp4', 'video/quicktime']);

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const SVG_EXTS = new Set(['svg']);
const VIDEO_EXTS = new Set(['webm', 'mp4', 'mov']);

export interface MediaValidationResult {
  ok: boolean;
  kind?: MediaSourceKind;
  error?: string;
}

function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Classify + size-validate a file before any decode work happens. */
export function classifyMediaFile(file: File): MediaValidationResult {
  const ext = fileExtension(file.name);
  const type = (file.type || '').toLowerCase();

  const isVideo = VIDEO_TYPES.has(type) || (!type && VIDEO_EXTS.has(ext)) || VIDEO_EXTS.has(ext);
  const isSvg = SVG_TYPES.has(type) || SVG_EXTS.has(ext);
  const isImage = IMAGE_TYPES.has(type) || (!type && IMAGE_EXTS.has(ext)) || IMAGE_EXTS.has(ext);

  if (isVideo && !isSvg && !isImage) {
    if (file.size > MEDIA_UPLOAD_LIMITS.videoMaxBytes) {
      return { ok: false, error: `Video is too large. Max size is ${MEDIA_UPLOAD_LIMITS.videoMaxBytes / (1024 * 1024)}MB.` };
    }
    return { ok: true, kind: 'video' };
  }
  if (isSvg) {
    if (file.size > MEDIA_UPLOAD_LIMITS.svgMaxBytes) {
      return { ok: false, error: 'SVG is too large. Max size is 1MB.' };
    }
    return { ok: true, kind: 'svg' };
  }
  if (isImage) {
    if (file.size > MEDIA_UPLOAD_LIMITS.imageMaxBytes) {
      return { ok: false, error: `Image is too large. Max size is ${MEDIA_UPLOAD_LIMITS.imageMaxBytes / (1024 * 1024)}MB.` };
    }
    return { ok: true, kind: 'image' };
  }
  return { ok: false, error: 'Unsupported format. Use PNG, JPEG, WebP, SVG, WebM, MP4, or MOV.' };
}

export interface VideoProbeResult {
  ok: boolean;
  error?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  /** Video element left seeked at first frame — caller draws poster then cleans up. */
  video?: HTMLVideoElement;
  objectUrl?: string;
}

/**
 * Decode-probe a video file: confirms the browser can actually decode it
 * (codec inside the container), and reports natural dimensions + duration.
 * On success the returned <video> element is paused at a decodable frame so
 * the caller can capture a poster without re-seeking.
 *
 * Caller MUST call `releaseVideoProbe(result)` when done unless it keeps
 * ownership of the objectUrl.
 */
export function probeVideoFile(file: File): Promise<VideoProbeResult> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    let settled = false;
    const timeout = window.setTimeout(() => {
      finish({ ok: false, error: 'Video could not be decoded in time. The codec inside this file may be unsupported (e.g. ProRes MOV). Try H.264 MP4 or WebM.' });
    }, MEDIA_UPLOAD_LIMITS.probeTimeoutMs);

    const finish = (result: VideoProbeResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('error', onError);
      if (!result.ok) {
        // Failed probe — tear down immediately.
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(objectUrl);
        resolve(result);
      } else {
        resolve({ ...result, video, objectUrl });
      }
    };

    const onLoadedData = () => {
      // loadeddata → first frame is decodable. Validate constraints.
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) {
        finish({ ok: false, error: 'Video decoded but reported no dimensions.' });
        return;
      }
      if (w * h > MEDIA_UPLOAD_LIMITS.maxBitmapPixels) {
        finish({ ok: false, error: 'Video resolution is too large. Max is 16.7MP per frame.' });
        return;
      }
      if (Number.isFinite(video.duration) && video.duration > MEDIA_UPLOAD_LIMITS.videoMaxDurationSec) {
        finish({ ok: false, error: `Video is too long. Max duration is ${MEDIA_UPLOAD_LIMITS.videoMaxDurationSec / 60} minutes.` });
        return;
      }
      finish({
        ok: true,
        width: w,
        height: h,
        durationSec: Number.isFinite(video.duration) ? video.duration : undefined,
      });
    };

    const onError = () => {
      finish({ ok: false, error: 'This video could not be decoded. The codec inside the container may be unsupported (e.g. ProRes MOV). Try H.264 MP4 or WebM.' });
    };

    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('error', onError);
    video.src = objectUrl;
    video.load();
  });
}

/** Release resources held by a successful probe (video element + object URL). */
export function releaseVideoProbe(result: VideoProbeResult): void {
  if (result.video) {
    result.video.removeAttribute('src');
    result.video.load();
  }
  if (result.objectUrl) {
    URL.revokeObjectURL(result.objectUrl);
  }
}
