import { SHARED_FUNCTIONS } from './gradientShaders';
import { SHARED_ANIMATION_HELPERS } from './animationHelpers';

// PLASMA GRADIENT SHADER
// Creates flowing, psychedelic interference patterns using multiple sine wave combinations
// Produces smooth, organic motion with customizable octaves and twist

export const plasmaGradientShader = `
  precision highp float;

  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform float intensity;
  uniform float time;
  uniform float textureTime;
  uniform float textureAnimationType;
  
  // Plasma-specific uniforms
  uniform float scale;       // Wave frequency (how tight the patterns are)
  uniform int octaves;       // Number of wave layers (1-8)
  uniform float twist;       // Radial twist distortion from center
  
  // Texture uniforms
  uniform float hasTexture;
  uniform float textureType;
  uniform float textureIntensity;
  uniform float textureScale;
  uniform float textureOpacity;
  uniform float blur;
  uniform float distortion;
  uniform float textureAngle;
  uniform float blendMode;
  uniform float gridSize;
  uniform float complexity;
  uniform float chromaticShift;
  uniform float layerOpacity;

  // Texture-specific parameters
  uniform float ridgeCount;
  uniform float ridgeIrregularity;
  uniform float blockIrregularity;
  uniform float turbulence;
  uniform float waveCount;
  uniform float colorIntensity;
  uniform float elevationShift;
  uniform float lineThickness;

  // Animation uniforms
  uniform float uRotation;
  uniform float uScale;
  uniform float uDriftX;
  uniform float uDriftY;
  uniform float uPulse;
  uniform float uTurbulence;
  uniform float uTwist;
  uniform float angle; // Base rotation from user slider (degrees)
  uniform float uHueRotation;
  
  // Interactive mode uniforms
  uniform float mouseX;
  uniform float mouseY;
  uniform float mouseIntensity;
  
  // Interactive warp displacement
  uniform sampler2D uDisplacementMap;
  uniform float uDisplacementStrength;

  // NOTE: uPatternTexture and uInvertTexture are declared inside SHARED_FUNCTIONS below.
  // DO NOT redeclare them here — duplicate uniform declarations are a GLSL compile error
  // in WebGL (GLSL ES 1.00 / 3.00) and produce a completely black shader output.
  // This was the root cause of Plasma rendering as a black canvas.

  // SPRINT 3.1.0: shader-driven animation uniforms — Plasma had none of
  // these before, so Wave/Morph/Liquid/Vortex/Kaleidoscope/FractalZoom/
  // Turbulence/Ripple were a complete no-op.
  uniform float uAnimPhase;
  uniform float uAnimEased;
  uniform float uAnimTime;
  uniform float uAnimIntensity;
  uniform float uAnimType;

  varying vec2 vUv;
  
  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}

  // Smooth interpolation between colors
  vec3 getGradientColor(float t) {
    t = clamp(t, 0.0, 1.0);
    
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      
      float pos0 = positions[i];
      float pos1 = positions[i + 1];
      
      if (t >= pos0 && t <= pos1) {
        float localT = (t - pos0) / (pos1 - pos0);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    
    return colors[0];
  }

  void main() {
    // Apply drift
    vec2 animatedUV = vUv + vec2(uDriftX, uDriftY);
    
    // Apply interactive warp displacement if active
    if (uDisplacementStrength > 0.001) {
      vec4 displacement = texture2D(uDisplacementMap, animatedUV);
      vec2 displacementVec = (displacement.rg - 0.5) * 2.0;
      animatedUV += displacementVec * uDisplacementStrength;
    }
    
    // Apply turbulence
    if (uTurbulence > 0.01) {
      animatedUV.x += noise(animatedUV * 5.0 + time) * uTurbulence * 0.05;
      animatedUV.y += noise(animatedUV * 5.0 - time) * uTurbulence * 0.05;
    }

    // SPRINT 3.1.0: shader-field animation — previously impossible, see above.
    animatedUV = applySharedAnimationField(animatedUV, vec2(0.5), angle, 1.0);
    
    // Center coordinates around (0, 0)
    vec2 centered = (animatedUV - 0.5) * 2.0;
    
    // Apply ROTATION (user base angle + animation rotation offset)
    float rotationRad = radians(angle + uRotation); // FIX: include base angle for rotation slider
    if (abs(rotationRad) > 0.001) {
      float cosRot = cos(rotationRad);
      float sinRot = sin(rotationRad);
      centered = vec2(
        centered.x * cosRot - centered.y * sinRot,
        centered.x * sinRot + centered.y * cosRot
      );
    }
    
    // Calculate total twist (static + animated)
    float totalTwist = twist + uTwist;
    
    // Apply TWIST effect - rotates coordinates based on distance from center
    if (abs(totalTwist) > 0.001) {
      float dist = length(centered);
      float angle = atan(centered.y, centered.x);
      angle += totalTwist * dist * 3.14159; // Radial twist
      centered = vec2(cos(angle), sin(angle)) * dist;
    }
    
    // Apply scale — the 'scale' uniform holds the full animated value (base * animation offset),
    // updated each frame by the GradientCanvas animation loop via:
    //   material.uniforms.scale.value = newState.currentScale * scaleBoost
    // Do NOT multiply by uScale here: that would double-apply the scale and make
    // the pattern appear 2.5-6x tighter than the slider intends.
    vec2 scaledUV = centered * scale;
    
    // Time-based animation for flowing motion
    float t = time * 0.5;
    
    // SINGLE CONTROLLED DOMAIN WARP for liquid effect
    vec2 warp = vec2(
      noise(scaledUV * 0.7 + vec2(t * 0.3, t * 0.2)),
      noise(scaledUV * 0.7 + vec2(t * 0.2, -t * 0.3) + 100.0)
    );
    
    vec2 warp2 = vec2(
      noise(scaledUV * 1.3 + warp * 1.5 + vec2(-t * 0.4, t * 0.5)),
      noise(scaledUV * 1.3 + warp * 1.5 + vec2(t * 0.5, t * 0.4) + 200.0)
    );
    
    // Apply consistent warping
    vec2 warped = scaledUV + warp * 2.2 + warp2 * 1.6;
    
    // COMPLEXITY CONTROLS PATTERN FREQUENCY AND CONTRAST
    // Low complexity = broad smooth gradients
    // High complexity = sharper, tighter patterns with more color boundaries
    
    // Scale frequency based on complexity
    float frequencyScale = 0.8 + float(octaves) * 0.25; // Range: 1.05 to 2.8
    
    // Generate base plasma using noise at complexity-dependent frequency
    float n1 = noise(warped * frequencyScale + vec2(t * 0.4, t * 0.3));
    float n2 = noise(warped * frequencyScale * 1.3 + vec2(-t * 0.3, t * 0.4) + 50.0);
    
    // Combine the two noise sources for richer patterns
    float plasma = (n1 + n2) * 0.5;
    
    // COMPLEXITY CONTROLS CONTRAST/SHARPNESS
    // Low complexity = smooth gradients
    // High complexity = sharper color boundaries
    float contrastPower = 1.0 + float(octaves) * 0.15; // Range: 1.15 to 2.2
    
    // Normalize to 0-1 range
    plasma = plasma * 0.5 + 0.5;
    
    // Apply contrast based on complexity
    // Higher contrast = more defined color regions
    plasma = pow(plasma, contrastPower);
    plasma = plasma * 2.0 - 1.0; // Expand range
    plasma = plasma * 0.5 + 0.5; // Re-normalize
    
    // Clamp to ensure valid range
    plasma = clamp(plasma, 0.0, 1.0);
    
    // Map plasma value to gradient colors and apply intensity + pulse
    vec3 color = getGradientColor(plasma) * intensity * uPulse;
    
    // Apply texture overlay if enabled
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);
      
      // Apply RGB dithering when textures are active to prevent banding artifacts
      vec3 rgbDither = vec3(
        fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(93.9898, 67.345))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(41.321, 89.123))) * 43758.5453123)
      );
      rgbDither = (rgbDither - 0.5) / 255.0;
      color += rgbDither;
    }
    
    // Apply hue rotation animation if active
    if (abs(uHueRotation) > 0.01) {
      color = applyHueRotation(color, uHueRotation);
    }
    
    gl_FragColor = vec4(color, layerOpacity);
  }
`;