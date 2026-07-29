/**
 * media/index.ts — Media Layer System public surface (Stage 1)
 */

export * from './types';
export * from './mediaValidation';
export * from './mediaShader';
export {
  createMediaTexture,
  disposeMediaTextureMap,
  MEDIA_TEXTURE_MAX_DIM,
} from './mediaTextureManager';
export { MediaUploadPanel } from './components/MediaUploadPanel';
export { MediaVideoManager } from './mediaVideoManager';

import type { Layer } from '../types/gradient';

/**
 * Source-aware export quality floor.
 * Returns the largest native media resolution across visible layers so the
 * export panel can nudge the user toward a preset that preserves upload
 * quality (a 4K source shouldn't silently ship as 1080p).
 */
export function getMediaSourceMaxResolution(layers: Layer[]): { width: number; height: number } | null {
  let best: { width: number; height: number } | null = null;
  for (const layer of layers) {
    const m = layer.media;
    if (!layer.visible || !m?.enabled || !m.naturalWidth || !m.naturalHeight) continue;
    if (!best || m.naturalWidth * m.naturalHeight > best.width * best.height) {
      best = { width: m.naturalWidth, height: m.naturalHeight };
    }
  }
  return best;
}
