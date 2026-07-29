import * as THREE from '../lib/three';
import { shaderCache } from './shaderCache';

/**
 * Create a shader material with caching optimization
 * Use this instead of direct THREE.ShaderMaterial construction for better performance
 */
export function createOptimizedShaderMaterial(
  vertexShader: string,
  fragmentShader: string,
  uniforms: any,
  options: THREE.ShaderMaterialParameters = {}
): THREE.ShaderMaterial {
  // Use the shader cache for optimized compilation
  return shaderCache.getOrCreate(vertexShader, fragmentShader, uniforms, options);
}

/**
 * Dispose of a shader material properly
 * Also handles cache reference counting
 */
export function disposeOptimizedShaderMaterial(material: THREE.ShaderMaterial): void {
  shaderCache.release(material);
}

/**
 * Batch create multiple shader materials
 * More efficient than creating them one by one
 */
export function createOptimizedShaderMaterialBatch(
  materials: Array<{
    vertexShader: string;
    fragmentShader: string;
    uniforms: any;
    options?: THREE.ShaderMaterialParameters;
  }>
): THREE.ShaderMaterial[] {
  // Create materials in batch using RAF for smooth performance
  return materials.map(({ vertexShader, fragmentShader, uniforms, options }) =>
    createOptimizedShaderMaterial(vertexShader, fragmentShader, uniforms, options || {})
  );
}

/**
 * Precompile commonly used shaders for instant access
 * Call this during app initialization
 */
export function precompileCommonShaders(
  shaderPairs: Array<{
    vertex: string;
    fragment: string;
    uniforms: any;
    options?: THREE.ShaderMaterialParameters;
  }>
): void {
  // Precompile in chunks to avoid blocking the main thread
  const chunkSize = 3;
  let index = 0;

  const compileChunk = () => {
    const chunk = shaderPairs.slice(index, index + chunkSize);
    
    chunk.forEach(({ vertex, fragment, uniforms, options }) => {
      createOptimizedShaderMaterial(vertex, fragment, uniforms, options || {});
    });

    index += chunkSize;

    if (index < shaderPairs.length) {
      requestAnimationFrame(compileChunk);
    } else {
      console.log('[Shader Cache] Precompilation complete');
    }
  };

  requestAnimationFrame(compileChunk);
}
