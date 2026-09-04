/**
 * Centralized Three.js export
 * All components should import THREE from this file instead of directly from 'three'
 * This ensures only a single instance of Three.js is used throughout the application
 * 
 * Note: The "Multiple instances of Three.js" warning is suppressed in init.ts
 * This is a false positive when using proper Vite deduplication
 */

import * as THREE from 'three';

declare global {
  var __THREE__: typeof THREE | undefined;
  var __THREE_REVISION__: string | undefined;
}

// Explicitly mark this as the canonical Three.js instance
if (typeof globalThis !== 'undefined') {
  globalThis.__THREE__ = THREE;
  globalThis.__THREE_REVISION__ = THREE.REVISION;
}

// Export the namespace as default
export default THREE;

// Also export it as a named export for convenience
export { THREE };

// Preserve Three.js' class/type namespace. Destructuring constructors into
// `const` exports erased their type side and caused hundreds of false
// "value used as a type" failures in clean typechecks.
export * from 'three';
