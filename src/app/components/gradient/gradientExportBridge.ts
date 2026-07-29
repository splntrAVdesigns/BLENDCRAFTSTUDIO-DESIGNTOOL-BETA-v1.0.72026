import type { MutableRefObject } from 'react';
import * as THREE from '../../lib/three';
import { resizeRenderTargets } from './canvasSizing';

export interface ExportRenderTargetCache {
  rt: THREE.WebGLRenderTarget;
  width: number;
  height: number;
}

export interface PreviewSize {
  w: number;
  h: number;
}

export function getOrCreateExportRenderTarget(
  renderer: THREE.WebGLRenderer,
  cacheRef: MutableRefObject<ExportRenderTargetCache | null>,
): THREE.WebGLRenderTarget {
  const w = renderer.domElement.width;
  const h = renderer.domElement.height;
  const cached = cacheRef.current;

  if (cached && cached.width === w && cached.height === h) {
    return cached.rt;
  }

  cached?.rt.dispose();

  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    colorSpace: THREE.SRGBColorSpace,
  });

  if ((renderer.capabilities as any).isWebGL2) {
    (rt as any).samples = 4;
  }

  cacheRef.current = { rt, width: w, height: h };
  return rt;
}

export function disposeExportRenderTargetCache(
  cacheRef: MutableRefObject<ExportRenderTargetCache | null>,
): void {
  if (!cacheRef.current) return;
  cacheRef.current.rt.dispose();
  cacheRef.current = null;
}

export function prepareRendererForExportSize(
  renderer: THREE.WebGLRenderer,
  exportWidth: number,
  exportHeight: number,
  previewSizeRef: MutableRefObject<PreviewSize | null>,
  renderTarget: THREE.WebGLRenderTarget | null,
  captureTarget: THREE.WebGLRenderTarget | null,
): void {
  if (!previewSizeRef.current) {
    previewSizeRef.current = {
      w: renderer.domElement.width,
      h: renderer.domElement.height,
    };
  }

  renderer.domElement.style.opacity = '0';
  renderer.domElement.style.transition = 'none';
  renderer.setSize(exportWidth, exportHeight, false);
  resizeRenderTargets(exportWidth, exportHeight, renderTarget, captureTarget);
}

export function restoreRendererPreviewSize(
  renderer: THREE.WebGLRenderer,
  previewSizeRef: MutableRefObject<PreviewSize | null>,
  renderTarget: THREE.WebGLRenderTarget | null,
  captureTarget: THREE.WebGLRenderTarget | null,
): boolean {
  const saved = previewSizeRef.current;
  if (!saved) return false;

  renderer.setSize(saved.w, saved.h, false);
  resizeRenderTargets(saved.w, saved.h, renderTarget, captureTarget);
  previewSizeRef.current = null;
  return true;
}

export function revealRendererCanvasAfterResize(renderer: THREE.WebGLRenderer): void {
  requestAnimationFrame(() => {
    if (renderer.domElement) {
      renderer.domElement.style.transition = 'opacity 0.15s ease-out';
      renderer.domElement.style.opacity = '1';
    }
  });
}

export function temporarilyResizeRendererTargets(
  renderer: THREE.WebGLRenderer,
  targetWidth: number,
  targetHeight: number,
  renderTarget: THREE.WebGLRenderTarget | null,
  captureTarget: THREE.WebGLRenderTarget | null,
): (() => void) | null {
  const liveW = renderer.domElement.width;
  const liveH = renderer.domElement.height;
  const needsResize = (targetWidth !== liveW || targetHeight !== liveH) &&
    targetWidth > 0 && targetHeight > 0;

  if (!needsResize) return null;

  renderer.setSize(targetWidth, targetHeight, false);
  resizeRenderTargets(targetWidth, targetHeight, renderTarget, captureTarget);

  return () => {
    renderer.setSize(liveW, liveH, false);
    resizeRenderTargets(liveW, liveH, renderTarget, captureTarget);
  };
}