import * as THREE from '../lib/three';
import { createNoise2D } from 'simplex-noise';
import { Layer, InteractionState, GradientConfig, TextureConfig, MaskConfig } from '../types/gradient';
import { hexToRgb } from './colors';
import {
  vertexShader,
  linearGradientShader,
  radialGradientShader,
  conicGradientShader,
  noiseGradientShader,
  waveGradientShader,
  waveGradientShader2,
  blobGradientShader,
  spiralGradientShader,
  burstGradientShader,
  camoGradientShader,
  fractalGradientShader,
  turbulenceGradientShader,
  gridGradientShader,
  voronoiGradientShader,
  abstractGradientShader, // Renamed from diamondGradientShader
  SHADER_VERSION_TIMESTAMP, // Force reimport of shaders module
} from '../shaders/gradientShaders';
import { createMeshGradientShader } from './meshGradientRenderer';
import { kaleidoscopeGradientShader } from '../shaders/kaleidoscopeShader';
import { diamondGradientShader } from '../shaders/diamondShader'; // New diamond pattern
import { plasmaGradientShader } from '../shaders/plasmaShader'; // Flowing interference patterns
import { marbleGradientShader, concentricGradientShader } from '../shaders/newGradients';
import { radialWavesGradientShader, mandalaGradientShader, starburstGradientShader, fourCornersGradientShader } from '../shaders/newGradients';
import { wrapShaderWithMask } from '../shaders/maskShaderWrapper';
import { createMediaMaterial, isMediaLayerActive } from '../media/mediaShader';
import { deterministicRange } from './deterministicAnimation';

const noise2D = createNoise2D();

// Log shader version to verify cache bust
console.log('[GradientRenderer] Shader module version:', SHADER_VERSION_TIMESTAMP);

export function renderGradientLayer(
  layer: Layer,
  width: number,
  height: number,
  interaction: InteractionState
): THREE.Mesh | null {
  if (!layer.gradient && !layer.texture && !isMediaLayerActive(layer.media)) return null;

  // Create plane geometry - subdivide if displacement configuration exists
  // Once a layer has displacement configured, always use subdivided geometry
  // This prevents visual jumps when toggling warp mode on/off
  const hasDisplacement = layer.displacement !== undefined && layer.displacement !== null;
  const hasVertexOffsets = layer.displacement?.vertexOffsets && layer.displacement.vertexOffsets.length > 0;
  const meshResolution = layer.displacement?.meshResolution || 64;
  const geometry = hasDisplacement 
    ? new THREE.PlaneGeometry(width, height, meshResolution, meshResolution)
    : new THREE.PlaneGeometry(width, height);
  
  // Apply stored vertex offsets if they exist (preserves warp edits even when warp mode is off)
  if (hasVertexOffsets) {
    const positions = geometry.attributes.position;
    const offsets = layer.displacement.vertexOffsets;
    
    // CRITICAL: Verify that offsets array matches expected size
    // Expected: positions.count vertices * 3 components (x, y, z)
    const expectedLength = positions.count * 3;
    
    // Only apply offsets if they match the geometry (prevents corruption during resolution changes)
    if (offsets.length === expectedLength) {
      // Apply offsets to vertex positions
      for (let i = 0; i < positions.count; i++) {
        positions.setX(i, positions.getX(i) + offsets[i * 3]);
        positions.setY(i, positions.getY(i) + offsets[i * 3 + 1]);
        positions.setZ(i, positions.getZ(i) + offsets[i * 3 + 2]);
      }
      
      positions.needsUpdate = true;
      geometry.computeVertexNormals(); // Recompute normals after deformation
    } else {
      console.warn(`[GradientRenderer] Skipping vertex offsets - size mismatch! Expected ${expectedLength}, got ${offsets.length}`);
    }
  }

  // Create material based on layer source
  let material: THREE.Material;

  if (isMediaLayerActive(layer.media)) {
    // MEDIA LAYER (Stage 1): uploaded image/SVG/video-poster replaces the
    // gradient sample. The material is mask-wrapped, so mask settings apply;
    // the effects post-pass applies downstream automatically. The texture
    // itself is assigned asynchronously by GradientCanvas's media effect.
    material = createMediaMaterial({
      media: layer.media!,
      canvasAspect: height > 0 ? width / height : 1,
    });
  } else if (layer.gradient) {
    material = createGradientMaterial(layer.gradient, layer.texture, interaction, undefined, 0, layer.id);
  } else if (layer.texture) {
    // Texture-only rendering (simplified for now)
    material = new THREE.MeshBasicMaterial({ color: 0x808080 });
  } else {
    return null;
  }

  // Apply opacity and blend mode
  if (material instanceof THREE.ShaderMaterial || material instanceof THREE.MeshBasicMaterial) {
    material.transparent = layer.opacity < 1;
    material.opacity = layer.opacity;
    
    // Apply blend mode (simplified - would need custom blending for full support)
    // STAGE 2.5 FIX: THREE.WebGLState warns every frame when blending is set
    // to MultiplyBlending without premultipliedAlpha = true on the SAME
    // material. premultipliedAlpha was set on the renderer context and one
    // unrelated post-process material, but never on per-layer materials.
    material.premultipliedAlpha = false;
    switch (layer.blendMode) {
      case 'multiply':
        material.blending = THREE.MultiplyBlending;
        material.premultipliedAlpha = true;
        break;
      case 'screen':
      case 'lighten':
        material.blending = THREE.AdditiveBlending;
        break;
      default:
        material.blending = THREE.NormalBlending;
    }
  }

  const mesh = new THREE.Mesh(geometry, material);
  // Position at origin since camera is centered
  mesh.position.set(0, 0, 0);

  return mesh;
}


function getPatternFlipModeValue(mode?: string): number {
  switch (mode) {
    case 'horizontal': return 1.0;
    case 'vertical': return 2.0;
    case 'checker': return 3.0;
    default: return 0.0;
  }
}

function getPatternOpacityCurveModeValue(mode?: string): number {
  switch (mode) {
    case 'center': return 1.0;
    case 'edge': return 2.0;
    default: return 0.0;
  }
}

function getTextureAnimationTypeValue(type?: string): number {
  switch (type) {
    case 'spin': 
    case 'rotation':
      return 0.0;
    case 'warp': return 1.0;
    case 'pingPong': return 2.0;
    case 'scale': return 3.0;
    case 'drift': return 4.0;
    case 'tectonic': return 5.0;
    case 'breathing': return 6.0;
    case 'seismic': return 7.0;
    case 'shear': return 8.0;
    case 'vortex': return 9.0;
    case 'fluid': return 10.0;
    default: return 4.0;
  }
}

// Map animation type to shader value for shader-driven animations
export function getAnimationTypeValue(type?: string): number {
  switch (type) {
    case 'wave': return 1.0;
    case 'morph': return 2.0;
    case 'vortex': return 3.0;
    case 'kaleidoscope': return 4.0;
    case 'fractalZoom': return 5.0;
    case 'turbulence': return 6.0;
    case 'ripple': return 7.0;
    default: return 0.0; // 0 = no shader-driven animation
  }
}

function createGradientMaterial(
  gradient: GradientConfig,
  texture?: TextureConfig,
  interaction: { mouseX: number; mouseY: number; mouseIntensity: number } = { mouseX: 0, mouseY: 0, mouseIntensity: 0 },
  displacementTexture?: THREE.Texture,
  displacementStrength: number = 0,
  layerId: string = 'gradient-layer'
): THREE.ShaderMaterial {
  
  // Convert color stops to shader format
  const colors: THREE.Vector3[] = [];
  
  // CRITICAL FIX: Sort color stops by position before processing
  // This prevents rendering artifacts when users manually adjust stop positions
  const sortedColors = sortColorStops(gradient.colors);

  sortedColors.forEach(c => {
    const rgb = hexToRgb(c.color);
    colors.push(new THREE.Vector3(rgb.r, rgb.g, rgb.b));
  });

  const positions = sortedColors.map(c => c.position);

  // Pad arrays to size 10
  while (colors.length < 10) colors.push(new THREE.Vector3(0, 0, 0));
  while (positions.length < 10) positions.push(1);

  const baseUniforms = {
    colors: { value: colors },
    positions: { value: positions },
    colorCount: { value: gradient.colors.length },
    intensity: { value: gradient.intensity || 1 },
    time: { value: 0 },
    textureTime: { value: 0 }, // Separate time for texture animation
    textureAnimationType: { value: getTextureAnimationTypeValue(texture?.textureAnimationType) }, // Animation type: 0=spin, 1=warp, 2=pingPong, 3=scale, 4=drift, 5=tectonic, 6=breathing, 7=seismic, 8=shear, 9=vortex, 10=fluid
    // Texture uniforms
    hasTexture: { value: texture ? 1.0 : 0.0 },
    textureType: { value: texture ? getTextureTypeValue(texture.type) : 0.0 },
    textureIntensity: { value: texture?.intensity || 0.0 },
    textureScale: { value: texture?.scale || 1.0 },
    textureOpacity: { value: texture?.opacity || 1.0 },
    blur: { 
      value: texture?.type === 'plasma' && texture.turbulence !== undefined ? texture.turbulence / 100 :
             (texture?.blur !== undefined ? texture.blur : 0.5)
    },
    distortion: { value: texture?.distortion !== undefined ? texture.distortion : 0.5 },
    angle: { value: gradient.angle || 0 }, // Gradient angle (for linear, stripe, wave, etc.)
    textureAngle: { value: texture?.angle !== undefined ? texture.angle : 90 }, // Texture angle (for linearGlass, waveSignal, etc.)
    blendMode: { value: texture?.blendMode ? getBlendModeValue(texture.blendMode) : 0.0 },
    // Animation uniforms
    animateTexture: { value: texture?.animateTexture === true ? 1.0 : 0.0 },
    animationSpeed: { value: texture?.animationSpeed || 1.0 },
    // Glass-specific uniforms (also used by plasma)
    gridSize: { 
      value: texture?.type === 'plasma' ? (texture.waveCount ?? 5) :
             (texture?.gridSize ?? 10)
    },
    complexity: { 
      value: texture?.complexity ?? 4
    },
    chromaticShift: {
      value: texture?.type === 'plasma' ? (texture.colorIntensity ?? 70) :
             (texture?.chromaticShift ?? 5)
    },
    // Topography-specific uniforms
    elevationShift: { value: texture?.elevationShift ?? 0 },
    lineThickness: { value: texture?.lineThickness ?? 50 },
    // Plasma-specific uniforms (separate from overloaded params above)
    waveCount: { value: texture?.waveCount ?? 5 },
    turbulence: { value: texture?.turbulence ?? 20 },
    colorIntensity: { value: texture?.colorIntensity ?? 15 },
    // Gradient animation uniforms (controlled by GradientCanvas)
    uRotation: { value: gradient.angle || 0.0 }, // Rotation angle from gradient config
    uScale: { value: gradient.scale || 1.0 }, // Scale multiplier from gradient config
    uAudioGlitch: { value: new THREE.Vector2(0, 0) }, // STAGE 3.0.5b: audio motion glitch (x=shove, y=slice)
    uDriftX: { value: 0.0 }, // Horizontal drift offset
    uDriftY: { value: 0.0 }, // Vertical drift offset
    uPulse: { value: 1.0 }, // Pulse multiplier
    uTurbulence: { value: 0.0 }, // Turbulence amount
    uTwist: { value: 0.0 }, // Animation twist (separate from gradient.twist)
    uHueRotation: { value: 0.0 }, // Hue shift animation (0-360 degrees)
    // NEW: Shader-driven animation uniforms
    uAnimPhase: { value: 0.0 }, // Normalized loop phase (0-1)
    uAnimEased: { value: 0.0 }, // Eased loop phase (0-1)
    uAnimTime: { value: 0.0 }, // Signed unbounded time
    uAnimIntensity: { value: 0.0 }, // Animation intensity
    uAnimType: { value: 0.0 }, // Animation type ID (0=none, 1=wave, 2=morph, 3=vortex, etc.)
    // PHASE 7.3E.10: normalized export-loop authority. Preview remains unchanged.
    uExportLoopEnabled: { value: 0.0 },
    uExportLoopPhase: { value: 0.0 },
    // Interactive mode uniforms (X/Y pad)
    mouseX: { value: interaction.mouseX },
    mouseY: { value: interaction.mouseY },
    mouseIntensity: { value: interaction.mouseIntensity },
    // Layer opacity uniform (applied in shader)
    layerOpacity: { value: 1.0 }, // Will be updated by GradientCanvas
    // Mask uniforms
    hasMask: { value: 0.0 },
    uMaskType: { value: 0.0 }, // 0=none, 1=alpha, 2=luminance, 3=layer, 4=image
    uMaskTexture: { value: null },
    uMaskOpacity: { value: 1.0 },
    uMaskFeather: { value: 0.0 },
    uMaskInvert: { value: 0.0 },
    uMaskMode: { value: 0.0 }, // 0=clip, 1=add, 2=subtract, 3=intersect
    uMaskFit: { value: 1.0 }, // Always 'contain' mode
    uMaskAspect: { value: 1.0 },
    uCanvasAspect: { value: 1.0 },
    uMaskScale: { value: 1.0 },
    uMaskOffset: { value: new THREE.Vector2(0.0, 0.0) },
    uMaskRotation: { value: 0.0 },
    uMaskExpand: { value: 0.0 },
    uMaskTexelSize: { value: new THREE.Vector2(1.0 / 1024.0, 1.0 / 1024.0) },
    uMaskSourceKind: { value: 0.0 }, // 0=bitmap, 1=svg/vector
    uBitmapSourceMode: { value: 0.0 }, // 0=alpha, 1=luminance
    uBitmapThreshold: { value: 0.5 },
    // Advanced mask uniforms — MUST be declared here at creation time so Three.js
    // registers their GPU uniform locations. These were previously added lazily via
    // the GradientCanvas initialization block, but that block is guarded by
    // `if (!material.uniforms.hasMask)` which never fires because hasMask is already
    // present here. Lazy addition after shader compilation causes silent no-ops.
    uMaskBlurQuality:   { value: 0.0 }, // 0=none 1=fast 2=medium 3=high
    uMaskTileMode:      { value: 0.0 }, // 0=single 1=repeat 2=mirror
    uMaskTileScale:     { value: 1.0 }, // tile density (>1 = denser/more tiles)
    uMaskEdgeDetect:    { value: 0.0 }, // 0=off 1=on (Sobel outline)
    uMaskEdgeThickness: { value: 2.0 }, // 1-20, scales Sobel sample radius
    // Pattern texture uniform — MUST be declared here at creation time.
    // THREE.js only binds uniforms that exist at shader compile time.
    // Lazy addition via GradientCanvas after compilation silently fails.
    uPatternTexture: { value: null },
    uPatternAR: { value: 1.0 }, // canvas width/height AR — corrects shape distortion on non-square canvases
    // Shape Pattern advanced controls — declare at material creation time so
    // gradient type switches do not reset/ignore pattern scale behavior.
    uPatternOffset: { value: new THREE.Vector2((texture?.patternOffsetX ?? 0) / 100, (texture?.patternOffsetY ?? 0) / 100) },
    uPatternDensity: { value: texture?.patternDensity ?? 50.0 },
    uPatternRandomRotation: { value: texture?.patternRandomRotation ?? 0.0 },
    uPatternAlternateFlip: { value: getPatternFlipModeValue(texture?.patternAlternateFlip) },
    uPatternStaggerRows: { value: texture?.patternStaggerRows ?? 0.0 },
    uPatternScaleVariance: { value: texture?.patternScaleVariance ?? 0.0 },
    uPatternOpacityCurve: { value: texture?.patternOpacityCurve ?? 0.0 },
    uPatternOpacityCurveMode: { value: getPatternOpacityCurveModeValue(texture?.patternOpacityCurveMode) },
    uTextureLOD: { value: 0.0 },
    // Invert toggle for spackle texture
    uInvertTexture: { value: 0.0 },
    // Displacement uniforms for Interactive Warp Mode
    uDisplacementMap: { value: displacementTexture },
    uDisplacementStrength: { value: displacementStrength },
    // Kaleidoscope-specific uniforms (mesh type) - always available with defaults
    segments: { value: gradient.segments || 6 },
    frequency: { value: gradient.frequency || 2.0 },
  };



  let fragmentShader: string;
  let additionalUniforms: any = {};

  switch (gradient.type) {
    case 'linear':
      fragmentShader = linearGradientShader;
      additionalUniforms = {
        angle: { value: (gradient.angle || 0) + (interaction.mouseX * 45) },
        scale: { value: (gradient.scale || 1) * (gradient.scaleBoost || 1) },
      };
      break;

    case 'radial':
      fragmentShader = radialGradientShader;
      additionalUniforms = {
        center: { value: new THREE.Vector2(
          (gradient.centerX || 0.5) + interaction.mouseX * 0.3, // Increased from 0.1 to 0.3 (3x sensitivity)
          (gradient.centerY || 0.5) + interaction.mouseY * 0.3
        )},
        scale: { value: (gradient.scale || 1) * (gradient.scaleBoost || 1) },
      };
      break;

    case 'conic':
      fragmentShader = conicGradientShader;
      additionalUniforms = {
        center: { value: new THREE.Vector2(
          (gradient.centerX || 0.5) + interaction.mouseX * 0.3,
          (gradient.centerY || 0.5) + interaction.mouseY * 0.3
        )},
        scale: { value: (gradient.scale || 1) * (gradient.scaleBoost || 1) },
      };
      break;

    case 'noise-spiral':
      fragmentShader = noiseGradientShader;
      additionalUniforms = {
        scale: { value: (gradient.scale || 1) * (gradient.scaleBoost || 1) * (1 + interaction.mouseIntensity * 0.2) },
        octaves: { value: gradient.octaves || 4 },
        frequency: { value: gradient.frequency || 2 },
      };
      break;

    case 'fractal':
      fragmentShader = fractalGradientShader;
      additionalUniforms = {
        scale: { value: (gradient.scale || 2.5) * (gradient.scaleBoost || 1) * (1 + interaction.mouseIntensity * 0.2) },
        octaves: { value: gradient.octaves || 6 },
        frequency: { value: gradient.frequency || 1 },
      };
      break;

    case 'turbulence':
      fragmentShader = turbulenceGradientShader;
      additionalUniforms = {
        scale: { value: (gradient.scale || 1) * (gradient.scaleBoost || 1) * (1 + interaction.mouseIntensity * 0.2) },
        octaves: { value: gradient.octaves || 6 },
        frequency: { value: gradient.frequency || 2 },
      };
      break;

    case 'stripe':
      fragmentShader = waveGradientShader;
      additionalUniforms = {
        angle: { value: gradient.angle || 0 },
        stripeCount: { value: gradient.stripeCount || 5 },
        waveAmplitude: { value: (gradient.waveAmplitude || 0.2) * (1 + interaction.mouseIntensity * 0.3) },
      };
      break;

    case 'wave':
      fragmentShader = waveGradientShader2;
      additionalUniforms = {
        angle: { value: gradient.angle || 0 },
        frequency: { value: gradient.stripeCount || gradient.frequency || 5 },
        waveAmplitude: { value: (gradient.waveAmplitude || 0.2) * (1 + interaction.mouseIntensity * 0.3) },
        scale: { value: (gradient.scale || 1) * (gradient.scaleBoost || 1) },
      };
      break;

    case 'wave2':
      fragmentShader = waveGradientShader2;
      additionalUniforms = {
        angle: { value: gradient.angle || 0 },
        stripeCount: { value: gradient.stripeCount || 5 },
        waveAmplitude: { value: (gradient.waveAmplitude || 0.2) * (1 + interaction.mouseIntensity * 0.3) },
      };
      break;

    case 'blob':
      fragmentShader = blobGradientShader;
      const blobCount = Math.min(gradient.blobCount || 3, 5);
      const blobPositions: THREE.Vector2[] = [];
      const blobSizes: number[] = [];
      
      for (let i = 0; i < 5; i++) {
        if (i < blobCount) {
          // Create blob positions with some randomness
          const angle = (i / blobCount) * Math.PI * 2;
          const radius = 0.3;
          blobPositions.push(new THREE.Vector2(
            0.5 + Math.cos(angle) * radius + interaction.mouseX * 0.05,
            0.5 + Math.sin(angle) * radius + interaction.mouseY * 0.05
          ));
          // Stable per-layer/per-blob size. Math.random() made material rebuilds
          // produce a different blob field between preview and deterministic export.
          blobSizes.push(deterministicRange(`${layerId}:blob-size`, i, 0.4, 0.6));
        } else {
          blobPositions.push(new THREE.Vector2(0, 0));
          blobSizes.push(0);
        }
      }
      
      additionalUniforms = {
        blobPositions: { value: blobPositions },
        blobSizes: { value: blobSizes },
        blobCount: { value: blobCount },
        scale: { value: (gradient.scale || 1) * (gradient.scaleBoost || 1) },
      };
      break;

    case 'spiral':
      fragmentShader = spiralGradientShader;
      additionalUniforms = {
        center: { value: new THREE.Vector2(
          (gradient.centerX || 0.5) + interaction.mouseX * 0.3, // Increased from 0.1 to 0.3
          (gradient.centerY || 0.5) + interaction.mouseY * 0.3
        )},
        scale: { value: (gradient.scale || 1) * (gradient.scaleBoost || 1) },
      };
      break;

    case 'burst':
      fragmentShader = burstGradientShader;
      additionalUniforms = {
        center: { value: new THREE.Vector2(
          (gradient.centerX || 0.5) + interaction.mouseX * 0.3,
          (gradient.centerY || 0.5) + interaction.mouseY * 0.3
        )},
        stripeCount: { value: gradient.stripeCount || 12 },
        scale: { value: (gradient.scale || 1) * (gradient.scaleBoost || 1) },
      };
      break;

    case 'camo':
      fragmentShader = camoGradientShader;
      additionalUniforms = {
        scale: { value: (gradient.scale || 1) * (gradient.scaleBoost || 1) },
        uTwist: { value: gradient.twist || 0 },
      };
      break;

    case 'kaleidoscope':
    case 'mesh': // DEPRECATED: 'mesh' is now 'kaleidoscope'. Kept for backward compatibility.
      // Kaleidoscope gradient with mirror-reflected patterns
      fragmentShader = kaleidoscopeGradientShader;
      additionalUniforms = {
        // segments and frequency are now in baseUniforms, no need to override
      };
      break;

    case 'grid':
      fragmentShader = gridGradientShader;
      additionalUniforms = {
        gridRows: { value: gradient.gridRows || 2 },
        gridCols: { value: gradient.gridCols || 2 },
        scale: { value: (gradient.scale || 1) * (gradient.scaleBoost || 1) },
      };
      break;

    case 'voronoi':
      fragmentShader = voronoiGradientShader;
      additionalUniforms = {
        scale: { value: (gradient.scale || 1) * (gradient.scaleBoost || 1) },
        octaves: { value: gradient.octaves || 3 },
      };
      break;

    case 'diamond':
      fragmentShader = diamondGradientShader;
      additionalUniforms = {
        angle: { value: gradient.angle || 45 },
        scale: { value: (gradient.scale || 1) * (gradient.scaleBoost || 1) },
        twist: { value: gradient.twist || 0 }, // Twist for internal gradients
      };
      break;

    case 'abstract':
      fragmentShader = abstractGradientShader;
      additionalUniforms = {
        center: { value: new THREE.Vector2(
          (gradient.centerX || 0.5) + interaction.mouseX * 0.3,
          (gradient.centerY || 0.5) + interaction.mouseY * 0.3
        )},
        angle: { value: gradient.angle || 0 },
        scale: { value: (gradient.scale || 1) * (gradient.scaleBoost || 1) },
      };
      break;

    case 'plasma':
      fragmentShader = plasmaGradientShader;
      additionalUniforms = {
        scale: { value: (gradient.scale || 2) * (gradient.scaleBoost || 1) }, // Default to 2 if not set
        octaves: { value: Math.max(1, gradient.octaves || 4) }, // Ensure at least 1, default 4
        twist: { value: gradient.twist || 0 }, // Radial twist distortion
      };
      break;

    case 'marble':
      fragmentShader = marbleGradientShader;
      additionalUniforms = {
        scale: { value: (gradient.scale || 2) * (gradient.scaleBoost || 1) }, // Default to 2 if not set
        octaves: { value: Math.max(1, gradient.octaves || 4) }, // Ensure at least 1, default 4
        twist: { value: gradient.twist || 0 }, // Radial twist distortion
      };
      break;

    case 'concentric':
      fragmentShader = concentricGradientShader;
      additionalUniforms = {
        center: { value: new THREE.Vector2(
          (gradient.centerX || 0.5) + interaction.mouseX * 0.3,
          (gradient.centerY || 0.5) + interaction.mouseY * 0.3
        )},
        scale: { value: (gradient.scale || 1) * (gradient.scaleBoost || 1) },
        octaves: { value: Math.max(1, gradient.octaves || 5) },
      };
      break;

    case 'radial-waves':
      fragmentShader = radialWavesGradientShader;
      additionalUniforms = {
        centerX: { value: (gradient.centerX || 0.5) + interaction.mouseX * 0.3 },
        centerY: { value: (gradient.centerY || 0.5) + interaction.mouseY * 0.3 },
        scale: { value: (gradient.scale || 1) * (gradient.scaleBoost || 1) },
        octaves: { value: Math.max(1, gradient.octaves || 3) },
        frequency: { value: gradient.frequency || 2.0 },
        complexity: { value: gradient.twist || 0 },
      };
      break;

    case 'mandala':
      fragmentShader = mandalaGradientShader;
      additionalUniforms = {
        center: { value: new THREE.Vector2(
          (gradient.centerX || 0.5) + interaction.mouseX * 0.3,
          (gradient.centerY || 0.5) + interaction.mouseY * 0.3
        )},
        scale: { value: (gradient.scale || 1) * (gradient.scaleBoost || 1) },
        octaves: { value: Math.max(1, gradient.octaves || 5) },
      };
      break;

    case 'starburst':
      fragmentShader = starburstGradientShader;
      additionalUniforms = {
        center: { value: new THREE.Vector2(
          (gradient.centerX || 0.5) + interaction.mouseX * 0.3,
          (gradient.centerY || 0.5) + interaction.mouseY * 0.3
        )},
        scale: { value: (gradient.scale || 1) * (gradient.scaleBoost || 1) },
        // uTwist is overloaded as "ray sharpness" for starburst (0=soft, 1=razor)
        // Override the animation-driven base uniform with the user's stored twist value
        uTwist: { value: gradient.twist !== undefined ? gradient.twist : 0.3 },
      };
      break;

    case 'four-corners':
      fragmentShader = fourCornersGradientShader;
      additionalUniforms = {
        angle: { value: gradient.angle || 0 }, // Base rotation angle
        scale: { value: (gradient.scale || 1) * (gradient.scaleBoost || 1) },
        complexity: { value: gradient.twist !== undefined ? gradient.twist : 0.5 }, // twist = Corner Spread (0-1)
      };
      break;

    default:
      fragmentShader = linearGradientShader;
      additionalUniforms = { angle: { value: 0 } };
  }

  // Wrap fragment shader with mask support
  fragmentShader = wrapShaderWithMask(fragmentShader);

  // CACHE-BUSTING: Add unique comment to force Three.js to recompile shader when texture type changes
  // This prevents Three.js from reusing a cached shader program that might not have the new texture code
  const textureTypeComment = texture ? `// TEXTURE_TYPE_${getTextureTypeValue(texture.type)}\n` : '';
  fragmentShader = textureTypeComment + fragmentShader;

  // CRITICAL: Force GPU program cache invalidation by adding unique defines
  const shaderDefines: { [key: string]: string } = {};
  if (texture) {
    shaderDefines[`TEXTURE_TYPE_${Math.floor(getTextureTypeValue(texture.type))}`] = '1';
  }

  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { ...baseUniforms, ...additionalUniforms },
    defines: shaderDefines, // This forces Three.js to create a new program cache entry
    transparent: true,
    premultipliedAlpha: false, // Use straight alpha for clean masking edges
    depthWrite: false, // Important for proper layer opacity blending
  });
}

function getTextureTypeValue(type: string): number {
  switch (type) {
    case 'grain':
      return 0.0;
    case 'noise':
      return 1.0;
    case 'dots':
      return 2.0;
    case 'lines':
      return 3.0;
    case 'organic':
      return 4.0;
    case 'camoShadows':
      return 5.0;
    case 'linearGlass':
      return 6.0;
    case 'frostedGlass':
      return 7.0;
    case 'blockGlass':
      return 8.0;
    case 'fractalGlass':
      return 9.0;
    case 'heatMelt':
      return 10.0;
    case 'waveSignal':
      return 11.0;
    case 'topography':
      return 12.0;
    case 'plasma':
      return 13.0;
    case 'shape-pattern':
      return 14.0;
    case 'spackle':
      return 15.0;
    case 'grunge':
      return 16.0;
    default:
      return 0.0;
  }
}

function getBlendModeValue(blendMode: string): number {
  switch (blendMode) {
    case 'normal':
      return 0.0;
    case 'multiply':
      return 1.0;
    case 'screen':
      return 2.0;
    case 'overlay':
      return 3.0;
    case 'soft-light':
      return 4.0;
    case 'hard-light':
      return 5.0;
    default:
      return 0.0;
  }
}

// Generate CSS gradient string
export function generateCSSGradient(gradient: GradientConfig): string {
  const colorStops = gradient.colors
    .map(c => `${c.color} ${(c.position * 100).toFixed(1)}%`)
    .join(', ');

  switch (gradient.type) {
    case 'linear':
      return `linear-gradient(${gradient.angle || 0}deg, ${colorStops})`;
    
    case 'radial':
      const cx = ((gradient.centerX || 0.5) * 100).toFixed(1);
      const cy = ((gradient.centerY || 0.5) * 100).toFixed(1);
      return `radial-gradient(circle at ${cx}% ${cy}%, ${colorStops})`;
    
    case 'conic':
      const ccx = ((gradient.centerX || 0.5) * 100).toFixed(1);
      const ccy = ((gradient.centerY || 0.5) * 100).toFixed(1);
      return `conic-gradient(from 0deg at ${ccx}% ${ccy}%, ${colorStops})`;
    
    case 'voronoi':
      // CSS approximation - use radial gradient
      return `radial-gradient(circle, ${colorStops})`;
    
    case 'diamond':
      // CSS approximation - use conic gradient
      return `conic-gradient(${colorStops})`;
    
    default:
      return `linear-gradient(180deg, ${colorStops})`;
  }
}

// Generate CSS from multiple layers
export function generateCSSFromLayers(layers: Layer[]): string {
  const visibleLayers = layers.filter(l => l.visible && l.gradient);
  if (visibleLayers.length === 0) return '';
  
  if (visibleLayers.length === 1) {
    return `background: ${generateCSSGradient(visibleLayers[0].gradient!)};`;
  }
  
  // Multiple layers - create a comma-separated list
  const gradients = visibleLayers.map(layer => generateCSSGradient(layer.gradient!));
  return `background: ${gradients.join(', ')};`;
}

// Helper function to sort color stops by position
function sortColorStops(colors: { color: string, position: number }[]): { color: string, position: number }[] {
  return colors.slice().sort((a, b) => a.position - b.position);
}