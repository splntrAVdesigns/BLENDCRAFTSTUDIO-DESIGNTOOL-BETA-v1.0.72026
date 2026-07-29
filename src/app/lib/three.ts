/**
 * Centralized Three.js export
 * All components should import THREE from this file instead of directly from 'three'
 * This ensures only a single instance of Three.js is used throughout the application
 * 
 * Note: The "Multiple instances of Three.js" warning is suppressed in init.ts
 * This is a false positive when using proper Vite deduplication
 */

import * as THREE from 'three';

// Explicitly mark this as the canonical Three.js instance
if (typeof globalThis !== 'undefined') {
  // @ts-ignore - Set the global Three.js instance marker
  globalThis.__THREE__ = THREE;
  // @ts-ignore - Also set the REVISION to match
  globalThis.__THREE_REVISION__ = THREE.REVISION;
}

// Export the namespace as default
export default THREE;

// Also export it as a named export for convenience
export { THREE };

// Re-export commonly used types and classes individually to avoid re-importing
export const {
  Scene,
  PerspectiveCamera,
  OrthographicCamera,
  WebGLRenderer,
  WebGLRenderTarget,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  MeshBasicMaterial,
  Vector2,
  Vector3,
  Vector4,
  Color,
  Clock,
  DataTexture,
  CanvasTexture,
  RGBAFormat,
  FloatType,
  HalfFloatType,
  UnsignedByteType,
  LinearFilter,
  ClampToEdgeWrapping,
  NoBlending,
  NormalBlending,
  AdditiveBlending,
  SubtractiveBlending,
  MultiplyBlending,
  CustomBlending,
  UniformsUtils,
  DoubleSide,
  FrontSide,
  BackSide,
  Raycaster,
  MathUtils,
  Texture,
  TextureLoader,
  SRGBColorSpace,
  LinearSRGBColorSpace,
} = THREE;