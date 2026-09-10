import { SHARED_FUNCTIONS } from './gradientShaders';
import { SHARED_ANIMATION_HELPERS } from './animationHelpers';

export const kaleidoscopeGradientShader = `
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
  uniform float textureAngle;
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
  uniform float uHueRotation;

  // Shader-driven animation uniforms
  uniform float uAnimPhase;
  uniform float uAnimEased;
  uniform float uAnimTime;
  uniform float uAnimIntensity;
  uniform float uAnimType;

  // Interactive mode uniforms
  uniform float mouseX;
  uniform float mouseY;
  uniform float mouseIntensity;

  // Displacement uniforms
  uniform sampler2D uDisplacementMap;
  uniform float uDisplacementStrength;

  // Kaleidoscope-specific uniforms
  uniform float frequency;
  uniform float segments;

  varying vec2 vUv;

  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}

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

  float sampleKaleidoT(vec2 uvIn) {
    vec2 ctr = vec2(0.5) + vec2(mouseX, mouseY) * 0.10 * mouseIntensity;
    // SPRINT 3.1.0: shader-field animation — previously a silent no-op (see
    // Marble in newGradients.ts for the full explanation). This is the
    // Kaleidoscope *gradient* type — distinct from the "kaleidoscope"
    // *animation* type, whose facet-distortion field (applyKaleidoField) is
    // what actually runs here when it's selected.
    vec2 driftedUV = applySharedAnimationField(uvIn + vec2(uDriftX, uDriftY), ctr, angle + uRotation, segments);
    vec2 p = driftedUV - ctr;
    float rot = radians(angle + uRotation);
    float c = cos(rot);
    float s = sin(rot);
    p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    p *= max(uScale * 1.05, 0.001);
    // Mandatory subtle crystalline shimmer — always active, gives the gem a living quality.
    // Independent of the uTurbulence slider so kaleidoscope always feels alive.
    vec2 shimmer = vec2(
      noise((p + ctr) * 6.0 + time * 0.07),
      noise((p + ctr) * 6.0 + vec2(17.3, 5.8) - time * 0.05)
    ) - 0.5;
    p += shimmer * 0.006;
    // Extra turbulence from slider
    if (uTurbulence > 0.01) {
      vec2 n = vec2(
        noise((p + ctr) * 5.0 + time * 0.05),
        noise((p + ctr) * 5.0 + vec2(19.4, 7.2) - time * 0.04)
      ) - 0.5;
      p += n * uTurbulence * 0.010;
    }
    float r = length(p) * max(frequency * 0.9 + 0.7, 0.1);
    float theta = atan(p.y, p.x);
    float segCount = max(float(segments), 4.0);
    float segAngle = 6.28318530718 / segCount;
    float local = mod(theta + segAngle * 0.5, segAngle) - segAngle * 0.5;
    local = abs(local) / max(segAngle * 0.5, 0.0001);
    float petal = 1.0 - local;
    float petals = 0.5 + 0.5 * cos(petal * 3.14159 * (2.0 + complexity * 0.18) + r * (4.0 + frequency));
    float rings  = 0.5 + 0.5 * cos(r * (6.0 + frequency * 1.8) - petal * 2.4);
    float flower = exp(-r * 2.4) * (0.5 + 0.5 * cos(theta * segCount * 0.5));
    float t = petals * 0.46 + rings * 0.40 + flower * 0.14;
    return clamp(t, 0.0, 1.0);
  }

  void main() {
    vec2 aa = max(fwidth(vUv) * 0.16, vec2(0.00012));
    float t0 = sampleKaleidoT(vUv);
    float t1 = sampleKaleidoT(clamp(vUv + vec2(aa.x,  0.0),  0.0, 1.0));
    float t2 = sampleKaleidoT(clamp(vUv + vec2(-aa.x, 0.0),  0.0, 1.0));
    float t3 = sampleKaleidoT(clamp(vUv + vec2(0.0,   aa.y), 0.0, 1.0));
    float t4 = sampleKaleidoT(clamp(vUv + vec2(0.0,  -aa.y), 0.0, 1.0));
    float t  = clamp(t0 * 0.68 + (t1 + t2 + t3 + t4) * 0.08, 0.0, 1.0);
    vec3 color = getGradientColor(t) * intensity * uPulse;
    if (hasTexture > 0.5) {
      color = applyTexture(color, vUv, textureType, textureScale,
        textureIntensity * textureOpacity, textureTime, blur, distortion,
        textureAngle, blendMode, textureOpacity, gridSize, complexity,
        chromaticShift, textureAnimationType, ridgeCount, ridgeIrregularity,
        blockIrregularity, turbulence, waveCount, colorIntensity,
        elevationShift, lineThickness);
    }
    if (abs(uHueRotation) > 0.01) {
      color = applyHueRotation(color, uHueRotation);
    }
    gl_FragColor = vec4(color, layerOpacity);
  }
`;