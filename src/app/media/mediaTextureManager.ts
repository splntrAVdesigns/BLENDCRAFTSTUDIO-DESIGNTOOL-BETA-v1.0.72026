/**
 * media/mediaTextureManager.ts — Stage 1
 *
 * Decodes uploaded media sources into THREE.Texture objects for the media
 * layer shader. Mirrors the lifecycle discipline of maskTextureManager:
 * caller owns disposal, textures tag their source in userData for cache
 * comparison, filtering configured for non-tiled full-frame sampling.
 *
 * COLOR SPACE NOTE
 * ─────────────────────────────────────────────────────────────────────────
 * The app's render pipeline is color-unmanaged by design (gradient hex
 * colors pass through as raw 0–1 values; mask textures likewise). Media
 * textures therefore use THREE's default (no) color space so uploaded
 * pixels reach the shader untransformed and match the source file exactly.
 * Introducing SRGBColorSpace here without managing the whole chain would
 * make uploads render darker/lighter than every other layer type.
 *
 * DECODE CEILING
 * ─────────────────────────────────────────────────────────────────────────
 * Sources larger than MEDIA_TEXTURE_MAX_DIM on their long edge are downscaled
 * at decode time. Beyond ~2048–4096px there is zero visible gain inside the
 * effects chain, and full-size 4K+ textures cost 4× GPU bandwidth per sample.
 */

import * as THREE from '../lib/three';
import type { MediaSourceKind } from './types';

export const MEDIA_TEXTURE_MAX_DIM = 4096;

export interface DecodedMediaTexture {
  texture: THREE.Texture;
  width: number;
  height: number;
}

function configureMediaTexture(texture: THREE.Texture, srcKey: string, kind: MediaSourceKind): void {
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  // Mipmaps off — matches texturePatternCache seam-suppression convention and
  // avoids POT resampling for arbitrary upload dimensions.
  texture.generateMipmaps = false;
  (texture.userData as Record<string, unknown>).mediaSrc = srcKey;
  (texture.userData as Record<string, unknown>).mediaKind = kind;
  texture.needsUpdate = true;
}

function drawToCanvas(
  source: HTMLImageElement | HTMLVideoElement,
  srcW: number,
  srcH: number
): HTMLCanvasElement {
  const longEdge = Math.max(srcW, srcH);
  const scale = longEdge > MEDIA_TEXTURE_MAX_DIM ? MEDIA_TEXTURE_MAX_DIM / longEdge : 1;
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not acquire 2D context for media decode.');
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image could not be decoded.'));
    img.src = src;
  });
}

/**
 * Decode a bitmap image (PNG/JPEG/WebP) source URL into a texture.
 */
export async function createImageMediaTexture(src: string): Promise<DecodedMediaTexture> {
  const img = await loadImageElement(src);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) throw new Error('Image decoded with zero dimensions.');

  // Downscale through canvas only when needed; otherwise upload the image directly.
  if (Math.max(srcW, srcH) > MEDIA_TEXTURE_MAX_DIM) {
    const canvas = drawToCanvas(img, srcW, srcH);
    const texture = new THREE.CanvasTexture(canvas);
    configureMediaTexture(texture, src, 'image');
    return { texture, width: canvas.width, height: canvas.height };
  }
  const texture = new THREE.Texture(img);
  configureMediaTexture(texture, src, 'image');
  return { texture, width: srcW, height: srcH };
}

/**
 * Decode an SVG source URL into a rasterized texture.
 * Browsers rasterize SVG safely inside <img> (scripts never execute there).
 * SVGs without intrinsic size rasterize at a 2048px reference frame.
 */
export async function createSvgMediaTexture(src: string): Promise<DecodedMediaTexture> {
  const img = await loadImageElement(src);
  let srcW = img.naturalWidth || img.width;
  let srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) {
    // Dimensionless SVG (no width/height/viewBox) — rasterize square.
    srcW = 2048;
    srcH = 2048;
  }
  // Always rasterize through canvas for crisp, fixed-density sampling.
  const canvas = drawToCanvas(img, srcW, srcH);
  const texture = new THREE.CanvasTexture(canvas);
  configureMediaTexture(texture, src, 'svg');
  return { texture, width: canvas.width, height: canvas.height };
}

/**
 * Stage 1 video handling: capture the first decodable frame of an already
 * probed <video> element as a static poster texture. Deterministic for
 * export by construction. Stage 2 replaces this with a live VideoTexture
 * gated on requestVideoFrameCallback.
 */
export function createVideoPosterTexture(
  video: HTMLVideoElement,
  srcKey: string
): DecodedMediaTexture {
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  if (!srcW || !srcH) throw new Error('Video has no decodable dimensions.');
  const canvas = drawToCanvas(video, srcW, srcH);
  const texture = new THREE.CanvasTexture(canvas);
  configureMediaTexture(texture, srcKey, 'video');
  return { texture, width: canvas.width, height: canvas.height };
}

/**
 * Capture a poster frame as a data URL for panel thumbnails / layer src.
 * Kept small (max 1024) — this is UI/runtime state, not the render texture.
 */
/**
 * STAGE 2.8.0 — regenerate a poster thumbnail from a persisted video Blob.
 *
 * WHY: `previewUrl` is captured once at upload time and deliberately stripped
 * on save (it's a runtime data URL). After a reload the blob rehydrates and
 * the VIDEO renders again, but the panel + layer-list thumbnails stayed blank
 * because nothing ever re-captured a poster from the restored bytes. This
 * closes that gap: mint a URL from the blob in THIS document's context, decode
 * the first frames in a detached <video>, capture, and clean everything up.
 *
 * Fails soft to null (thumbnail simply stays absent) — a poster is cosmetic
 * and must never block or break rehydration. Hard 5s timeout so a corrupt
 * blob can't leak a decoding element.
 */
export function capturePosterFromBlob(blob: Blob, maxDim = 256): Promise<string | null> {
  return new Promise((resolve) => {
    let url: string | null = null;
    let video: HTMLVideoElement | null = null;
    let settled = false;

    const cleanup = () => {
      if (video) {
        video.removeAttribute('src');
        try { video.load(); } catch { /* detached element — best effort */ }
        video = null;
      }
      if (url) { URL.revokeObjectURL(url); url = null; }
    };
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      resolve(result);
    };
    const timeout = window.setTimeout(() => finish(null), 5000);

    try {
      url = URL.createObjectURL(blob);
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.onerror = () => finish(null);
      video.onloadeddata = () => {
        if (!video) return finish(null);
        // Seek slightly in — frame 0 of many encodes is black/blank.
        const d = Number.isFinite(video.duration) ? video.duration : 0;
        const t = d > 0.5 ? Math.min(0.1, d * 0.05) : 0;
        const capture = () => {
          try {
            finish(video ? captureVideoPosterDataUrl(video, maxDim) : null);
          } catch {
            finish(null);
          }
        };
        if (t > 0 && Math.abs(video.currentTime - t) > 0.001) {
          video.onseeked = capture;
          video.currentTime = t;
        } else {
          capture();
        }
      };
      video.src = url;
    } catch {
      finish(null);
    }
  });
}

export function captureVideoPosterDataUrl(video: HTMLVideoElement, maxDim = 1024): string {
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  const longEdge = Math.max(srcW, srcH);
  const scale = longEdge > maxDim ? maxDim / longEdge : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(srcW * scale));
  canvas.height = Math.max(1, Math.round(srcH * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not acquire 2D context for poster capture.');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/**
 * Decode any media src (by kind) into a texture. Poster-frame video sources
 * arrive here as data URLs, so 'video' routes through the image decoder.
 */
export async function createMediaTexture(
  src: string,
  kind: MediaSourceKind
): Promise<DecodedMediaTexture> {
  switch (kind) {
    case 'svg':
      return createSvgMediaTexture(src);
    case 'video': // Stage 1: src is a poster-frame data URL
    case 'image':
    default:
      return createImageMediaTexture(src);
  }
}

/** Dispose a media texture map — used on unmount / canvas resize. */
export function disposeMediaTextureMap(map: Map<string, THREE.Texture>): void {
  map.forEach((texture) => texture.dispose());
  map.clear();
}