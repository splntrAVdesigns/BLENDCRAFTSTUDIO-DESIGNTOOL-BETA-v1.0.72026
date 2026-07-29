import * as THREE from '../../lib/three';
import { Layer } from '../../types/gradient';

function getSvgIntrinsicSize(svgText: string, fallback = { width: 1024, height: 1024 }) {
  const viewBoxMatch = svgText.match(/viewBox\s*=\s*["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/i);
  if (viewBoxMatch) {
    const width = Math.max(1, Number(viewBoxMatch[3]) || fallback.width);
    const height = Math.max(1, Number(viewBoxMatch[4]) || fallback.height);
    return { width, height };
  }

  const widthMatch = svgText.match(/width\s*=\s*["']\s*([-\d.]+)(px)?\s*["']/i);
  const heightMatch = svgText.match(/height\s*=\s*["']\s*([-\d.]+)(px)?\s*["']/i);
  const width = Math.max(1, Number(widthMatch?.[1]) || fallback.width);
  const height = Math.max(1, Number(heightMatch?.[1]) || fallback.height);
  return { width, height };
}

export async function createSvgMaskTexture(
  svgText: string,
  renderer: THREE.WebGLRenderer | null,
  viewBox?: { x: number; y: number; width: number; height: number },
  renderMode?: 'fill' | 'wireframe',
  strokeWidth?: number
): Promise<THREE.Texture> {
  if (!svgText || svgText.trim().length === 0) {
    throw new Error('SVG text is empty');
  }

  let processedSvg = svgText.trim();
  const isPathOnly = /^[MmLlHhVvCcSsQqTtAaZz\s\d.,\-]+$/.test(processedSvg);

  if (isPathOnly && viewBox) {
    const isWireframe = renderMode === 'wireframe';
    const effectiveStroke = strokeWidth !== undefined ? strokeWidth : (isWireframe ? 3 : 0);

    let pathAttrs: string;
    if (isWireframe) {
      pathAttrs = `fill="none" stroke="white" stroke-width="${effectiveStroke}"`;
    } else if (effectiveStroke > 0) {
      pathAttrs = `fill="white" stroke="white" stroke-width="${effectiveStroke}"`;
    } else {
      pathAttrs = `fill="white"`;
    }

    const strokeExpand = effectiveStroke > 0 ? Math.ceil(effectiveStroke / 2) + 1 : 0;
    const expandedVB = {
      x: viewBox.x - strokeExpand,
      y: viewBox.y - strokeExpand,
      width:  viewBox.width  + strokeExpand * 2,
      height: viewBox.height + strokeExpand * 2,
    };
    processedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${expandedVB.x} ${expandedVB.y} ${expandedVB.width} ${expandedVB.height}" overflow="visible"><path d="${processedSvg}" ${pathAttrs}/></svg>`;

    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      if (import.meta.env?.DEV) console.log(`[SVG Mask] Wrapped path-only data (mode: ${renderMode || 'fill'}, stroke: ${effectiveStroke})`);
    }
  } else if (!processedSvg.includes('<svg') && !processedSvg.includes('<?xml')) {
    throw new Error('Invalid SVG: Not a valid SVG document or path data');
  }

  if (processedSvg.includes('<svg') && !processedSvg.includes('xmlns')) {
    processedSvg = processedSvg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  if (processedSvg.includes('<svg') && !processedSvg.includes('overflow=')) {
    processedSvg = processedSvg.replace(/(<svg[^>]*)(>)/, '$1 overflow="visible"$2');
  }

  // For full SVG documents (HUD/complex shapes), inject a <style> to override
  // stroke widths so the Stroke Width slider takes effect.
  // Only applied when strokeWidth is explicitly provided and > 0, and renderMode
  // is not 'fill' — fill shapes don't need stroke width control.
  if (processedSvg.includes('<svg') && strokeWidth !== undefined && strokeWidth > 0 && renderMode !== 'fill') {
    const sw = strokeWidth.toFixed(1);
    const strokeOverride = `<style>path,circle,ellipse,rect,polyline,polygon,line{stroke-width:${sw}px;stroke-linecap:round;stroke-linejoin:round}</style>`;
    // Insert after the first closing > of the <svg> opening tag
    processedSvg = processedSvg.replace(/(<svg[^>]*>)/, `$1${strokeOverride}`);
  }

  const intrinsic = getSvgIntrinsicSize(processedSvg);
  const longest = Math.max(intrinsic.width, intrinsic.height);

  // Adaptive rasterization size based on SVG complexity.
  // Simple path-only shapes (circle, square, triangle) need at most 512px for crisp edges.
  // Moderate shapes need 1024px. Only complex multi-path SVGs justify 2048px.
  const isPathOnly = !processedSvg.includes('<svg');
  const svgByteLen = processedSvg.length;
  const adaptiveMax = isPathOnly
    ? 512                           // Simple path-data shapes — 512px is plenty
    : svgByteLen < 5000
      ? 1024                        // Small SVG documents
      : Math.min(2048, Math.max(1024, longest)); // Complex SVGs — scale to intrinsic, max 2048
  const baseLongSide = adaptiveMax;
  const scale = baseLongSide / longest;
  const contentWidth = Math.max(1, Math.round(intrinsic.width * scale));
  const contentHeight = Math.max(1, Math.round(intrinsic.height * scale));
  const strokePadding = strokeWidth ? Math.ceil(strokeWidth * scale * 6) : 0;
  const basePad = Math.max(48, Math.round(Math.max(contentWidth, contentHeight) * 0.15));
  const pad = Math.max(basePad, strokePadding);
  const rasterWidth = contentWidth + pad * 2;
  const rasterHeight = contentHeight + pad * 2;
  const blob = new Blob([processedSvg], { type: 'image/svg+xml;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      const timeout = setTimeout(() => {
        image.onload = null;
        image.onerror = null;
        reject(new Error('SVG loading timeout (10s)'));
      }, 10000);

      image.onload = () => {
        clearTimeout(timeout);
        resolve(image);
      };

      image.onerror = (event) => {
        clearTimeout(timeout);
        if (import.meta.env?.DEV) console.error('SVG load error event:', event);
        reject(new Error('Failed to load SVG: Invalid SVG data or browser restriction'));
      };

      image.src = blobUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = rasterWidth;
    canvas.height = rasterHeight;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      throw new Error('Failed to create SVG mask canvas context');
    }

    ctx.clearRect(0, 0, rasterWidth, rasterHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, pad, pad, contentWidth, contentHeight);

    // Bounding-box crop: detect the tight non-transparent pixel bounds and
    // re-upload only that region (plus a 1px guard) as the texture.
    // Without this, the 15% padding on every side tiles as empty space in
    // repeat mode, making the shape appear tiny. Also reduces GPU texture size.
    let finalCanvas = canvas;
    try {
      const pixels = ctx.getImageData(0, 0, rasterWidth, rasterHeight);
      const data = pixels.data;
      let minX = rasterWidth, minY = rasterHeight, maxX = 0, maxY = 0;
      for (let y = 0; y < rasterHeight; y++) {
        for (let x = 0; x < rasterWidth; x++) {
          const a = data[(y * rasterWidth + x) * 4 + 3];
          if (a > 4) { // alpha > 1.5% = visible pixel
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      const guard = 2;
      minX = Math.max(0, minX - guard);
      minY = Math.max(0, minY - guard);
      maxX = Math.min(rasterWidth  - 1, maxX + guard);
      maxY = Math.min(rasterHeight - 1, maxY + guard);
      const cropW = maxX - minX + 1;
      const cropH = maxY - minY + 1;
      // Only crop if it actually reduces the canvas (>10% savings)
      if (cropW * cropH < rasterWidth * rasterHeight * 0.9 && cropW > 4 && cropH > 4) {
        const cropped = document.createElement('canvas');
        cropped.width  = cropW;
        cropped.height = cropH;
        const cCtx = cropped.getContext('2d')!;
        cCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
        finalCanvas = cropped;
      }
    } catch {
      // getImageData may fail in some sandboxed contexts — fall back to full canvas
    }

    const texture = new THREE.CanvasTexture(finalCanvas);
    // Mask coverage is sampled from alpha. sRGB is used intentionally because
    // Three r183's WebGL1 upload path can fault on NoColorSpace CanvasTextures
    // in the Figma Chromium iframe; alpha remains unchanged.
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = renderer?.capabilities.getMaxAnisotropy() || 1;
    texture.needsUpdate = true;
    (texture.userData as any).sourceType = 'svg';
    return texture;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export async function createBitmapMaskTexture(
  imageUrl: string,
  renderer: THREE.WebGLRenderer | null
): Promise<THREE.Texture> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load bitmap mask image'));
    image.src = imageUrl;
  });

  const srcW = Math.max(1, img.naturalWidth || img.width || 1024);
  const srcH = Math.max(1, img.naturalHeight || img.height || 1024);
  const longest = Math.max(srcW, srcH);
  const scale = longest > 4096 ? 4096 / longest : 1.0;
  const rasterWidth  = Math.max(1, Math.round(srcW * scale));
  const rasterHeight = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = rasterWidth;
  canvas.height = rasterHeight;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('Failed to create bitmap mask canvas context');

  ctx.clearRect(0, 0, rasterWidth, rasterHeight);
  ctx.imageSmoothingEnabled = scale < 1.0;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, rasterWidth, rasterHeight);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = renderer?.capabilities.getMaxAnisotropy() || 1;
  texture.needsUpdate = true;
  (texture.userData as any).sourceType = 'image';
  return texture;
}

type SyncMaskTexturesOptions = {
  layers: Layer[];
  renderer: THREE.WebGLRenderer | null;
  maskTextures: Map<string, THREE.Texture>;
  isCancelled: () => boolean;
  onTextureVersionChange: () => void;
  onNeedsRender: () => void;
};

export function syncMaskTexturesForLayers({
  layers,
  renderer,
  maskTextures,
  isCancelled,
  onTextureVersionChange,
  onNeedsRender,
}: SyncMaskTexturesOptions) {
  const applyLoadedTexture = (layerId: string, cacheKey: string, texture: THREE.Texture) => {
    if (isCancelled()) {
      texture.dispose();
      return;
    }

    (texture.userData as any).url = cacheKey;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = renderer?.capabilities.getMaxAnisotropy() || 1;

    const existing = maskTextures.get(layerId);
    if (existing) existing.dispose();
    maskTextures.set(layerId, texture);
    onTextureVersionChange();
    onNeedsRender();
  };

  const loadBitmapMaskTexture = (layerId: string, imageUrl: string, cacheKey: string) => {
    createBitmapMaskTexture(imageUrl, renderer)
      .then((texture) => {
        applyLoadedTexture(layerId, cacheKey, texture);
      })
      .catch((error) => {
        if (import.meta.env?.DEV) console.error(`Failed to load mask texture for layer ${layerId}:`, error);
      });
  };

  layers.forEach(layer => {
    const mask = layer.mask;
    if (mask?.type === 'image' && mask.imageUrl) {
      const hasSvgText = !!mask.svgText && mask.svgText.trim().length > 0;
      const isFullSvg = hasSvgText && (mask.svgText!.includes('<svg') || mask.svgText!.includes('<?xml'));
      const isPathOnly = hasSvgText && /^[MmLlHhVvCcSsQqTtAaZz\s\d.,\-]+$/.test(mask.svgText!.trim());
      const isSvgValid = hasSvgText && (isFullSvg || (isPathOnly && !!mask.svgViewBox));
      const isSvgSource = mask.sourceType === 'svg' && hasSvgText && isSvgValid;

      if (mask.sourceType === 'svg' && hasSvgText && !isSvgValid) {
        if (import.meta.env?.DEV) console.warn(`[SVG Mask] Layer ${layer.id} invalid SVG data.`, {
          hasSvgText,
          isFullSvg,
          isPathOnly,
          hasViewBox: !!mask.svgViewBox,
          svgTextLength: mask.svgText?.length ?? 0,
          svgPreview: mask.svgText?.substring(0, 50)
        });
      }

      const cacheKey = isSvgSource
        ? `svg:${mask.svgText!.length}:${mask.svgViewBox?.width ?? ''}x${mask.svgViewBox?.height ?? ''}:${mask.svgRenderMode ?? 'fill'}:${mask.svgStrokeWidth ?? 0}:${mask.imageUrl}`
        : mask.imageUrl;

      const existingTexture = maskTextures.get(layer.id);
      if (!existingTexture || (existingTexture.userData as any).url !== cacheKey) {
        if (isSvgSource && mask.svgText) {
          if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
            if (import.meta.env?.DEV) console.log(`[SVG Mask] Layer ${layer.id}: Loading (${mask.svgShapeId ?? 'uploaded'})`);
          }

          createSvgMaskTexture(mask.svgText, renderer, mask.svgViewBox, mask.svgRenderMode, mask.svgStrokeWidth)
            .then((texture) => {
              texture.minFilter = THREE.LinearFilter;
              applyLoadedTexture(layer.id, cacheKey, texture);
            })
            .catch((error) => {
              if (import.meta.env?.DEV) console.error(`Failed to rasterize SVG mask for layer ${layer.id}:`, error);
              if (mask.imageUrl) {
                if (import.meta.env?.DEV) console.warn(`SVG mask failed - bitmap fallback for layer ${layer.id}`);
                loadBitmapMaskTexture(layer.id, mask.imageUrl, cacheKey);
              } else {
                if (import.meta.env?.DEV) console.error(`No bitmap fallback for layer ${layer.id}`);
                const existing = maskTextures.get(layer.id);
                if (existing) {
                  existing.dispose();
                  maskTextures.delete(layer.id);
                }
              }
            });
        } else {
          loadBitmapMaskTexture(layer.id, mask.imageUrl, cacheKey);
        }
      }
    } else {
      const existingTexture = maskTextures.get(layer.id);
      if (existingTexture) {
        existingTexture.dispose();
        maskTextures.delete(layer.id);
      }
    }
  });

  const layerIds = new Set(layers.map(l => l.id));
  Array.from(maskTextures.keys()).forEach(id => {
    if (!layerIds.has(id)) {
      const texture = maskTextures.get(id);
      if (texture) texture.dispose();
      maskTextures.delete(id);
    }
  });
}