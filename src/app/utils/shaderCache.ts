import * as THREE from '../lib/three';

/**
 * Shader compilation cache for optimized gradient rendering
 * Prevents redundant shader compilation and improves performance
 */

interface ShaderCacheEntry {
  material: THREE.ShaderMaterial;
  lastUsed: number;
  refCount: number;
}

class ShaderCache {
  private cache: Map<string, ShaderCacheEntry> = new Map();
  private readonly MAX_CACHE_SIZE = 50;
  private readonly CACHE_TTL = 60000; // 1 minute

  /**
   * Generate a unique key for shader parameters
   */
  private generateKey(
    vertexShader: string,
    fragmentShader: string,
    uniforms: any
  ): string {
    // Create a hash from vertex/fragment shaders and uniform types
    const uniformsKey = Object.keys(uniforms)
      .sort()
      .map(key => `${key}:${typeof uniforms[key]?.value}`)
      .join(',');
    
    return `${vertexShader.length}-${fragmentShader.length}-${uniformsKey}`;
  }

  /**
   * Get or create a shader material
   */
  getOrCreate(
    vertexShader: string,
    fragmentShader: string,
    uniforms: any,
    options: THREE.ShaderMaterialParameters = {}
  ): THREE.ShaderMaterial {
    const key = this.generateKey(vertexShader, fragmentShader, uniforms);
    const cached = this.cache.get(key);

    if (cached) {
      // Update last used timestamp and increment ref count
      cached.lastUsed = Date.now();
      cached.refCount++;
      
      // Clone uniforms to avoid shared state
      const material = cached.material.clone();
      material.uniforms = THREE.UniformsUtils.clone(uniforms);
      
      return material;
    }

    // Create new material
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: THREE.UniformsUtils.clone(uniforms),
      ...options,
    });

    // Add to cache
    this.cache.set(key, {
      material,
      lastUsed: Date.now(),
      refCount: 1,
    });

    // Cleanup old entries if cache is too large
    this.cleanup();

    return material;
  }

  /**
   * Release a material reference
   */
  release(material: THREE.ShaderMaterial): void {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.material === material) {
        entry.refCount = Math.max(0, entry.refCount - 1);
        
        // Remove if no longer referenced
        if (entry.refCount === 0) {
          material.dispose();
          this.cache.delete(key);
        }
        return;
      }
    }
  }

  /**
   * Clean up old or unused cache entries
   */
  private cleanup(): void {
    if (this.cache.size <= this.MAX_CACHE_SIZE) {
      return;
    }

    const now = Date.now();
    const entries = Array.from(this.cache.entries());
    
    // Sort by last used time (oldest first)
    entries.sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    // Remove oldest entries until we're under the limit
    const toRemove = entries.slice(0, this.cache.size - this.MAX_CACHE_SIZE);
    
    for (const [key, entry] of toRemove) {
      if (entry.refCount === 0) {
        entry.material.dispose();
        this.cache.delete(key);
      }
    }

    // Also remove any expired entries
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.lastUsed > this.CACHE_TTL && entry.refCount === 0) {
        entry.material.dispose();
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached shaders
   */
  clear(): void {
    for (const entry of this.cache.values()) {
      entry.material.dispose();
    }
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      totalRefs: Array.from(this.cache.values()).reduce(
        (sum, entry) => sum + entry.refCount,
        0
      ),
    };
  }
}

// Export singleton instance
export const shaderCache = new ShaderCache();

// Export cache clearing utility for memory management
export function clearShaderCache() {
  shaderCache.clear();
}

// Export stats for debugging
export function getShaderCacheStats() {
  return shaderCache.getStats();
}
