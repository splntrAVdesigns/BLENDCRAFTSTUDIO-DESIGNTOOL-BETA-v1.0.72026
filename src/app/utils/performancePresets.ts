/**
 * Performance Presets - Quick settings for different performance levels
 */

export interface PerformancePreset {
  name: string;
  description: string;
  canvasWidth: number;
  canvasHeight: number;
  pixelRatio: number;
  targetFPS: number;
  maxLayers: number;
  effectsEnabled: boolean;
  texturesSimplified: boolean;
}

export const PERFORMANCE_PRESETS: Record<string, PerformancePreset> = {
  ultra: {
    name: 'Ultra Low (Recommended)',
    description: 'Maximum performance - 540p, 24 FPS',
    canvasWidth: 960,
    canvasHeight: 540,
    pixelRatio: 1.0,
    targetFPS: 24,
    maxLayers: 2,
    effectsEnabled: false,
    texturesSimplified: true,
  },
  low: {
    name: 'Low',
    description: 'Good performance - 720p, 24 FPS',
    canvasWidth: 1280,
    canvasHeight: 720,
    pixelRatio: 1.0,
    targetFPS: 24,
    maxLayers: 3,
    effectsEnabled: false,
    texturesSimplified: false,
  },
  medium: {
    name: 'Medium',
    description: 'Balanced - 720p, 30 FPS',
    canvasWidth: 1280,
    canvasHeight: 720,
    pixelRatio: 1.0,
    targetFPS: 30,
    maxLayers: 4,
    effectsEnabled: false,
    texturesSimplified: false,
  },
  high: {
    name: 'High',
    description: 'Quality - 1080p, 30 FPS (requires good GPU)',
    canvasWidth: 1920,
    canvasHeight: 1080,
    pixelRatio: 1.0,
    targetFPS: 30,
    maxLayers: 5,
    effectsEnabled: true,
    texturesSimplified: false,
  },
};

/**
 * Auto-detect best performance preset based on device capabilities
 */
export function detectOptimalPerformance(): PerformancePreset {
  // Check if we have GPU info
  const canvas = document.createElement('canvas');
  const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
  
  if (!gl) {
    // No WebGL support - ultra low
    return PERFORMANCE_PRESETS.ultra;
  }
  
  const renderer = gl.getParameter(gl.RENDERER).toLowerCase();
  
  // Check for software rendering (very slow)
  if (renderer.includes('swiftshader') || renderer.includes('llvmpipe') || renderer.includes('software')) {
    return PERFORMANCE_PRESETS.ultra;
  }
  
  // Check screen size
  const screenPixels = window.screen.width * window.screen.height;
  
  // Small screen (mobile/tablet) → low
  if (screenPixels < 1920 * 1080) {
    return PERFORMANCE_PRESETS.low;
  }
  
  // Check hardware concurrency (CPU cores)
  const cores = navigator.hardwareConcurrency || 2;
  
  if (cores < 4) {
    return PERFORMANCE_PRESETS.low;
  } else if (cores < 8) {
    return PERFORMANCE_PRESETS.medium;
  }
  
  // Default to medium for safety
  return PERFORMANCE_PRESETS.medium;
}

/**
 * Apply performance preset to canvas settings
 */
export function applyPerformancePreset(
  preset: PerformancePreset,
  currentSettings: any
): any {
  return {
    ...currentSettings,
    width: preset.canvasWidth,
    height: preset.canvasHeight,
  };
}
