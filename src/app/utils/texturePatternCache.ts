/**
 * Pattern Texture Cache
 *
 * Architecture: Option A — 1024×1024 POT canvas, RepeatWrapping, mipmaps enabled.
 *
 * Cache key includes only properties that affect the CANVAS pixel content:
 *   shapeId, spacing, rotation, fillMode, outlineThickness
 *
 * Intentionally EXCLUDED from cache key:
 *   canvasWidth / canvasHeight — pattern canvas is always 1024×1024 POT regardless
 *     of gradient canvas dimensions. No reason to re-bake on resize.
 *   offsetX / offsetY — these are SHADER uniforms (uPatternOffset), not canvas
 *     properties. The canvas pixel content is identical regardless of offset value.
 *     Including them previously caused a new cache entry for every slider tick
 *     while generating byte-for-byte identical canvases — O(n) cache misses for
 *     zero visual benefit on the canvas side.
 *   scale — also a shader uniform (uPatternScale). Never affects canvas content.
 */

import type { TextureConfig } from '../types/gradient';
import { generatePattern } from './patternRenderer';
import type { PatternConfig } from './patternRenderer';

// Maximum number of cached entries before evicting the oldest.
const MAX_CACHE_SIZE = 30;

function buildPatternConfig(texture: TextureConfig): PatternConfig {
  return {
    shapeId:  texture.shapePatternId ?? 'circle',
    spacing:  texture.patternSpacing  ?? 0,
    rotation: texture.patternRotation ?? 0,
    fillMode: (texture.patternFillMode ?? 'fill') as 'fill' | 'wireframe',
    outlineThickness: texture.patternOutlineThickness ?? 3,
    // offsetX / offsetY intentionally omitted — they are shader uniforms applied
    // via uPatternOffset and do not affect the baked canvas pixel content.
    // scale is also shader-side (uPatternScale) — not a canvas property.
  };
}

function generateCacheKey(config: PatternConfig): string {
  // Only include properties that affect canvas pixels.
  // offsetX, offsetY, scale are shader uniforms — excluded by design.
  return [
    config.shapeId,
    config.spacing,
    config.rotation,
    config.fillMode,
    config.outlineThickness ?? 3,
  ].join('_');
}

interface PatternCacheEntry { canvas: HTMLCanvasElement; dataUrl: string; }
const patternCache = new Map<string, PatternCacheEntry>();

function evictIfNeeded(): void {
  if (patternCache.size >= MAX_CACHE_SIZE) {
    const oldest = patternCache.keys().next().value;
    if (oldest) patternCache.delete(oldest);
  }
}

export async function getPatternCanvas(
  texture: TextureConfig,
): Promise<HTMLCanvasElement | null> {
  if (texture.type !== 'shape-pattern') return null;

  // Use 'circle' as default when no shape selected — renders on first enable
  // before user has picked a shape, avoiding a blank first render.
  const effectiveTexture = texture.shapePatternId
    ? texture
    : { ...texture, shapePatternId: 'circle' };

  const config   = buildPatternConfig(effectiveTexture);
  const cacheKey = generateCacheKey(config);

  const cached = patternCache.get(cacheKey);
  if (cached) return cached.canvas;

  try {
    const result = await generatePattern(config);
    evictIfNeeded();
    patternCache.set(cacheKey, result);
    return result.canvas;
  } catch (error) {
    console.error('[PatternCache] generatePattern failed:', error);
    return null;
  }
}

export async function createPatternThreeTexture(canvas: HTMLCanvasElement): Promise<any> {
  const { THREE, LinearFilter } = await import('../lib/three');
  const texture = new THREE.CanvasTexture(canvas);

  // RepeatWrapping: correct mode for a tiling texture sampled via fract() in the shader.
  //
  // Why NOT ClampToEdge:
  //   The bilinear filter kernel extends ±0.5 texels beyond the sample point.
  //   When the sample falls near UV=0 or UV=1 (the fract() wrap boundary),
  //   the filter reads slightly outside [0,1]. With ClampToEdge the out-of-bounds
  //   sample is the edge pixel doubled — an incorrect weight that produces a 1px
  //   bright seam line at fractional scale values (where the wrap falls mid-texel).
  //
  // Why RepeatWrapping works:
  //   The filter correctly reads from the opposite edge of the texture for the
  //   out-of-bounds sample. For a centered symmetric shape on a uniform background,
  //   the left/right edges and top/bottom edges carry the same background value,
  //   so the blend is smooth and seamless at every scale — integer or fractional.
  //
  // WebGL 1.0 compatibility: RepeatWrapping + mipmaps are both valid on POT
  //   textures (1024×1024 is POT). Non-POT textures require ClampToEdge — not us.
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;

  // Mipmaps DISABLED: LinearMipmapLinear was the source of seam lines at stagger
  // and scale-variance UV discontinuities. At those tile boundaries, dFdx/dFdy
  // spikes caused the GPU to select a coarser mip level, rendering a dark stripe.
  // Since the shader controls scale and density via uniforms (no extreme minification),
  // the base-level LinearFilter gives identical visual quality without seam artifacts.
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function clearPatternCache(): void {
  patternCache.clear();
}