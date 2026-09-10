import { SHARED_FUNCTIONS } from './gradientShaders';
import { SHARED_ANIMATION_HELPERS } from './animationHelpers';

// Diamond gradient shader - restore clean diamond lattice with full-pattern twist
export const diamondGradientShader = `
  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform float time;
  uniform float scale;
  uniform float intensity;
  uniform float angle;
  uniform float twist;
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
  uniform float uTwist;
  uniform float uHueRotation;
  uniform float mouseX;
  uniform float mouseY;
  uniform float mouseIntensity;
  uniform sampler2D uDisplacementMap;
  uniform float uDisplacementStrength;

  // SPRINT 3.1.0: shader-driven animation uniforms — Diamond had none of
  // these before, so Wave/Morph/Liquid/Vortex/Kaleidoscope/FractalZoom/
  // Turbulence/Ripple were a complete no-op regardless of gradient content.
  uniform float uAnimPhase;
  uniform float uAnimEased;
  uniform float uAnimTime;
  uniform float uAnimIntensity;
  uniform float uAnimType;

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

  float sampleDiamondT(vec2 sampleUv) {
    vec2 uv = applyDisplacement(sampleUv, uDisplacementMap, uDisplacementStrength);
    uv += vec2(uDriftX, uDriftY);

    vec2 center = vec2(0.5) + vec2(mouseX, mouseY) * 0.08 * mouseIntensity;
    vec2 p = uv - center;

    float rot = radians(angle + uRotation + 45.0);
    float c = cos(rot);
    float s = sin(rot);
    vec2 q = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    q *= max(scale * uScale * 2.0, 0.001);

    // Twist must bend the full diamond lattice, not only the internal ramp.
    float totalTwist = twist + uTwist;
    if (abs(totalTwist) > 0.0001) {
      float r = length(q);
      float a = atan(q.y, q.x) + totalTwist * (0.9 + r * 1.2);
      q = vec2(cos(a), sin(a)) * r;
    }

    vec2 grid = q * 2.0 + vec2(0.5);
    vec2 id = floor(grid);
    vec2 f = fract(grid) - 0.5;

    // Alternate the per-diamond ramp so each tile keeps the proper diamond look.
    float checker = mod(id.x + id.y, 2.0);
    float ramp = checker < 1.0 ? f.y : -f.y;

    // Very light center lift only, to avoid pseudo-stroke bands.
    float centerLift = max(0.0, 0.5 - (abs(f.x) + abs(f.y))) * 0.045;

    return clamp(0.5 + ramp + centerLift, 0.0, 1.0);
  }

  void main() {
    // Diamond is already visually correct now. The remaining issue is tiny seam sparkle
    // from diagonal multi-tap AA crossing parity boundaries. Use a tighter cross-sample
    // resolve and clamp to the local neighborhood so no bright outliers can leak through.
    vec2 aa = max(fwidth(vUv) * 0.065, vec2(0.000045));

    // SPRINT 3.1.0 FIX: shader-field animation is applied ONCE here, before the
    // 5x anti-aliasing taps below — not inside sampleDiamondT, which runs 5x per
    // pixel. The AA taps perturb around one shared animated position, which is
    // both correct (they anti-alias the diamond edges, not the animation field)
    // and ~5x cheaper.
    vec2 fieldCenter = vec2(0.5) + vec2(mouseX, mouseY) * 0.08 * mouseIntensity;
    vec2 animatedUv = applySharedAnimationField(vUv, fieldCenter, angle + uRotation, 1.0);

    float t0 = sampleDiamondT(animatedUv);
    float t1 = sampleDiamondT(clamp(animatedUv + vec2( aa.x, 0.0), 0.0, 1.0));
    float t2 = sampleDiamondT(clamp(animatedUv + vec2(-aa.x, 0.0), 0.0, 1.0));
    float t3 = sampleDiamondT(clamp(animatedUv + vec2(0.0,  aa.y), 0.0, 1.0));
    float t4 = sampleDiamondT(clamp(animatedUv + vec2(0.0, -aa.y), 0.0, 1.0));

    float tMin = min(min(t0, t1), min(min(t2, t3), t4));
    float tMax = max(max(t0, t1), max(max(t2, t3), t4));

    float t = clamp(
      t0 * 0.70 +
      (t1 + t2 + t3 + t4) * 0.075,
      tMin,
      tMax
    );

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