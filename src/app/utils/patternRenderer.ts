/**
 * Pattern Renderer — Shape Pattern texture generator
 *
 * Architecture: 1×1 single shape per tile (industry standard)
 * ────────────────────────────────────────────────────────────
 * Each canvas contains exactly ONE centered shape.
 * The shader handles all repetition via fract(uv * scale).
 *
 * Why 1×1 eliminates seams structurally:
 *   With 4×4, at scale=1.9 the tile boundary falls at a non-integer
 *   position relative to the shape grid, creating an asymmetric gap
 *   that is visible as a thin line at any non-integer scale value.
 *   With 1×1, the tile boundary ALWAYS falls exactly halfway between
 *   two adjacent shapes at every scale value. Seam is impossible.
 *
 * Canvas: 1024×1024 POT (required for WebGL 1.0 mipmaps + RepeatWrapping).
 * AR correction: shader divides Y UV by uPatternAR so tiles are square
 *   on the gradient canvas (e.g. circles stay circular on 16:9).
 *
 * Seam elimination — RepeatWrapping (set in texturePatternCache.ts):
 *   With ClampToEdgeWrapping the bilinear filter at the tile wrap boundary
 *   doubles the edge pixel (clamps it against itself), producing a 1px
 *   artifact at fractional scale values where the wrap falls mid-texel.
 *   With RepeatWrapping the filter correctly blends the last texel of tile N
 *   with the first texel of tile N+1 — for a centered symmetric shape these
 *   are the same black background value on both sides → clean blend → no seam.
 *   No EDGE_GUARD inset is needed or wanted: an inset creates a hard geometric
 *   black strip between every pair of adjacent tiles at ALL scale values,
 *   which is far more visible than the sub-pixel fractional-scale artifact
 *   it was intended to fix.
 */

import { getShapeById } from '../lib/maskShapes';
import { rasterizeSVG } from './svgRasterizer';

const POT_SIZE_SIMPLE  = 512;  // Simple path-only shapes — 512px is crisp, uses 1/4 the GPU mem
const POT_SIZE_COMPLEX = 1024; // Complex SVG shapes (multi-path, detailed) — keep full 1024px

/** Pick rasterization resolution based on shape path complexity. */
function getPatternPotSize(svgPath: string): number {
  // A full SVG document suggests a complex multi-path shape.
  // A plain path-data string (M, L, C, A commands only) is a simple shape.
  const isSimplePath = !svgPath.includes('<svg') && !svgPath.includes('<?xml');
  return isSimplePath ? POT_SIZE_SIMPLE : POT_SIZE_COMPLEX;
}

export interface PatternConfig {
  shapeId: string;
  spacing: number;       // 0–100: 0=shape fills tile, 100=shape is tiny dot
  offsetX?: number;      // shader-side only — NOT used in canvas rendering.
  offsetY?: number;      // shader-side only — NOT used in canvas rendering.
                         // Applied via uPatternOffset uniform in gradient shader.
  rotation: number;      // 0–360 degrees — baked into canvas
  fillMode: 'fill' | 'wireframe';
  outlineThickness?: number; // 1–20 px, only used for wireframe mode
  canvasWidth?: number;  // unused — canvas is always 1024×1024
  canvasHeight?: number;
}

export async function generatePattern(
  config: PatternConfig
): Promise<{ canvas: HTMLCanvasElement; dataUrl: string; patternAR: number }> {
  const { shapeId, spacing, rotation, fillMode } = config;
  // offsetX / offsetY intentionally destructured-out — they are shader uniforms,
  // not canvas properties. Any value passed here is silently ignored.

  const shape = getShapeById(shapeId);
  if (!shape) throw new Error(`Shape not found: ${shapeId}`);

  // ── Adaptive POT canvas: 512 for simple paths, 1024 for complex SVGs ────────
  const POT_SIZE = getPatternPotSize(shape.svgPath);
  const canvas = document.createElement('canvas');
  canvas.width  = POT_SIZE;
  canvas.height = POT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D context');

  // Black background: shader reads .r channel (0=gap, 1=shape).
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, POT_SIZE, POT_SIZE);

  // ── Single centered shape ─────────────────────────────────────────────────
  //   spacing=0   → shape fills the full tile (no gap between adjacent tiles)
  //   spacing=20  → shape uses 60% of tile, 20% margin each side
  //   spacing=100 → shape collapses — clamped to MIN_SHAPE_PX so it stays visible
  //
  // Without the clamp: at spacing≥50%, POT_SIZE*(1-margin*2) goes zero or negative
  // and Math.max(1,...) collapses to 1px — invisible on any canvas size.
  // MIN_SHAPE_PX keeps a renderable shape visible across the full 0-100% range.
  const MIN_SHAPE_PX = 32;
  const margin    = spacing / 100;                                          // 0..1 margin on EACH side
  const shapeSide = Math.max(MIN_SHAPE_PX, POT_SIZE * (1 - margin * 2));  // diameter in canvas pixels
  const cx = POT_SIZE / 2;
  const cy = POT_SIZE / 2;

  const strokeWidth  = config.outlineThickness ?? shape.defaultStrokeWidth ?? 3;
  const useWireframe = fillMode === 'wireframe' || shape.renderMode === 'wireframe';
  const shapeDataUrl = useWireframe
    ? await rasterizeSVG(shape.svgPath, shape.viewBox, shapeSide, 'white', 'white', strokeWidth)
    : await rasterizeSVG(shape.svgPath, shape.viewBox, shapeSide, 'white');

  const shapeImg = await loadImage(shapeDataUrl);

  ctx.save();
  ctx.translate(cx, cy);
  if (rotation !== 0) ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(shapeImg, -shapeSide / 2, -shapeSide / 2, shapeSide, shapeSide);
  ctx.restore();

  // patternAR = 1.0 always (square canvas). Shader uses uPatternAR from
  // canvasSettings.width/height to correct Y UV for the gradient canvas AR.
  return { canvas, dataUrl: canvas.toDataURL('image/png'), patternAR: 1.0 };
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

export async function generatePatternThumbnail(
  config: PatternConfig,
  size = 256
): Promise<string> {
  const result = await generatePattern(config);
  return result.dataUrl;
}