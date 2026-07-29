/**
 * SVG Rasterizer Utility
 * Converts SVG paths to rasterized PNG textures for mask system
 */

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Rasterize SVG path to PNG data URL
 * @param svgPath - SVG path data string
 * @param viewBox - SVG viewBox dimensions
 * @param targetSize - Output texture resolution (default: 2048 for simple, 4096 for detailed)
 * @param fillColor - Fill color (default: white for masks)
 * @param strokeColor - Stroke color (optional)
 * @param strokeWidth - Stroke width (optional)
 * @returns Promise<string> - PNG data URL
 */
export async function rasterizeSVG(
  svgPath: string,
  viewBox: ViewBox,
  targetSize: number = 2048,
  fillColor: string = 'white',
  strokeColor?: string,
  strokeWidth: number = 0
): Promise<string> {
  // Validate inputs
  if (!svgPath || svgPath.trim().length === 0) {
    throw new Error('SVG path is empty');
  }

  if (!viewBox || viewBox.w <= 0 || viewBox.h <= 0) {
    throw new Error('Invalid viewBox dimensions');
  }

  const trimmedSvgPath = svgPath.trim();

  // Shape-pack support: some curated glyph packs provide complete SVG documents
  // instead of a single path `d` string. Render those documents directly so their
  // authored geometry stays exact. Existing built-in path-data presets continue
  // through the original path wrapper below.
  if (trimmedSvgPath.includes('<svg')) {
    const svgStart = trimmedSvgPath.indexOf('<svg');
    const svgEnd = trimmedSvgPath.lastIndexOf('</svg>');
    const svgContent = svgStart >= 0 && svgEnd >= 0
      ? trimmedSvgPath.slice(svgStart, svgEnd + 6)
      : trimmedSvgPath;

    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    try {
      const img = await loadImage(url);
      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Failed to get 2D context');
      }

      ctx.drawImage(img, 0, 0, targetSize, targetSize);
      return canvas.toDataURL('image/png');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Build stroke attributes
  const strokeAttrs = strokeColor
    ? `stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none"`
    : `fill="${fillColor}"`;

  // STROKE RENDERING: SVG strokes are centered on the path edge — half extends
  // outside the shape boundary. We expand the SVG viewBox by strokeWidth/2 on
  // all sides so there's coordinate room for the stroke overhang.
  // 
  // Unlike the previous "oversized canvas + crop" approach (which cut off shapes
  // with coordinates at x=0 because the crop started at (pad,pad)), this approach
  // keeps the canvas at exactly targetSize and just expands the coordinate space.
  // The shape occupies a slightly smaller fraction of the canvas (shape/paddedTotal)
  // but NEVER clips — even shapes whose paths start exactly at x=0 or y=0.
  const pad = strokeWidth > 0 ? Math.ceil(strokeWidth / 2) + 2 : 0; // +2 safety margin
  const paddedVB = {
    x: viewBox.x - pad,
    y: viewBox.y - pad,
    w: viewBox.w + pad * 2,
    h: viewBox.h + pad * 2,
  };
  const renderSize = targetSize; // canvas stays at targetSize — no oversized render

  // SVG uses padded viewBox so stroke overhang has room; canvas is targetSize×targetSize
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${paddedVB.x} ${paddedVB.y} ${paddedVB.w} ${paddedVB.h}" width="${renderSize}" height="${renderSize}"><path d="${svgPath.trim()}" ${strokeAttrs}/></svg>`;

  // Convert to blob
  const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    // Load SVG at oversized dimensions (includes stroke padding)
    const img = await loadImage(url);

    // Final canvas at target size
    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }

    // Render at targetSize — viewBox expansion handles stroke room (no crop needed)
    ctx.drawImage(img, 0, 0, targetSize, targetSize);

    // Convert to PNG data URL
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Load image from URL with timeout
 * @param url - Image URL
 * @param timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns Promise<HTMLImageElement>
 */
function loadImage(url: string, timeoutMs: number = 10000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    // Add timeout to prevent hanging
    const timeout = setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      reject(new Error('Image loading timeout'));
    }, timeoutMs);

    img.onload = () => {
      clearTimeout(timeout);
      resolve(img);
    };

    img.onerror = (event) => {
      clearTimeout(timeout);
      console.error('Image load error:', event);
      reject(new Error('Failed to load image: Invalid image data'));
    };

    img.src = url;
  });
}

/**
 * Generate thumbnail preview of shape
 * @param svgPath - SVG path data
 * @param viewBox - SVG viewBox dimensions
 * @param size - Thumbnail size (default: 128)
 * @returns Promise<string> - PNG data URL
 */
export async function generateThumbnail(
  svgPath: string,
  viewBox: ViewBox,
  size: number = 128
): Promise<string> {
  return rasterizeSVG(svgPath, viewBox, size, 'white');
}

/**
 * Rasterize shape with wire-frame (stroke only)
 * @param svgPath - SVG path data
 * @param viewBox - SVG viewBox dimensions
 * @param targetSize - Output resolution
 * @param strokeColor - Stroke color (default: white)
 * @param strokeWidth - Stroke width (default: 2)
 * @returns Promise<string> - PNG data URL
 */
export async function rasterizeWireframe(
  svgPath: string,
  viewBox: ViewBox,
  targetSize: number = 2048,
  strokeColor: string = 'white',
  strokeWidth: number = 2
): Promise<string> {
  return rasterizeSVG(svgPath, viewBox, targetSize, 'white', strokeColor, strokeWidth);
}

/**
 * Get recommended resolution based on shape complexity
 * @param complexity - 'simple' or 'detailed'
 * @returns number - Recommended pixel size
 */
export function getRecommendedResolution(complexity: 'simple' | 'detailed'): number {
  return complexity === 'detailed' ? 4096 : 2048;
}