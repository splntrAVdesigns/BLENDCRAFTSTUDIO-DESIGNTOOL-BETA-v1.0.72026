/**
 * Shared Animation Field Helpers for GLSL Shaders
 * Reusable block for shader-driven gradient animation families
 * PREMIUM REFINED VERSION v2 - Production Quality with Polish
 */

export const SHARED_ANIMATION_HELPERS = `
  const float TAU = 6.28318530718;

  float animClamp01(float v) {
    return clamp(v, 0.0, 1.0);
  }

  mat2 animRot(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat2(c, -s, s, c);
  }

  vec2 animDirFromAngle(float degrees) {
    float a = radians(degrees);
    return vec2(cos(a), sin(a));
  }

  // Soft modulation signal from eased phase
  float animSoftMod() {
    return 0.5 + 0.5 * sin(uAnimEased * TAU);
  }

  // Stronger centered modulation
  float animStrongMod() {
    return smoothstep(0.0, 1.0, 0.5 + 0.5 * sin(uAnimEased * TAU));
  }

  // Utility helpers
  float animCenterWeight(vec2 uv, vec2 center, float radius) {
    float d = length(uv - center);
    return 1.0 - smoothstep(0.0, radius, d);
  }

  float animEdgeWeight(vec2 uv, vec2 center, float radius) {
    float d = length(uv - center);
    return smoothstep(0.0, radius, d);
  }

  // ===================================================================
  // PREMIUM ANIMATION FIELD TRANSFORMS
  // ===================================================================

  // 1. WAVE - Strong directional flow field with edge amplitude rise
  vec2 applyWaveField(vec2 uv, vec2 center, float baseAngleDeg) {
    vec2 dir = animDirFromAngle(baseAngleDeg);
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 p = uv - center;

    // STRATEGIC FIX: Use continuous time with fractional wrapping for seamless loops
    float continuousTime = fract(uAnimPhase) * TAU;
    float travel = dot(p, dir) * 10.0 + continuousTime * 2.0;

    // Cross-banding to create sheet/ribbon feel
    float cross = dot(p, perp) * 6.5;

    // Main directional wave
    float primary = sin(travel);

    // Secondary cross modulation adds layered motion
    float secondary = sin(travel * 0.65 + sin(cross * 0.85) * 1.35);

    // POLISH: Add edge weight for bigger "sheet" feeling
    float edgeBoost = animEdgeWeight(uv, center, 0.7);

    // SURGICAL FIX: Use uAnimEased ONLY for amplitude/contrast, not travel position
    float amp = mix(0.012, 0.06, uAnimEased) * uAnimIntensity;
    amp *= (1.0 + edgeBoost * 0.35); // Boost amplitude toward edges
    
    float lateral = mix(0.004, 0.028, animSoftMod()) * uAnimIntensity;
    lateral *= (1.0 + edgeBoost * 0.25); // Boost lateral motion toward edges

    p += perp * primary * amp;
    p += dir * secondary * lateral;

    return p + center;
  }

  // 2. MORPH - Organic shape evolution
  vec2 applyMorphField(vec2 uv, vec2 center) {
    vec2 p = uv - center;
    // STRATEGIC FIX: Use phase-based continuous time for seamless loops
    float continuousTime = uAnimPhase * TAU;
    vec2 uvA = p + vec2(
      sin(p.y * 4.0 + continuousTime * 1.2) * 0.03,
      cos(p.x * 3.0 + continuousTime * 1.0) * 0.03
    ) * uAnimIntensity;
    vec2 uvB = p + vec2(
      cos(p.y * 7.0 + 1.2 + continuousTime * 0.8) * 0.04,
      sin(p.x * 5.0 - 0.8 + continuousTime * 1.4) * 0.04
    ) * uAnimIntensity;
    float morphMix = animClamp01(uAnimEased);
    vec2 result = mix(uvA, uvB, morphMix);
    return result + center;
  }

  // 3. VORTEX - Broad rotational field with bounded ping-pong reversal
  vec2 applyVortexField(vec2 uv, vec2 center) {
    vec2 p = uv - center;
    float r = length(p);
    float safeR = max(r, 0.0001);
    float a = atan(p.y, p.x);

    float rNorm = clamp(r / 0.7071, 0.0, 1.0);
    float field = pow(1.0 - smoothstep(0.0, 1.02, rNorm), 0.42);
    field = max(field, 0.18 * (1.0 - smoothstep(0.82, 1.08, rNorm)));

    // Bounded transport avoids long-session precision drift.
    float ping = sin(uAnimPhase * TAU * 0.5);
    float direction = sign(ping) * pow(abs(ping), 0.72);
    float twistPhase = sin(uAnimPhase * TAU + rNorm * 3.5);
    float spiralBias = (1.15 + 0.85 * (1.0 - rNorm)) * field * uAnimIntensity;

    // Slight center drift removes the cheap static bullseye feel.
    vec2 movingCenter = center + vec2(
      sin(uAnimPhase * TAU * 0.43),
      cos(uAnimPhase * TAU * 0.37)
    ) * 0.018 * uAnimIntensity;
    p = uv - movingCenter;
    r = length(p);
    safeR = max(r, 0.0001);
    a = atan(p.y, p.x);

    float angularOffset = direction * spiralBias * (0.9 + 0.55 * twistPhase);
    a += angularOffset;

    float suction = (0.018 + 0.020 * animSoftMod()) * field * uAnimIntensity;
    float radialBreath = sin(uAnimPhase * TAU * 1.2 + a * 2.5) * 0.018 * field * uAnimIntensity;
    r = max(0.001, r * (1.0 + radialBreath) - suction);

    vec2 tangent = vec2(-p.y, p.x) / safeR;
    vec2 swirlDrift = tangent * (0.020 * field * sin(uAnimPhase * TAU * 1.1 + r * 7.0));

    return movingCenter + vec2(cos(a), sin(a)) * r + swirlDrift;
  }

  // 4. KALEIDOSCOPE - Crystalline facet modulation with stronger edge definition
  vec2 applyKaleidoField(vec2 uv, vec2 center, float segments) {
    vec2 p = uv - center;
    float r = length(p);
    
    // STRATEGIC FIX: Prevent center artifact with minimum radius threshold
    r = max(r, 0.02); // Prevents mathematical singularity at exact center
    
    float a = atan(p.y, p.x);

    float seg = TAU / max(segments, 1.0);

    // Base mirrored fold
    a = mod(a, seg);
    a = abs(a - seg * 0.5);

    // POLISH: Modulate facet by edge weight for crystalline outer chamber
    float edgeWeight = animEdgeWeight(uv, center, 0.8);
    float centerWeight = animCenterWeight(uv, center, 0.5);

    // STRATEGIC FIX: Use phase-based time for seamless loops
    float continuousTime = uAnimPhase * TAU;
    float facetFreq = 12.0; // Fixed frequency for consistent crystal structure
    float facet = sin(a * facetFreq + r * 10.0 + continuousTime * 1.8);
    
    // SURGICAL FIX: Use uAnimEased to modulate facet amplitude, not fold transport
    float facetAmp = mix(0.008, 0.05, uAnimEased) * uAnimIntensity;
    facetAmp *= (0.7 + edgeWeight * 0.8); // Stronger at edges, softer at center

    // Radial tunnel pulse with continuous time
    float tunnel = sin(r * 20.0 + continuousTime * 2.8) * 0.02 * uAnimIntensity;

    // Fold jitter - subtle, not floppy, with continuous time
    float foldJitter = sin(continuousTime * 1.5 + r * 7.5) * 0.035 * uAnimIntensity;

    a += foldJitter;
    a += facet * facetAmp;
    r += tunnel;

    return vec2(cos(a), sin(a)) * r + center;
  }

  // 5. FRACTAL ZOOM - Premium 3-level recursive nesting blend
  vec2 applyFractalZoomField(vec2 uv, vec2 center) {
    vec2 p = uv - center;

    // Base loop phase
    float phase = uAnimPhase;

    // POLISH: Three zoom levels for richer recursion (up from 2)
    float zoomA = exp2(phase * 2.0);            // 1 -> 4
    float zoomB = exp2((phase + 0.333) * 2.0);  // offset nested zoom (1/3 cycle)
    float zoomC = exp2((phase + 0.667) * 2.0);  // offset nested zoom (2/3 cycle)

    vec2 pA = p * zoomA;
    vec2 pB = p * zoomB;
    vec2 pC = p * zoomC;

    // Recursive wrap
    pA = fract(pA + 0.5) - 0.5;
    pB = fract(pB + 0.5) - 0.5;
    pC = fract(pC + 0.5) - 0.5;

    // Tri-way blend between octaves for smoother recursion
    float t = fract(uAnimEased * 3.0); // Cycle through 3 states
    float state = floor(uAnimEased * 3.0);
    
    // SURGICAL FIX: Soften the handoff between nested levels with smoothstep
    float nestBlend = smoothstep(0.2, 0.8, t); // Gentler transitions
    
    vec2 pMix;
    if (state < 0.5) {
      // Blend A -> B
      pMix = mix(pA, pB, nestBlend);
    } else if (state < 1.5) {
      // Blend B -> C
      pMix = mix(pB, pC, nestBlend);
    } else {
      // Blend C -> A
      pMix = mix(pC, pA, nestBlend);
    }

    // Add subtle radial tightening
    float r = length(pMix);
    float tighten = mix(1.0, 1.25, animSoftMod() * uAnimIntensity);
    pMix *= tighten - r * 0.15 * uAnimIntensity;

    return pMix + center;
  }

  // 6. TURBULENCE - Multi-frequency chaos
  vec2 applyTurbulenceField(vec2 uv, vec2 center) {
    vec2 p = uv - center;
    // STRATEGIC FIX: Use phase-based continuous time for seamless loops
    float continuousTime = uAnimPhase * TAU;
    vec2 flow = vec2(
      sin(p.y * 6.0 + continuousTime * 1.6),
      cos(p.x * 5.0 + continuousTime * 1.4)
    ) * 0.035 * uAnimIntensity;
    vec2 flow2 = vec2(
      cos(p.y * 11.0 + continuousTime * 2.2),
      sin(p.x * 9.0 + continuousTime * 1.8)
    ) * 0.015 * uAnimIntensity * mix(0.6, 1.2, animSoftMod());
    return p + flow + flow2 + center;
  }

  // ===================================================================
  // UNIFIED ENTRY POINT
  // ===================================================================
  vec2 applySharedAnimationField(vec2 uv, vec2 center, float baseAngleDeg, float segments) {
    if (uAnimType < 0.5) return uv;
    if (uAnimType < 1.5) return applyWaveField(uv, center, baseAngleDeg);
    if (uAnimType < 2.5) return applyMorphField(uv, center);
    if (uAnimType < 3.5) return applyVortexField(uv, center);
    if (uAnimType < 4.5) return applyKaleidoField(uv, center, segments);
    if (uAnimType < 5.5) return applyFractalZoomField(uv, center);
    if (uAnimType < 6.5) return applyTurbulenceField(uv, center);
    return uv;
  }
`;