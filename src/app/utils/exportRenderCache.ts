/**
 * Phase 3 — Export Renderer Optimization
 *
 * Small session cache used by GradientCanvas while deterministic exports are active.
 * The cache deliberately stores references to already-created GPU resources and
 * uniform slots; it never clones Three.js materials, textures, geometries or matrices.
 */

export interface ExportCacheEntry<TMesh = unknown, TLayer = unknown, TUniforms = unknown> {
  layerId: string;
  mesh: TMesh;
  layer: TLayer;
  uniforms: TUniforms;
  maskTextureWidth: number;
  maskTextureHeight: number;
}

export interface ExportRenderCache<TEntry = ExportCacheEntry> {
  entries: TEntry[];
  visibleGradientColors: unknown;
  width: number;
  height: number;
  aspect: number;
  shaderWarmupComplete: boolean;
  staticUniformsApplied: boolean;
  buildCount: number;
}

export function createExportRenderCache<TEntry>(options: {
  entries: TEntry[];
  visibleGradientColors?: unknown;
  width: number;
  height: number;
}): ExportRenderCache<TEntry> {
  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height));
  return {
    entries: options.entries,
    visibleGradientColors: options.visibleGradientColors ?? null,
    width,
    height,
    aspect: width / height,
    shaderWarmupComplete: false,
    staticUniformsApplied: false,
    buildCount: 1,
  };
}

export function resizeExportRenderCache<TEntry>(
  cache: ExportRenderCache<TEntry>,
  width: number,
  height: number,
): boolean {
  const nextWidth = Math.max(1, Math.round(width));
  const nextHeight = Math.max(1, Math.round(height));
  if (cache.width === nextWidth && cache.height === nextHeight) return false;
  cache.width = nextWidth;
  cache.height = nextHeight;
  cache.aspect = nextWidth / nextHeight;
  cache.staticUniformsApplied = false;
  return true;
}

export function invalidateExportRenderCache<TEntry>(cache: ExportRenderCache<TEntry> | null): void {
  if (!cache) return;
  cache.entries.length = 0;
  cache.visibleGradientColors = null;
  cache.shaderWarmupComplete = false;
  cache.staticUniformsApplied = false;
}
