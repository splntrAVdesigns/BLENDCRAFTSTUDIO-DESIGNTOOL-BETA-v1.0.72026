import * as THREE from '../../lib/three';

/**
 * Canvas sizing helpers extracted from GradientCanvas Phase 1.
 * These helpers intentionally preserve the previous sizing behavior.
 */
export function getDisplayPixelRatio(maxRatio = 2): number {
  return Math.min(window.devicePixelRatio || 1, maxRatio);
}

export function applyRendererSize(
  renderer: THREE.WebGLRenderer,
  width: number,
  height: number,
  pixelRatio = getDisplayPixelRatio()
): void {
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
}

export function getDrawingBufferSize(renderer: THREE.WebGLRenderer): THREE.Vector2 {
  return renderer.getDrawingBufferSize(new THREE.Vector2());
}

export function resizeRenderTargets(
  width: number,
  height: number,
  ...targets: Array<THREE.WebGLRenderTarget | null | undefined>
): void {
  targets.forEach(target => {
    if (target) target.setSize(width, height);
  });
}