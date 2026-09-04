import * as THREE from '../lib/three';
import { EffectsConfig } from '../components/controls/EffectsControls';
import { withOutputColorSpace } from '../shaders/outputColorSpace';

// Convert shape string to integer for shader
function shapeToInt(shape: string): number {
  const shapeMap: Record<string, number> = {
    'square': 0,
    'circle': 1,
    'hexagon': 2,
    'diamond': 3,
    'triangle': 4,
    'lines': 5,
  };
  return shapeMap[shape] || 0;
}

// Convert dithering string to integer for shader
function ditheringToInt(dithering: string): number {
  const ditheringMap: Record<string, number> = {
    'none': 0,
    'bayer': 1,
    'noise': 2,
    'blueNoise': 3,
    'scanline': 4,
    'dotDiffusion': 5,
    'crosshatch': 6,
  };
  return ditheringMap[dithering] || 0;
}

// Create a post-processing shader material that applies all effects
export function createEffectsMaterial(effects: EffectsConfig): THREE.ShaderMaterial {
  const vertexShader = `
    varying vec2 vUv;
    
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const fragmentShader = `
    uniform sampler2D tDiffuse;
    uniform float blur;
    uniform float chromaticAberration;
    uniform float vignette;
    uniform float saturation;
    uniform float brightness;
    uniform float contrast;
    uniform float hueShift;
    uniform float filmGrain;
    uniform float filmGrainSize;
    uniform float temperature;
    uniform float tint;
    uniform float posterize;
    uniform float ditherStrength;
    uniform float ditherScale;
    uniform float halftone;
    uniform float halftoneAngle;
    uniform float shapeOverlay; // Shape-based overlay effect
    uniform float pixelate; // Proper pixelation
    uniform int posterizeDithering; // 0=none, 1=bayer, 2=noise, 3=blue-noise hash, 4=scanline, 5=dot diffusion, 6=crosshatch
    uniform int creativeShape; // 0=square, 1=circle, 2=hexagon, 3=diamond, 4=triangle, 5=lines
    uniform bool posterizeEnabled;
    uniform bool halftoneEnabled;
    uniform bool shapeOverlayEnabled;
    uniform bool pixelateEnabled;
    uniform bool invert;
    uniform float time;
    uniform vec2 resolution;
    // STAGE 3.0.5: audio SHAKE. A UV offset applied to the composited frame, so
    // the IMAGERY jolts while the quad stays put. Because it shifts the sample
    // coordinate (not the mesh), the frame never leaves its bounds — clamped
    // edges smear rather than reveal black. Zero when audio isn't driving it,
    // so a non-shaking frame samples exactly as before.
    uniform vec2 uShake;
    // PHASE 1: Fresnel Effect
    uniform bool fresnelEnabled;
    uniform float fresnelPower;
    uniform float fresnelIntensity;

    // Sprint 2: Shader-based flash uniforms — replaces CSS div overlays.
    // Flash is applied after all effects and respects mask alpha so masked regions never flash.
    uniform float uFlashOpacity;   // 0.0 = off, LFO-driven when on
    uniform vec3  uFlashColor;     // flash color (1,1,1 = white, palette or hue-rotated)
    uniform int   uFlashPosition;  // 0=full, 1=topbottom, 2=sides, 3=corners, 4=cornersAlt, 5=opposite, 6=centerBurst
    uniform int   uFlashBeatGroup; // 0-3, active quadrant for alternating modes
    uniform int   uFlashBlendMode; // 0=screen/light (brighten), 1=multiply/dark (darken toward black)

    varying vec2 vUv;
    
    // Stronger post AA to reduce stair-stepping and pseudo-stroke buildup on
    // hard procedural boundaries across multiple gradient types.
    vec3 applyLightAA(vec2 uv, vec3 baseColor) {
      vec2 texel = 1.0 / max(resolution, vec2(1.0));
      vec3 n  = texture2D(tDiffuse, uv + vec2(0.0, -1.0) * texel).rgb;
      vec3 s  = texture2D(tDiffuse, uv + vec2(0.0,  1.0) * texel).rgb;
      vec3 e  = texture2D(tDiffuse, uv + vec2( 1.0, 0.0) * texel).rgb;
      vec3 w  = texture2D(tDiffuse, uv + vec2(-1.0, 0.0) * texel).rgb;
      vec3 ne = texture2D(tDiffuse, uv + vec2( 1.0, -1.0) * texel).rgb;
      vec3 nw = texture2D(tDiffuse, uv + vec2(-1.0, -1.0) * texel).rgb;
      vec3 se = texture2D(tDiffuse, uv + vec2( 1.0,  1.0) * texel).rgb;
      vec3 sw = texture2D(tDiffuse, uv + vec2(-1.0,  1.0) * texel).rgb;

      vec3 lumaWeights = vec3(0.299, 0.587, 0.114);
      float lC  = dot(baseColor, lumaWeights);
      float lN  = dot(n,  lumaWeights);
      float lS  = dot(s,  lumaWeights);
      float lE  = dot(e,  lumaWeights);
      float lW  = dot(w,  lumaWeights);
      float lNE = dot(ne, lumaWeights);
      float lNW = dot(nw, lumaWeights);
      float lSE = dot(se, lumaWeights);
      float lSW = dot(sw, lumaWeights);

      float lMin = min(lC, min(min(min(lN, lS), min(lE, lW)), min(min(lNE, lNW), min(lSE, lSW))));
      float lMax = max(lC, max(max(max(lN, lS), max(lE, lW)), max(max(lNE, lNW), max(lSE, lSW))));
      float contrast = lMax - lMin;
      float edge = smoothstep(0.02, 0.12, contrast);

      vec3 cardinal = (n + s + e + w) * 0.125;
      vec3 diagonal = (ne + nw + se + sw) * 0.0625;
      vec3 neighborhood = baseColor * 0.5 + cardinal + diagonal;
      return mix(baseColor, neighborhood, edge * 0.38);
    }

    // RGB to HSV conversion
    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }
    
    // HSV to RGB conversion
    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }
    
    // Random function for noise
    float random(vec2 st) {
      return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }
    
    // High quality STATIC grain (no animation)
    float filmGrainNoise(vec2 uv) {
      return fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453123);
    }
    
    // Shape detection functions for pixelate and halftone
    float getShape(vec2 cellPos, vec2 cellCenter, float size, int shape) {
      vec2 delta = cellPos - cellCenter;
      float dist = length(delta);
      
      if (shape == 0) { // Square
        return (abs(delta.x) < size * 0.4 && abs(delta.y) < size * 0.4) ? 1.0 : 0.0;
      } else if (shape == 1) { // Circle
        return (dist < size * 0.4) ? 1.0 : 0.0;
      } else if (shape == 2) { // Hexagon
        float angle = atan(delta.y, delta.x);
        float hexDist = cos(floor(0.5 + angle / 1.047197) * 1.047197 - angle) * dist;
        return (hexDist < size * 0.4) ? 1.0 : 0.0;
      } else if (shape == 3) { // Diamond
        float diamondDist = abs(delta.x) + abs(delta.y);
        return (diamondDist < size * 0.5) ? 1.0 : 0.0;
      } else if (shape == 4) { // Triangle - handled specially in tessellation
        // This shouldn't be called for triangles when proper tessellation is used
        return 1.0;
      } else if (shape == 5) { // Lines (horizontal)
        return (abs(delta.y) < size * 0.1) ? 1.0 : 0.0;
      }
      
      return 1.0;
    }
    
    // Triangle tessellation - proper interlocking pattern
    float getTriangleTessellation(vec2 pixelPos, float size) {
      // Equilateral triangle dimensions
      float triangleHeight = size * 0.866; // sqrt(3)/2
      float halfWidth = size * 0.5;
      
      // Calculate row and column in tessellation
      float row = floor(pixelPos.y / triangleHeight);
      float col = floor(pixelPos.x / size);
      
      // Position within cell
      vec2 cellPos = vec2(
        mod(pixelPos.x, size),
        mod(pixelPos.y, triangleHeight)
      );
      
      // Determine if triangle points up or down (checkerboard pattern)
      bool pointsUp = mod(row + col, 2.0) < 1.0;
      
      // Check if point is inside triangle
      if (pointsUp) {
        // Triangle pointing UP: peak at top, base at bottom
        float edgeLeft = cellPos.y * (halfWidth / triangleHeight);
        float edgeRight = size - (cellPos.y * (halfWidth / triangleHeight));
        return (cellPos.x >= edgeLeft && cellPos.x <= edgeRight) ? 1.0 : 0.0;
      } else {
        // Triangle pointing DOWN: base at top, peak at bottom
        float edgeLeft = (triangleHeight - cellPos.y) * (halfWidth / triangleHeight);
        float edgeRight = size - ((triangleHeight - cellPos.y) * (halfWidth / triangleHeight));
        return (cellPos.x >= edgeLeft && cellPos.x <= edgeRight) ? 1.0 : 0.0;
      }
    }
    
    // Shape-based halftone2 effect (renamed from old pixelate)
    vec3 applyHalftone2(vec2 uv, float amount, int shape) {
      if (amount < 1.0) return texture2D(tDiffuse, uv).rgb;
      
      // Use exponential scaling for better control
      float pixelSize = pow(amount / 10.0, 1.5) * 10.0;
      pixelSize = max(pixelSize, 1.0);
      
      vec2 pixelPos = uv * resolution;
      
      // SPECIAL HANDLING FOR TRIANGLES - Use tessellation
      if (shape == 4) {
        float shapeMask = getTriangleTessellation(pixelPos, pixelSize);
        
        // Sample color based on tessellation
        float triangleHeight = pixelSize * 0.866;
        float row = floor(pixelPos.y / triangleHeight);
        float col = floor(pixelPos.x / pixelSize);
        vec2 cellCenter = vec2((col + 0.5) * pixelSize, (row + 0.5) * triangleHeight);
        vec2 sampleUV = cellCenter / resolution;
        vec3 cellColor = texture2D(tDiffuse, sampleUV).rgb;
        
        if (shapeMask > 0.5) {
          return cellColor;
        } else {
          return texture2D(tDiffuse, uv).rgb * 0.3;
        }
      }
      
      // REGULAR SHAPES - Standard grid approach
      vec2 cellIndex = floor(pixelPos / pixelSize);
      vec2 cellCenter = (cellIndex + 0.5) * pixelSize;
      
      // Sample color from cell center with UV wrapping
      vec2 sampleUV = cellCenter / resolution;
      vec3 cellColor = texture2D(tDiffuse, sampleUV).rgb;
      
      // Apply shape mask with wrapping for seamless edges
      float shapeMask = getShape(pixelPos, cellCenter, pixelSize, shape);
      
      // Check if we're near an edge and need to wrap
      vec2 edgeDist = min(pixelPos, resolution - pixelPos);
      if (edgeDist.x < pixelSize || edgeDist.y < pixelSize) {
        // Near edge - also check wrapped cell positions
        vec2 wrappedCenter = cellCenter;
        
        // Wrap horizontally if needed
        if (pixelPos.x < pixelSize) {
          wrappedCenter.x += resolution.x;
        } else if (pixelPos.x > resolution.x - pixelSize) {
          wrappedCenter.x -= resolution.x;
        }
        
        // Wrap vertically if needed
        if (pixelPos.y < pixelSize) {
          wrappedCenter.y += resolution.y;
        } else if (pixelPos.y > resolution.y - pixelSize) {
          wrappedCenter.y -= resolution.y;
        }
        
        // Check shape with wrapped center
        float wrappedMask = getShape(pixelPos, wrappedCenter, pixelSize, shape);
        shapeMask = max(shapeMask, wrappedMask);
      }
      
      // Return shaped pixel or background
      if (shapeMask > 0.5) {
        return cellColor;
      } else {
        // For non-square shapes, show background texture
        return texture2D(tDiffuse, uv).rgb * 0.3;
      }
    }
    
    // PROPER pixelate effect with high-quality super-sampling (RESTORED!)
    vec3 applyPixelate(vec2 uv, float amount) {
      if (amount < 1.0) return texture2D(tDiffuse, uv).rgb;
      
      // Use exponential scaling for better control
      // Small values = fine detail, large values = dramatic pixelation
      float pixelSize = pow(amount / 10.0, 1.5) * 10.0;
      pixelSize = max(pixelSize, 1.0);
      
      // Calculate pixel grid
      vec2 pixelatedUV = floor(uv * resolution / pixelSize) * pixelSize / resolution;
      
      // Super-sample 4 points for smoother, more visually pleasing pixels
      // This reduces aliasing and creates more professional-looking results
      vec3 color = vec3(0.0);
      float samples = 4.0;
      float offset = pixelSize / resolution.x * 0.25;
      
      color += texture2D(tDiffuse, pixelatedUV + vec2(0.0, 0.0)).rgb;
      color += texture2D(tDiffuse, pixelatedUV + vec2(offset, 0.0)).rgb;
      color += texture2D(tDiffuse, pixelatedUV + vec2(0.0, offset)).rgb;
      color += texture2D(tDiffuse, pixelatedUV + vec2(offset, offset)).rgb;
      
      return color / samples;
    }
    
    // Halftone effect with angle and shape support
    vec3 applyHalftone(vec3 color, vec2 uv, float amount, float angle, int shape) {
      if (amount < 1.0) return color;
      
      // Convert to grayscale
      float gray = dot(color, vec3(0.299, 0.587, 0.114));
      
      // Rotate UV based on angle
      float angleRad = radians(angle);
      vec2 center = vec2(0.5, 0.5);
      vec2 uvCentered = uv - center;
      mat2 rotation = mat2(cos(angleRad), -sin(angleRad), sin(angleRad), cos(angleRad));
      vec2 rotatedUV = rotation * uvCentered + center;
      
      // Create halftone pattern
      vec2 pixelPos = rotatedUV * resolution;
      float dotSize = amount;
      vec2 cellIndex = floor(pixelPos / dotSize);
      vec2 cellCenter = (cellIndex + 0.5) * dotSize;
      
      // Adjust dot size based on luminance
      float dotScale = 1.0 - gray;
      float adjustedDotSize = dotSize * dotScale;
      
      // Apply shape mask with luminance-based sizing
      float shapeMask = getShape(pixelPos, cellCenter, adjustedDotSize, shape);
      
      return mix(color, vec3(0.0), 1.0 - shapeMask);
    }
    
    // Simple blur
    vec3 applyBlur(vec2 uv, float amount) {
      if (amount < 0.01) return texture2D(tDiffuse, uv).rgb;
      
      vec3 color = vec3(0.0);
      float total = 0.0;
      float radius = amount * 0.005;
      
      for(float x = -2.0; x <= 2.0; x++) {
        for(float y = -2.0; y <= 2.0; y++) {
          vec2 offset = vec2(x, y) * radius;
          color += texture2D(tDiffuse, uv + offset).rgb;
          total += 1.0;
        }
      }
      
      return color / total;
    }
    
    // Chromatic aberration — lateral prismatic RGB split.
    // amount is in the same 0–1 UV-normalised space as the effects slider.
    // At amount = 1.0 the lateral offset is 3% of the frame width, which is
    // clearly visible without destroying the composition. The old radial
    // approach used direction = (uv - 0.5) and strength = amount * 1.0, which
    // sent UV coordinates 12+ units out of bounds at audio-hit magnitudes and
    // caused the GPU to clamp-stretch each corner into a solid quadrant (the
    // "4-quadrant split" bug). Lateral offsets stay well inside [0,1] and the
    // explicit clamp() below is a belt-and-suspenders guard against rounding.
    vec3 applyChromaticAberration(vec2 uv, float amount) {
      if (amount < 0.001) return texture2D(tDiffuse, uv).rgb;

      // 3% UV per unit — at slider=1 or a full audio hit: ±0.03 UV (~58px on 1920w)
      float strength = amount * 0.03;

      // R shifts left, B shifts right → classic prismatic lateral fringe
      float r = texture2D(tDiffuse, clamp(uv - vec2(strength, 0.0), 0.0, 1.0)).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, clamp(uv + vec2(strength, 0.0), 0.0, 1.0)).b;

      return vec3(r, g, b);
    }
    
    // Film grain - MUCH MORE VISIBLE with animated noise
    vec3 applyFilmGrain(vec3 color, vec2 uv, float amount, float grainSize) {
      if (amount < 0.01) return color;
      
      // Ultra-high frequency for visible grain
      float frequency = 500.0 / max(grainSize, 0.1);
      vec2 grainUV = uv * resolution / frequency;
      
      // Generate animated noise
      float noise = filmGrainNoise(grainUV);
      
      // Make grain MUCH stronger - increased from 0.05 to 0.5!
      float grainValue = (noise - 0.5) * amount * 2.0;
      
      // Apply to luminance for realistic film grain
      return clamp(color + vec3(grainValue), 0.0, 1.0);
    }
    
    // Vignette
    vec3 applyVignette(vec3 color, vec2 uv, float intensity) {
      if (intensity < 0.01) return color;
      
      vec2 position = uv - vec2(0.5);
      float dist = length(position);
      float vig = smoothstep(0.8, 0.4, dist);
      vig = mix(1.0, vig, intensity);
      return color * vig;
    }
    
    // Color adjustments
    vec3 adjustColor(vec3 color, float sat, float bright, float cont) {
      // Brightness
      color *= bright;
      
      // Contrast
      color = (color - 0.5) * cont + 0.5;
      
      // Saturation
      float gray = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(gray), color, sat);
      
      return clamp(color, 0.0, 1.0);
    }
    
    // Temperature adjustment
    vec3 applyTemperature(vec3 color, float temp) {
      if (abs(temp) < 0.01) return color;
      
      float t = temp * 0.01;
      color.r *= 1.0 + t * 0.3;
      color.b *= 1.0 - t * 0.3;
      
      return clamp(color, 0.0, 1.0);
    }
    
    // Tint adjustment
    vec3 applyTint(vec3 color, float tintAmount) {
      if (abs(tintAmount) < 0.01) return color;
      
      float t = tintAmount * 0.01;
      color.g *= 1.0 + t * 0.3;
      color.r *= 1.0 - abs(t) * 0.2;
      color.b *= 1.0 - abs(t) * 0.2;
      
      return clamp(color, 0.0, 1.0);
    }
    
    float bayer4(vec2 pixel) {
      vec2 p = mod(pixel, 4.0);
      float x = p.x;
      float y = p.y;
      float row0 = mix(mix(0.0, 8.0, step(1.0, x)), mix(2.0, 10.0, step(3.0, x)), step(2.0, x));
      float row1 = mix(mix(12.0, 4.0, step(1.0, x)), mix(14.0, 6.0, step(3.0, x)), step(2.0, x));
      float row2 = mix(mix(3.0, 11.0, step(1.0, x)), mix(1.0, 9.0, step(3.0, x)), step(2.0, x));
      float row3 = mix(mix(15.0, 7.0, step(1.0, x)), mix(13.0, 5.0, step(3.0, x)), step(2.0, x));
      float upper = mix(row0, row1, step(1.0, y));
      float lower = mix(row2, row3, step(3.0, y));
      return (mix(upper, lower, step(2.0, y)) + 0.5) / 16.0;
    }

    // Stable hash dither with a blue-noise-like high-frequency distribution.
    float blueNoiseHash(vec2 pixel) {
      float a = random(pixel * vec2(0.754877, 0.569840));
      float b = random((pixel + vec2(37.0, 17.0)) * vec2(1.324718, 2.236068));
      return fract(a + b * 0.618034);
    }

    float scanlineDither(vec2 pixel) {
      float row = mod(pixel.y, 4.0);
      float rowBias = mix(-0.35, 0.35, step(2.0, row));
      float fine = random(vec2(pixel.x, floor(pixel.y * 0.5))) - 0.5;
      return clamp(0.5 + rowBias + fine * 0.35, 0.0, 1.0);
    }

    float dotDiffusionDither(vec2 pixel) {
      vec2 cell = mod(pixel, 6.0) - 3.0;
      float dot = smoothstep(3.2, 0.0, length(cell));
      float jitter = random(floor(pixel / 6.0)) * 0.25;
      return clamp(dot * 0.85 + jitter, 0.0, 1.0);
    }

    float crosshatchDither(vec2 pixel) {
      float a = step(0.5, mod(pixel.x + pixel.y, 8.0) / 8.0);
      float b = step(0.5, mod(pixel.x - pixel.y + 64.0, 8.0) / 8.0);
      float noise = random(floor(pixel / 2.0)) * 0.2;
      return clamp((a + b) * 0.35 + noise, 0.0, 1.0);
    }

    // Posterize. User-facing posterize is 0-100; curve is intentionally front-loaded
    // so 30% is already visible and 60% feels strong for design-use dithering.
    vec3 applyPosterize(vec3 color, vec2 uv, float amount, int dithering, int shape, float dStrength, float dScale) {
      if (amount <= 0.01) return color;

      float strength = clamp(amount / 100.0, 0.0, 1.0);
      float curvedStrength = pow(strength, 0.45);
      float l = floor(mix(24.0, 2.0, curvedStrength) + 0.5);
      float stepSize = 1.0 / max(1.0, l - 1.0);

      float density = mix(0.28, 2.4, clamp(dScale / 100.0, 0.0, 1.0));
      vec2 pixel = floor(uv * resolution * density);
      vec3 working = color;
      float threshold = 0.5;
      float amp = mix(0.0, 3.25, clamp(dStrength / 100.0, 0.0, 1.0));
      
      if (dithering == 1) {
        threshold = bayer4(pixel);
        amp *= 1.1;
      } else if (dithering == 2) {
        threshold = random(pixel + floor(time * 24.0));
        amp *= 1.35;
      } else if (dithering == 3) {
        threshold = blueNoiseHash(pixel);
        amp *= 1.25;
      } else if (dithering == 4) {
        threshold = scanlineDither(pixel);
        amp *= 1.2;
      } else if (dithering == 5) {
        threshold = dotDiffusionDither(pixel);
        amp *= 1.3;
      } else if (dithering == 6) {
        threshold = crosshatchDither(pixel);
        amp *= 1.25;
      }

      if (dithering > 0) {
        vec3 lumaBias = vec3(dot(color, vec3(0.299, 0.587, 0.114)));
        vec3 pushed = mix(color, lumaBias, clamp(strength * 0.24, 0.0, 0.24));
        working = clamp(pushed + (threshold - 0.5) * stepSize * amp, 0.0, 1.0);
      }
      
      return floor(working * (l - 1.0) + 0.5) / (l - 1.0);
    }
    
    // Hue shift
    vec3 applyHueShift(vec3 color, float shift) {
      if (abs(shift) < 0.001) return color;
      
      vec3 hsv = rgb2hsv(color);
      hsv.x = fract(hsv.x + shift / 360.0);
      return hsv2rgb(hsv);
    }
    
    // PHASE 1: Fresnel Effect - Edge lighting based on viewing angle
    vec3 applyFresnelEffect(vec3 color, vec2 uv, float power, float intensity) {
      // Create pseudo-normal from UV position (centered)
      vec2 centered = uv - 0.5;
      float dist = length(centered);
      
      // Enhanced Fresnel approximation using distance from center
      // Invert so edges are bright
      float edgeDist = clamp(dist * 2.0, 0.0, 1.0);
      float fresnel = pow(edgeDist, power);
      
      // Strengthen edge glow effect
      vec3 edgeColor = color * (1.0 + fresnel * intensity * 4.0);
      
      // Add strong white rim at extreme edges for glass/chrome effect
      edgeColor += vec3(fresnel * fresnel * intensity * 1.5);
      
      return mix(color, edgeColor, intensity);
    }
    
    void main() {
      // STAGE 3.0.5: apply audio shake FIRST, so every downstream sample
      // (chroma, blur, all effects) reads from the jolted coordinate. Clamp so
      // the smeared edge stays in-bounds rather than wrapping.
      vec2 uv = clamp(vUv + uShake, 0.0, 1.0);
      
      // Start with initial sample - apply chromatic aberration if active
      vec3 color;
      float alpha; // Preserve alpha channel from mask
      
      if (chromaticAberration > 0.01) {
        color = applyChromaticAberration(uv, chromaticAberration);
        alpha = texture2D(tDiffuse, uv).a; // Preserve original alpha
      } else {
        vec4 originalColor = texture2D(tDiffuse, uv);
        color = originalColor.rgb;
        alpha = originalColor.a; // Preserve alpha from masked gradient
      }
      
      // Apply blur if active
      if (blur > 0.01) {
        color = applyBlur(uv, blur);
        // Alpha is already captured above
      }
      
      // Apply pixelation if active (overrides blur/chroma)
      if (pixelateEnabled && pixelate > 0.0) {
        color = applyPixelate(uv, pixelate);
      }
      
      // Apply shape overlay if active (FIXED - was missing!)
      if (shapeOverlayEnabled && shapeOverlay > 0.0) {
        color = applyHalftone2(uv, shapeOverlay, creativeShape);
      }
      
      // Apply posterize
      if (posterizeEnabled && posterize > 0.01) {
        color = applyPosterize(color, uv, posterize, posterizeDithering, creativeShape, ditherStrength, ditherScale);
      }
      
      // Apply halftone
      if (halftoneEnabled && halftone > 0.01) {
        color = applyHalftone(color, uv, halftone, halftoneAngle, creativeShape);
      }
      
      // Apply temperature and tint
      if (abs(temperature) > 0.01) {
        color = applyTemperature(color, temperature);
      }
      if (abs(tint) > 0.01) {
        color = applyTint(color, tint);
      }
      
      // Apply color adjustments
      color = adjustColor(color, saturation, brightness, contrast);
      
      // Apply hue shift
      if (abs(hueShift) > 0.01) {
        color = applyHueShift(color, hueShift);
      }
      
      // Apply film grain
      if (filmGrain > 0.01) {
        color = applyFilmGrain(color, uv, filmGrain, filmGrainSize);
      }
      
      // Apply vignette
      if (vignette > 0.01) {
        color = applyVignette(color, uv, vignette);
      }
      
      // PHASE 1: Apply Fresnel effect (edge lighting)
      if (fresnelEnabled) {
        color = applyFresnelEffect(color, uv, fresnelPower, fresnelIntensity);
      }
      
      // Apply invert
      if (invert) {
        color = vec3(1.0) - color;
      }
      
      color = applyLightAA(vUv, color);

      // Sprint 2: Shader-based flash compositing — respects mask alpha.
      // By multiplying effective opacity by alpha, the flash only brightens
      // pixels the mask declared visible — solving the mask boundary bug where
      // CSS div overlays would illuminate the entire canvas frame including
      // transparent (masked-out) regions.
      if (uFlashOpacity > 0.001) {
        // Compute UV-based position mask
        float flashMask = 1.0;
        if (uFlashPosition == 1) {
          // topbottom: brightest at top and bottom edges, fades toward center
          float topEdge = smoothstep(0.5, 0.85, 1.0 - vUv.y);
          float botEdge = smoothstep(0.5, 0.85, vUv.y);
          flashMask = max(topEdge, botEdge);
        } else if (uFlashPosition == 2) {
          // sides: brightest at left and right edges
          float leftEdge  = smoothstep(0.5, 0.1, vUv.x);
          float rightEdge = smoothstep(0.5, 0.9, vUv.x);
          flashMask = max(leftEdge, rightEdge);
        } else if (uFlashPosition == 3 || uFlashPosition == 4) {
          // corners (sync or alternate): radial fade from each corner
          float tl = smoothstep(0.55, 0.0, length(vUv - vec2(0.0, 1.0)));
          float tr = smoothstep(0.55, 0.0, length(vUv - vec2(1.0, 1.0)));
          float bl = smoothstep(0.55, 0.0, length(vUv - vec2(0.0, 0.0)));
          float br = smoothstep(0.55, 0.0, length(vUv - vec2(1.0, 0.0)));
          if (uFlashPosition == 3) {
            flashMask = max(max(tl, tr), max(bl, br));
          } else {
            // cornersAlt — only the active beat group corner lights
            if (uFlashBeatGroup == 0) flashMask = tl;
            else if (uFlashBeatGroup == 1) flashMask = tr;
            else if (uFlashBeatGroup == 2) flashMask = br;
            else flashMask = bl;
          }
        } else if (uFlashPosition == 5) {
          // opposite — alternate between topbottom and sides each beat
          if (uFlashBeatGroup == 0) {
            float topEdge = smoothstep(0.5, 0.9, 1.0 - vUv.y);
            float botEdge = smoothstep(0.5, 0.9, vUv.y);
            flashMask = max(topEdge, botEdge);
          } else {
            float leftEdge  = smoothstep(0.5, 0.1, vUv.x);
            float rightEdge = smoothstep(0.5, 0.9, vUv.x);
            flashMask = max(leftEdge, rightEdge);
          }
        } else if (uFlashPosition == 6) {
          // centerBurst: brightest at center, fades to edges
          float distFromCenter = length(vUv - vec2(0.5));
          flashMask = smoothstep(0.65, 0.0, distFromCenter);
        }
        // else uFlashPosition == 0 (full): flashMask stays 1.0

        // Apply flash blend — respects mask alpha (effectiveOp = 0 on masked-out pixels).
        // uFlashBlendMode 0: screen blend  → brightens toward uFlashColor (light flash)
        // uFlashBlendMode 1: multiply blend → darkens toward black (dark/shadow flash)
        float effectiveOp = uFlashOpacity * flashMask * alpha;
        if (uFlashBlendMode == 0) {
          // Screen blend: additive brightening
          color = 1.0 - (1.0 - color) * (1.0 - uFlashColor * effectiveOp);
        } else {
          // Multiply blend: subtractive shadow (color * (1 - op) → black at op=1)
          color = color * (1.0 - effectiveOp);
        }
      }

      // Output with PRESERVED ALPHA from mask
      gl_FragColor = vec4(color, alpha);
    }
  `;

  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      blur: { value: effects.blur },
      chromaticAberration: { value: effects.chromaticAberration },
      vignette: { value: effects.vignette },
      saturation: { value: effects.saturation },
      brightness: { value: effects.brightness },
      contrast: { value: effects.contrast },
      hueShift: { value: effects.hueShift },
      filmGrain: { value: effects.filmGrain || 0 },
      filmGrainSize: { value: effects.filmGrainSize || 1 },
      temperature: { value: effects.temperature || 0 },
      tint: { value: effects.tint || 0 },
      posterize: { value: effects.posterize || 0 },
      ditherStrength: { value: effects.ditherStrength ?? 65 },
      ditherScale: { value: effects.ditherScale ?? 50 },
      halftone: { value: effects.halftone || 0 },
      halftoneAngle: { value: effects.halftoneAngle || 0 },
      shapeOverlay: { value: effects.shapeOverlay || 0 },
      pixelate: { value: effects.pixelate || 0 },
      posterizeDithering: { value: ditheringToInt(effects.posterizeDithering || 'none') },
      creativeShape: { value: shapeToInt(effects.creativeShape || 'square') },
      posterizeEnabled: { value: effects.posterizeEnabled || false },
      halftoneEnabled: { value: effects.halftoneEnabled || false },
      shapeOverlayEnabled: { value: effects.shapeOverlayEnabled || false },
      pixelateEnabled: { value: effects.pixelateEnabled || false },
      invert: { value: effects.invert || false },
      time: { value: 0 },
      resolution: { value: new THREE.Vector2(1920, 1080) },
      // STAGE 3.0.5: audio shake offset (UV space). Driven per-frame from the
      // global audio deltas; stays (0,0) whenever nothing routes to Shake.
      uShake: { value: new THREE.Vector2(0, 0) },
      // PHASE 1: Fresnel Effect
      fresnelEnabled: { value: effects.fresnelEnabled || false },
      fresnelPower: { value: effects.fresnelPower || 2 },
      fresnelIntensity: { value: effects.fresnelIntensity || 0.5 },
      // Sprint 2: shader-based flash — driven by flash RAF loop in GradientCanvas
      uFlashOpacity:   { value: 0.0 },
      uFlashColor:     { value: new THREE.Vector3(1, 1, 1) },
      uFlashPosition:  { value: 0 },
      uFlashBeatGroup: { value: 0 },
      uFlashBlendMode: { value: 0 }, // 0=screen (light), 1=multiply (dark)
    },
    vertexShader,
    fragmentShader: withOutputColorSpace(fragmentShader),
    transparent: true, // Enable transparency to respect alpha channel
    depthWrite: false, // Disable depth writing for proper alpha blending
  });
}

// Check if any effects are active
export function hasActiveEffects(effects: EffectsConfig): boolean {
  return (
    effects.blur > 0 ||
    effects.chromaticAberration > 0 ||
    effects.vignette > 0 ||
    Math.abs(effects.saturation - 1) > 0.01 ||
    Math.abs(effects.brightness - 1) > 0.01 ||
    Math.abs(effects.contrast - 1) > 0.01 ||
    Math.abs(effects.hueShift) > 0.01 ||
    (effects.filmGrain || 0) > 0 ||
    (effects.temperature || 0) !== 0 ||
    (effects.tint || 0) !== 0 ||
    (effects.posterizeEnabled && (effects.posterize || 0) > 0) ||
    (effects.halftoneEnabled && effects.halftone > 0) ||
    (effects.shapeOverlayEnabled && effects.shapeOverlay > 0) ||
    (effects.pixelateEnabled && effects.pixelate > 0) ||
    effects.invert ||
    effects.fresnelEnabled || // PHASE 1: Fresnel effect
    effects.flashEnabled      // Flash FX — needs post-process path to run the flash shader
  );
}

export interface PostProcessAudioDeltas {
  shakeX: number;
  shakeY: number;
  chromaAdd: number;
  brightnessAdd: number;
  blurAdd: number;
  saturationAdd: number;
  vignetteAdd: number;
  strobeAdd: number;
}

/**
 * Single authority for deciding whether a frame uses the post-process graph.
 * Preview and deterministic export must call this same predicate or their
 * pixels can diverge even before capture/encoding begins.
 */
export function shouldUsePostProcess(
  effects: EffectsConfig,
  audio: PostProcessAudioDeltas,
): boolean {
  return hasActiveEffects(effects) ||
    audio.shakeX !== 0 ||
    audio.shakeY !== 0 ||
    audio.chromaAdd > 0.001 ||
    audio.brightnessAdd > 0.001 ||
    audio.blurAdd > 0.001 ||
    audio.saturationAdd > 0.001 ||
    audio.vignetteAdd > 0.001 ||
    audio.strobeAdd > 0.001;
}
