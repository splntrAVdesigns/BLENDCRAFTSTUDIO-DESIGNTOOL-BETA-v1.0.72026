import { GradientType, GradientConfig } from '../types/gradient';

/**
 * Default configuration for each gradient type
 * These defaults are applied when a user switches to a new gradient type
 */
export interface GradientTypeDefaults {
  angle?: number;
  scale?: number;
  twist?: number;
  intensity?: number;
  octaves?: number;
  frequency?: number;
  stripeCount?: number;
  waveAmplitude?: number;
  blobCount?: number;
  gridRows?: number;
  gridCols?: number;
  centerX?: number;
  centerY?: number;
  segments?: number;
}

export interface GradientTypeConfig {
  defaults: GradientTypeDefaults;
  showAngle: boolean;
  showScale: boolean;
  showTwist: boolean;
  showCenter: boolean;
}

/**
 * Configuration for each gradient type defining:
 * - Default slider values
 * - Which sliders should be visible
 */
export const GRADIENT_TYPE_CONFIGS: Record<GradientType, GradientTypeConfig> = {
  // Linear gradients - directional flow
  linear: {
    defaults: {
      angle: 90,
      scale: 1,
      twist: 0,
      intensity: 1,
    },
    showAngle: true,
    showScale: false,
    showTwist: false,
    showCenter: false,
  },

  // Radial gradients - emanate from center
  radial: {
    defaults: {
      scale: 1,
      twist: 0,
      intensity: 1,
      centerX: 0.5,
      centerY: 0.5,
    },
    showAngle: false,
    showScale: true,
    showTwist: false, // Radial should not twist
    showCenter: true,
  },

  // Conic gradients - pure angular sweep (color wheel)
  conic: {
    defaults: {
      angle: 0,
      scale: 1,
      twist: 0,
      intensity: 1,
      centerX: 0.5,
      centerY: 0.5,
    },
    showAngle: true, // For rotation
    showScale: false,
    showTwist: false, // Conic should never twist
    showCenter: true,
  },

  // Spiral gradients - rotating emanation
  spiral: {
    defaults: {
      angle: 0,
      scale: 2,
      twist: 2, // Within UI range of -2 to 2
      intensity: 1,
      centerX: 0.5,
      centerY: 0.5,
    },
    showAngle: true,
    showScale: true,
    showTwist: true,
    showCenter: true,
  },

  // Burst gradients - explosive radial with blur
  burst: {
    defaults: {
      angle: 0,
      scale: 2,
      twist: 0,
      intensity: 1,
      centerX: 0.5,
      centerY: 0.5,
    },
    showAngle: true,
    showScale: true,
    showTwist: false,
    showCenter: true,
  },

  // DEPRECATED: Use 'kaleidoscope' instead
  mesh: {
    defaults: {
      scale: 1,
      twist: 0,
      intensity: 1,
      segments: 6, // Kaleidoscope mirror segments (3-16)
      frequency: 2.0, // Detail level within segments (0.5-5.0)
    },
    showAngle: false,
    showScale: true,
    showTwist: true, // Enable twist for kaleidoscope
    showCenter: false,
  },

  // Blob gradients - organic shapes
  blob: {
    defaults: {
      scale: 1.5,
      twist: 0,
      intensity: 1,
      blobCount: 4,
      frequency: 3, // Organic variation
    },
    showAngle: true,
    showScale: true,
    showTwist: true, // Twist applies spiral distortion to blob shapes
    showCenter: false,
  },

  // Stripe gradients - parallel bands
  stripe: {
    defaults: {
      angle: 45,
      scale: 1,
      twist: 0,
      intensity: 1,
      stripeCount: 8,
      waveAmplitude: 0.1,
    },
    showAngle: true,
    showScale: true,
    showTwist: false,
    showCenter: false,
  },

  // Wave gradients - undulating linear
  wave: {
    defaults: {
      angle: 90,
      scale: 1,
      twist: 0,
      intensity: 1,
      frequency: 5,
      waveAmplitude: 0.3,
    },
    showAngle: true,
    showScale: true,
    showTwist: true, // Enable twist for wave
    showCenter: false,
  },

  // Noise Spiral gradients - turbulent rotation
  'noise-spiral': {
    defaults: {
      scale: 2,
      twist: 1.5, // Within UI range of -2 to 2
      intensity: 1,
      octaves: 4,
      frequency: 2,
    },
    showAngle: true,
    showScale: true,
    showTwist: true,
    showCenter: false,
  },

  // Fractal gradients - self-similar patterns with breaks
  fractal: {
    defaults: {
      scale: 2.5,
      twist: 0,
      intensity: 1,
      octaves: 6,
      frequency: 1.5,
    },
    showAngle: true,
    showScale: true,
    showTwist: true, // Enable twist for fractal
    showCenter: false,
  },

  // Turbulence gradients - chaotic flow
  turbulence: {
    defaults: {
      scale: 1.5,
      twist: 0,
      intensity: 1,
      octaves: 6,
      frequency: 2,
    },
    showAngle: true,
    showScale: true,
    showTwist: true, // Enable twist for turbulence
    showCenter: false,
  },

  // Camo gradients - military pattern
  camo: {
    defaults: {
      scale: 2,
      twist: 0,
      intensity: 1,
      octaves: 4,
      frequency: 2,
    },
    showAngle: true,
    showScale: true,
    showTwist: false, // Twist disabled for camo (not working correctly)
    showCenter: false,
  },

  // Grid gradients - regular patterns
  grid: {
    defaults: {
      scale: 1,
      twist: 0,
      intensity: 1,
      gridRows: 8,
      gridCols: 8,
    },
    showAngle: true,
    showScale: true,
    showTwist: false, // Twist not applicable for grid gradients
    showCenter: false,
  },

  // Kaleidoscope - radial mirror symmetry
  kaleidoscope: {
    defaults: {
      scale: 1.2,
      twist: 0.25, // Subtle prismatic warp
      intensity: 1,
      segments: 8, // More segments = more prismatic (was 6)
      frequency: 2.5, // Tunnel depth (was 2.0) - renamed from "bands" semantically
    },
    showAngle: false,
    showScale: true,
    showTwist: true, // Enable twist for kaleidoscope
    showCenter: false,
  },

  // PHASE 1: Voronoi - cellular organic patterns
  voronoi: {
    defaults: {
      scale: 1,
      twist: 0,
      intensity: 1,
      octaves: 3,
    },
    showAngle: true,
    showScale: true,
    showTwist: true,
    showCenter: false,
  },

  // PHASE 1: Abstract - flowing abstract pattern (formerly diamond)
  abstract: {
    defaults: {
      angle: 60,
      scale: 2,
      twist: 0,
      intensity: 1,
      centerX: 0.5,
      centerY: 0.5,
    },
    showAngle: true,
    showScale: true,
    showTwist: true,
    showCenter: true,
  },

  // PHASE 1: Diamond - textile diamond pattern
  diamond: {
    defaults: {
      angle: 90,   // 90 degrees default rotation
      scale: 2,    // 2.00x default scale
      twist: 0,    // 0 = no twist
      intensity: 1,
    },
    showAngle: true,
    showScale: true,
    showTwist: true, // Diamond now supports twist for internal gradients
    showCenter: false,
  },

  // PHASE 5: Plasma - flowing interference patterns
  plasma: {
    defaults: {
      scale: 2.5,    // Wave frequency (how tight the patterns are)
      twist: 0,      // Radial twist distortion
      intensity: 1,
      octaves: 4,    // Complexity (number of wave layers: 1-8)
    },
    showAngle: false,
    showScale: true,
    showTwist: true, // Plasma supports radial twist
    showCenter: false,
  },

  // Marble - Organic stone texture with flowing veins
  marble: {
    defaults: {
      angle: 45,      // Flow direction
      scale: 1.5,     // Pattern scale
      twist: 0,
      intensity: 1,
      octaves: 4,     // Vein Intensity (1-8)
    },
    showAngle: true,  // Flow direction
    showScale: true,
    showTwist: false,
    showCenter: false,
  },

  // Concentric - Circular ripple patterns
  concentric: {
    defaults: {
      scale: 1.0,     // Spacing
      twist: 0,
      intensity: 1,
      octaves: 5,     // Ring Count (1-8)
      centerX: 0.5,   // Center point
      centerY: 0.5,
    },
    showAngle: false,
    showScale: true,
    showTwist: false,
    showCenter: true, // Ripple center control
  },

  // Radial Waves - Expanding circular waves with interference
  'radial-waves': {
    defaults: {
      scale: 1.0,      // Wave spacing
      twist: 0,
      intensity: 1,
      octaves: 3,      // Wave Count (1-5)
      frequency: 2.0,  // Speed: wave expansion speed
      centerX: 0.5,    // Wave origin X
      centerY: 0.5,    // Wave origin Y
    },
    showAngle: false,
    showScale: true,
    showTwist: false,
    showCenter: true,  // Enable center controls
  },

  // Mandala - Symmetrical radial patterns with sacred geometry
  mandala: {
    defaults: {
      angle: 0,        // Rotation
      scale: 1.0,      // Pattern scale
      twist: 0,
      intensity: 1,
      segments: 8,     // Radial symmetry segments (3-16)
      octaves: 4,      // Layers: concentric layers (1-8)
    },
    showAngle: true,   // Rotation control
    showScale: true,
    showTwist: false,
    showCenter: false,
  },

  // Starburst - Radial star/sunburst rays from center
  starburst: {
    defaults: {
      angle: 0,        // Base rotation angle
      scale: 1.0,      // Spread of rays
      twist: 0.3,      // Ray sharpness (0=soft, 1=razor)
      intensity: 1,
      segments: 12,    // Number of rays (3-32)
      centerX: 0.5,
      centerY: 0.5,
    },
    showAngle: true,   // Rotation control
    showScale: true,   // Ray spread
    showTwist: true,   // Ray sharpness
    showCenter: true,  // Center point
  },

  'four-corners': {
    defaults: {
      scale: 1.0,
      twist: 0.5,      // Corner Spread: controls displacement from corners (0-1)
      intensity: 1,
    },
    showAngle: true,   // Rotation control
    showScale: true,   // Zoom/spread control
    showTwist: true,   // Corner Spread (renamed in UI)
    showCenter: false, // No center control needed
  },
};

/**
 * Get default configuration for a specific gradient type
 */
export function getGradientDefaults(type: GradientType): GradientTypeDefaults {
  return GRADIENT_TYPE_CONFIGS[type]?.defaults || {
    angle: 0,
    scale: 1,
    twist: 0,
    intensity: 1,
  };
}

/**
 * Get UI configuration for a specific gradient type
 */
export function getGradientUIConfig(type: GradientType): GradientTypeConfig {
  return GRADIENT_TYPE_CONFIGS[type] || GRADIENT_TYPE_CONFIGS.linear;
}

/**
 * Apply default values to a gradient configuration when type changes
 */
export function applyGradientDefaults(gradient: GradientConfig, newType: GradientType): GradientConfig {
  try {
    const defaults = getGradientDefaults(newType);
    
    return {
      ...gradient,
      type: newType,
      ...defaults,
    };
  } catch (error) {
    console.error('[gradientDefaults] Error applying defaults:', error);
    // Fallback: return gradient with just type changed
    return {
      ...gradient,
      type: newType,
    };
  }
}