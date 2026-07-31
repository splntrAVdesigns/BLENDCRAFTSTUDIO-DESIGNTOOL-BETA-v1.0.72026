import THREE from '../lib/three';
import type { WebGLRenderer } from 'three';

export interface OfflineExportRendererHandle {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  dispose(): void;
}

/**
 * Export-only WebGL renderer.
 *
 * It is never mounted in the document and therefore is not owned by the
 * workspace compositor, React layout, or the live preview animation loop.
 * GradientCanvas.renderAtTime() receives this renderer explicitly and renders
 * the same authoritative scene/material graph into this independent surface.
 */
export function createOfflineExportRenderer(
  width: number,
  height: number,
): OfflineExportRendererHandle {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid offline export size ${width}×${height}.`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
    precision: 'highp',
    powerPreference: 'high-performance',
    stencil: false,
    depth: false,
  });

  renderer.autoClear = false;
  renderer.setPixelRatio(1);
  renderer.setSize(Math.round(width), Math.round(height), false);
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  let disposed = false;
  return {
    renderer,
    canvas,
    dispose() {
      if (disposed) return;
      disposed = true;
      try { renderer.setRenderTarget(null); } catch {}
      try { renderer.clear(); } catch {}
      try { renderer.dispose(); } catch {}
      try { renderer.forceContextLoss(); } catch {}
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}
