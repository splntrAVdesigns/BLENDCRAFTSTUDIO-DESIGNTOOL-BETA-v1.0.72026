import * as THREE from '../../lib/three';

/**
 * WebGL disposal helpers extracted from GradientCanvas Phase 1.
 * Kept deliberately small and mechanical to avoid behavior changes.
 */
export function disposeTexture(texture: THREE.Texture | null | undefined): void {
  if (texture) texture.dispose();
}

export function disposeMaterial(material: THREE.Material | THREE.Material[] | null | undefined): void {
  if (!material) return;
  if (Array.isArray(material)) {
    material.forEach(m => m.dispose());
    return;
  }
  material.dispose();
}

export function disposeMesh(mesh: THREE.Mesh | null | undefined): void {
  if (!mesh) return;
  if (mesh.geometry) mesh.geometry.dispose();
  disposeMaterial(mesh.material as THREE.Material | THREE.Material[] | null | undefined);
}

export function disposeTextureMap(map: Map<string, THREE.Texture>): void {
  map.forEach(texture => texture.dispose());
  map.clear();
}

export function disposeGeometryMap(map: Map<string, THREE.BufferGeometry>): void {
  map.forEach(geometry => geometry.dispose());
  map.clear();
}

export function disposeRenderTargetRef(ref: { current: THREE.WebGLRenderTarget | null }): void {
  if (ref.current) {
    ref.current.dispose();
    ref.current = null;
  }
}