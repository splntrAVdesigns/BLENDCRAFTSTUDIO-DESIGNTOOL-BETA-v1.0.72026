// CACHE_BUST_ROTATION_ANGLE_UNIFORM_20260503_152000
// FOUR_CORNERS_ROTATION_USES_ANGLE_PLUS_UROTATION_PATTERN
import { SHARED_FUNCTIONS } from './gradientShaders';
import { SHARED_ANIMATION_HELPERS } from './animationHelpers';

// MARBLE/VEINS GRADIENT SHADER
// Organic stone texture with flowing veins using turbulence + domain warping
export const marbleGradientShader = `
  precision highp float;

  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform float intensity;
  uniform float time;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float angle;
  uniform float scale;
  uniform int octaves; // Vein Intensity: 1-8
  uniform float complexity; // Flow complexity
  
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
  uniform float uHueRotation;

  // NEW: Shader-driven animation uniforms
  uniform float uAnimPhase;
  uniform float uAnimEased;
  uniform float uAnimTime;
  uniform float uAnimIntensity;
  uniform float uAnimType;

  // Interactive mode uniforms
  uniform float mouseX;
  uniform float mouseY;
  uniform float mouseIntensity;
  
  // Interactive warp displacement
  uniform sampler2D uDisplacementMap;
  uniform float uDisplacementStrength;
  
  varying vec2 vUv;
  
  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}

  vec3 getGradientColor(float t) {
    t = clamp(t, 0.0, 1.0);
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      float pos0 = positions[i];
      float pos1 = positions[i + 1];
      if (t >= pos0 && t <= pos1) {
        float localT = (pos1 > pos0) ? (t - pos0) / (pos1 - pos0) : 0.0;
        localT = smoothstep(0.0, 1.0, localT);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return (t < positions[0]) ? colors[0] : colors[colorCount - 1];
  }

  // Fractal Brownian Motion for organic turbulence
  float fbm(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    
    for (int i = 0; i < 8; i++) {
      if (i >= octaves) break;
      value += amplitude * noise(p * frequency);
      frequency *= 2.0;
      amplitude *= 0.5;
    }
    
    return value;
  }

  void main() {
    // Apply drift
    vec2 animatedUV = vUv + vec2(uDriftX, uDriftY);
    
    // Apply interactive displacement
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
    
    // Center coordinates
    vec2 centered = (animatedUV - 0.5) * 2.0;
    
    // Apply rotation (flow direction)
    float rotationRad = radians(angle + uRotation);
    float cosRot = cos(rotationRad);
    float sinRot = sin(rotationRad);
    centered = vec2(
      centered.x * cosRot - centered.y * sinRot,
      centered.x * sinRot + centered.y * cosRot
    );
    
    // Apply scale
    vec2 scaledUV = centered * scale * uScale;
    
    // Flow complexity affects domain warping strength
    float warpStrength = 0.3 + complexity * 0.15; // Range: 0.3 to 1.5
    
    // Create directional flow field for veins
    vec2 flowDir = vec2(1.0, 0.3); // Main vein direction
    float flowNoise = fbm(scaledUV * 2.0 + time * 0.1, 3);
    vec2 flowOffset = flowDir * flowNoise * warpStrength;
    
    // Apply domain warping for organic distortion
    vec2 warp1 = vec2(
      fbm(scaledUV + flowOffset, 3),
      fbm(scaledUV + flowOffset + 100.0, 3)
    );
    
    vec2 warp2 = vec2(
      fbm(scaledUV + warp1 * warpStrength + time * 0.05, 4),
      fbm(scaledUV + warp1 * warpStrength + time * 0.05 + 200.0, 4)
    );
    
    vec2 warpedUV = scaledUV + warp1 * warpStrength * 0.5 + warp2 * warpStrength;
    
    // Vein intensity controls turbulence layers
    int veinLayers = octaves;
    
    // Create base marble pattern with layered turbulence
    float marble = fbm(warpedUV * 3.0, veinLayers);
    
    // Add sharp veins using sine waves with turbulent displacement
    float veinPattern = sin(warpedUV.x * 8.0 + marble * 5.0) * 0.5 + 0.5;
    
    // Add secondary veins at different frequency
    float vein2 = sin(warpedUV.y * 6.0 + marble * 4.0) * 0.3 + 0.5;
    
    // Combine patterns
    float t = marble * 0.6 + veinPattern * 0.3 + vein2 * 0.1;
    
    // Normalize to 0-1 range
    t = fract(t);
    
    // Smooth the transitions for natural stone look
    t = smoothstep(0.1, 0.9, t);
    
    vec3 color = getGradientColor(t) * intensity * uPulse;
    
    // Apply texture overlay if enabled
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);
      
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

// CONCENTRIC/RINGS GRADIENT SHADER
// Circular ripple patterns from center or multiple points
export const concentricGradientShader = `
  precision highp float;

  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform float intensity;
  uniform float time;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float scale;
  uniform int octaves; // Ring Count: 1-8
  uniform float complexity; // Wave modulation: 0-8
  uniform float angle; // Rotation slider (degrees)
  
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
  uniform float uHueRotation;
  uniform vec2 center;

  // NEW: Shader-driven animation uniforms
  uniform float uAnimPhase;
  uniform float uAnimEased;
  uniform float uAnimTime;
  uniform float uAnimIntensity;
  uniform float uAnimType;

  // Interactive mode uniforms
  uniform float mouseX;
  uniform float mouseY;
  uniform float mouseIntensity;
  
  // Interactive warp displacement
  uniform sampler2D uDisplacementMap;
  uniform float uDisplacementStrength;
  
  varying vec2 vUv;
  
  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}

  vec3 getGradientColor(float t) {
    t = clamp(t, 0.0, 1.0);
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      float pos0 = positions[i];
      float pos1 = positions[i + 1];
      if (t >= pos0 && t <= pos1) {
        float localT = (pos1 > pos0) ? (t - pos0) / (pos1 - pos0) : 0.0;
        localT = smoothstep(0.0, 1.0, localT);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return (t < positions[0]) ? colors[0] : colors[colorCount - 1];
  }

  void main() {
    // Apply drift
    vec2 animatedUV = vUv + vec2(uDriftX, uDriftY);
    
    // Apply interactive displacement
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
    
    // Apply mouse interaction to center
    vec2 interactiveCenter = center + vec2(mouseX, mouseY) * 0.5 * mouseIntensity;

    // Apply rotation around the center point (Rotation slider + animation)
    vec2 toCenter = animatedUV - interactiveCenter;
    float totalAngle = radians(angle + uRotation);
    if (abs(totalAngle) > 0.001) {
      float cosA = cos(totalAngle);
      float sinA = sin(totalAngle);
      toCenter = vec2(
        toCenter.x * cosA - toCenter.y * sinA,
        toCenter.x * sinA + toCenter.y * cosA
      );
    }
    float dist = length(toCenter);
    
    // Ring count controls frequency
    float ringFrequency = 3.0 + float(octaves) * 2.0; // Range: 5 to 19
    
    // Apply scale
    dist *= scale * uScale;
    
    // Create basic ripple pattern
    float ripple = dist * ringFrequency;
    
    // Wave modulation (complexity) adds organic variation
    if (complexity > 0.1) {
      float waveNoise = noise(toCenter * 5.0 + time * 0.3) * complexity * 0.2;
      ripple += waveNoise;
    }
    
    // Add animated ripple waves (like water ripples)
    float timeWave = time * 2.0;
    ripple += sin(dist * 10.0 - timeWave) * 0.1 * uPulse;
    
    // Convert to gradient coordinate
    float t = fract(ripple);
    
    // Smooth transitions for natural ripple effect
    t = smoothstep(0.0, 1.0, t);
    
    vec3 color = getGradientColor(t) * intensity * uPulse;
    
    // Apply texture overlay if enabled
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);
      
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

// RADIAL WAVES GRADIENT SHADER
// Expanding circular waves with multiple sources and interference patterns
export const radialWavesGradientShader = `
  precision highp float;

  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform float intensity;
  uniform float time;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float scale;
  uniform int octaves; // Wave Count: 1-5
  uniform float frequency; // Speed: wave expansion speed
  uniform float complexity; // Decay: how quickly waves fade
  uniform float angle; // Base rotation (Rotation slider)
  uniform float centerX; // Wave origin X
  uniform float centerY; // Wave origin Y
  
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
  uniform float uHueRotation;

  // NEW: Shader-driven animation uniforms
  uniform float uAnimPhase;
  uniform float uAnimEased;
  uniform float uAnimTime;
  uniform float uAnimIntensity;
  uniform float uAnimType;

  // Interactive mode uniforms
  uniform float mouseX;
  uniform float mouseY;
  uniform float mouseIntensity;
  
  // Interactive warp displacement
  uniform sampler2D uDisplacementMap;
  uniform float uDisplacementStrength;
  
  varying vec2 vUv;
  
  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}

  vec3 getGradientColor(float t) {
    t = clamp(t, 0.0, 1.0);
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      float pos0 = positions[i];
      float pos1 = positions[i + 1];
      if (t >= pos0 && t <= pos1) {
        float localT = (pos1 > pos0) ? (t - pos0) / (pos1 - pos0) : 0.0;
        localT = smoothstep(0.0, 1.0, localT);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return (t < positions[0]) ? colors[0] : colors[colorCount - 1];
  }

  // Hash function for wave source positions
  float hash(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  void main() {
    // Apply drift
    vec2 animatedUV = vUv + vec2(uDriftX, uDriftY);
    
    // Apply interactive displacement
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
    
    // Use centerX and centerY for main wave origin
    vec2 mainCenter = vec2(centerX, centerY);

    // Apply rotation (angle slider + animation uRotation) around the wave center
    float totalRotation = radians(angle + uRotation);
    if (abs(totalRotation) > 0.001) {
      vec2 centered = animatedUV - mainCenter;
      float cosA = cos(totalRotation);
      float sinA = sin(totalRotation);
      animatedUV = vec2(
        centered.x * cosA - centered.y * sinA,
        centered.x * sinA + centered.y * cosA
      ) + mainCenter;
    }
    
    // Wave count (1-5 sources)
    int numWaveSources = clamp(octaves, 1, 5);

    // Wave speed (frequency controls expansion rate)
    float waveSpeed = frequency * 0.5; // Range: 0.5 to 2.5

    // Decay rate (complexity controls fade)
    float decayRate = 0.5 + complexity * 0.1; // Range: 0.5 to 1.3

    // Accumulate wave interference
    float waveSum = 0.0;
    float weightSum = 0.0;

    // Generate multiple wave sources distributed around main center
    for (int i = 0; i < 5; i++) {
      if (i >= numWaveSources) break;

      // First wave source is at the exact center point
      vec2 waveCenter;
      if (i == 0) {
        waveCenter = mainCenter;
      } else {
        // Additional wave sources orbit around the main center
        float angle = float(i) * 6.28318 / float(numWaveSources - 1) + time * 0.1;
        float radius = 0.2 + hash(float(i)) * 0.15;
        waveCenter = mainCenter + vec2(
          cos(angle) * radius,
          sin(angle) * radius
        );
      }
      
      // Calculate distance from this wave source
      float dist = length(animatedUV - waveCenter) * scale * uScale;
      
      // Animated expanding wave with decay
      float expandingTime = time * waveSpeed;
      float wave = sin(dist * 10.0 - expandingTime * 3.0);
      
      // Apply decay based on distance
      float decay = exp(-dist * decayRate);
      
      // Accumulate with decay weight
      waveSum += wave * decay;
      weightSum += decay;
    }
    
    // Normalize by total weight
    float t = weightSum > 0.0 ? waveSum / weightSum : 0.0;
    
    // Map to 0-1 range
    t = t * 0.5 + 0.5;
    
    // Smooth the transitions
    t = smoothstep(0.0, 1.0, t);
    
    vec3 color = getGradientColor(t) * intensity * uPulse;
    
    // Apply texture overlay if enabled
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);
      
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

// MANDALA GRADIENT SHADER
// Symmetrical radial patterns with abstract sacred geometry
export const mandalaGradientShader = `
  precision highp float;

  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform float intensity;
  uniform float time;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float angle;
  uniform float scale;
  uniform int segments; // Radial symmetry segments: 3-16
  uniform int octaves; // Layers: 1-8, concentric layers of patterns
  uniform float complexity; // Pattern complexity/detail
  
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
  uniform float uHueRotation;

  // NEW: Shader-driven animation uniforms
  uniform float uAnimPhase;
  uniform float uAnimEased;
  uniform float uAnimTime;
  uniform float uAnimIntensity;
  uniform float uAnimType;

  // Interactive mode uniforms
  uniform float mouseX;
  uniform float mouseY;
  uniform float mouseIntensity;
  
  // Interactive warp displacement
  uniform sampler2D uDisplacementMap;
  uniform float uDisplacementStrength;
  
  varying vec2 vUv;
  
  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}

  vec3 getGradientColor(float t) {
    t = clamp(t, 0.0, 1.0);
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      float pos0 = positions[i];
      float pos1 = positions[i + 1];
      if (t >= pos0 && t <= pos1) {
        float localT = (pos1 > pos0) ? (t - pos0) / (pos1 - pos0) : 0.0;
        localT = smoothstep(0.0, 1.0, localT);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return (t < positions[0]) ? colors[0] : colors[colorCount - 1];
  }

  void main() {
    // Apply drift
    vec2 animatedUV = vUv + vec2(uDriftX, uDriftY);
    
    // Apply interactive displacement
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
    
    // Center coordinates
    vec2 centered = (animatedUV - 0.5) * 2.0;
    
    // Apply rotation (animated)
    float rotationRad = radians(angle + uRotation);
    float cosRot = cos(rotationRad);
    float sinRot = sin(rotationRad);
    centered = vec2(
      centered.x * cosRot - centered.y * sinRot,
      centered.x * sinRot + centered.y * cosRot
    );
    
    // Apply scale
    centered *= scale * uScale;

    // Convert to polar coordinates
    float radius = length(centered);
    float theta = atan(centered.y, centered.x);

    // Apply twist based on radial distance for spiral mandala effect
    if (abs(uTwist) > 0.01) {
      theta += uTwist * radius * 2.0;
    }

    // Apply radial symmetry (mirror reflection)
    float segmentAngle = 6.28318 / float(segments);
    float mirroredTheta = mod(theta, segmentAngle);
    
    // Mirror every other segment for kaleidoscope effect
    float segmentIndex = floor(theta / segmentAngle);
    if (mod(segmentIndex, 2.0) > 0.5) {
      mirroredTheta = segmentAngle - mirroredTheta;
    }
    
    // Reconstruct coordinates with symmetry
    vec2 symmetricPos = vec2(
      cos(mirroredTheta) * radius,
      sin(mirroredTheta) * radius
    );
    
    // Create layered concentric patterns
    float pattern = 0.0;
    float layerCount = float(octaves);
    
    for (int i = 0; i < 8; i++) {
      if (i >= octaves) break;
      
      float layer = float(i);
      float freq = 1.0 + layer * 0.5;
      
      // Radial component
      float radialPattern = sin(radius * freq * 10.0 + time * 0.5);
      
      // Angular component with symmetry
      float angularPattern = sin(mirroredTheta * freq * 5.0);
      
      // Combine with noise for organic feel
      float noisePattern = noise(symmetricPos * freq * 3.0 + time * 0.2);
      
      // Weight by layer (inner layers more prominent)
      float weight = 1.0 - (layer / layerCount) * 0.5;
      
      pattern += (radialPattern * angularPattern + noisePattern * complexity * 0.3) * weight;
    }
    
    // Normalize pattern
    pattern = pattern / layerCount;
    
    // Map to 0-1 range
    float t = pattern * 0.5 + 0.5;
    t = fract(t);
    
    // Smooth transitions
    t = smoothstep(0.0, 1.0, t);
    
    vec3 color = getGradientColor(t) * intensity * uPulse;
    
    // Apply texture overlay if enabled
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);
      
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

// STARBURST GRADIENT SHADER
// Radial star/sunburst pattern with configurable rays and sharpness
export const starburstGradientShader = `
  precision highp float;

  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform float intensity;
  uniform float time;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform vec2 center;
  uniform float angle;
  uniform float scale;
  uniform int segments;
  uniform float uTwist;
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

  uniform float uRotation;
  uniform float uScale;
  uniform float uDriftX;
  uniform float uDriftY;
  uniform float uPulse;
  uniform float uTurbulence;
  uniform float uHueRotation;
  uniform float animationSpeed;
  uniform float complexity;

  // NEW: Shader-driven animation uniforms
  uniform float uAnimPhase;
  uniform float uAnimEased;
  uniform float uAnimTime;
  uniform float uAnimIntensity;
  uniform float uAnimType;
  uniform float mouseX;
  uniform float mouseY;
  uniform float mouseIntensity;
  uniform sampler2D uDisplacementMap;
  uniform float uDisplacementStrength;

  varying vec2 vUv;

  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}

  vec3 getGradientColor(float t) {
    t = clamp(t, 0.0, 1.0);
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      float p0 = positions[i];
      float p1 = positions[i + 1];
      if (t >= p0 && t <= p1) {
        float lt = (t - p0) / max(p1 - p0, 0.0001);
        lt = smoothstep(0.0, 1.0, lt);
        return mix(colors[i], colors[i + 1], lt);
      }
    }
    return (t < positions[0]) ? colors[0] : colors[colorCount - 1];
  }

  float sampleStarburstT(vec2 uvIn) {
    vec2 d = uvIn - center;
    float dist = length(d);
    float theta = atan(d.y, d.x) + radians(angle + uRotation);

    // Apply twist based on radial distance for spiral burst effect
    if (abs(uTwist) > 0.01) {
      theta += uTwist * dist * 3.0;
    }

    dist = dist / max(scale * 0.7 * uScale, 0.0001);
    float segCount = max(float(segments), 3.0);
    float ray = 0.5 + 0.5 * cos(theta * segCount);
    float rings = 0.5 + 0.5 * sin(dist * (8.0 + segCount * 0.35) - time * 0.18);
    float t = mix(ray, rings, 0.34);

    if (uTurbulence > 0.01) {
      float n = noise(uvIn * 7.0 + time * 0.15) - 0.5;
      t = clamp(t + n * uTurbulence * 0.02, 0.0, 1.0);
    }

    return clamp(t, 0.0, 1.0);
  }

  void main() {
    vec2 aa = max(fwidth(vUv) * 0.26, vec2(0.00018));
    float t0 = sampleStarburstT(vUv);
    float t1 = sampleStarburstT(clamp(vUv + vec2(aa.x, 0.0), 0.0, 1.0));
    float t2 = sampleStarburstT(clamp(vUv + vec2(-aa.x, 0.0), 0.0, 1.0));
    float t3 = sampleStarburstT(clamp(vUv + vec2(0.0, aa.y), 0.0, 1.0));
    float t4 = sampleStarburstT(clamp(vUv + vec2(0.0, -aa.y), 0.0, 1.0));
    float t = mixWrapped(mixWrapped(t0, mixWrapped(t1, t2, 0.5), 0.14), mixWrapped(t3, t4, 0.5), 0.14);

    vec3 color = getGradientColor(t);

    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);
    }

    if (abs(uHueRotation) > 0.01) {
      color = applyHueRotation(color, uHueRotation);
    }

    gl_FragColor = vec4(color, layerOpacity);
  }
`;

// FOUR CORNERS GRADIENT SHADER v2.1 - CACHE BUST 2026-05-03
// Bilinear mesh gradient blending colors from each corner
export const fourCornersGradientShader = `
  precision highp float;
  // COLOR_PALETTE_FIX_V2_1 - Force shader recompilation

  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform float intensity;
  uniform float time;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float angle;
  uniform float scale;
  uniform float complexity; // Corner Spread: controls displacement from exact corners (0-1)

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
  uniform float uHueRotation;

  // NEW: Shader-driven animation uniforms
  uniform float uAnimPhase;
  uniform float uAnimEased;
  uniform float uAnimTime;
  uniform float uAnimIntensity;
  uniform float uAnimType;

  // Interactive mode uniforms
  uniform float mouseX;
  uniform float mouseY;
  uniform float mouseIntensity;

  // Interactive warp displacement
  uniform sampler2D uDisplacementMap;
  uniform float uDisplacementStrength;

  varying vec2 vUv;

  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}

  vec3 getGradientColor(float t) {
    t = clamp(t, 0.0, 1.0);
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      float pos0 = positions[i];
      float pos1 = positions[i + 1];
      if (t >= pos0 && t <= pos1) {
        float localT = (pos1 > pos0) ? (t - pos0) / (pos1 - pos0) : 0.0;
        localT = smoothstep(0.0, 1.0, localT);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return (t < positions[0]) ? colors[0] : colors[colorCount - 1];
  }

  void main() {
    vec2 center = vec2(0.5);

    // Start with base UV
    vec2 uv = vUv;

    // Apply drift
    uv += vec2(uDriftX, uDriftY);

    // Apply interactive displacement
    if (uDisplacementStrength > 0.001) {
      vec4 displacement = texture2D(uDisplacementMap, uv);
      vec2 displacementVec = (displacement.rg - 0.5) * 2.0;
      uv += displacementVec * uDisplacementStrength;
    }

    // Apply turbulence
    if (uTurbulence > 0.01) {
      uv.x += noise(uv * 5.0 + time) * uTurbulence * 0.05;
      uv.y += noise(uv * 5.0 - time) * uTurbulence * 0.05;
    }

    // Apply scale (zoom from center) - do this BEFORE rotation
    vec2 scaledUV = (uv - center) / (scale * uScale) + center;

    // Corner Spread: controls how far corner colors extend toward edges
    // 0.0 = corners at canvas edges  |  1.0 = corners pushed outward beyond canvas
    float spread = clamp(complexity, 0.0, 1.0);

    // Corner offset: how far to push corners outward from canvas edges
    // spread = 0.0 → offset = 0.0 (corners at 0,0 / 1,0 / 0,1 / 1,1)
    // spread = 1.0 → offset = 0.35 (corners pushed outward to extend color coverage)
    float edgeOffset = spread * 0.35;

    // Small random variation for organic feel
    float organicVar = 0.015;

    // Define 4 corner BASE positions - pushed OUTWARD when spread is high
    // This makes corner colors extend MORE toward edges (better for zoomed-out scenarios)
    vec2 c1Base = vec2(
      0.0 - edgeOffset + organicVar * noise(vec2(1.0, 1.1)),
      0.0 - edgeOffset + organicVar * noise(vec2(1.1, 1.2))
    ); // Top-left
    vec2 c2Base = vec2(
      1.0 + edgeOffset - organicVar * noise(vec2(2.0, 2.1)),
      0.0 - edgeOffset + organicVar * noise(vec2(2.1, 2.2))
    ); // Top-right
    vec2 c3Base = vec2(
      0.0 - edgeOffset + organicVar * noise(vec2(3.0, 3.1)),
      1.0 + edgeOffset - organicVar * noise(vec2(3.1, 3.2))
    ); // Bottom-left
    vec2 c4Base = vec2(
      1.0 + edgeOffset - organicVar * noise(vec2(4.0, 4.1)),
      1.0 + edgeOffset - organicVar * noise(vec2(4.1, 4.2))
    ); // Bottom-right

    // ROTATION: Rotate the corner positions around center
    // This makes rotation visually obvious - the entire corner layout rotates
    // Combine base angle with animation offset
    float rotRad = radians(angle + uRotation);
    float cosR = cos(rotRad);
    float sinR = sin(rotRad);

    // Rotate each corner position around center
    vec2 c1Offset = c1Base - center;
    vec2 c1 = vec2(
      c1Offset.x * cosR - c1Offset.y * sinR,
      c1Offset.x * sinR + c1Offset.y * cosR
    ) + center;

    vec2 c2Offset = c2Base - center;
    vec2 c2 = vec2(
      c2Offset.x * cosR - c2Offset.y * sinR,
      c2Offset.x * sinR + c2Offset.y * cosR
    ) + center;

    vec2 c3Offset = c3Base - center;
    vec2 c3 = vec2(
      c3Offset.x * cosR - c3Offset.y * sinR,
      c3Offset.x * sinR + c3Offset.y * cosR
    ) + center;

    vec2 c4Offset = c4Base - center;
    vec2 c4 = vec2(
      c4Offset.x * cosR - c4Offset.y * sinR,
      c4Offset.x * sinR + c4Offset.y * cosR
    ) + center;

    // Calculate distance from current pixel to each corner
    float d1 = length(scaledUV - c1);
    float d2 = length(scaledUV - c2);
    float d3 = length(scaledUV - c3);
    float d4 = length(scaledUV - c4);

    // Inverse distance weighting for smooth mesh blending
    // Fixed blend power for consistent soft mesh gradient
    float blendPower = 2.0;

    float w1 = 1.0 / pow(d1 + 0.01, blendPower);
    float w2 = 1.0 / pow(d2 + 0.01, blendPower);
    float w3 = 1.0 / pow(d3 + 0.01, blendPower);
    float w4 = 1.0 / pow(d4 + 0.01, blendPower);

    // Normalize weights so they sum to 1.0
    float totalWeight = w1 + w2 + w3 + w4;
    w1 /= totalWeight;
    w2 /= totalWeight;
    w3 /= totalWeight;
    w4 /= totalWeight;

    // DEBUG: Sample 4 corner colors DIRECTLY from the colors array
    // This ensures we get the exact palette colors without interpolation
    // Corner mapping: TL=color1, TR=color2, BL=color3, BR=color4
    vec3 color1, color2, color3, color4;

    // CRITICAL FIX: Always use the direct color values from the palette
    // Don't use getGradientColor() which interpolates - we want exact colors
    color1 = colors[0];  // Top-left corner

    if (colorCount >= 2) {
      color2 = colors[1];  // Top-right corner
    } else {
      color2 = colors[0];
    }

    if (colorCount >= 3) {
      color3 = colors[2];  // Bottom-left corner
    } else {
      color3 = colorCount >= 2 ? colors[1] : colors[0];
    }

    if (colorCount >= 4) {
      color4 = colors[3];  // Bottom-right corner
    } else if (colorCount >= 3) {
      color4 = colors[2];
    } else if (colorCount >= 2) {
      color4 = colors[0];  // Diagonal opposite of color2
    } else {
      color4 = colors[0];
    }

    // Weighted blend based on distance from each corner
    vec3 color = color1 * w1 + color2 * w2 + color3 * w3 + color4 * w4;

    color *= intensity * uPulse;

    // Apply texture overlay if enabled
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);

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
;