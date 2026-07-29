// CACHE_BUST_1746326400000_PHASE5_COMPLETE
// FINAL_CACHE_BUST_ALL_UNIFORMS_FIXED
// WebGL shader code for various gradient types
import { SHARED_ANIMATION_HELPERS } from './animationHelpers';

// CRITICAL CACHE BUST: 2026-05-03-FOUR-CORNERS-FIX
export const SHADER_VERSION_TIMESTAMP = '2026-06-12-PATTERN-TEXTURE2D-FALLBACK-V1';

export const vertexShader = `
  precision highp float;
  precision highp int;
  varying vec2 vUv;
  
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Common texture functions to be included in all shaders
// SHADER VERSION: 3.2.3 - PATTERN TEXTURE FIX
export const SHARED_FUNCTIONS = `
  // STAGE 3.0.5b — AUDIO MOTION GLITCH (shared across every gradient type).
  // Declared here so all ~17 gradient shaders get it from one edit rather than
  // seventeen. uAudioGlitch is (0,0) whenever nothing routes to Motion, so
  // applyAudioGlitch is an identity no-op at rest and a non-audio frame is
  // byte-identical to before. Independent of uAnimType — this is Motion's OWN
  // effect, which is the whole point: it works on every gradient type and on
  // layers with no animation.
  uniform vec2 uAudioGlitch; // x = directional shove, y = slice/tear amount
  vec2 applyAudioGlitch(vec2 uv) {
    if (uAudioGlitch.x == 0.0 && uAudioGlitch.y == 0.0) return uv;
    // Directional shove: the field kicks on a beat.
    uv += vec2(uAudioGlitch.x, uAudioGlitch.x * 0.6);
    // Horizontal slice/tear: banded rows offset by a stepped pseudo-random
    // amount for a digital glitch feel, scaled by the slice component.
    float glitchBand = floor(uv.y * 12.0);
    uv.x += (fract(sin(glitchBand * 12.9898) * 43758.5453) - 0.5) * uAudioGlitch.y;
    return uv;
  }
  // Phase 5 quality contract: gradient interpolation, procedural noise and
  // subpixel mask transforms use high precision consistently in preview and export.
  precision highp float;
  precision highp int;

  // SHADER_CACHE_BUST_V3_2_3_FOUR_CORNERS_FIX_20260503 - Force browser to reload shader code NOW

  // CRITICAL: Pattern texture uniform must be declared FIRST before any functions
  // This is used by applyTexture() function below
  uniform sampler2D uPatternTexture;
  // AR correction for pattern texture (canvasWidth / canvasHeight).
  // Pattern is always baked on a 1024×1024 POT canvas; this uniform
  // stretches UV.x so shapes appear non-distorted on 16:9 canvases.
  uniform float uPatternAR;
  // Texture animation enable flag (needed by applyTexture)
  uniform float animateTexture;
  // LOD quality hint: 0=full (1080p+), 1=medium (720p), 2=low (540p)
  // Expensive texture types use this to skip costly samples at low resolutions.
  uniform float uTextureLOD;

  // Spackle invert toggle uniform (0=normal, 1=invert pattern)
  uniform float uInvertTexture;

  // Shape Pattern offset — applied inside fract() for seamless wrapping at any value.
  // Set from patternOffsetX / patternOffsetY sliders, normalized to [-0.5, 0.5] range.
  // Must be inside fract() — if applied outside, integer offsets produce no visible
  // change and fractional offsets create a hard discontinuity seam.
  uniform vec2 uPatternOffset;
  uniform float uPatternDensity;
  uniform float uPatternRandomRotation;
  uniform float uPatternAlternateFlip;
  uniform float uPatternStaggerRows;
  uniform float uPatternScaleVariance;
  uniform float uPatternOpacityCurve;
  uniform float uPatternOpacityCurveMode;

  // fbm4 — defined after noise() below

  // ── SPACKLE HELPERS ─────────────────────────────────────────────────────────
  vec2 spHash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }
  // Size-stratified spray cell (Option B architecture):
  // crisp dot field — elliptical, hard-edged, low GPU cost.
  float spackleCell(vec2 uv, float cellCount, float baseRad, float density, float seed) {
    vec2 sc  = uv * cellCount;
    vec2 iu  = floor(sc);
    vec2 fu  = fract(sc);
    float res = 0.0;
    for (int ii = -1; ii <= 1; ii++) {
      for (int jj = -1; jj <= 1; jj++) {
        vec2 b   = vec2(float(ii), float(jj));
        vec2 h   = spHash2(iu + b + seed);
        if (h.x < density) {
          vec2  r    = b + h * 0.80 + 0.10 - fu;
          float ang  = h.y * 6.2832;
          float cosA = cos(ang); float sinA = sin(ang);
          vec2  rRot = vec2(r.x*cosA - r.y*sinA, r.x*sinA + r.y*cosA);
          float sqA  = 0.55 + h.x * 0.45;          // ellipse squash 0.55-1.0
          float d    = length(vec2(rRot.x / sqA, rRot.y));
          float rad  = baseRad * (0.38 + h.y * 1.0); // varied sizes within tier
          float soft = rad * 0.04 + 0.001;            // crisp hard edge
          res = max(res, smoothstep(rad + soft, rad - soft, d));
        }
      }
    }
    return res;
  }

  // Cluster-weighted density: makes dots pile up in organic zones (Option A weighting).
  // clusterStrength 0=uniform, 1=heavy clustering. Uses 2 sin/cos — no noise().
  float spClusterWeight(vec2 uv, float seed, float strength) {
    float cx = sin(uv.x * 4.1 + seed * 1.7) * cos(uv.y * 3.7 - seed * 2.3);
    float cy = cos(uv.x * 5.3 - seed * 0.9) * sin(uv.y * 4.9 + seed * 1.1);
    float cluster = cx * cy * 0.5 + 0.5; // 0-1
    return mix(1.0, cluster * 1.8, strength); // 1.0 = uniform, higher = clustered
  }


  // Random function for grain
  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
  }

  // PHASE5_MARKER: This line forces shader recompilation
  const float PHASE5_SHADER_VERSION = 3.23;

  // Shared anti-alias helpers for hard procedural boundaries.
  float aaWidth(float v, float boost) {
    return max(fwidth(v) * boost, 0.0008);
  }

  float aaStep(float edge, float v, float boost) {
    float w = aaWidth(v, boost);
    return smoothstep(edge - w, edge + w, v);
  }

  float aaPulse(float v, float halfWidth, float boost) {
    float dist = abs(fract(v) - 0.5);
    float w = aaWidth(v, boost);
    return 1.0 - smoothstep(halfWidth - w, halfWidth + w, dist);
  }


  float wrapDelta(float a, float b) {
    float d = b - a;
    d -= floor(d + 0.5);
    return d;
  }

  float mixWrapped(float a, float b, float t) {
    return fract(a + wrapDelta(a, b) * t);
  }
  
  // Perlin-style noise
  float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    
    float a = fract(sin(dot(i, vec2(12.9898, 78.233))) * 43758.5453);
    float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(12.9898, 78.233))) * 43758.5453);
    float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
    float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
    
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }
  
  // HUE SHIFT ANIMATION HELPERS
  
  // Convert RGB to HSL
  vec3 rgb2hsl(vec3 color) {
    float maxVal = max(max(color.r, color.g), color.b);
    float minVal = min(min(color.r, color.g), color.b);
    float delta = maxVal - minVal;
    
    // Lightness
    float l = (maxVal + minVal) / 2.0;
    
    // Saturation
    float s = 0.0;
    if (delta > 0.0001) {
      s = l < 0.5 ? delta / (maxVal + minVal) : delta / (2.0 - maxVal - minVal);
    }
    
    // Hue
    float h = 0.0;
    if (delta > 0.0001) {
      if (maxVal == color.r) {
        h = (color.g - color.b) / delta + (color.g < color.b ? 6.0 : 0.0);
      } else if (maxVal == color.g) {
        h = (color.b - color.r) / delta + 2.0;
      } else {
        h = (color.r - color.g) / delta + 4.0;
      }
      h /= 6.0;
    }
    
    return vec3(h, s, l);
  }
  
  // Convert HSL to RGB
  vec3 hsl2rgb(vec3 hsl) {
    float h = hsl.x;
    float s = hsl.y;
    float l = hsl.z;
    
    float c = (1.0 - abs(2.0 * l - 1.0)) * s;
    float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
    float m = l - c / 2.0;
    
    vec3 rgb = vec3(0.0);
    if (h < 1.0 / 6.0) {
      rgb = vec3(c, x, 0.0);
    } else if (h < 2.0 / 6.0) {
      rgb = vec3(x, c, 0.0);
    } else if (h < 3.0 / 6.0) {
      rgb = vec3(0.0, c, x);
    } else if (h < 4.0 / 6.0) {
      rgb = vec3(0.0, x, c);
    } else if (h < 5.0 / 6.0) {
      rgb = vec3(x, 0.0, c);
    } else {
      rgb = vec3(c, 0.0, x);
    }
    
    return rgb + m;
  }
  
  // Apply hue rotation to a color (rotation in degrees 0-360)
  vec3 applyHueRotation(vec3 color, float rotation) {
    if (abs(rotation) < 0.01) return color; // Skip if no rotation
    
    vec3 hsl = rgb2hsl(color);
    hsl.x = mod(hsl.x + rotation / 360.0, 1.0); // Rotate hue and wrap around
    return hsl2rgb(hsl);
  }
  
  // INTERACTIVE WARP MODE - Displacement function
  vec2 applyDisplacement(vec2 uv, sampler2D displacementMap, float strength) {
    if (strength < 0.001) return uv; // Skip if no displacement
    
    // Sample displacement map (stored as RGB where R=X offset, G=Y offset, B=unused)
    vec3 displacement = texture2D(displacementMap, uv).rgb;
    
    // Convert from 0-1 range to -1 to +1 range (127/255 = 0.5 = neutral)
    vec2 offset = (displacement.rg - 0.5) * 2.0;
    
    // Apply displacement strength
    return uv + offset * strength;
  }
  
  // ENHANCED DOMAIN WARPING - Multi-octave noise distortion (PHASE 1)
  vec2 applyDomainWarp(vec2 uv, float intensity, float time, int octaves) {
    if (intensity < 0.001) return uv;
    
    vec2 warpedUV = uv;
    float amplitude = intensity * 0.1;
    float frequency = 2.0;
    
    for (int i = 0; i < 4; i++) {
      if (i >= octaves) break;
      
      // Layer noise with offset for X and Y
      float noiseX = noise(warpedUV * frequency + time * 0.1);
      float noiseY = noise(warpedUV * frequency + vec2(100.0, 100.0) + time * 0.1);
      
      // Apply feedback: use warped UV for next iteration
      warpedUV.x += (noiseX - 0.5) * amplitude;
      warpedUV.y += (noiseY - 0.5) * amplitude;
      
      // Increase frequency, decrease amplitude for finer details
      frequency *= 2.0;
      amplitude *= 0.5;
    }
    
    return warpedUV;
  }
  
  // GLASS TEXTURE HELPER FUNCTIONS
  
  // Fresnel calculation for edge lighting (glass effect)
  float calculateFresnel(vec2 uv, vec2 normalDirection, float ior) {
    // Create a pseudo-normal from the direction
    vec3 viewDir = normalize(vec3(uv - 0.5, 1.0));
    vec3 normal = normalize(vec3(normalDirection, 0.0));
    
    // Fresnel-Schlick approximation
    float cosTheta = abs(dot(viewDir, normal));
    float R0 = pow((1.0 - ior) / (1.0 + ior), 2.0);
    float fresnel = R0 + (1.0 - R0) * pow(1.0 - cosTheta, 5.0);
    
    return fresnel;
  }
  
  // Enhanced bevel calculation with proper depth and highlights
  vec3 applyBevelLighting(vec3 baseColor, float edgeGradient, float intensity, float blur) {
    // Separate highlight and shadow components
    float highlight = max(edgeGradient, 0.0) * intensity;
    float shadow = max(-edgeGradient, 0.0) * intensity;
    
    // Apply blur/softness
    float blurAmount = blur * 2.5;
    highlight = smoothstep(0.0, blurAmount, highlight) * smoothstep(blurAmount * 2.5, 0.0, highlight);
    shadow = smoothstep(0.0, blurAmount, shadow) * smoothstep(blurAmount * 2.5, 0.0, shadow);
    
    // Apply lighting
    vec3 result = baseColor;
    result += baseColor * highlight * 1.8; // Strong highlights
    result += vec3(1.0) * highlight * 0.4; // Add white edge highlights for glass effect
    result -= baseColor * shadow * 0.7; // Deep shadows
    
    return clamp(result, vec3(0.0), vec3(1.5)); // Allow some over-bright for glass
  }
  
  // DISTORTION PATTERNS - Warps UV for different glass types
  vec2 applyGlassDistortion(vec2 uv, float distortionAmount, float glassType, float time) {
    vec2 distorted = uv;
    
    if (distortionAmount < 0.01) return uv;
    
    if (glassType < 6.5) {
      // Type 6: Linear Glass - Sinusoidal waves along lines
      float wave = sin(uv.y * 20.0 + time * 0.5) * distortionAmount * 0.05;
      distorted.x += wave;
      
    } else if (glassType < 7.5) {
      // Type 7: Frosted Glass - Random organic distortion (NO radial pull)
      float noiseX = noise(uv * 15.0 + vec2(time * 0.1, 0.0));
      float noiseY = noise(uv * 15.0 + vec2(100.0, time * 0.1));
      
      // Add multi-scale noise for organic frosted variation
      noiseX += noise(uv * 35.0 + time * 0.05) * 0.5;
      noiseY += noise(uv * 35.0 + vec2(50.0, time * 0.05)) * 0.5;
      
      // Apply organic distortion without radial bias
      distorted.x += (noiseX - 0.5) * distortionAmount * 0.08;
      distorted.y += (noiseY - 0.5) * distortionAmount * 0.08;
      
    } else if (glassType < 8.5) {
      // Type 8: Block Glass - Subtle random offset per block (NO circular pinching)
      vec2 cellPos = fract(uv * 10.0);
      vec2 cellID = floor(uv * 10.0);
      
      // Random offset per cell for glass irregularity
      float offsetX = noise(cellID + vec2(0.0, 0.0));
      float offsetY = noise(cellID + vec2(100.0, 100.0));
      
      // Apply subtle per-block distortion without circular patterns
      distorted.x += (offsetX - 0.5) * distortionAmount * 0.03;
      distorted.y += (offsetY - 0.5) * distortionAmount * 0.03;
      
    } else if (glassType < 9.5) {
      // Type 9: Fractal Glass - Chaotic angular bending
      float noise1 = noise(uv * 8.0 + time * 0.2);
      float noise2 = noise(uv * 15.0 - time * 0.15);
      
      distorted.x += (noise1 - 0.5) * distortionAmount * 0.06;
      distorted.y += (noise2 - 0.5) * distortionAmount * 0.06;
      
    } else if (glassType < 10.5) {
      // Type 10: HeatMelt - Gravity-based melting flow
      float melt = noise(uv * 12.0 + vec2(time * 0.1, 0.0));
      distorted.y += melt * distortionAmount * 0.08; // Drip down
      distorted.x += sin(uv.y * 15.0 + time * 0.3) * distortionAmount * 0.02;
      
    } else if (glassType < 11.5) {
      // Type 11: Wave Signal - Animated wave interference
      float wave1 = sin(uv.x * 25.0 + time * 2.0);
      float wave2 = cos(uv.y * 20.0 - time * 1.5);
      distorted.x += wave1 * distortionAmount * 0.04;
      distorted.y += wave2 * distortionAmount * 0.04;
    }
    
    return distorted;
  }
  
  // EDGE DETECTION for inner bevel
  float calculateEdgeIntensity(float pattern, vec2 uv, float bevelSize) {
    float offset = 0.002 * bevelSize;
    
    // Sample surrounding pixels for edge detection
    float center = pattern;
    float top = step(0.5, fract((pattern + offset) * 100.0));
    float bottom = step(0.5, fract((pattern - offset) * 100.0));
    float left = step(0.5, fract((pattern + offset * 50.0) * 100.0));
    float right = step(0.5, fract((pattern - offset * 50.0) * 100.0));
    
    // Calculate edge magnitude
    float dx = abs(right - left);
    float dy = abs(top - bottom);
    
    return dx + dy;
  }
  
  // Shader-based blend modes
  vec3 applyBlendMode(vec3 base, vec3 texture, float blendMode, float opacity) {
    vec3 result;
    
    if (blendMode < 0.5) {
      // 0: Normal
      result = mix(base, texture, opacity);
    } else if (blendMode < 1.5) {
      // 1: Multiply
      result = mix(base, base * texture, opacity);
    } else if (blendMode < 2.5) {
      // 2: Screen
      result = mix(base, vec3(1.0) - (vec3(1.0) - base) * (vec3(1.0) - texture), opacity);
    } else if (blendMode < 3.5) {
      // 3: Overlay
      vec3 overlayResult;
      overlayResult.r = base.r < 0.5 ? 2.0*base.r*texture.r : 1.0-2.0*(1.0-base.r)*(1.0-texture.r);
      overlayResult.g = base.g < 0.5 ? 2.0*base.g*texture.g : 1.0-2.0*(1.0-base.g)*(1.0-texture.g);
      overlayResult.b = base.b < 0.5 ? 2.0*base.b*texture.b : 1.0-2.0*(1.0-base.b)*(1.0-texture.b);
      result = mix(base, overlayResult, opacity);
    } else if (blendMode < 4.5) {
      // 4: Soft Light
      vec3 softLightResult;
      for (int i = 0; i < 3; i++) {
        float b = i == 0 ? base.r : (i == 1 ? base.g : base.b);
        float t = i == 0 ? texture.r : (i == 1 ? texture.g : texture.b);
        float val = (t < 0.5) ? b - (1.0 - 2.0 * t) * b * (1.0 - b) : b + (2.0 * t - 1.0) * (sqrt(b) - b);
        if (i == 0) softLightResult.r = val;
        else if (i == 1) softLightResult.g = val;
        else softLightResult.b = val;
      }
      result = mix(base, softLightResult, opacity);
    } else if (blendMode < 5.5) {
      // 5: Hard Light
      vec3 hardLightResult;
      hardLightResult.r = texture.r < 0.5 ? 2.0*base.r*texture.r : 1.0-2.0*(1.0-base.r)*(1.0-texture.r);
      hardLightResult.g = texture.g < 0.5 ? 2.0*base.g*texture.g : 1.0-2.0*(1.0-base.g)*(1.0-texture.g);
      hardLightResult.b = texture.b < 0.5 ? 2.0*base.b*texture.b : 1.0-2.0*(1.0-base.b)*(1.0-texture.b);
      result = mix(base, hardLightResult, opacity);
    } else {
      // Default to normal
      result = mix(base, texture, opacity);
    }
    
    return result;
  }
  
  // Apply texture animation to UV coordinates
  // Motion families are intentionally distinct to avoid overlap between animation types.
  vec2 animateTextureUV(vec2 uv, float animationType, float time) {
    vec2 animatedUV = uv;
    
    if (animationType < 0.5) {
      // Type 0: SPIN - Balanced circular rotation around center
      vec2 centered = uv - 0.5;
      float angle = time * 1.8;
      float cosA = cos(angle);
      float sinA = sin(angle);
      animatedUV = vec2(
        centered.x * cosA - centered.y * sinA,
        centered.x * sinA + centered.y * cosA
      ) + 0.5;
      
    } else if (animationType < 1.5) {
      // Type 1: WARP - Organic distortion waves
      float warpX = sin(uv.y * 10.0 + time) * 0.05;
      float warpY = cos(uv.x * 10.0 + time * 0.95) * 0.05;
      animatedUV = uv + vec2(warpX, warpY);
      
    } else if (animationType < 2.5) {
      // Type 2: PING PONG - Back-and-forth motion
      float pingPong = sin(time) * 0.1;
      animatedUV = uv + vec2(pingPong, pingPong * 0.5);
      
    } else if (animationType < 3.5) {
      // Type 3: SCALE - Clean symmetric zoom pulse
      float scalePulse = 1.0 + sin(time * 1.05) * 0.18;
      vec2 centered = (uv - 0.5) * scalePulse;
      animatedUV = centered + 0.5;
      
    } else if (animationType < 4.5) {
      // Type 4: DRIFT - Smooth directional flow with light phase offset
      float phaseX = sin(uv.y * 2.4 + time * 0.45) * 0.012;
      float phaseY = cos(uv.x * 1.9 + time * 0.35) * 0.009;
      // STAGE 2.9.3: time * 0.05 grew without bound — after ~20s of playback
      // the sample point has walked a full canvas-width away, and after a
      // minute it's 3 widths out. Harmless while the destination is a
      // repeating pattern, destructive once it isn't.
      //
      // fract() bounds it to [0,1) WITHOUT changing the look: for a
      // repeat-wrapped texture, offsetting by a whole UV unit is identical to
      // not offsetting at all, so this is the same motion with the unbounded
      // growth removed. (Caveat: on a non-repeating source the wrap point
      // would be visible — media takes the bounded path in animationHelpers
      // instead, so it never reaches this branch.)
      animatedUV = uv + vec2(fract(time * 0.05) + phaseX, fract(time * 0.03) + phaseY);
      
    } else if (animationType < 5.5) {
      // Type 5: TECTONIC - Region-based plate shifting with subtle seam shear
      vec2 cellUv = uv * 4.0;
      vec2 cellId = floor(cellUv);
      vec2 localUv = fract(cellUv) - 0.5;
      float regionPhase = dot(cellId, vec2(12.9898, 78.233));
      vec2 plateDir = normalize(vec2(
        sin(regionPhase * 0.73),
        cos(regionPhase * 1.13)
      ));
      float plateMotion = sin(time * 0.55 + regionPhase) * 0.018;
      float secondaryMotion = sin(time * 0.27 + regionPhase * 1.7) * 0.010;
      float seamMask = smoothstep(0.34, 0.48, max(abs(localUv.x), abs(localUv.y)));
      vec2 seamShear = vec2(localUv.y, -localUv.x) * seamMask * sin(time * 0.8 + regionPhase) * 0.012;
      animatedUV = uv + plateDir * (plateMotion + secondaryMotion) + seamShear;
      
    } else if (animationType < 6.5) {
      // Type 6: BREATHING - Organic buoyant pulse, distinct from Scale
      float breathPhase = time * 1.15;
      float inhale = sin(breathPhase) * 0.5 + 0.5;
      inhale = inhale * inhale * (3.0 - 2.0 * inhale);
      float exhale = sin(breathPhase + 1.5708) * 0.5 + 0.5;
      exhale = exhale * exhale * (3.0 - 2.0 * exhale);
      vec2 centered = uv - 0.5;
      vec2 breatheScale = vec2(
        1.0 + (inhale - 0.5) * 0.08,
        1.0 + (exhale - 0.5) * 0.16
      );
      vec2 buoyancy = vec2(
        sin(time * 0.42) * 0.006,
        cos(time * 0.58) * 0.012
      );
      animatedUV = centered * breatheScale + 0.5 + buoyancy;
      
    } else if (animationType < 7.5) {
      // Type 7: SEISMIC - Radial wave patterns with damping
      vec2 center = vec2(0.5, 0.5);
      float dist = distance(uv, center);
      float waveFreq = 12.0;
      float waveSpeed = 3.0;
      float damping = smoothstep(0.0, 0.7, dist);
      float wave = sin(dist * waveFreq - time * waveSpeed);
      float harmonic = sin(dist * waveFreq * 1.5 - time * waveSpeed * 1.2) * 0.3;
      float waveOffset = (wave + harmonic) * 0.02 * (1.0 - damping * 0.5);
      vec2 direction = normalize(uv - center + vec2(0.0001));
      animatedUV = uv + direction * waveOffset;
      
    } else if (animationType < 8.5) {
      // Type 8: SHEAR - Layered directional slippage
      float shearA = sin(uv.y * 9.0 + time * 1.15) * 0.045;
      float shearB = sin(uv.y * 3.5 - time * 0.55) * 0.018;
      animatedUV = uv + vec2(shearA + shearB, cos(uv.x * 4.0 + time * 0.4) * 0.006);
      
    } else if (animationType < 9.5) {
      // Type 9: VORTEX - Continuous whirlpool field with wide throat, strong side pull, and smooth reversal.
      vec2 center = vec2(0.5, 0.5);
      vec2 p = uv - center;
      float r = max(length(p), 0.0001);
      vec2 radial = p / r;
      vec2 tangent = vec2(-radial.y, radial.x);
      float rNorm = clamp(r / 0.7071, 0.0, 1.0);

      float spinPhase = time * 1.95;
      float reversal = sin(time * 0.30);
      float spinDir = sign(reversal == 0.0 ? 1.0 : reversal) * smoothstep(0.12, 0.95, abs(reversal));

      float throatMask = smoothstep(0.030, 0.16, r);
      float coreRing = exp(-pow((r - 0.11) / 0.07, 2.0));
      float midRing = exp(-pow((r - 0.28) / 0.12, 2.0));
      float outerRing = exp(-pow((r - 0.54) / 0.18, 2.0));
      float edgeCarry = smoothstep(0.18, 1.0, rNorm);

      float arm1 = sin(dot(p, vec2( 6.4, -5.2)) * 1.35 - spinPhase * spinDir);
      float arm2 = cos(dot(p, vec2(-5.1, -6.0)) * 1.10 - spinPhase * 0.82 * spinDir);
      float arm3 = sin((r * 20.0) - spinPhase * 1.18 * spinDir);
      float armField = arm1 * 0.55 + arm2 * 0.45 + arm3 * 0.35;

      vec2 swirl = tangent * spinDir * (
        0.20 +
        0.90 * (1.0 - rNorm) +
        0.95 * midRing +
        0.55 * outerRing +
        0.12 * armField
      ) * (0.80 + edgeCarry * 0.95);

      vec2 inward = -radial * (
        0.05 +
        0.20 * (1.0 - rNorm) +
        0.34 * midRing +
        0.18 * outerRing
      ) * throatMask;

      vec2 spiralArms = normalize(tangent * spinDir * 1.45 - radial * 0.42) *
        (0.22 * midRing + 0.18 * outerRing + 0.10 * edgeCarry + 0.06 * armField);

      vec2 throatSpin = tangent * spinDir * 0.42 * coreRing * throatMask;
      vec2 micro = vec2(
        sin(p.y * 10.0 - spinPhase * 0.90),
        cos(p.x * 9.0 + spinPhase * 0.82)
      ) * 0.020 * (0.35 + midRing + outerRing * 0.4);

      animatedUV = uv + swirl + inward + spiralArms + throatSpin + micro;
      
    } else {
      // Type 10: FLUID - Organic water / psychedelic multi-directional motion
      vec2 centered = uv - 0.5;
      float r = length(centered);
      float swirlA = sin(uv.y * 7.5 + time * 0.95) * 0.020;
      float swirlB = cos(uv.x * 6.2 - time * 0.78) * 0.020;
      float ripple = sin((uv.x + uv.y) * 8.0 - time * 1.15 + r * 18.0) * 0.013;
      float bounce = cos(r * 22.0 - time * 1.35) * 0.010;
      vec2 crossFlow = vec2(
        swirlA + ripple,
        swirlB + bounce
      );
      vec2 recirculate = vec2(
        sin((uv.y - uv.x) * 9.0 + time * 0.62),
        cos((uv.x + uv.y) * 8.5 - time * 0.58)
      ) * 0.012;
      vec2 basinPull = centered * (sin(time * 0.44 + r * 12.0) * -0.018);
      animatedUV = uv + crossFlow + recirculate + basinPull;
    }
    
    return animatedUV;
  }
  
  // Apply texture overlay based on type
  // PHASE5_CACHE_REFRESH: textureAngle is separate from gradient angle to prevent conflicts
  // ── GRUNGE HELPER ─── defined HERE so it comes AFTER noise() ────────────────
  // 4-octave unrolled FBM (fractal Brownian motion). Unrolled for GLSL ES 1.00
  // compatibility (no variable loop bounds). noise() must be defined first.
  float fbm4(vec2 p) {
    float v = 0.0;
    v += 0.5000 * noise(p); p = p * 2.13 + vec2(5.2, 1.3);
    v += 0.2500 * noise(p); p = p * 2.13 + vec2(5.2, 1.3);
    v += 0.1250 * noise(p); p = p * 2.13 + vec2(5.2, 1.3);
    v += 0.0625 * noise(p);
    return v;
  }


  vec3 applyTexture(vec3 color, vec2 uv, float textureType, float scale, float intensity, float time, float blur, float distortion, float textureAngle, float blendMode, float opacity, float gridSize, float complexity, float chromaticShift, float animationType, float ridgeCount, float ridgeIrregularity, float blockIrregularity, float turbulence, float waveCount, float colorIntensity, float elevationShift, float lineThickness) {
    // Apply animation to UV BEFORE texture sampling
    vec2 animatedUV = animateTextureUV(uv, animationType, time);
    
    vec3 textureColor = color;
    
    if (textureType < 0.5) { {
      // Type 0: Grain - FIXED: scale affects density; clamp ensures no black artifacts
      float grainTime = time * 0.18 + sin(dot(animatedUV, vec2(17.0, 29.0)) + time * 0.12) * 0.15;
      // Pixel-space high-frequency grain: one deterministic sample per output
      // pixel. This avoids UV/hash precision blocks at 1080p/4K and preserves
      // crisp film grain in lossless PNG exports.
      vec2 grainPixel = floor(gl_FragCoord.xy * max(scale, 0.125));
      float grain = random(grainPixel + grainTime * 97.0) * 2.0 - 1.0;
      // FIX: clamp prevents dark gradients going pure-black when grain * intensity * 0.15
      // drives a component below 0. Mix with base color at max 0.9 opacity so gradient
      // always shows through and grain is a true overlay, never a replacement.
      vec3 grainColor = color + vec3(grain) * intensity * 0.15;
      textureColor = mix(color, max(vec3(0.0), grainColor), min(opacity, 0.92)); }
    } else if (textureType < 1.5) { {
      // Type 1: Noise
      float n = noise(animatedUV * scale * 10.0);
      textureColor = mix(color, color * (0.5 + n * 0.5), intensity); }
    } else if (textureType < 2.5) { {
      // Type 2: Dots - Fixed: Use original UV to prevent bent pattern
      // Dots should form a straight grid, rotation can be added later if needed
      vec2 pos = fract(uv * scale * 20.0) - 0.5;
      float d = length(pos);
      float dots = smoothstep(0.25, 0.2, d);
      textureColor = mix(color, color * 0.5, dots * intensity); }
    } else if (textureType < 3.5) { {
      // Type 3: Lines - with angle rotation support (use original UV for straight lines)
      float angleRad = radians(textureAngle);
      vec2 rotatedUV = vec2(
        uv.x * cos(angleRad) - uv.y * sin(angleRad),
        uv.x * sin(angleRad) + uv.y * cos(angleRad)
      );
      float lineField = rotatedUV.x * scale * 30.0;
      float lines = aaPulse(lineField, 0.18, 1.5);
      textureColor = mix(color, color * 0.7, lines * intensity); }
    } else if (textureType < 4.5) { {
      // Type 4: Organic (FIXED: No time offset - animation comes from animatedUV)
      float n = sin(animatedUV.x * scale * 10.0) * cos(animatedUV.y * scale * 10.0);
      n += sin(length(animatedUV * scale * 5.0)) * 0.5;
      n = n * 0.5 + 0.5;
      textureColor = mix(color, color * (0.7 + n * 0.3), intensity); }
    } else if (textureType < 5.5) { {
      // Type 5: Camo Shadows - organic shadowy pattern with angle rotation
      // Apply angle rotation to UV coordinates
      float angleRad = radians(textureAngle);
      vec2 rotatedUV = vec2(
        animatedUV.x * cos(angleRad) - animatedUV.y * sin(angleRad),
        animatedUV.x * sin(angleRad) + animatedUV.y * cos(angleRad)
      );
      
      float camoNoise1 = noise(rotatedUV * scale * 8.0);
      float camoNoise2 = noise(rotatedUV * scale * 15.0);
      float camoNoise3 = noise(rotatedUV * scale * 25.0);
      
      // Combine multiple noise layers for organic camo effect
      float camo = camoNoise1 * 0.5 + camoNoise2 * 0.3 + camoNoise3 * 0.2;
      camo = smoothstep(0.3, 0.7, camo);
      
      // Create shadow-like darkening
      float shadow = 1.0 - camo * 0.6;
      textureColor = color * shadow;
      textureColor = mix(color, textureColor, intensity); }
    } else if (textureType < 6.5) { {
      // Type 6: Linear Glass - FIXED: Animation support + ridgeCount/ridgeIrregularity

      // STEP 1: Apply distortion (FIXED: No time offset - animation comes from animatedUV)
      vec2 distortedUV = animatedUV;
      if (distortion > 0.01) {
        float wave = sin(animatedUV.y * 20.0) * distortion * 0.05;
        distortedUV.x += wave;
      }

      // STEP 2: Create line pattern (vertical ridges)
      float rad = radians(textureAngle);
      vec2 dir = vec2(cos(rad), sin(rad));
      vec2 perpDir = vec2(-dir.y, dir.x);

      float perpDist = dot(distortedUV, perpDir);

      // Ridge count controls number of ridges (5-50 range)
      float effectiveRidgeCount = mix(5.0, 50.0, ridgeCount / 50.0);
      float lineFreq = effectiveRidgeCount * scale;

      // Ridge irregularity adds organic variation (0-100 range)
      float irregularity = ridgeIrregularity / 100.0;
      if (irregularity > 0.01) {
        float irregNoise = noise(distortedUV * 10.0) * irregularity * 2.0;
        perpDist += irregNoise;
      }

      float linePattern = sin(perpDist * lineFreq);
      
      // STEP 3: Calculate surface normal for Fresnel
      vec2 normalDir = perpDir * cos(linePattern * 3.14159);
      float fresnel = calculateFresnel(animatedUV, normalDir, 1.5); // Glass IOR ~1.5
      
      // STEP 4: Detect edges for inner bevel
      float edgeOffset = 0.015 * scale; // SCALE controls bevel width
      float lineTop = sin((perpDist + edgeOffset) * lineFreq);
      float lineBottom = sin((perpDist - edgeOffset) * lineFreq);
      
      // Calculate edge gradients (for highlight/shadow)
      float edgeGradient = (lineTop - lineBottom) * 2.0; // Enhanced depth
      
      // STEP 5: Apply enhanced bevel lighting with Fresnel
      textureColor = applyBevelLighting(color, edgeGradient, intensity, blur);
      
      // STEP 6: Add Fresnel edge glow
      textureColor += vec3(1.0) * fresnel * intensity * 0.3;
      
      textureColor = clamp(textureColor, vec3(0.0), vec3(1.5));
       }
    } else if (textureType < 7.5) { {
      // Type 7: Frosted Glass - COMPLETELY REBUILT: ULTRA VISIBLE, working controls
      
      // STEP 1: STRONG distortion (FIXED: No time offset - animation comes from animatedUV)
      vec2 distortedUV = animatedUV + vec2(
        noise(animatedUV * 5.0) - 0.5,
        noise(animatedUV * 5.0 + vec2(100.0, 100.0)) - 0.5
      ) * distortion * 1.2; // STRONGER distortion
      
      // STEP 2: EXTREME scale range (50x multiplier for zoom-out)
      vec2 noiseUV = distortedUV * scale * 50.0; // EXTREME: 50x for microscopic detail
      
      // STEP 3: Cellular pattern — LOD-aware octave count.
      // LOD 0 (1080p+): 6 octaves for maximum detail.
      // LOD 1-2 (720p/540p): 3 unrolled octaves — half the noise calls,
      // no visible quality loss at those resolutions.
      float frostedPattern = 0.0;
      if (uTextureLOD < 0.5) {
        // Full quality — 6 octaves
        float amp = 1.0;
        for (int i = 0; i < 6; i++) {
          frostedPattern += noise(noiseUV) * amp;
          noiseUV *= 2.0;
          amp *= 0.5;
        }
      } else {
        // Reduced — 3 unrolled octaves (half cost, same visual at 540p/720p)
        frostedPattern += noise(noiseUV) * 0.500; noiseUV *= 2.0;
        frostedPattern += noise(noiseUV) * 0.250; noiseUV *= 2.0;
        frostedPattern += noise(noiseUV) * 0.125;
      }
      frostedPattern = frostedPattern * 0.5 + 0.5;
      
      // STEP 4: BLUR - ACTUALLY BLURS the pattern (0% = sharp cells, 100% = soft smooth)
      float blurredPattern = frostedPattern;
      if (blur > 0.01) {
        // Multi-sample blur
        float blurRadius = blur * 0.1;
        vec2 blurUV = distortedUV * scale * 50.0;
        blurredPattern = frostedPattern;
        blurredPattern += noise(blurUV + vec2(blurRadius, 0.0)) * 0.5 + 0.5;
        blurredPattern += noise(blurUV + vec2(-blurRadius, 0.0)) * 0.5 + 0.5;
        blurredPattern += noise(blurUV + vec2(0.0, blurRadius)) * 0.5 + 0.5;
        blurredPattern += noise(blurUV + vec2(0.0, -blurRadius)) * 0.5 + 0.5;
        blurredPattern /= 5.0;
      }
      
      // Mix sharp and blurred based on blur slider
      float finalPattern = mix(frostedPattern, blurredPattern, blur);
      
      // STEP 5: Calculate HEIGHT-BASED normals for proper beveling
      float heightOffset = 0.02;
      float heightCenter = finalPattern;
      float heightRight = noise(distortedUV * scale * 50.0 + vec2(heightOffset, 0.0)) * 0.5 + 0.5;
      float heightUp = noise(distortedUV * scale * 50.0 + vec2(0.0, heightOffset)) * 0.5 + 0.5;
      
      float gradX = (heightRight - heightCenter) / heightOffset;
      float gradY = (heightUp - heightCenter) / heightOffset;
      vec3 surfaceNormal = normalize(vec3(-gradX * 15.0, -gradY * 15.0, 1.0));
      
      // STEP 6: ULTRA-VISIBLE BASE PATTERN (not controlled by intensity!)
      textureColor = color * (0.4 + finalPattern * 1.2); // EXTREME contrast for visibility
      
      // STEP 7: BEVEL INTENSITY - Creates 3D raised cells with highlights/shadows
      // Directional lighting (45° from top-left)
      vec3 lightDir = normalize(vec3(0.7, 0.7, 1.0));
      float ndotl = dot(surfaceNormal, lightDir);
      float bevelLighting = ndotl * 0.5 + 0.5;
      
      // STRONGER bevel effect with better contrast (FIXED: More responsive to intensity slider)
      float bevelStrength = intensity * 1.5; // Increased from 0.8 to 1.5 for better visibility
      textureColor += color * (bevelLighting - 0.5) * bevelStrength;
      
      // Specular highlights on raised areas
      float specular = pow(max(ndotl, 0.0), 3.0);
      textureColor += vec3(1.0) * specular * intensity * 0.4; // Increased from 0.2 to 0.4
      
      // STEP 8: Subtle fresnel rim
      vec2 normalDir2D = normalize(vec2(gradX, gradY));
      float fresnel = calculateFresnel(animatedUV, normalDir2D, 1.52);
      textureColor += vec3(1.0) * fresnel * 0.15;
      
      textureColor = clamp(textureColor, vec3(0.0), vec3(2.0));
       }
    } else if (textureType < 8.5) { {
      // Type 8: Block Glass - FIXED: Now animates correctly + blockIrregularity

      // STEP 1: STRONGER distortion (FIXED: No time offset - animation comes from animatedUV)
      vec2 distortedUV = animatedUV + vec2(
        noise(animatedUV * 5.0) - 0.5,
        noise(animatedUV * 5.0 + vec2(50.0, 50.0)) - 0.5
      ) * distortion * 0.4;

      // STEP 2: SEPARATED Grid Size and Scale
      // gridSize = number of cells (independent)
      // scale = bevel width and detail level (MUCH STRONGER)
      float cellCount = gridSize * (0.5 + scale * 2.5); // FIXED: Scale multiplies cell count (2.5x effect)

      // Block irregularity adds size variation per cell (0-100 range)
      float irregularity = blockIrregularity / 100.0;
      vec2 adjustedUV = distortedUV;
      if (irregularity > 0.01) {
        // Per-cell size variation
        vec2 tempCellID = floor(distortedUV * cellCount);
        float sizeVariation = (noise(tempCellID * 3.0) - 0.5) * irregularity * 0.4;
        adjustedUV = distortedUV * (1.0 + sizeVariation);
      }

      vec2 cellPos = adjustedUV * cellCount;
      vec2 cellID = floor(cellPos);
      vec2 cellUV = fract(cellPos);
      
      // STEP 3: Create grid edges with SCALE-controlled bevel width
      vec2 distToEdge = min(cellUV, 1.0 - cellUV);
      float linePattern = min(distToEdge.x, distToEdge.y);
      
      // STEP 4: Add per-block color variation (subtle rainbow tint)
      vec3 blockVariation = vec3(
        noise(cellID) * 0.15,
        noise(cellID + vec2(10.0, 20.0)) * 0.12,
        noise(cellID + vec2(30.0, 40.0)) * 0.18
      );
      
      // STEP 5: Calculate surface normal for Fresnel
      vec2 normalDir = vec2(
        sign(cellUV.x - 0.5) * (1.0 - 2.0 * distToEdge.x),
        sign(cellUV.y - 0.5) * (1.0 - 2.0 * distToEdge.y)
      );
      float fresnel = calculateFresnel(uv, normalize(normalDir), 1.5);
      
      // STEP 6: SCALE-controlled bevel width and BLUR-controlled edge softness
      float bevelWidth = 0.005 + scale * 0.035; // FIXED: Much stronger scale effect (0.015 -> 0.035)
      float blurredEdge = blur * 0.1; // FIXED: Increased from 0.02 to 0.1 for visible blur effect
      float edgeIntensity = smoothstep(bevelWidth - blurredEdge, bevelWidth, linePattern) - 
                            smoothstep(bevelWidth, bevelWidth + blurredEdge, linePattern);
      
      // Calculate STRONG bevel gradient
      float bevelGradient = ((linePattern - bevelWidth) / (blurredEdge + 0.001)) * edgeIntensity;
      
      // STEP 7: FIXED - Intensity controls bevel depth, not overall brightness
      // Separate base color from bevel lighting
      float bevelDepth = intensity * 2.0; // Control how pronounced the 3D effect is
      vec3 bevelHighlight = vec3(1.0) * max(bevelGradient, 0.0) * bevelDepth; // White highlights
      vec3 bevelShadow = vec3(1.0) * max(-bevelGradient, 0.0) * bevelDepth * 0.7; // Darker shadows
      
      textureColor = color * (0.85 + length(blockVariation) * 0.3);
      textureColor += blockVariation; // Add subtle color variation
      textureColor += bevelHighlight;
      textureColor -= bevelShadow;
      
      // STEP 8: STRONGER Fresnel rim lighting
      textureColor += vec3(1.0) * fresnel * intensity * 0.5; // FIXED: 0.25 -> 0.5
      
      textureColor = clamp(textureColor, vec3(0.0), vec3(1.8));
       }
    } else if (textureType < 9.5) { {
      // Type 9: Fractal Glass - FIXED: Proper chromatic aberration, complexity works, uses animation
      
      // STEP 1: Apply distortion for organic glass warping (FIXED: No time offset)
      vec2 distortedUV = animatedUV + vec2(
        noise(animatedUV * 8.0) - 0.5,
        noise(animatedUV * 15.0) - 0.5
      ) * distortion * 0.06;
      
      // STEP 2: Create VORONOI-LIKE shattered glass cells (angular cracks)
      // Complexity now dramatically affects scale multiplier
      float complexityScale = 4.0 + complexity * 2.0; // 6.0-28.0 range (dramatic effect)
      vec2 scaledUV = distortedUV * scale * complexityScale;
      
      // Create fractal shatter pattern using Worley/Voronoi-style distance
      float minDist1 = 10.0;
      float minDist2 = 10.0;
      vec2 nearestPoint = vec2(0.0);
      
      // FIXED: Complexity controls shard count (more visible effect)
      float sampleCount = 2.0 + complexity * 1.5; // 3.5-14 points
      
      for (float i = 0.0; i < 12.0; i++) {
        if (i >= sampleCount) break;
        
        // Generate random point in each cell
        vec2 cellOffset = vec2(
          noise(scaledUV + vec2(i * 47.3, i * 23.7)),
          noise(scaledUV + vec2(i * 91.5, i * 67.2))
        );
        
        vec2 point = floor(scaledUV) + cellOffset + vec2(i * 0.3);
        float dist = length(scaledUV - point);
        
        // Track two closest points for crack detection
        if (dist < minDist1) {
          minDist2 = minDist1;
          minDist1 = dist;
          nearestPoint = point;
        } else if (dist < minDist2) {
          minDist2 = dist;
        }
      }
      
      // STEP 3: Create angular glass cracks (where two cells meet)
      float crackPattern = abs(minDist1 - minDist2); // Distance between closest points
      float shardEdges = smoothstep(0.0, 0.08, crackPattern); // Crack width
      
      // Calculate surface normal from nearest point direction
      vec2 normalDir = normalize(scaledUV - nearestPoint);
      
      // STEP 4: Calculate Fresnel for realistic glass reflection
      float fresnel = calculateFresnel(uv, normalDir, 1.5); // Glass IOR ~1.5
      
      // STEP 5: BLUR controls crack softness
      float blurredCrack = smoothstep(0.0, 0.15 + blur * 0.4, shardEdges);
      
      // STEP 6: BEVEL creates 3D depth at cracks (controlled by intensity)
      float crackDepth = 1.0 - blurredCrack;
      vec3 bevelHighlight = color * crackDepth * intensity * 0.4;
      vec3 bevelShadow = color * (1.0 - crackDepth) * intensity * 0.2;
      
      // STEP 7: Base glass with per-shard variation (always visible)
      float shardBrightness = noise(nearestPoint) * 0.15 + 0.9;
      textureColor = color * shardBrightness;
      textureColor += bevelHighlight;
      textureColor -= bevelShadow;
      
      // STEP 8: CHROMATIC SHIFT - Prismatic rainbow effect (FIXED: proper dispersion)
      if (chromaticShift > 0.5) {
        // Create rainbow prismatic effect at crack edges
        float chromaticStrength = crackDepth * (chromaticShift / 20.0); // 0-100% -> 0-5x
        
        // Rainbow spectrum based on distance from crack
        float spectrumPhase = atan(normalDir.y, normalDir.x) * 0.5 + crackDepth * 3.0;
        
        vec3 prismaticColor = vec3(
          sin(spectrumPhase) * 0.5 + 0.5,           // Red channel
          sin(spectrumPhase + 2.094) * 0.5 + 0.5,   // Green (120° offset)
          sin(spectrumPhase + 4.189) * 0.5 + 0.5    // Blue (240° offset)
        );
        
        // Apply rainbow only at crack edges
        textureColor = mix(textureColor, textureColor * 0.7 + prismaticColor * 0.6, chromaticStrength);
      }
      
      // STEP 9: Add Fresnel highlights
      textureColor += vec3(1.0) * fresnel * 0.25;
      
      textureColor = clamp(textureColor, vec3(0.0), vec3(1.8));
       }
    } else if (textureType < 10.5) { {
      // Type 10: HeatMelt - Organic flow with 3D bevel and always-on liquid movement.
      // Preserves the original look (multi-octave noise flow + bevel highlights) but
      // adds a cheap always-on liquid undulation that makes the surface feel molten.
      // distortion → warp intensity  |  blur → boundary softness  |  intensity → bevel depth
      
      // STEP 1: Base UV with scale (animation comes from animatedUV)
      vec2 baseUV = animatedUV * scale;
      
      // STEP 2: Always-on liquid drip — 2 sin/cos pairs, near-zero GPU cost.
      // Baseline 0.022 is clearly visible at default settings without any distortion.
      // distortion slider amplifies up to 0.062 for heavy, dramatic melt.
      float hmLiqAmp = 0.022 + distortion * 0.040;
      baseUV += vec2(
        sin(baseUV.y * 4.1  + time * 0.18) * hmLiqAmp,
        cos(baseUV.x * 3.3  + time * 0.14) * hmLiqAmp * 1.6  // stronger vertical drip bias
      );
      
      // STEP 3: Distortion warp (user distortion slider)
      vec2 distortOffset = vec2(
        noise(baseUV * 4.0) - 0.5,
        noise(baseUV * 4.0 + vec2(100.0, 100.0)) - 0.5
      ) * distortion * 3.0;
      
      vec2 distortedUV = baseUV + distortOffset;
      
      // STEP 4: Multi-octave flow pattern
      float flow1 = noise(distortedUV * 10.0);
      float flow2 = noise(distortedUV * 20.0);
      float flow3 = noise(distortedUV * 40.0);
      
      float flowPattern = flow1 * 0.55 + flow2 * 0.3 + flow3 * 0.15;
      flowPattern = flowPattern * 0.5 + 0.5;
      
      // STEP 5: Blur (0% = sharp, 100% = very blurred)
      float sharpPattern = flowPattern;
      float blurredPattern = flowPattern;
      if (blur > 0.01) {
        float blurRadius = blur * 0.08;
        blurredPattern += noise(distortedUV * 10.0 + vec2(blurRadius, 0.0)) * 0.5 + 0.5;
        blurredPattern += noise(distortedUV * 10.0 + vec2(-blurRadius, 0.0)) * 0.5 + 0.5;
        blurredPattern += noise(distortedUV * 10.0 + vec2(0.0, blurRadius)) * 0.5 + 0.5;
        blurredPattern += noise(distortedUV * 10.0 + vec2(0.0, -blurRadius)) * 0.5 + 0.5;
        blurredPattern /= 5.0;
      }
      
      float finalPattern = mix(sharpPattern, blurredPattern, blur);
      finalPattern = mix(finalPattern, 0.5, blur * 0.5);
      
      // STEP 6: Height-based normals for bevel
      float heightOffset = 0.015;
      float heightCenter = finalPattern;
      float heightRight = noise(distortedUV * 10.0 + vec2(heightOffset, 0.0)) * 0.5 + 0.5;
      float heightUp    = noise(distortedUV * 10.0 + vec2(0.0, heightOffset)) * 0.5 + 0.5;
      float gradX = (heightRight - heightCenter) / heightOffset;
      float gradY = (heightUp    - heightCenter) / heightOffset;
      vec3 surfaceNormal = normalize(vec3(-gradX * 20.0, -gradY * 20.0, 1.0));
      
      // STEP 7: Base pattern colour
      textureColor = color * (0.6 + finalPattern * 0.8);
      
      // STEP 8: Bevel lighting
      if (intensity > 0.01) {
        vec3 lightDir = normalize(vec3(0.7, 0.7, 1.0));
        float ndotl = dot(surfaceNormal, lightDir);
        float bevelLighting = ndotl * 0.5 + 0.5;
        textureColor += color * (bevelLighting - 0.5) * intensity * 1.2;
        float specular = pow(max(ndotl, 0.0), 4.0);
        textureColor += vec3(1.0) * specular * intensity * 0.3;
      }
      
      textureColor = clamp(textureColor, vec3(0.0), vec3(1.6));
       }
    } else if (textureType < 11.5) { {
      // Type 11: Wave Signal - ENHANCED with animated interference patterns
      
      // STEP 1: Apply wave distortion (FIXED: Use animatedUV for spin, keep time for wave animation)
      vec2 distortedUV = animatedUV;
      if (distortion > 0.01) {
        float internalWaveTime = time * 0.6;
        float wave1 = sin(animatedUV.x * 25.0 + internalWaveTime * 2.0);
        float wave2 = cos(animatedUV.y * 20.0 - internalWaveTime * 1.5);
        distortedUV.x += wave1 * distortion * 0.04;
        distortedUV.y += wave2 * distortion * 0.04;
      }
      
      // STEP 2: Create animated wave interference pattern
      float rad = radians(textureAngle);
      vec2 dir = vec2(cos(rad), sin(rad));
      vec2 perpDir = vec2(-dir.y, dir.x);
      
      float perpDist = dot(distortedUV, perpDir);
      float lineFreq = scale * 25.0;
      
      // Add wave interference with time animation
      float wave1 = sin(perpDist * lineFreq + time * 2.0);
      float wave2 = sin(perpDist * lineFreq * 1.3 - time * 1.5);
      float linePattern = (wave1 + wave2 * 0.5) / 1.5;
      
      // STEP 3: Calculate surface normal for waves
      vec2 normalDir = perpDir * cos(linePattern * 3.14159);
      float fresnel = calculateFresnel(uv, normalDir, 1.33); // Water-like IOR
      
      // STEP 4: Detect edges with wave depth
      float edgeOffset = 0.018 * scale;
      float lineTop = sin((perpDist + edgeOffset) * lineFreq + time * 2.0) + 
                      sin((perpDist + edgeOffset) * lineFreq * 1.3 - time * 1.5) * 0.5;
      float lineBottom = sin((perpDist - edgeOffset) * lineFreq + time * 2.0) + 
                         sin((perpDist - edgeOffset) * lineFreq * 1.3 - time * 1.5) * 0.5;
      
      float edgeGradient = (lineTop - lineBottom) * 1.8;
      
      // STEP 5: Apply enhanced bevel with wave depth
      textureColor = applyBevelLighting(color, edgeGradient, intensity, blur);
      
      // STEP 6: Add Fresnel glow and wave shimmer
      textureColor += vec3(1.0) * fresnel * intensity * 0.25;
      
      // Add interference color shift
      float interference = sin(perpDist * lineFreq * 2.0 + time * 3.0) * 0.5 + 0.5;
      textureColor += color * interference * intensity * 0.15;
      
      textureColor = clamp(textureColor, vec3(0.0), vec3(1.5)); }
    } else if (textureType < 12.5) { {
      // ══════════════════════════════════════════════════════════════════
      // Type 12: Topography — Contour mapping
      // elevationShift  → "Band Spread": controls contour band density
      //                   0 = 3 wide bands (open terrain), 100 = 20+ tight bands (dense atlas)
      // lineThickness   → ALL line widths, extreme range
      // chromaticShift  → "Contour Fill": light/dark band alternation using gradient palette
      // complexity      → terrain detail octaves
      // distortion      → organic warp + liquid eddy amplitude

      // ── UV + always-on liquid eddies ─────────────────────────────────────
      vec2 tUV = animatedUV;
      vec2 tEddy = vec2(
        sin(tUV.y * 6.5 + time * 0.90) + sin((tUV.x + tUV.y) * 5.0 - time * 0.55),
        cos(tUV.x * 5.8 - time * 0.82) + sin((tUV.y - tUV.x) * 6.8 + time * 0.62)
      ) * (0.012 + distortion * 0.030);
      vec2 tDistUV = tUV + vec2(
        noise(tUV * 8.0 + time * 0.025) - 0.5,
        noise(tUV * 8.0 + vec2(100.0) + time * 0.025) - 0.5
      ) * distortion * 0.18 + tEddy;

      // ── Height map ────────────────────────────────────────────────────────
      float tDetail = clamp((complexity - 1.0) / 7.0, 0.0, 1.0);
      vec2 hUV = tDistUV * max(scale, 0.001) * 4.0;
      float hA = noise(hUV);
      float hB = noise(hUV * 2.0 + 17.3) * mix(0.20, 0.48, tDetail);
      float hC = noise(hUV * 4.0 + 37.1) * mix(0.04, 0.18, tDetail);
      float heightMap = clamp((hA + hB + hC) * 0.72, 0.0, 1.0);

      // ── Fixed contour band spacing ────────────────────────────────────────
      // majorInterval = 0.14 → ~7 major bands at default scale.
      // Terrain Detail (complexity) controls visual density organically
      // by adding more noise octaves — no separate band-count slider needed.
      float majorInterval = 0.14;
      float minorInterval = majorInterval * 0.50;

      // ── LINE THICKNESS ────────────────────────────────────────────────────
      float tThick = pow(clamp(lineThickness / 100.0, 0.0, 1.0), 0.55);
      float majorWidth = mix(0.0010, 0.140, tThick);
      float minorWidth = mix(0.0005, 0.050, tThick);

      // ── Contour line mask ─────────────────────────────────────────────────
      float majPhase = heightMap / max(majorInterval, 0.0001);
      float majDist  = min(fract(majPhase), 1.0 - fract(majPhase));
      float majAA    = aaWidth(majPhase, mix(0.6, 3.0, tThick));
      float majLine  = 1.0 - smoothstep(majorWidth * 0.7, majorWidth + majAA, majDist);

      float minPhase = heightMap / max(minorInterval, 0.0001);
      float minDist  = min(fract(minPhase), 1.0 - fract(minPhase));
      float minAA    = aaWidth(minPhase, mix(0.5, 2.2, tThick));
      float minLine  = 1.0 - smoothstep(minorWidth * 0.7, minorWidth + minAA, minDist);
      minLine *= mix(0.50, 0.90, tDetail) * (1.0 - majLine * 0.65);
      float lineMask = clamp(max(majLine, minLine), 0.0, 1.0);

      // ── CONTOUR FILL: light/dark band alternation using gradient palette ──
      // chromaticShift (0–100 mapped from slider 0–20 → 0–1):
      //   0%   = black lines on plain gradient (classic topographic map)
      //   100% = adjacent bands alternate between lightened/darkened gradient color
      //          ONLY the user's gradient palette is used — no foreign colors,
      //          no hue shifts, no channel math. Works identically on every palette.
      float fillAmt = clamp(chromaticShift / 20.0, 0.0, 1.0);

      // Which band are we in? Even bands = slightly lighter, odd bands = slightly darker.
      float bandIdx  = floor(heightMap / max(majorInterval, 0.0001));
      float isOdd    = mod(bandIdx, 2.0); // 0 for even bands, 1 for odd bands
      // Shadow/highlight multipliers — stay within palette, never introduce new colors
      float shadowMult = 0.72;    // odd bands: darken gradient
      float lightMult  = 1.18;    // even bands: lighten gradient (clamped below)
      float bandMult   = mix(lightMult, shadowMult, isOdd);
      vec3  bandColor  = clamp(color * bandMult, vec3(0.0), vec3(1.15));
      // Terrain: blend between plain gradient and banded version
      vec3 terrainColor = mix(color, bandColor, fillAmt * 0.85);

      // Lines: always black regardless of fill amount — ensures readability
      vec3 lineColor = vec3(0.0);

      // ── Composite ─────────────────────────────────────────────────────────
      textureColor = terrainColor;
      textureColor = mix(textureColor, lineColor, lineMask);
      textureColor = clamp(textureColor, vec3(0.0), vec3(1.10));
      textureColor = mix(color, textureColor, intensity);
       }
    } else if (textureType < 13.5) { {
      // Type 13: Plasma - Energy field with sine wave interference + dedicated parameters
      vec2 plasmaUV = animatedUV * scale;

      // FIXED: Use dedicated waveCount parameter (1-10 range)
      float effectiveWaveCount = clamp(waveCount, 1.0, 10.0);
      float plasma = 0.0;

      for (float i = 0.0; i < 10.0; i += 1.0) {
        if (i >= effectiveWaveCount) break;
        float freq = 2.0 + i * 1.5;
        float phase = time * (0.5 + i * 0.3);
        plasma += sin(plasmaUV.x * freq + phase);
        plasma += cos(plasmaUV.y * freq * 1.3 - phase * 0.8);
        plasma += sin((plasmaUV.x + plasmaUV.y) * freq * 0.7 + phase * 1.2);
      }

      plasma /= max(effectiveWaveCount * 3.0, 1.0);
      plasma = plasma * 0.5 + 0.5;

      // FIXED: Use dedicated turbulence parameter (0-100 range)
      float turbulenceAmount = turbulence / 100.0;
      if (turbulenceAmount > 0.01) {
        float plasmaInternalTime = time * 0.55;
        float turb1 = noise(plasmaUV * 5.0 + plasmaInternalTime * 0.3) * turbulenceAmount;
        float turb2 = noise(plasmaUV * 10.0 - plasmaInternalTime * 0.2) * turbulenceAmount * 0.5;
        plasma += turb1 + turb2;
        plasma = fract(plasma);
      }

      // FIXED: Use dedicated colorIntensity parameter (0-100 range)
      float colorSampling = clamp(colorIntensity / 100.0, 0.0, 1.0);
      
      // Create plasma effect by modulating the base color
      vec3 monochromeLayer = color * (0.5 + plasma * 0.5);
      
      // Create vibrant layer by shifting hue based on plasma value
      vec3 vibrantLayer = color;
      float hueShift = plasma * 360.0;
      vibrantLayer = applyHueRotation(vibrantLayer, hueShift);
      vibrantLayer *= (0.7 + plasma * 0.6);
      
      vec3 plasmaColor = mix(monochromeLayer, vibrantLayer, colorSampling);
      textureColor = mix(color, plasmaColor, intensity);
 }
    } else if (textureType < 14.5) { {
      // Type 14: Shape Pattern — Tiled geometric/symbol patterns
      // Architecture: 1×1 canvas (one shape per tile). Shader handles repetition
      // via scale. Tile boundary ALWAYS falls in the gap between shapes at any
      // scale value — seams are structurally impossible.
      // AR correction: Y UV divided by uPatternAR → square tiles on 16:9 canvas.

      // ── UV tiling — three fixes applied together ──────────────────────────
      //
      // FIX 1 — Center-origin scaling:
      //   Old: uv.x * scale           → anchor at corner (0,0), expands right/down
      //   New: (uv.x - 0.5) * scale + 0.5 → anchor at canvas center, expands equally
      //
      // FIX 2 — Default tile count (UI 1.00x = 2×2 grid):
      //   BASE_TILES = 2.0 so scale=1.0 produces 2 tiles per axis.
      //   Scale values: 1.00x→2×2, 2.00x→4×4, 0.50x→1×1.
      //   The raw slider number is unchanged — only the internal mapping shifts.
      //
      // FIX 3 — Offset uniforms (sliders were silently ignored before):
      //   uPatternOffset is declared above and set from patternOffsetX/Y sliders
      //   (normalized to [-0.5, 0.5] in the renderer).
      //   CRITICAL: offset is applied to tiledUV BEFORE sampling — RepeatWrapping
      //   wraps any UV value correctly, so the offset takes effect seamlessly.
      //
      // uPatternAR = canvasWidth / canvasHeight (e.g. 1.778 for 16:9).
      // Y UV divided by AR → tiles stay square on any canvas aspect ratio.

      float ar = max(uPatternAR, 0.001);
      const float BASE_TILES = 2.0;

      // Density is shader-side so users can increase/decrease repetition without
      // re-baking the shape texture. 50% = neutral; 0% = sparse; 100% = dense.
      float densityMul = pow(2.0, (clamp(uPatternDensity, 0.0, 100.0) - 50.0) / 25.0);
      float effectiveScale = scale * densityMul;

      vec2 tiledUV = vec2(
        (uv.x - 0.5) * effectiveScale * BASE_TILES       + 0.5 + uPatternOffset.x,
        (uv.y - 0.5) * effectiveScale * BASE_TILES / ar  + 0.5 + uPatternOffset.y
      );

      if (uPatternStaggerRows > 0.001) {
        float row = floor(tiledUV.y);
        float oddRow = mod(row, 2.0);
        // Stagger shifts tiledUV.x by 0.5 at every row boundary.
        // This creates a UV derivative discontinuity exactly at integer Y values —
        // the GPU sees a huge dFdx/dFdy spike and selects a coarse mipmap for
        // those boundary pixels, producing a dark seam line across the pattern.
        // We clamp the effective derivative so the mip selection stays at the
        // base level regardless of the per-row X shift.
        tiledUV.x += oddRow * 0.5 * clamp(uPatternStaggerRows / 100.0, 0.0, 1.0);
      }

      // Explicit derivative clamp for pattern texture sampling.
      // Stagger (above) and scale-variance (below) both create UV discontinuities
      // at tile boundaries. dFdx/dFdy spike → coarse mip → seam line.
      // We compute derivatives of the UNshifted tiledUV (before per-cell transforms)
      // and clamp them to a single-texel budget so the sampler always picks the
      // base mip at boundary pixels.
      vec2 patternDdx = dFdx(tiledUV);
      vec2 patternDdy = dFdy(tiledUV);
      float maxDeriv = 1.0; // 1 texel budget — prevents coarse-mip at boundaries
      patternDdx = clamp(patternDdx, -maxDeriv, maxDeriv);
      patternDdy = clamp(patternDdy, -maxDeriv, maxDeriv);

      vec2 patternUV = tiledUV;

      // Advanced per-cell transforms. Deterministic hash = stable randomization
      // with no frame-to-frame flicker.
      //
      // PATCH M2A.1:
      // Alternate tile flip must transform the glyph sample inside each cell, not
      // create a new tiled coordinate that crosses hard integer boundaries. Sampling
      // cell + localUV after a conditional flip can create sub-pixel derivative
      // discontinuities at row/column borders, showing up as hairline seams.
      // For transformed cells we sample the single baked tile with local UV only.
      // The cell hash still controls which cells flip/rotate/scale, but the sample
      // coordinate remains safely inside 0..1 with a tiny texel guard.
      if (uPatternRandomRotation > 0.001 || uPatternAlternateFlip > 0.5 || uPatternScaleVariance > 0.001) {
        vec2 cell = floor(tiledUV);
        vec2 localUV = fract(tiledUV);
        float rnd = random(cell + vec2(13.17, 41.93));
        float rnd2 = random(cell + vec2(71.07, 9.41));

        if (uPatternAlternateFlip > 0.5) {
          float parity = mod(cell.x + cell.y, 2.0);
          if (uPatternAlternateFlip < 1.5) {
            if (mod(cell.x, 2.0) > 0.5) localUV.x = 1.0 - localUV.x;
          } else if (uPatternAlternateFlip < 2.5) {
            if (mod(cell.y, 2.0) > 0.5) localUV.y = 1.0 - localUV.y;
          } else {
            if (parity > 0.5) localUV = vec2(1.0) - localUV;
          }
        }

        if (uPatternScaleVariance > 0.001) {
          float variance = clamp(uPatternScaleVariance / 100.0, 0.0, 1.0);
          float cellScale = mix(1.0, mix(0.65, 1.25, rnd2), variance);
          localUV = (localUV - 0.5) / max(cellScale, 0.01) + 0.5;
        }

        if (uPatternRandomRotation > 0.001) {
          float rotAmt = clamp(uPatternRandomRotation / 100.0, 0.0, 1.0);
          float a = (rnd - 0.5) * 6.28318530718 * rotAmt;
          float ca = cos(a);
          float sa = sin(a);
          localUV = mat2(ca, -sa, sa, ca) * (localUV - 0.5) + 0.5;
        }

        // 1px / 1024 POT guard: prevents filter kernels from sampling over the
        // wrapped edge after per-cell flip/rotation. This removes hairline seams
        // without changing base tiling when advanced transforms are off.
        float tileGuard = 1.0 / 1024.0;
        patternUV = clamp(localUV, vec2(tileGuard), vec2(1.0 - tileGuard));
      }

      if (animateTexture > 0.5) {
        vec2 centerUV   = vec2(0.5, 0.5);
        vec2 centerAnim = animateTextureUV(centerUV, animationType, time);
        vec2 centerRest = animateTextureUV(centerUV, animationType, 0.0);
        patternUV = patternUV + (centerAnim - centerRest);
      }

      // WebGL1/Figma Make compatibility: texture2DGrad is not available in the
      // GLSL profile used by this preview iframe, so sampling with it prevents
      // the fragment shader from compiling and leaves the main canvas blank.
      // Keep the derivative calculations above for future WebGL2/extension work,
      // but use standard texture2D here so mask/pattern layers render reliably.
      float patternMask = texture2D(uPatternTexture, patternUV).r;

      float curveStrength = clamp(uPatternOpacityCurve / 100.0, 0.0, 1.0);
      if (curveStrength > 0.001 && uPatternOpacityCurveMode > 0.5) {
        float distFromCenter = distance(uv, vec2(0.5));
        float centerWeight = 1.0 - smoothstep(0.0, 0.72, distFromCenter);
        float edgeWeight = smoothstep(0.08, 0.72, distFromCenter);
        float curveWeight = (uPatternOpacityCurveMode < 1.5) ? centerWeight : edgeWeight;
        patternMask *= mix(1.0, curveWeight, curveStrength);
      }

      float darkFactor = 1.0 - intensity * 0.72;
      float blend = patternMask * intensity;
      textureColor = mix(color, color * darkFactor, blend);
 }
    } else if (textureType < 15.5) { {
      // ── Type 15: Spackle (Graffiti Spray Paint) ─────────────────────────────
      // Option B: three size-stratified tiers (micro-mist, splatter, fat-blobs)
      // blended by weight → modern layered spray look.
      // Option A cluster weighting applied via the Randomize (turbulence) slider.
      // Always-on liquid wave shifts the field like wet paint — amplitude 0.018
      // baseline so it's visible at default settings without needing distortion.
      //
      // lineThickness → size + density (thin = fine mist, bold = heavy coat)
      // turbulence    → seed AND cluster strength (right = tighter clusters)
      // uInvertTexture → swap dots vs background

      // ── STEP 1: User animation layer ──────────────────────────────────────
      vec2 spUV = (animatedUV - 0.5) * scale + 0.5;

      // ── STEP 2: Always-on liquid shift ────────────────────────────────────
      // Baseline 0.018 = clearly visible shimmer even at default settings.
      // Pair of orthogonal sin/cos = 4 trig calls = zero noise GPU cost.
      float spLiqAmp = 0.018 + distortion * 0.022;
      spUV += vec2(
        sin(spUV.y * 7.3 + time * 0.30) * spLiqAmp,
        cos(spUV.x * 5.9 + time * 0.24) * spLiqAmp * 0.8
      );

      float spSeed    = fract(turbulence * 0.037) + 0.5;
      float spCluster = clamp(turbulence / 100.0, 0.0, 1.0); // Randomize → cluster strength
      float spT       = clamp(lineThickness / 100.0, 0.0, 1.0);

      // ── STEP 3: Per-tier cluster weight envelope ──────────────────────────
      // Makes dots accumulate in organic zones — denser in some areas, empty in others.
      // Weight is different per tier so mist and blobs cluster independently.
      float cwMist    = spClusterWeight(spUV, spSeed,       spCluster * 0.8);
      float cwSplat   = spClusterWeight(spUV, spSeed + 4.3, spCluster * 1.0);
      float cwBlob    = spClusterWeight(spUV, spSeed + 8.7, spCluster * 1.4);

      // ── STEP 4: Three size-stratified tiers ──────────────────────────────
      // Tier 1: Micro-mist — 90% of visible dots, tiny, very dense
      float spRad1  = mix(0.030, 0.080, spT);
      float spDens1 = mix(0.50, 0.90, spT) * cwMist;
      float spMist  = spackleCell(spUV, 38.0, spRad1, clamp(spDens1, 0.0, 1.0), spSeed);

      // Tier 2: Splatter-drops — medium, moderate density
      float spRad2  = mix(0.070, 0.160, spT);
      float spDens2 = mix(0.28, 0.55, spT) * cwSplat;
      float spSplat = spackleCell(spUV, 16.0, spRad2, clamp(spDens2, 0.0, 1.0), spSeed + 5.1);

      // Tier 3: Fat-blobs — large, rare, punchy
      float spRad3  = mix(0.130, 0.260, spT);
      float spDens3 = mix(0.08, 0.22, spT) * cwBlob;
      float spBlob  = spackleCell(spUV,  6.0, spRad3, clamp(spDens3, 0.0, 1.0), spSeed + 11.9);

      // ── STEP 5: Layer blend — mist base, splatter mid, blobs punch through ─
      float sp = max(max(spMist * 0.85, spSplat * 0.95), spBlob);

      if (uInvertTexture > 0.5) sp = 1.0 - sp;
      sp = clamp(sp, 0.0, 1.0);
      vec3 spColor = color * sp;
      textureColor = mix(color, spColor, intensity);
 }
    } else if (textureType < 16.5) { {
      // ── Type 16: Grunge (Dusty / Distressed / Aged Surface) ─────────────────
      //
      // CLEAN REBUILD — pure high-frequency hash noise ONLY.
      // ALL low-frequency components removed (they caused visible large blobs):
      //   • No FBM (fbm4 creates smooth large-scale patches)
      //   • No scratch layer (gSM2 used noise at freq 3.2 = large blobs)
      //   • No spatial modulation envelopes
      //
      // Only two layers of high-frequency noise particles, both at freq > 40.
      // Thickness slider controls particle frequency and threshold width:
      //   thin (0%)  → freq 65, threshold 0.87 → micro dust specks
      //   bold (100%)→ freq 32, threshold 0.65 → slightly larger particles
      //
      // turbulence   → randomize (shifts all seeds for different layout)
      // lineThickness→ particle size / boldness only

      vec2  gUV   = (animatedUV - 0.5) * scale + 0.5;
      float gSeed = turbulence * 0.13 + 0.5;
      float gThk  = clamp(lineThickness / 100.0, 0.0, 1.0);

      // ── Layer A: Primary dust particles ───────────────────────────────────
      // High-frequency noise only — each period is small enough to look like particles.
      // Three harmonics at ratios 1 : 1.63 : 2.71 (avoid integer ratios = no grid pattern).
      float gF1  = mix(65.0, 32.0, gThk);
      float gL1a = noise(gUV * gF1         + gSeed * 0.8);
      float gL1b = noise(gUV * gF1 * 1.63  + gSeed * 1.4 + 2.9);
      float gL1c = noise(gUV * gF1 * 2.71  + gSeed * 0.6 + 6.1);
      // Weights: highest frequency gets lowest weight to avoid dominance
      float gRaw1 = gL1a * 0.55 + gL1b * 0.28 + gL1c * 0.17;
      // Steep threshold: only the brightest noise peaks survive as particles
      float gT1   = mix(0.87, 0.65, gThk);
      float gW1   = mix(0.08, 0.20, gThk); // narrow = crisp particles
      float gP1   = smoothstep(gT1, gT1 + gW1, gRaw1);

      // ── Layer B: Secondary finer cloud ────────────────────────────────────
      // Higher frequency → smaller, more numerous specks (the "dusty" feel).
      float gF2  = gF1 * 1.82;
      float gL2a = noise(gUV * gF2         + gSeed * 1.1 + 4.3);
      float gL2b = noise(gUV * gF2 * 1.58  + gSeed * 0.7 + 8.7);
      float gRaw2 = gL2a * 0.60 + gL2b * 0.40;
      float gT2   = mix(0.84, 0.62, gThk);
      float gW2   = mix(0.07, 0.16, gThk);
      float gP2   = smoothstep(gT2, gT2 + gW2, gRaw2);

      // Merge both layers — max prevents darkening at overlaps
      float grunge = max(gP1, gP2 * 0.75);
      grunge = clamp(grunge, 0.0, 1.0);

      vec3 grungeColor = color * grunge;
      textureColor = mix(color, grungeColor, intensity);
 }
    } else { {
      // Fallback
      textureColor = color;
    } }
    
    // Apply blend mode — OUTSIDE the if-else chain so ALL texture types return.
    // BUG WAS: return was inside the final else{} so grain/lines/dots/etc. never
    // returned a value → GLSL undefined behavior → GPU output pure black.
    return applyBlendMode(color, textureColor, blendMode, opacity);
  }
  
  // ========================================
  // CLEAN TWIST/ROTATION EFFECT
  // ========================================
  // Professional, predictable twist control:
  // - Clean radial falloff (stronger at edges)
  // - Smooth, monotonic rotation
  // - Intuitive slider mapping
  // - Reversible with negative values
  // - No band inversions or complex segmentation
  vec2 applyEnhancedTwist(vec2 uv, vec2 centerPoint, float twistAmount, float interactiveIntensity) {
    if (abs(twistAmount) < 0.001) return uv;
    
    vec2 p = uv - centerPoint;
    float r = length(p);
    if (r < 0.0001) return uv; // Skip center point
    
    // Corner-normalized distance (0 at center, 1 at corners)
    float normalizedR = clamp(r / 0.7071, 0.0, 1.0);
    
    // Smooth quadratic falloff (stronger toward edges)
    float falloff = normalizedR * normalizedR;
    
    // Interactive mode boost (optional secondary modifier)
    float interactiveBoost = 1.0 + interactiveIntensity * 0.5;
    
    // Calculate rotation angle (twistAmount is in "turns" - multiply by 2π for radians)
    float angle = twistAmount * falloff * 6.28318530718 * interactiveBoost;
    
    // Apply rotation
    float s = sin(angle);
    float c = cos(angle);
    
    vec2 rotated = vec2(
      p.x * c - p.y * s,
      p.x * s + p.y * c
    );
    
    return rotated + centerPoint;
  }
`;

// Linear gradient shader
export const linearGradientShader = `
  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform float angle;
  uniform float intensity;
  uniform float time;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float hasTexture;
  uniform float textureType;
  uniform float textureIntensity;
  uniform float textureScale;
  uniform float textureOpacity;
  uniform float blur;
  uniform float distortion;
  uniform float blendMode;
  uniform float textureAngle; // Separate texture angle (prevents conflict with gradient angle)
  uniform float gridSize;
  uniform float complexity;
  uniform float chromaticShift;
  uniform float animationSpeed;
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

  // Animation uniforms (ALL types)
  uniform float uRotation;
  uniform float uScale;
  uniform float scale; // Static scale multiplier (gradient.scale * scaleBoost)
  uniform float uDriftX;
  uniform float uDriftY;
  uniform float uPulse;
  uniform float uTurbulence;
  uniform float uTwist;
  uniform float uHueRotation; // Hue shift animation (0-360 degrees)
  
  // NEW: Shader-driven animation uniforms
  uniform float uAnimPhase;    // Normalized loop phase (0-1)
  uniform float uAnimEased;    // Eased loop phase (0-1)
  uniform float uAnimTime;     // Signed unbounded time
  uniform float uAnimIntensity; // Animation intensity
  uniform float uAnimType;     // Animation type ID (1=wave, 2=morph, etc.)
  
  // Interactive Warp Displacement uniforms
  uniform sampler2D uDisplacementMap;

  uniform float uDisplacementStrength;
  
  varying vec2 vUv;
  
  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}
  
  vec3 getGradientColor(float t) {
    t = clamp(t, 0.0, 1.0); // Clamp to prevent banding from out-of-range values
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      if (t <= positions[i + 1]) {
        float localT = (t - positions[i]) / (positions[i + 1] - positions[i]);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return colors[colorCount - 1];
  }
  
  void main() {
    // STEP 1: Apply interactive displacement FIRST (warps the entire gradient structure)
    vec2 animatedUV = applyDisplacement(vUv, uDisplacementMap, uDisplacementStrength);
    animatedUV = applyAudioGlitch(animatedUV); // STAGE 3.0.5b: audio motion
    
    // STEP 2: Apply drift offset to UV
    animatedUV += vec2(uDriftX, uDriftY);
    
    // STEP 3: Apply unified shader-driven animation field
    vec2 center = vec2(0.5);
    animatedUV = applySharedAnimationField(animatedUV, center, angle, 1.0);
    
    // Apply turbulence (chaotic noise distortion)
    if (uTurbulence > 0.01) {
      animatedUV.x += noise(animatedUV * 5.0 + time) * uTurbulence * 0.1;
      animatedUV.y += noise(animatedUV * 5.0 - time) * uTurbulence * 0.1;
    }
    
    // Apply ENHANCED VORTEX/SEGMENTED TWIST (hybrid effect with interactive mode)
    animatedUV = applyEnhancedTwist(animatedUV, vec2(0.5), uTwist, uDisplacementStrength);
    
    // Apply rotation animation to angle
    float animatedAngle = angle + uRotation;
    // -90° offset aligns the slider with design-tool convention: the displayed
    // angle now matches what the user sees (0°=horizontal sweep, 90°=vertical sweep),
    // matching CSS linear-gradient / Figma. Pure display-convention shift; the
    // gradient math is unchanged otherwise.
    float rad = radians(animatedAngle - 90.0);
    
    // Calculate gradient position with scale animation
    float t = (animatedUV.x - 0.5) * cos(rad) + (animatedUV.y - 0.5) * sin(rad);
    t = t * (uScale * scale) + 0.5; // Apply animation scale + boost
    
    vec3 color = getGradientColor(t) * intensity;
    
    // Apply pulse (intensity modulation)
    color *= uPulse;
    
    // Apply texture overlay if enabled
    // FIXED: Use vUv (screen space) instead of animatedUV to prevent texture rotation with gradient
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);
      
      // Apply RGB dithering when textures are active to prevent banding artifacts
      vec3 rgbDither = vec3(
        fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(93.9898, 67.345))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(41.321, 89.123))) * 43758.5453123)
      );
      rgbDither = (rgbDither - 0.5) / 255.0; // Visible dithering for texture effects
      color += rgbDither;
    }
    
    // Apply hue rotation animation if active
    if (abs(uHueRotation) > 0.01) {
      color = applyHueRotation(color, uHueRotation);
    }
    
    gl_FragColor = vec4(color, layerOpacity);
  }
`;

// Radial gradient shader
export const radialGradientShader = `
  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform vec2 center;
  uniform float scale;
  uniform float intensity;
  uniform float time;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float hasTexture;
  uniform float textureType;
  uniform float textureIntensity;
  uniform float textureScale;
  uniform float textureOpacity;
  uniform float blur;
  uniform float distortion;
  uniform float blendMode;
  uniform float textureAngle; // Separate texture angle (prevents conflict with gradient angle)
  uniform float gridSize;
  uniform float complexity;
  uniform float chromaticShift;
  uniform float angle;
  uniform float animationSpeed;
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

  // Animation uniforms (ALL types)
  uniform float uRotation;
  uniform float uScale;
  uniform float uDriftX;
  uniform float uDriftY;
  uniform float uPulse;
  uniform float uTurbulence;
  uniform float uTwist;
  uniform float uHueRotation; // Hue shift animation (0-360 degrees)
  
  // NEW: Shader-driven animation uniforms
  uniform float uAnimPhase;
  uniform float uAnimEased;
  uniform float uAnimTime;
  uniform float uAnimIntensity;
  uniform float uAnimType;
  
  // Interactive mode uniforms (X/Y pad)
  uniform float mouseX;
  uniform float mouseY;
  uniform float mouseIntensity;
  
  // Interactive Warp Displacement uniforms
  uniform sampler2D uDisplacementMap;

  uniform float uDisplacementStrength;
  
  varying vec2 vUv;
  
  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}
  
  vec3 getGradientColor(float t) {
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      if (t <= positions[i + 1]) {
        float localT = (t - positions[i]) / (positions[i + 1] - positions[i]);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return colors[colorCount - 1];
  }
  
  void main() {
    // STEP 1: Apply interactive displacement FIRST (warps the entire gradient structure)
    vec2 animatedUV = applyDisplacement(vUv, uDisplacementMap, uDisplacementStrength);
    animatedUV = applyAudioGlitch(animatedUV); // STAGE 3.0.5b: audio motion
    
    // STEP 2: Apply drift animation
    animatedUV += vec2(uDriftX, uDriftY);
    
    // STEP 3: Apply unified shader-driven animation field
    animatedUV = applySharedAnimationField(animatedUV, center, angle, 1.0);
    
    // Apply turbulence (chaotic noise distortion)
    if (uTurbulence > 0.01) {
      animatedUV.x += noise(animatedUV * 5.0 + time) * uTurbulence * 0.1;
      animatedUV.y += noise(animatedUV * 5.0 - time) * uTurbulence * 0.1;
    }
    
    // Apply mouse interaction to center dynamically (INCREASED MULTIPLIER FOR VISIBILITY)
    vec2 interactiveCenter = center + vec2(mouseX, mouseY) * 0.5 * mouseIntensity;
    
    // Apply ENHANCED VORTEX/SEGMENTED TWIST (hybrid effect with interactive mode)
    animatedUV = applyEnhancedTwist(animatedUV, interactiveCenter, uTwist, mouseIntensity + uDisplacementStrength);
    
    // Apply rotation by rotating UV coordinates around center
    vec2 toCenter = animatedUV - interactiveCenter;
    float rotRad = radians(angle + uRotation); // FIX: include base angle so rotation slider works
    float cosR = cos(rotRad);
    float sinR = sin(rotRad);
    vec2 rotated = vec2(
      toCenter.x * cosR - toCenter.y * sinR,
      toCenter.x * sinR + toCenter.y * cosR
    ) + interactiveCenter;
    
    // Apply scale animation with elliptical distortion for visible rotation
    float animatedScale = scale * uScale;
    
    // Create elliptical distortion so rotation is visible
    // When rotation is active, stretch the gradient into an ellipse
    float ellipseRatio = 1.0 + abs(uRotation) * 0.005; // Subtle ellipse when rotating
    vec2 ellipseStretch = vec2(1.0, ellipseRatio);
    vec2 toRotatedCenter = (rotated - interactiveCenter) * ellipseStretch;
    
    float dist = length(toRotatedCenter) / animatedScale;
    
    // EXTREME GRADUAL BLENDING: Ultra-smooth radial with no visible bands
    // Use very low power exponent to aggressively spread colors across entire canvas
    // Lower exponent = more extreme spread (0.3 spreads much more than 0.7)
    float gradualDist = pow(dist, 0.35); // Very aggressive smoothing
    
    // Apply additional smoothstep for silky-smooth transitions between colors
    gradualDist = smoothstep(0.0, 1.4, gradualDist); // Extended range for even more spread
    
    vec3 color = getGradientColor(gradualDist) * intensity;
    
    // Apply pulse (intensity modulation)
    color *= uPulse;
    
    // Apply texture overlay if enabled
    // FIXED: Use vUv (screen space) instead of animatedUV to prevent texture rotation with gradient
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);
      
      // Apply RGB dithering when textures are active to prevent banding artifacts
      vec3 rgbDither = vec3(
        fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(93.9898, 67.345))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(41.321, 89.123))) * 43758.5453123)
      );
      rgbDither = (rgbDither - 0.5) / 255.0; // Visible dithering for texture effects
      color += rgbDither;
    }
    
    // Apply hue rotation animation if active
    if (abs(uHueRotation) > 0.01) {
      color = applyHueRotation(color, uHueRotation);
    }
    
    gl_FragColor = vec4(color, layerOpacity);
  }
`;

// Conic gradient shader
export const conicGradientShader = `
  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform vec2 center;
  uniform float intensity;
  uniform float time;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float angle;
  uniform float hasTexture;
  uniform float textureType;
  uniform float textureIntensity;
  uniform float textureScale;
  uniform float textureOpacity;
  uniform float blur;
  uniform float distortion;
  uniform float blendMode;
  uniform float textureAngle; // Separate texture angle (prevents conflict with gradient angle)
  uniform float gridSize;
  uniform float complexity;
  uniform float chromaticShift;
  uniform float animationSpeed;
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

  // Animation uniforms (ALL types)
  uniform float uRotation;
  uniform float uScale;
  uniform float scale; // Static scale multiplier
  uniform float uDriftX;
  uniform float uDriftY;
  uniform float uPulse;
  uniform float uTurbulence;
  uniform float uTwist;
  uniform float uHueRotation; // Hue shift animation (0-360 degrees)
  
  // NEW: Shader-driven animation uniforms
  uniform float uAnimPhase;
  uniform float uAnimEased;
  uniform float uAnimTime;
  uniform float uAnimIntensity;
  uniform float uAnimType;
  
  // Interactive mode uniforms (X/Y pad)
  uniform float mouseX;
  uniform float mouseY;
  uniform float mouseIntensity;
  
  // Interactive Warp Displacement uniforms
  uniform sampler2D uDisplacementMap;

  uniform float uDisplacementStrength;
  
  varying vec2 vUv;
  
  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}
  
  vec3 getGradientColor(float t) {
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      if (t <= positions[i + 1]) {
        float localT = (t - positions[i]) / (positions[i + 1] - positions[i]);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return colors[colorCount - 1];
  }
  
  void main() {
    // STEP 1: Apply interactive displacement FIRST
    vec2 animatedUV = applyDisplacement(vUv, uDisplacementMap, uDisplacementStrength);
    animatedUV = applyAudioGlitch(animatedUV); // STAGE 3.0.5b: audio motion
    
    // STEP 2: Apply drift animation
    animatedUV += vec2(uDriftX, uDriftY);
    
    // STEP 3: Apply unified shader-driven animation field
    animatedUV = applySharedAnimationField(animatedUV, center, angle, 6.0);
    
    // Apply turbulence (slight distortion only)
    if (uTurbulence > 0.01) {
      animatedUV.x += noise(animatedUV * 5.0 + time) * uTurbulence * 0.05;
      animatedUV.y += noise(animatedUV * 5.0 - time) * uTurbulence * 0.05;
    }
    
    // Apply mouse interaction to center dynamically
    vec2 interactiveCenter = center + vec2(mouseX, mouseY) * 0.5 * mouseIntensity;

    // Calculate direction from center
    vec2 dir = (animatedUV - interactiveCenter) / max(scale, 0.01); // scale zooms conic spread

    // Calculate angle from center (pure conic sweep)
    float baseAngle = atan(dir.y, dir.x);

    // CRITICAL FIX: Apply twist based on radial distance for spiral conic effect
    // When uTwist is non-zero, gradient rotates more at edges than center
    float radialDist = length(dir);
    float twistOffset = uTwist * radialDist * 3.14159265; // Scale twist by distance from center

    // Apply base rotation (user slider) + animation rotation offset + twist
    float rotatedAngle = baseAngle + radians(angle + uRotation) + twistOffset;

    // Normalize angle to 0-1 range
    float t = fract((rotatedAngle + 3.14159265) / (2.0 * 3.14159265));
    
    vec3 color = getGradientColor(t) * intensity;
    
    // Apply pulse
    color *= uPulse;
    
    // Apply texture overlay if enabled
    // FIXED: Use vUv (screen space) instead of animatedUV to prevent texture rotation with gradient
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);
      
      // Apply RGB dithering when textures are active to prevent banding artifacts
      vec3 rgbDither = vec3(
        fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(93.9898, 67.345))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(41.321, 89.123))) * 43758.5453123)
      );
      rgbDither = (rgbDither - 0.5) / 255.0; // Visible dithering for texture effects
      color += rgbDither;
    }
    
    // Apply hue rotation animation if active
    if (abs(uHueRotation) > 0.01) {
      color = applyHueRotation(color, uHueRotation);
    }
    
    gl_FragColor = vec4(color, layerOpacity);
  }
`;

// Noise gradient shader
export const noiseGradientShader = `
  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform float time;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float scale;
  uniform float octaves;
  uniform float frequency;
  uniform float intensity;
  uniform float hasTexture;
  uniform float textureType;
  uniform float textureIntensity;
  uniform float textureScale;
  uniform float textureOpacity;
  uniform float blur;
  uniform float distortion;
  uniform float blendMode;
  uniform float textureAngle; // Separate texture angle (prevents conflict with gradient angle)
  uniform float angle;
  uniform float gridSize;
  uniform float complexity;
  uniform float chromaticShift;
  uniform float animationSpeed;
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
  uniform float uHueRotation; // Hue shift animation (0-360 degrees)
  
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

  // Interactive Warp Displacement uniforms
  uniform sampler2D uDisplacementMap;
  uniform float uDisplacementStrength;

  varying vec2 vUv;
  
  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}
  
  vec3 getGradientColor(float t) {
    t = clamp(t, 0.0, 1.0);
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      if (t <= positions[i + 1]) {
        float localT = (t - positions[i]) / (positions[i + 1] - positions[i]);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return colors[colorCount - 1];
  }
  
  void main() {
    // Apply drift
    vec2 animatedUV = vUv + vec2(uDriftX, uDriftY);
    animatedUV = applyAudioGlitch(animatedUV); // STAGE 3.0.5b: audio motion
    
    // Apply unified shader-driven animation field
    vec2 center = vec2(0.5);
    animatedUV = applySharedAnimationField(animatedUV, center, angle, 1.0);
    
    // Apply ENHANCED VORTEX/SEGMENTED TWIST (hybrid effect)
    animatedUV = applyEnhancedTwist(animatedUV, vec2(0.5), uTwist, 0.0);
    
    // Apply rotation
    vec2 toCenter = animatedUV - vec2(0.5);
    float rotRad = radians(angle + uRotation); // FIX: include base angle so rotation slider works
    float cosR = cos(rotRad);
    float sinR = sin(rotRad);
    vec2 rotated = vec2(
      toCenter.x * cosR - toCenter.y * sinR,
      toCenter.x * sinR + toCenter.y * cosR
    ) + vec2(0.5);
    
    // Calculate noise with scale
    vec2 uv = rotated * scale * uScale;
    float noiseValue = 0.0;
    float amp = 1.0;
    float freq = frequency;
    
    for (float i = 0.0; i < 8.0; i++) {
      if (i >= octaves) break;
      noiseValue += noise(uv * freq + time * 0.1) * amp;
      freq *= 2.0;
      amp *= 0.5;
    }
    
    // Add extra turbulence
    if (uTurbulence > 0.01) {
      noiseValue += noise(uv * 3.0 + time) * uTurbulence * 0.2;
    }
    
    float t = (noiseValue + 1.0) * 0.5;
    
    vec3 color = getGradientColor(t) * intensity * uPulse;
    
    // Apply texture overlay if enabled
    // FIXED: Use vUv (screen space) instead of animatedUV to prevent texture rotation with gradient
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);
      
      // Apply RGB dithering when textures are active to prevent banding artifacts
      vec3 rgbDither = vec3(
        fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(93.9898, 67.345))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(41.321, 89.123))) * 43758.5453123)
      );
      rgbDither = (rgbDither - 0.5) / 255.0; // Visible dithering for texture effects
      color += rgbDither;
    }
    
    // Apply hue rotation animation if active
    if (abs(uHueRotation) > 0.01) {
      color = applyHueRotation(color, uHueRotation);
    }
    
    gl_FragColor = vec4(color, layerOpacity);
  }
`;

// Wave gradient shader
export const waveGradientShader = `
  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform float time;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float angle;
  uniform float stripeCount;
  uniform float waveAmplitude;
  uniform float intensity;
  uniform float hasTexture;
  uniform float textureType;
  uniform float textureIntensity;
  uniform float textureScale;
  uniform float textureOpacity;
  uniform float blur;
  uniform float distortion;
  uniform float blendMode;
  uniform float textureAngle; // Separate texture angle (prevents conflict with gradient angle)
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
  uniform float uHueRotation; // Hue shift animation (0-360 degrees)
  
  // NEW: Shader-driven animation uniforms
  uniform float uAnimPhase;
  uniform float uAnimEased;
  uniform float uAnimTime;
  uniform float uAnimIntensity;
  uniform float uAnimType;
  
  // Interactive Warp Displacement uniforms
  uniform sampler2D uDisplacementMap;

  uniform float uDisplacementStrength;
  
  varying vec2 vUv;
  
  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}
  
  vec3 getGradientColor(float t) {
    t = mod(t, 1.0);
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      if (t <= positions[i + 1]) {
        float localT = (t - positions[i]) / (positions[i + 1] - positions[i]);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return colors[colorCount - 1];
  }
  
  void main() {
    // STEP 1: Apply interactive displacement FIRST (creates organic wave bending)
    vec2 animatedUV = applyDisplacement(vUv, uDisplacementMap, uDisplacementStrength);
    animatedUV = applyAudioGlitch(animatedUV); // STAGE 3.0.5b: audio motion
    
    // STEP 2: Apply drift
    animatedUV += vec2(uDriftX, uDriftY);
    
    // STEP 3: NEW - Apply shader-driven animation field
    vec2 center = vec2(0.5);
    animatedUV = applySharedAnimationField(animatedUV, center, angle, 1.0);
    
    // Always-on subtle wave undulation: gives parallel bands a living, fluid quality.
    float waveFlow = sin(animatedUV.x * 8.0 + time * 0.6) * 0.008
                   + sin(animatedUV.y * 6.0 - time * 0.4) * 0.005;
    animatedUV.y += waveFlow;
    
    // Apply turbulence
    if (uTurbulence > 0.01) {
      animatedUV.x += noise(animatedUV * 5.0 + time) * uTurbulence * 0.1;
      animatedUV.y += noise(animatedUV * 5.0 - time) * uTurbulence * 0.1;
    }
    
    // Stripe gradients should NOT twist - they need parallel bands, not spirals
    // Apply rotation
    float animatedAngle = angle + uRotation;
    // -90° offset: align Angle slider with design-tool convention (see linear gradient).
    float rad = radians(animatedAngle - 90.0);
    float base = animatedUV.x * cos(rad) + animatedUV.y * sin(rad);
    
    // Apply scale to stripe count
    float scaledStripeCount = stripeCount * uScale;
    float wave = sin((base + time * 0.5) * scaledStripeCount * 6.28318) * waveAmplitude;
    float t = base + wave;
    
    vec3 color = getGradientColor(t) * intensity * uPulse;
    
    // Apply texture overlay if enabled
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);
      
      // Apply RGB dithering when textures are active to prevent banding artifacts
      vec3 rgbDither = vec3(
        fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(93.9898, 67.345))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(41.321, 89.123))) * 43758.5453123)
      );
      rgbDither = (rgbDither - 0.5) / 255.0; // Visible dithering for texture effects
      color += rgbDither;
    }
    
    // Apply hue rotation animation if active
    if (abs(uHueRotation) > 0.01) {
      color = applyHueRotation(color, uHueRotation);
    }
    
    gl_FragColor = vec4(color, layerOpacity);
  }
`;

// Blob gradient shader
export const blobGradientShader = `
  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform float time;
  uniform vec2 blobPositions[5];
  uniform float blobSizes[5];
  uniform int blobCount;
  uniform float intensity;
  uniform float hasTexture;
  uniform float textureType;
  uniform float textureIntensity;
  uniform float textureScale;
  uniform float textureOpacity;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float blur;
  uniform float distortion;
  uniform float blendMode;
  uniform float textureAngle; // Separate texture angle (prevents conflict with gradient angle)
  uniform float angle;
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
  uniform float scale; // Static scale multiplier
  uniform float uDriftX;
  uniform float uDriftY;
  uniform float uPulse;
  uniform float uTurbulence;
  uniform float uTwist;
  uniform float uHueRotation; // Hue shift animation (0-360 degrees)
  
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
  
  // Interactive Warp Displacement uniforms
  uniform sampler2D uDisplacementMap;

  uniform float uDisplacementStrength;
  
  varying vec2 vUv;
  
  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}
  
  vec3 getGradientColor(float t) {
    t = clamp(t, 0.0, 1.0);
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      if (t <= positions[i + 1]) {
        float localT = (t - positions[i]) / (positions[i + 1] - positions[i]);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return colors[colorCount - 1];
  }
  
  void main() {
    // STEP 1: Apply interactive displacement FIRST
    vec2 animatedUV = applyDisplacement(vUv, uDisplacementMap, uDisplacementStrength);
    animatedUV = applyAudioGlitch(animatedUV); // STAGE 3.0.5b: audio motion
    
    // STEP 2: Apply drift
    animatedUV += vec2(uDriftX, uDriftY);
    
    // STEP 3: NEW - Apply shader-driven animation field (great for morph/turbulence)
    vec2 center = vec2(0.5);
    animatedUV = applySharedAnimationField(animatedUV, center, angle, 1.0);
    
    // Apply turbulence (slight organic distortion)
    if (uTurbulence > 0.01) {
      animatedUV.x += noise(animatedUV * 5.0 + time) * uTurbulence * 0.05;
      animatedUV.y += noise(animatedUV * 5.0 - time) * uTurbulence * 0.05;
    }
    
    // Apply rotation
    vec2 toCenter = animatedUV - vec2(0.5);
    float rotRad = radians(angle + uRotation);
    float cosR = cos(rotRad);
    float sinR = sin(rotRad);
    vec2 rotated = vec2(
      toCenter.x * cosR - toCenter.y * sinR,
      toCenter.x * sinR + toCenter.y * cosR
    ) + vec2(0.5);

    // Apply twist (spiral distortion) — controlled by the Twist slider
    vec2 twisted = rotated;
    if (abs(uTwist) > 0.001) {
      twisted = applyEnhancedTwist(rotated, vec2(0.5), uTwist, uDisplacementStrength);
    }
    
    // Apply scale
    vec2 scaled = (twisted - vec2(0.5)) / (uScale * max(scale, 0.01)) + vec2(0.5);
    
    // Calculate non-uniform blob field with organic shapes
    float value = 0.0;
    
    for (int i = 0; i < 5; i++) {
      if (i >= blobCount) break;
      vec2 toBlob = scaled - blobPositions[i];
      
      // Add organic distortion to each blob
      float blobNoise = noise(blobPositions[i] * 10.0 + time * 0.3);
      float angleOffset = blobNoise * 6.28318;
      float radiusVariation = 1.0 + sin(atan(toBlob.y, toBlob.x) * 3.0 + angleOffset) * 0.3;
      
      float blobDist = length(toBlob) / radiusVariation;
      value += (1.0 - smoothstep(0.0, blobSizes[i], blobDist));
    }
    
    value = clamp(value, 0.0, 1.0);
    
    vec3 color = getGradientColor(value) * intensity * uPulse;
    
    // Apply texture overlay if enabled
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);
      
      // Apply RGB dithering when textures are active to prevent banding artifacts
      vec3 rgbDither = vec3(
        fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(93.9898, 67.345))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(41.321, 89.123))) * 43758.5453123)
      );
      rgbDither = (rgbDither - 0.5) / 255.0; // Visible dithering for texture effects
      color += rgbDither;
    }
    
    // Apply hue rotation animation if active
    if (abs(uHueRotation) > 0.01) {
      color = applyHueRotation(color, uHueRotation);
    }
    
    gl_FragColor = vec4(color, layerOpacity);
  }
`;

// Texture overlay shader
export const textureOverlayShader = `
  uniform sampler2D baseTexture;
  uniform float noiseScale;
  uniform float noiseIntensity;
  uniform float time;
  varying vec2 vUv;
  
  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
  }
  
  void main() {
    vec4 baseColor = texture2D(baseTexture, vUv);
    float noise = random(vUv * noiseScale + time) * noiseIntensity;
    gl_FragColor = vec4(baseColor.rgb + noise, baseColor.a);
  }
`;

// Spiral gradient shader
export const spiralGradientShader = `
  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform vec2 center;
  uniform float scale;
  uniform float intensity;
  uniform float time;
  uniform float hasTexture;
  uniform float textureType;
  uniform float textureIntensity;
  uniform float textureScale;
  uniform float textureOpacity;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float blur;
  uniform float distortion;
  uniform float blendMode;
  uniform float textureAngle; // Separate texture angle (prevents conflict with gradient angle)
  uniform float angle;
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
  uniform float uHueRotation; // Hue shift animation (0-360 degrees)
  
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
  
  // Interactive Warp Displacement uniforms
  uniform sampler2D uDisplacementMap;

  uniform float uDisplacementStrength;
  
  varying vec2 vUv;
  
  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}
  
  vec3 getGradientColor(float t) {
    t = clamp(t, 0.0, 1.0);
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      if (t <= positions[i + 1]) {
        float localT = (t - positions[i]) / (positions[i + 1] - positions[i]);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return colors[colorCount - 1];
  }
  
  void main() {
    // STEP 1: Apply interactive displacement FIRST
    vec2 animatedUV = applyDisplacement(vUv, uDisplacementMap, uDisplacementStrength);
    animatedUV = applyAudioGlitch(animatedUV); // STAGE 3.0.5b: audio motion
    
    // STEP 2: Apply drift
    animatedUV += vec2(uDriftX, uDriftY);
    
    // STEP 3: NEW - Apply shader-driven animation field (before polar conversion)
    vec2 interactiveCenter = center + vec2(mouseX, mouseY) * 0.5 * mouseIntensity;
    animatedUV = applySharedAnimationField(animatedUV, interactiveCenter, angle, 1.0);
    
    // STEP 4: Apply turbulence
    if (uTurbulence > 0.01) {
      animatedUV.x += noise(animatedUV * 5.0 + time) * uTurbulence * 0.1;
      animatedUV.y += noise(animatedUV * 5.0 - time) * uTurbulence * 0.1;
    }
    
    // Apply ENHANCED VORTEX/SEGMENTED TWIST (hybrid effect with interactive mode)
    animatedUV = applyEnhancedTwist(animatedUV, interactiveCenter, uTwist, mouseIntensity + uDisplacementStrength);
    
    // Apply rotation
    vec2 toCenter = animatedUV - interactiveCenter;
    float rotRad = radians(angle + uRotation); // FIX: include base angle so rotation slider works
    float cosR = cos(rotRad);
    float sinR = sin(rotRad);
    vec2 rotated = vec2(
      toCenter.x * cosR - toCenter.y * sinR,
      toCenter.x * sinR + toCenter.y * cosR
    ) + interactiveCenter;
    
    // Calculate spiral - continuous flowing pattern
    vec2 dir = rotated - interactiveCenter;
    float dist = length(dir) / (scale * uScale);
    float angleVal = atan(dir.y, dir.x);
    
    // Create spiral by combining radial distance and angular rotation
    float spiral = fract(dist * 5.0 + angleVal / 6.28318 + time * 0.1);
    
    // Sample gradient color
    vec3 color = getGradientColor(spiral) * intensity * uPulse;
    
    // Add subtle dithering to reduce color banding (when no texture active)
    if (hasTexture < 0.5) {
      float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      dither = (dither - 0.5) / 255.0; // Subtle 8-bit dithering
      color += vec3(dither);
    }
    
    // Apply texture overlay if enabled
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);
      
      // Apply RGB dithering when textures are active to prevent banding artifacts
      vec3 rgbDither = vec3(
        fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(93.9898, 67.345))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(41.321, 89.123))) * 43758.5453123)
      );
      rgbDither = (rgbDither - 0.5) / 255.0; // Visible dithering for texture effects
      color += rgbDither;
    }
    
    // Apply hue rotation animation if active
    if (abs(uHueRotation) > 0.01) {
      color = applyHueRotation(color, uHueRotation);
    }
    
    gl_FragColor = vec4(color, layerOpacity);
  }
`;

// Burst gradient shader (radial stripes)
export const burstGradientShader = `
  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform vec2 center;
  uniform int stripeCount;
  uniform float intensity;
  uniform float time;
  uniform float hasTexture;
  uniform float textureType;
  uniform float textureIntensity;
  uniform float textureScale;
  uniform float textureOpacity;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float blur;
  uniform float distortion;
  uniform float blendMode;
  uniform float textureAngle; // Separate texture angle (prevents conflict with gradient angle)
  uniform float angle;
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
  uniform float scale; // Static scale multiplier
  uniform float uDriftX;
  uniform float uDriftY;
  uniform float uPulse;
  uniform float uTurbulence;
  uniform float uTwist;
  uniform float uHueRotation; // Hue shift animation (0-360 degrees)
  
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
  
  // Interactive Warp Displacement uniforms
  uniform sampler2D uDisplacementMap;

  uniform float uDisplacementStrength;
  
  varying vec2 vUv;
  
  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}
  
  vec3 getGradientColor(float t) {
    t = mod(t, 1.0);
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      if (t <= positions[i + 1]) {
        float localT = (t - positions[i]) / (positions[i + 1] - positions[i]);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return colors[colorCount - 1];
  }
  
  void main() {
    // STEP 1: Apply interactive displacement FIRST
    vec2 animatedUV = applyDisplacement(vUv, uDisplacementMap, uDisplacementStrength);
    animatedUV = applyAudioGlitch(animatedUV); // STAGE 3.0.5b: audio motion
    
    // STEP 2: Apply drift
    animatedUV += vec2(uDriftX, uDriftY);
    
    // STEP 3: NEW - Apply shader-driven animation (great for kaleidoscope/vortex on burst)
    vec2 interactiveCenter = center + vec2(mouseX, mouseY) * 0.5 * mouseIntensity;
    animatedUV = applySharedAnimationField(animatedUV, interactiveCenter, angle, float(stripeCount));
    
    // Apply twist before rotation for proper distortion layering
    animatedUV = applyEnhancedTwist(animatedUV, interactiveCenter, uTwist, mouseIntensity + uDisplacementStrength);
    
    // Subtle ray-shimmer: always-on organic ray edge variation using time.
    // Creates a living quality in the burst rays without needing turbulence slider.
    float rayShimmer = noise(animatedUV * 4.0 + time * 0.08) * 0.012;
    animatedUV += vec2(rayShimmer, -rayShimmer * 0.7);
    
    // Apply turbulence
    if (uTurbulence > 0.01) {
      animatedUV.x += noise(animatedUV * 5.0 + time) * uTurbulence * 0.1;
      animatedUV.y += noise(animatedUV * 5.0 - time) * uTurbulence * 0.1;
    }
    
    // Calculate position relative to center
    vec2 toCenter = animatedUV - interactiveCenter;
    
    // Apply rotation
    float rotRad = radians(angle + uRotation); // FIX: include base angle so rotation slider works
    float cosR = cos(rotRad);
    float sinR = sin(rotRad);
    vec2 rotated = vec2(
      toCenter.x * cosR - toCenter.y * sinR,
      toCenter.x * sinR + toCenter.y * cosR
    );
    
    // Calculate distance and angle for starburst effect
    float dist = length(rotated) * uScale * scale;
    float angle = atan(rotated.y, rotated.x);
    
    // Create starburst rays using angular modulation
    float rayAngle = 6.28318 / float(stripeCount); // 2*PI / stripe count
    float anglePattern = mod(angle, rayAngle) / rayAngle;
    
    // Smooth starburst rays with sine wave for gradual transitions
    float rays = sin(angle * float(stripeCount)) * 0.5 + 0.5;
    
    // Combine radial distance with ray pattern for starburst
    // Use smoother falloff for gradual gradient
    float radialGradient = smoothstep(0.0, 1.5, dist);
    
    // Blend rays with radial gradient for starburst effect
    // More gradual blending, less aggressive at center
    float t = mix(rays, radialGradient, 0.4 + dist * 0.3);
    
    vec3 color = getGradientColor(t) * intensity * uPulse;
    
    // Apply texture overlay if enabled
    // FIXED: Use vUv (screen space) instead of animatedUV to prevent texture rotation with gradient
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);
      
      // Apply RGB dithering when textures are active to prevent banding artifacts
      vec3 rgbDither = vec3(
        fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(93.9898, 67.345))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(41.321, 89.123))) * 43758.5453123)
      );
      rgbDither = (rgbDither - 0.5) / 255.0; // Visible dithering for texture effects
      color += rgbDither;
    }
    
    // Apply hue rotation animation if active
    if (abs(uHueRotation) > 0.01) {
      color = applyHueRotation(color, uHueRotation);
    }
    
    gl_FragColor = vec4(color, layerOpacity);
  }
`;

// Camo gradient shader
export const camoGradientShader = `
  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform float time;
  uniform float scale;
  uniform float intensity;
  uniform float hasTexture;
  uniform float textureType;
  uniform float textureIntensity;
  uniform float textureScale;
  uniform float textureOpacity;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float blur;
  uniform float distortion;
  uniform float blendMode;
  uniform float textureAngle; // Separate texture angle (prevents conflict with gradient angle)
  uniform float angle;
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
  uniform float uHueRotation; // Hue shift animation (0-360 degrees)
  
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

  // Interactive Warp Displacement uniforms
  uniform sampler2D uDisplacementMap;
  uniform float uDisplacementStrength;

  varying vec2 vUv;
  
  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}
  
  // Simplex noise function
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  
  vec3 getGradientColor(float t) {
    t = clamp(t, 0.0, 1.0);
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      if (t <= positions[i + 1]) {
        float localT = (t - positions[i]) / (positions[i + 1] - positions[i]);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return colors[colorCount - 1];
  }
  
  void main() {
    // Apply drift
    vec2 animatedUV = vUv + vec2(uDriftX, uDriftY);
    animatedUV = applyAudioGlitch(animatedUV); // STAGE 3.0.5b: audio motion
    
    // NEW: Apply shader-driven animation (subtle for camo to avoid mushiness)
    vec2 center = vec2(0.5);
    animatedUV = applySharedAnimationField(animatedUV, center, angle, 1.0);

    // Apply twist for warping organic camo patches
    animatedUV = applyEnhancedTwist(animatedUV, center, uTwist, mouseIntensity);

    // Apply rotation
    vec2 toCenter = animatedUV - vec2(0.5);
    float rotRad = radians(angle + uRotation); // FIX: include base angle so rotation slider works
    float cosR = cos(rotRad);
    float sinR = sin(rotRad);
    vec2 rotated = vec2(
      toCenter.x * cosR - toCenter.y * sinR,
      toCenter.x * sinR + toCenter.y * cosR
    ) + vec2(0.5);
    
    // Apply scale
    vec2 uv = rotated * scale * uScale;
    
    // Multiple noise layers for camo effect
    float noise1 = snoise(uv * 3.0 + time * 0.05);
    float noise2 = snoise(uv * 6.0 - time * 0.03);
    float noise3 = snoise(uv * 12.0 + time * 0.07);
    
    // Add extra turbulence
    if (uTurbulence > 0.01) {
      noise1 += snoise(uv * 5.0 + time) * uTurbulence * 0.2;
    }
    
    // Combine noise layers with thresholding for camo patches.
    // Keep the original camouflage region layout, only soften the region edges.
    float combined = (noise1 * 0.5 + noise2 * 0.3 + noise3 * 0.2);
    float patchAA = aaWidth(combined, 1.6);
    float patches = 0.0;
    patches = mix(patches, 0.3, smoothstep(0.0 - patchAA, 0.0 + patchAA, combined));
    patches = mix(patches, 0.6, smoothstep(0.5 - patchAA, 0.5 + patchAA, combined));
    patches = mix(patches, 0.9, smoothstep(0.8 - patchAA, 0.8 + patchAA, combined));
    
    vec3 color = getGradientColor(patches) * intensity * uPulse;
    
    // Apply texture overlay if enabled
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);
      
      // Apply RGB dithering when textures are active to prevent banding artifacts
      vec3 rgbDither = vec3(
        fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(93.9898, 67.345))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(41.321, 89.123))) * 43758.5453123)
      );
      rgbDither = (rgbDither - 0.5) / 255.0; // Visible dithering for texture effects
      color += rgbDither;
    }
    
    // Apply hue rotation animation if active
    if (abs(uHueRotation) > 0.01) {
      color = applyHueRotation(color, uHueRotation);
    }
    
    gl_FragColor = vec4(color, layerOpacity);
  }
`;

// Wave gradient shader (distinct - actual wave patterns, not stripes)
export const waveGradientShader2 = `
  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform float time;
  uniform float angle;
  uniform float frequency;
  uniform float waveAmplitude;
  uniform float intensity;
  uniform float hasTexture;
  uniform float textureType;
  uniform float textureIntensity;
  uniform float textureScale;
  uniform float textureOpacity;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float blur;
  uniform float distortion;
  uniform float blendMode;
  uniform float textureAngle; // Separate texture angle (prevents conflict with gradient angle)
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
  uniform float scale; // Static scale multiplier
  uniform float uDriftX;
  uniform float uDriftY;
  uniform float uPulse;
  uniform float uTurbulence;
  uniform float uTwist;
  uniform float uHueRotation; // Hue shift animation (0-360 degrees)
  
  // NEW: Shader-driven animation uniforms
  uniform float uAnimPhase;
  uniform float uAnimEased;
  uniform float uAnimTime;
  uniform float uAnimIntensity;
  uniform float uAnimType;
  uniform float uExportLoopEnabled;
  uniform float uExportLoopPhase;

  // Interactive Warp Displacement uniforms
  uniform sampler2D uDisplacementMap;
  uniform float uDisplacementStrength;

  varying vec2 vUv;

  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}

  vec3 getGradientColor(float t) {
    t = clamp(t, 0.0, 1.0);
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      if (t <= positions[i + 1]) {
        float localT = (t - positions[i]) / (positions[i + 1] - positions[i]);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return colors[colorCount - 1];
  }

  void main() {
    // Apply drift
    vec2 animatedUV = vUv + vec2(uDriftX, uDriftY);
    animatedUV = applyAudioGlitch(animatedUV); // STAGE 3.0.5b: audio motion
    
    // NEW: Apply shader-driven animation field (reuse wave pattern approach)
    vec2 center = vec2(0.5);
    animatedUV = applySharedAnimationField(animatedUV, center, angle, 1.0);
    
    // Apply ENHANCED VORTEX/SEGMENTED TWIST (hybrid effect)
    animatedUV = applyEnhancedTwist(animatedUV, vec2(0.5), uTwist, 0.0);
    
    // Apply rotation
    float animatedAngle = angle + uRotation;
    // -90° offset: align Angle slider with design-tool convention (see linear gradient).
    float rad = radians(animatedAngle - 90.0);
    vec2 dir = vec2(cos(rad), sin(rad));
    float base = dot(animatedUV, dir);
    
    // Create wave pattern with scale and turbulence
    float scaledFreq = frequency * uScale * scale;
    float loopAngle = uExportLoopPhase * 6.28318530718;
    float animationTime = mix(time, loopAngle, step(0.5, uExportLoopEnabled));
    float wave1 = sin(base * scaledFreq * 6.28318 + animationTime) * waveAmplitude;
    float wave2 = sin(base * scaledFreq * 2.0 * 6.28318 - animationTime) * waveAmplitude * 0.5;
    
    // Add turbulence
    float turbNoise = 0.0;
    if (uTurbulence > 0.01) {
      vec2 loopNoiseOffset = vec2(cos(loopAngle), sin(loopAngle)) * 0.5;
      vec2 noiseOffset = mix(vec2(time * 0.5), loopNoiseOffset, step(0.5, uExportLoopEnabled));
      turbNoise = (noise(animatedUV * 5.0 + noiseOffset) - 0.5) * uTurbulence * 0.15;
    }
    
    // Combine base gradient with waves (normalized to 0-1 range)
    float t = fract(base + wave1 + wave2 + turbNoise);
    
    // PHASE 7.3E.10 ANALYTIC EDGE AA: integrate the procedural gradient
    // across the pixel footprint instead of sampling only the pixel centre.
    // This removes staircase edges in both the live canvas and exports without blur.
    float footprint = max(fwidth(t), 0.00035);
    vec3 color = (
      getGradientColor(fract(t - footprint * 0.375)) +
      getGradientColor(fract(t - footprint * 0.125)) +
      getGradientColor(fract(t + footprint * 0.125)) +
      getGradientColor(fract(t + footprint * 0.375))
    ) * 0.25 * intensity * uPulse;
    
    // Apply texture overlay if enabled
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);
      
      // Apply RGB dithering when textures are active to prevent banding artifacts
      vec3 rgbDither = vec3(
        fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(93.9898, 67.345))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(41.321, 89.123))) * 43758.5453123)
      );
      rgbDither = (rgbDither - 0.5) / 255.0; // Visible dithering for texture effects
      color += rgbDither;
    }
    
    // Apply hue rotation animation if active
    if (abs(uHueRotation) > 0.01) {
      color = applyHueRotation(color, uHueRotation);
    }
    
    gl_FragColor = vec4(color, layerOpacity);
  }
`;

// Fractal gradient shader (complex fractal patterns)
export const fractalGradientShader = `
  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform float time;
  uniform float scale;
  uniform int octaves;
  uniform float frequency;
  uniform float intensity;
  uniform float hasTexture;
  uniform float textureType;
  uniform float textureIntensity;
  uniform float textureScale;
  uniform float textureOpacity;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float blur;
  uniform float distortion;
  uniform float blendMode;
  uniform float textureAngle; // Separate texture angle (prevents conflict with gradient angle)
  uniform float angle;
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
  uniform float uHueRotation; // Hue shift animation (0-360 degrees)
  
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

  // Interactive Warp Displacement uniforms
  uniform sampler2D uDisplacementMap;
  uniform float uDisplacementStrength;

  varying vec2 vUv;
  
  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}
  
  // Simplex noise
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  
  vec3 getGradientColor(float t) {
    t = clamp(t, 0.0, 1.0);
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      if (t <= positions[i + 1]) {
        float localT = (t - positions[i]) / (positions[i + 1] - positions[i]);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return colors[colorCount - 1];
  }
  
  void main() {
    // Apply drift
    vec2 animatedUV = vUv + vec2(uDriftX, uDriftY);
    animatedUV = applyAudioGlitch(animatedUV); // STAGE 3.0.5b: audio motion
    
    // Apply unified shader-driven animation field
    vec2 center = vec2(0.5);
    animatedUV = applySharedAnimationField(animatedUV, center, angle, 1.0);
    
    // Apply mouse interaction
    vec2 interactiveCenter = vec2(0.5) + vec2(mouseX, mouseY) * 0.5 * mouseIntensity;
    
    // Apply twist before rotation for proper distortion layering
    animatedUV = applyEnhancedTwist(animatedUV, interactiveCenter, uTwist, mouseIntensity);
    
    // Apply rotation
    vec2 toCenter = animatedUV - interactiveCenter;
    float rotRad = radians(angle + uRotation); // FIX: include base angle so rotation slider works
    float cosR = cos(rotRad);
    float sinR = sin(rotRad);
    vec2 rotated = vec2(
      toCenter.x * cosR - toCenter.y * sinR,
      toCenter.x * sinR + toCenter.y * cosR
    ) + interactiveCenter;
    
    // === DOMAIN WARPING for stretched gradients with sliced sections ===
    // Balanced scaling: divide by scale for intuitive zoom control (higher scale = zoom in)
    float adjustedScale = max(scale * uScale, 0.1); // Prevent division by zero
    vec2 uv = rotated / adjustedScale;
    
    // LAYER 1: Primary domain warp - creates stretched flow
    vec2 warp1 = vec2(
      snoise(uv * frequency * 0.8 + time * 0.1),
      snoise(uv * frequency * 0.8 + vec2(100.0, 50.0) - time * 0.1)
    );
    
    // LAYER 2: Secondary warp - creates fractal slicing
    vec2 warp2 = vec2(
      snoise((uv + warp1 * 2.0) * frequency * 1.5 + time * 0.05),
      snoise((uv + warp1 * 2.0) * frequency * 1.5 + vec2(200.0, 100.0) + time * 0.05)
    );
    
    // LAYER 3: Tertiary warp - adds fine detail and mirroring
    vec2 warp3 = vec2(
      snoise((uv + warp2 * 1.5) * frequency * 2.5),
      snoise((uv + warp2 * 1.5) * frequency * 2.5 + vec2(300.0, 150.0))
    );
    
    // Combine warps with octave-based control for complexity
    float octaveFactor = float(octaves) / 6.0; // Normalize octaves (default 6)
    vec2 totalWarp = warp1 * 1.2 + warp2 * 0.8 * octaveFactor + warp3 * 0.4 * octaveFactor;
    
    // Apply domain distortion to create stretched gradients
    vec2 distortedUV = uv + totalWarp * 1.5;
    
    // === SLICED SECTIONS: Create fractal-like breaks ===
    // Use absolute value for mirroring effect
    float slice1 = abs(snoise(distortedUV * frequency * 0.6));
    float slice2 = abs(snoise(distortedUV * frequency * 1.2 + vec2(50.0)));
    
    // Combine slices with different weights for fractal appearance
    float pattern = slice1 * 0.6 + slice2 * 0.4;
    
    // Add hard-edged sections for defined breaks
    float sections = floor(pattern * 8.0 * octaveFactor) / (8.0 * octaveFactor);
    pattern = mix(pattern, sections, 0.3);
    
    // Add turbulence if enabled
    if (uTurbulence > 0.01) {
      float turbNoise = snoise(distortedUV * 3.0 + time * 0.2);
      pattern += turbNoise * uTurbulence * 0.2;
    }
    
    // Normalize to 0-1 range with smooth gradation
    float t = fract(pattern * 2.0);
    
    vec3 color = getGradientColor(t) * intensity * uPulse;
    
    // Apply texture overlay if enabled
    // FIXED: Use vUv (screen space) instead of animatedUV to prevent texture rotation with gradient
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);
      
      // Apply RGB dithering when textures are active to prevent banding artifacts
      vec3 rgbDither = vec3(
        fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(93.9898, 67.345))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(41.321, 89.123))) * 43758.5453123)
      );
      rgbDither = (rgbDither - 0.5) / 255.0; // Visible dithering for texture effects
      color += rgbDither;
    }
    
    // Apply hue rotation animation if active
    if (abs(uHueRotation) > 0.01) {
      color = applyHueRotation(color, uHueRotation);
    }
    
    gl_FragColor = vec4(color, layerOpacity);
  }
`;

// Turbulence gradient shader (chaotic turbulent patterns)
export const turbulenceGradientShader = `
  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform float time;
  uniform float scale;
  uniform int octaves;
  uniform float frequency;
  uniform float intensity;
  uniform float hasTexture;
  uniform float textureType;
  uniform float textureIntensity;
  uniform float textureScale;
  uniform float textureOpacity;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float blur;
  uniform float distortion;
  uniform float blendMode;
  uniform float textureAngle; // Separate texture angle (prevents conflict with gradient angle)
  uniform float angle;
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
  uniform float uHueRotation; // Hue shift animation (0-360 degrees)
  
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

  // Interactive Warp Displacement uniforms
  uniform sampler2D uDisplacementMap;
  uniform float uDisplacementStrength;

  varying vec2 vUv;
  
  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}
  
  // Simplex noise
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  
  vec3 getGradientColor(float t) {
    t = clamp(t, 0.0, 1.0);
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      if (t <= positions[i + 1]) {
        float localT = (t - positions[i]) / (positions[i + 1] - positions[i]);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return colors[colorCount - 1];
  }
  
  void main() {
    // Apply drift
    vec2 animatedUV = vUv + vec2(uDriftX, uDriftY);
    animatedUV = applyAudioGlitch(animatedUV); // STAGE 3.0.5b: audio motion
    
    // Apply unified shader-driven animation field
    vec2 center = vec2(0.5);
    animatedUV = applySharedAnimationField(animatedUV, center, angle, 1.0);
    
    // Apply ENHANCED VORTEX/SEGMENTED TWIST (hybrid effect)
    animatedUV = applyEnhancedTwist(animatedUV, vec2(0.5), uTwist, 0.0);
    
    // Apply rotation
    vec2 toCenter = animatedUV - vec2(0.5);
    float rotRad = radians(angle + uRotation); // FIX: include base angle so rotation slider works
    float cosR = cos(rotRad);
    float sinR = sin(rotRad);
    vec2 rotated = vec2(
      toCenter.x * cosR - toCenter.y * sinR,
      toCenter.x * sinR + toCenter.y * cosR
    ) + vec2(0.5);
    
    // Calculate turbulence with scale
    vec2 uv = rotated * scale * uScale;
    float turbulence = 0.0;
    float amp = 1.0;
    float freq = frequency;
    
    // Turbulence uses absolute value for sharper, more chaotic patterns
    for (int i = 0; i < 8; i++) {
      if (i >= octaves) break;
      turbulence += abs(snoise(uv * freq + vec2(time * 0.1, -time * 0.07))) * amp;
      freq *= 2.0;
      amp *= 0.5;
    }
    
    // Add extra turbulence
    if (uTurbulence > 0.01) {
      turbulence += abs(snoise(uv * 3.0 + vec2(time, -time * 0.5))) * uTurbulence * 0.4;
    }
    
    float t = turbulence;
    
    vec3 color = getGradientColor(t) * intensity * uPulse;
    
    // Apply texture overlay if enabled
    // FIXED: Use vUv (screen space) instead of animatedUV to prevent texture rotation with gradient
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);
      
      // Apply RGB dithering when textures are active to prevent banding artifacts
      vec3 rgbDither = vec3(
        fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(93.9898, 67.345))) * 43758.5453123),
        fract(sin(dot(gl_FragCoord.xy, vec2(41.321, 89.123))) * 43758.5453123)
      );
      rgbDither = (rgbDither - 0.5) / 255.0; // Visible dithering for texture effects
      color += rgbDither;
    }
    
    // Apply hue rotation animation if active
    if (abs(uHueRotation) > 0.01) {
      color = applyHueRotation(color, uHueRotation);
    }
    
    gl_FragColor = vec4(color, layerOpacity);
  }
`;

// Grid gradient shader - pixel-grid gradient with stable block cells
export const gridGradientShader = `
  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform int gridRows;
  uniform int gridCols;
  uniform float intensity;
  uniform float time;
  uniform float hasTexture;
  uniform float textureType;
  uniform float textureIntensity;
  uniform float textureScale;
  uniform float textureOpacity;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float blur;
  uniform float distortion;
  uniform float blendMode;
  uniform float textureAngle;
  uniform float angle;
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
  uniform float uRotation;
  uniform float uScale;
  uniform float scale; // Static scale multiplier
  uniform float uDriftX;
  uniform float uDriftY;
  uniform float uPulse;
  uniform float uTurbulence;
  uniform float uTwist;
  uniform float uHueRotation;
  uniform float mouseX;
  uniform float mouseY;
  uniform float mouseIntensity;
  uniform sampler2D uDisplacementMap;
  uniform float uDisplacementStrength;

  varying vec2 vUv;
  ${SHARED_FUNCTIONS}

  vec3 getGradientColor(float t) {
    t = clamp(t, 0.0, 1.0);
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      if (t <= positions[i + 1]) {
        float localT = (t - positions[i]) / max(positions[i + 1] - positions[i], 0.0001);
        localT = smoothstep(0.0, 1.0, localT);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return colors[colorCount - 1];
  }

  float sampleGridT(vec2 uvIn) {
    vec2 uv = applyDisplacement(uvIn, uDisplacementMap, uDisplacementStrength);
    uv += vec2(uDriftX, uDriftY);

    vec2 center = vec2(0.5) + vec2(mouseX, mouseY) * 0.10 * mouseIntensity;
    vec2 p = uv - center;

    float rot = radians(angle + uRotation);
    float c = cos(rot);
    float s = sin(rot);
    vec2 rp = vec2(p.x * c - p.y * s, p.x * s + p.y * c);

    float zoom = max(uScale * scale, 0.001);
    vec2 cells = max(vec2(float(gridCols), float(gridRows)) * zoom, vec2(1.0));
    vec2 gridPos = (rp + 0.5) * cells;
    vec2 cellId = floor(gridPos);
    vec2 cellCenter = (cellId + 0.5) / cells - 0.5;

    // Evaluate one global directional gradient at each block center.
    float t = dot(cellCenter, normalize(vec2(1.0, 1.0))) + 0.5;
    return clamp(t, 0.0, 1.0);
  }

  void main() {
    float t = sampleGridT(vUv);
    vec3 color = getGradientColor(t) * intensity * uPulse;
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale, textureIntensity * textureOpacity, textureTime, blur, distortion, textureAngle, blendMode, textureOpacity, gridSize, complexity, chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity, blockIrregularity, turbulence, waveCount, colorIntensity, elevationShift, lineThickness);
    }
    if (abs(uHueRotation) > 0.01) {
      color = applyHueRotation(color, uHueRotation);
    }
    gl_FragColor = vec4(color, layerOpacity);
  }
`;

export const voronoiGradientShader = `
  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform float time;
  uniform float scale;
  uniform float intensity;
  uniform int octaves;
  uniform float hasTexture;
  uniform float textureType;
  uniform float textureIntensity;
  uniform float textureScale;
  uniform float textureOpacity;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float blur;
  uniform float distortion;
  uniform float blendMode;
  uniform float textureAngle;
  uniform float angle;
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

  // Interactive Warp Displacement uniforms
  uniform sampler2D uDisplacementMap;
  uniform float uDisplacementStrength;

  varying vec2 vUv;
  
  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}
  
  vec3 getGradientColor(float t) {
    t = clamp(t, 0.0, 1.0);
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      if (t <= positions[i + 1]) {
        float localT = (t - positions[i]) / (positions[i + 1] - positions[i]);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return colors[colorCount - 1];
  }
  
  void main() {
    // Apply drift
    vec2 animatedUV = vUv + vec2(uDriftX, uDriftY);
    animatedUV = applyAudioGlitch(animatedUV); // STAGE 3.0.5b: audio motion
    
    // NEW: Apply shader-driven animation before voronoi evaluation
    vec2 center = vec2(0.5);
    animatedUV = applySharedAnimationField(animatedUV, center, angle, 1.0);
    
    // Apply scale
    animatedUV *= uScale;
    
    // Apply rotation
    vec2 toCenter = animatedUV - vec2(0.5);
    float rotRad = radians(angle + uRotation);
    float cosR = cos(rotRad);
    float sinR = sin(rotRad);
    vec2 rotated = vec2(
      toCenter.x * cosR - toCenter.y * sinR,
      toCenter.x * sinR + toCenter.y * cosR
    ) + vec2(0.5);
    
    // Apply twist (spiral distortion from center)
    vec2 twistUV = rotated;
    if (abs(uTwist) > 0.001) {
      vec2 centered = twistUV - vec2(0.5);
      float dist = length(centered);
      float twistAngle = dist * uTwist * 3.14159;
      float cosT = cos(twistAngle);
      float sinT = sin(twistAngle);
      centered = vec2(
        centered.x * cosT - centered.y * sinT,
        centered.x * sinT + centered.y * cosT
      );
      twistUV = centered + vec2(0.5);
    }
    
    // Enhanced Domain Warping for organic flow
    vec2 uv = applyDomainWarp(twistUV, uTurbulence * 2.0, time, octaves);
    
    // Scale for Voronoi cell density - BETTER BALANCE (4.0 works well)
    vec2 scaledUV = uv * scale * 4.0;
    
    // Voronoi algorithm - find nearest and second nearest cell
    vec2 cellID = floor(scaledUV);
    vec2 cellUV = fract(scaledUV);
    
    float minDist = 10.0;
    vec2 nearestCell = vec2(0.0);
    float secondMinDist = 10.0;
    
    // Search neighboring cells for proper Voronoi regions
    for (float y = -1.0; y <= 1.0; y++) {
      for (float x = -1.0; x <= 1.0; x++) {
        vec2 neighbor = vec2(x, y);
        vec2 neighborCell = cellID + neighbor;
        
        // Generate random point in neighboring cell (stable position)
        float randX = noise(neighborCell + vec2(0.0, 0.0));
        float randY = noise(neighborCell + vec2(100.0, 200.0));
        vec2 randomPoint = neighbor + vec2(randX, randY);
        
        // Animate cell points slightly
        randomPoint += vec2(
          sin(time * 0.3 + randX * 10.0) * 0.05,
          cos(time * 0.3 + randY * 10.0) * 0.05
        );
        
        // Calculate distance to this cell point
        float dist = length(cellUV - randomPoint);
        
        if (dist < minDist) {
          secondMinDist = minDist;
          minDist = dist;
          nearestCell = neighborCell;
        } else if (dist < secondMinDist) {
          secondMinDist = dist;
        }
      }
    }
    
    // Use cell ID for color regions (proper Voronoi cells)
    // Hash the cell ID to get a stable value per cell
    float cellHash = noise(nearestCell * 0.1);
    
    // EXAGGERATED STRETCHED GRADIENTS: Map distance more dramatically
    // Increase multiplier from 0.3 to 1.2 for MUCH more stretch
    float t = cellHash + minDist * 1.2;
    
    // Add edge detection to ensure NO MISSING CELL AREAS
    float edgeDist = secondMinDist - minDist;
    float edge = smoothstep(0.0, 0.02, edgeDist);
    
    // Apply edge with FULL coverage (no gaps)
    float edgeFactor = mix(0.9, 1.0, edge);
    
    t = fract(t); // Keep in 0-1 range
    
    vec3 color = getGradientColor(t) * edgeFactor * intensity * uPulse;
    
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

// Abstract gradient shader - Flowing abstract pattern (formerly diamond)
export const abstractGradientShader = `
  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform float time;
  uniform float scale;
  uniform float intensity;
  uniform float angle;
  uniform float hasTexture;
  uniform float textureType;
  uniform float textureIntensity;
  uniform float textureScale;
  uniform float textureOpacity;
  uniform float textureTime;
  uniform float textureAnimationType;
  uniform float blur;
  uniform float distortion;
  uniform float blendMode;
  uniform float textureAngle;
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

  // Interactive Warp Displacement uniforms
  uniform sampler2D uDisplacementMap;
  uniform float uDisplacementStrength;

  varying vec2 vUv;
  
  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}
  
  vec3 getGradientColor(float t) {
    t = clamp(t, 0.0, 1.0);
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      if (t <= positions[i + 1]) {
        float localT = (t - positions[i]) / (positions[i + 1] - positions[i]);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return colors[colorCount - 1];
  }
  
  float sampleAbstractT(vec2 pUV, float complexityValue, float timeValue) {
    float diamond45 = radians(45.0);
    float cosDiam = cos(diamond45);
    float sinDiam = sin(diamond45);
    vec2 diamondUV = vec2(
      pUV.x * cosDiam - pUV.y * sinDiam,
      pUV.x * sinDiam + pUV.y * cosDiam
    );

    float manhattanDist = abs(diamondUV.x) + abs(diamondUV.y);
    float euclideanDist = length(pUV);
    float theta = atan(diamondUV.y, diamondUV.x);

    float patternFreq = 2.0 + complexityValue * 0.22;
    float angularFreq = floor(3.0 + complexityValue * 0.55 + 0.5);

    float ringField = 0.5 + 0.5 * sin(manhattanDist * patternFreq * 6.28318 + timeValue * 0.04);
    float radialField = 0.5 + 0.5 * cos(euclideanDist * patternFreq * 5.0 - timeValue * 0.03);
    float angularField = 0.5 + 0.5 * cos(theta * angularFreq + euclideanDist * 2.0);

    float tt = mix(ringField, radialField, 0.42);
    tt = mix(tt, angularField, 0.18 + complexityValue * 0.01);
    float microNoise = (noise(pUV * (8.0 + complexityValue * 1.4) + timeValue * 0.08) - 0.5) * 0.015;
    return clamp(tt + microNoise, 0.0, 1.0);
  }

  void main() {
    // Apply drift
    vec2 animatedUV = vUv + vec2(uDriftX, uDriftY);
    animatedUV = applyAudioGlitch(animatedUV); // STAGE 3.0.5b: audio motion
    
    // NEW: Apply shader-driven animation field early (perfect for abstract patterns)
    vec2 interactiveCenter = center + vec2(mouseX, mouseY) * 0.5 * mouseIntensity;
    animatedUV = applySharedAnimationField(animatedUV, interactiveCenter, angle, 1.0);
    
    // Center UV
    vec2 uv = animatedUV - interactiveCenter;
    
    // Apply rotation (gradient angle + animation rotation)
    float totalAngle = radians(angle + uRotation);
    float cosA = cos(totalAngle);
    float sinA = sin(totalAngle);
    vec2 rotated = vec2(
      uv.x * cosA - uv.y * sinA,
      uv.x * sinA + uv.y * cosA
    );
    
    // Apply twist (spiral distortion)
    vec2 twistedUV = rotated;
    if (abs(uTwist) > 0.001) {
      float dist = length(rotated);
      float twistAngle = dist * uTwist * 3.14159;
      float cosT = cos(twistAngle);
      float sinT = sin(twistAngle);
      twistedUV = vec2(
        rotated.x * cosT - rotated.y * sinT,
        rotated.x * sinT + rotated.y * cosT
      );
    }
    
    // Apply scale
    twistedUV *= scale * uScale;
    
    // Enhanced Domain Warping
    twistedUV = applyDomainWarp(twistedUV + interactiveCenter, uTurbulence * 2.0, time, 3) - interactiveCenter;
    
    vec2 aa = max(fwidth(vUv) * 0.22, vec2(0.00018));
    float t0 = sampleAbstractT(twistedUV, complexity, time);
    float t1 = sampleAbstractT(twistedUV + vec2( aa.x, 0.0), complexity, time);
    float t2 = sampleAbstractT(twistedUV + vec2(-aa.x, 0.0), complexity, time);
    float t3 = sampleAbstractT(twistedUV + vec2(0.0,  aa.y), complexity, time);
    float t4 = sampleAbstractT(twistedUV + vec2(0.0, -aa.y), complexity, time);
    float t = clamp(t0 * 0.60 + (t1 + t2 + t3 + t4) * 0.10, 0.0, 1.0);
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