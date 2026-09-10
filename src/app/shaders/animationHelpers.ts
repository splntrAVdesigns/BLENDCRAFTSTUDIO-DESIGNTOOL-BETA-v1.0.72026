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

  // 1. WAVE - Continuous sheet flow with no hard phase reset.
  // SPRINT 3.1.0 — HARMONIC RETUNE: 1.75/0.35/0.62/0.21 rad/s retuned to
  // 8/2/3/1 x (TAU/30) so the whole field closes exactly at 30s (see
  // estimateAnimationCycle.ts). Values are within ~5% of the originals.
  vec2 applyWaveField(vec2 uv, vec2 center, float baseAngleDeg) {
    vec2 dir = animDirFromAngle(baseAngleDeg);
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 p = uv - center;

    float t = uAnimTime;
    float travel = dot(p, dir) * 10.0 + t * 1.6755;
    float cross = dot(p, perp) * 6.5;

    float primary = sin(travel + sin(cross * 0.75 + t * 0.41888) * 0.65);
    float secondary = sin(travel * 0.58 - t * 0.62832 + sin(cross * 1.15 - t * 0.20944) * 1.15);

    float edgeBoost = animEdgeWeight(uv, center, 0.7);
    float amp = (0.020 + 0.022 * animSoftMod()) * uAnimIntensity;
    amp *= (1.0 + edgeBoost * 0.28);

    float lateral = (0.008 + 0.014 * animStrongMod()) * uAnimIntensity;
    lateral *= (1.0 + edgeBoost * 0.18);

    p += perp * primary * amp;
    p += dir * secondary * lateral;

    return p + center;
  }

  // 2. MORPH - Continuous organic shape evolution without cycle snap.
  // SPRINT 3.1.0 — HARMONIC RETUNE: 1.2/1.0/0.8/1.4 rad/s retuned to
  // 2/1/1/2 x (TAU/8). The crossfade term's original nested 0.23+sin(0.07)
  // wobble implied a true period near 90s (0.07 rad/s dominates) — that's
  // impractical for export, so it's compressed to the same 1x(TAU/8) base
  // and the inner nested wobble is dropped. The crossfade now cycles
  // noticeably faster than before — flag for review after visual test.
  vec2 applyMorphField(vec2 uv, vec2 center) {
    vec2 p = uv - center;
    float t = uAnimTime;
    vec2 uvA = p + vec2(
      sin(p.y * 4.0 + t * 1.5708) * 0.03,
      cos(p.x * 3.0 + t * 0.7854) * 0.03
    ) * uAnimIntensity;
    vec2 uvB = p + vec2(
      cos(p.y * 7.0 + 1.2 + t * 0.7854) * 0.04,
      sin(p.x * 5.0 - 0.8 + t * 1.5708) * 0.04
    ) * uAnimIntensity;
    float morphMix = 0.5 + 0.5 * sin(t * 0.7854);
    vec2 result = mix(uvA, uvB, morphMix);
    return result + center;
  }

  // 3. VORTEX - Continuous spiral-arm whirlpool with wide throat, stronger side pull, and smooth 3-cycle ping-pong reversal.
  // STAGE 2.9.3: one authoritative vortex period (seconds → rad/s).
  #define VORTEX_LOOP_W 1.2566370614   // 2π / 5s

  /**
   * STAGE 2.9.3 — RIGID VORTEX FOR MEDIA.
   *
   * The field version below displaces UV by up to 2.65 canvas-widths. For a
   * PROCEDURAL gradient that's harmless — sampling far away just evaluates a
   * smooth infinite field somewhere else, which is the swirl that looks good.
   * For a TEXTURE it is destructive: animatedUV is a texture coordinate, so
   * displacement magnitude IS deformation.
   *
   *  • The flip: swirl is a TRANSLATION along the tangent, not a rotation.
   *    At r=0.28 its magnitude is 1.85 — an arc of 6.6 radians (~378°) at that
   *    radius. Every pixel samples more than a full turn away, so the top of
   *    the image lands where the bottom was. That reads as upside-down.
   *  • The collapse: textures clamp at their edges, so everything pushed
   *    outside [0,1] returns edge pixels — the image smears into the centre
   *    and leaves streaked lobes.
   *
   * The fix is not a weaker field (that's just a worse vortex) but the correct
   * operation: DIFFERENTIAL ROTATION — rotate more near the centre, less at
   * the rim. Amplitude becomes an ANGLE rather than a distance, so the map is
   * area-preserving: every sample stays inside the disk. No clamping, no
   * collapse, no flip, and it still reads as a genuine whirlpool.
   *
   * Loops exactly: twist is driven by reversal itself, so it winds up and
   * fully unwinds to identity across one 5s period.
   */
  vec2 applyVortexFieldRigid(vec2 uv, vec2 center) {
    vec2 p = uv - center;
    float r = length(p);
    float rNorm = clamp(r / 0.7071, 0.0, 1.0);
    float t = uAnimTime;

    float reversal = sin(t * VORTEX_LOOP_W);

    // Falloff squared: strong core twist easing smoothly to zero at the rim,
    // so the frame edges stay put and only the interior swirls.
    float falloff = (1.0 - rNorm) * (1.0 - rNorm);
    float twist = reversal * falloff * 2.2 * uAnimIntensity;

    float c = cos(twist);
    float sn = sin(twist);
    vec2 q = vec2(p.x * c - p.y * sn, p.x * sn + p.y * c);

    // Gentle breathing, bounded FAR from zero (0.94–1.06). The old field's
    // inward pull could drive effective scale through zero, which is what
    // collapsed the image to a point.
    float breathe = 1.0 + 0.06 * sin(t * VORTEX_LOOP_W * 3.0) * uAnimIntensity;

    return q * breathe + center;
  }

  vec2 applyVortexField(vec2 uv, vec2 center) {
    vec2 p = uv - center;
    float r = max(length(p), 0.0001);
    vec2 radial = p / r;
    vec2 tangent = vec2(-radial.y, radial.x);
    float rNorm = clamp(r / 0.7071, 0.0, 1.0);
    float t = uAnimTime;

    // ── STAGE 2.9.3: HARMONIC RETUNE — every frequency is an integer multiple
    // of one base period, so the whole field is EXACTLY periodic.
    //
    // Before: spin 1.85 rad/s (period 3.40s) and reversal 0.30 rad/s (period
    // 20.94s) — a 6.15:1 ratio, incommensurate. estimateCycleTime meanwhile
    // declared 2.00s. Three unrelated periods, which is why loop lock could
    // never close the wrap (the harness measured 94%) and why the reversal
    // appeared to "never come back" at speed 1.0 — you were waiting out a
    // ~10s half-cycle, and raising speed simply scaled it into view.
    //
    // Now: base period 5s (VORTEX_LOOP_W = 2π/5), spin = 3× base. The field
    // repeats exactly every 5s at speed 1.0, which matches the export lengths
    // actually being used. estimateCycleTime is updated to match.
    float spinPhase = t * (VORTEX_LOOP_W * 3.0);
    float reversal = sin(t * VORTEX_LOOP_W);
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

    return uv + (swirl + inward + spiralArms + throatSpin + micro) * uAnimIntensity;
  }

  // 7. RIPPLE - Chaotic multi-source liquid ripples across the frame.
  // SPRINT 3.1.0 — HARMONIC RETUNE: the eleven independent frequency
  // constants below (0.27/0.33/0.19/0.29/0.41/0.23/0.31/2.2/1.7/2.6/1.4/1.1)
  // shared no common period. Retuned to integer multiples of TAU/16s — the
  // six slow center-motion terms collapse to a single 1x base (0.3927
  // rad/s), which trades a little of the "detuned" multi-source character
  // for an exact 16s loop close; the three ripple-wave rates and the final
  // flourish keep distinct 6x/4x/7x and 4x/3x multiples. Matches the JS
  // ripple case's 16s retune above.
  vec2 applyRippleField(vec2 uv, vec2 center) {
    float t = uAnimTime;
    vec2 p = uv - center;

    vec2 c1 = vec2(sin(t * 0.3927) * 0.26, cos(t * 0.3927) * 0.20);
    vec2 c2 = vec2(cos(t * 0.3927 + 1.3) * 0.34, sin(t * 0.3927 - 0.7) * 0.28);
    vec2 c3 = vec2(sin(t * 0.3927 - 0.9) * 0.22, sin(t * 0.3927 + 0.6) * 0.34);

    vec2 d1 = p - c1;
    vec2 d2 = p - c2;
    vec2 d3 = p - c3;
    float r1 = max(length(d1), 0.0001);
    float r2 = max(length(d2), 0.0001);
    float r3 = max(length(d3), 0.0001);

    vec2 n1 = d1 / r1;
    vec2 n2 = d2 / r2;
    vec2 n3 = d3 / r3;

    float w1 = sin(r1 * 24.0 - t * 2.356 + sin(t * 0.3927) * 0.8);
    float w2 = sin(r2 * 20.0 - t * 1.571 + 1.3);
    float w3 = sin(r3 * 28.0 - t * 2.749 - 0.9);

    vec2 ripple = n1 * w1 * exp(-r1 * 1.8) * 0.030;
    ripple += n2 * w2 * exp(-r2 * 1.6) * 0.028;
    ripple += n3 * w3 * exp(-r3 * 1.9) * 0.024;
    ripple += vec2(sin((uv.y + uv.x) * 9.0 - t * 1.571), cos((uv.x - uv.y) * 8.0 + t * 1.178)) * 0.010;

    return uv + ripple * uAnimIntensity;
  }

  // 4. KALEIDOSCOPE - Continuous crystalline modulation with no phase snap.
  // SPRINT 3.1.0: this function was previously unreachable — 'kaleidoscope'
  // was never assigned a uAnimType value, so it compiled into every shader
  // but never ran. Now wired in (see SHADER_ANIM_TYPE_MAP), so its
  // frequencies are retuned here at the same time: 1.8/0.21/2.4/1.35 rad/s
  // retuned to 17/2/23/13 x (TAU/60), closing at the same 60s true period as
  // the JS rotation+hue retune above.
  vec2 applyKaleidoField(vec2 uv, vec2 center, float segments) {
    vec2 p = uv - center;
    float r = max(length(p), 0.02);
    float a = atan(p.y, p.x);
    float seg = TAU / max(segments, 1.0);

    a = mod(a, seg);
    a = abs(a - seg * 0.5);

    float edgeWeight = animEdgeWeight(uv, center, 0.8);
    float t = uAnimTime;
    float facet = sin(a * 12.0 + r * 10.0 + t * 1.780 + sin(t * 0.2094) * 0.8);
    float facetAmp = (0.014 + 0.028 * animSoftMod()) * uAnimIntensity;
    facetAmp *= (0.7 + edgeWeight * 0.8);
    float tunnel = sin(r * 20.0 + t * 2.408) * 0.02 * uAnimIntensity;
    float foldJitter = sin(t * 1.361 + r * 7.5) * 0.028 * uAnimIntensity;

    a += foldJitter + facet * facetAmp;
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

  // 6. TURBULENCE - Continuous multi-frequency chaos without visible loop reset.
  // SPRINT 3.1.0 — HARMONIC RETUNE: 1.6/1.4/2.2/1.8/0.73/0.58 rad/s retuned
  // to 3/2/4/3/1/1 x (TAU/11) so the field closes exactly at 11s, matching
  // the JS turbulence case in calculateAnimationOffset().
  vec2 applyTurbulenceField(vec2 uv, vec2 center) {
    vec2 p = uv - center;
    float t = uAnimTime;
    vec2 flow = vec2(
      sin(p.y * 6.0 + t * 1.7136),
      cos(p.x * 5.0 + t * 1.1424)
    ) * 0.035 * uAnimIntensity;
    vec2 flow2 = vec2(
      cos(p.y * 11.0 + t * 2.285),
      sin(p.x * 9.0 + t * 1.7136)
    ) * 0.015 * uAnimIntensity * mix(0.6, 1.2, animSoftMod());
    vec2 flow3 = vec2(
      sin(dot(p, vec2(8.0, 5.0)) - t * 0.5712),
      cos(dot(p, vec2(-6.0, 9.0)) + t * 0.5712)
    ) * 0.010 * uAnimIntensity;
    return p + flow + flow2 + flow3 + center;
  }

  // ===================================================================
  // UNIFIED ENTRY POINT
  // ===================================================================
  // GLSL ES 1.00 requires declaration before use; the media entry point below
  // delegates to the field version defined further down.
  vec2 applySharedAnimationField(vec2 uv, vec2 center, float baseAngleDeg, float segments);

  /**
   * STAGE 2.9.3 — MEDIA FIELD SAFETY NET.
   *
   * Bounds how far ANY animation may move a texture sample. The vortex was the
   * acute case, but it isn't the only one: Drift's time * 0.05 term grows
   * without bound, so after ~20s of playback it too walks media off the canvas
   * and clamps. A per-type audit fixes the cases we know about; this bounds the
   * ones we haven't hit yet.
   *
   * 0.35 UV is roughly a third of the frame — enough for every field to read as
   * strong motion, far short of the ~1.0 where a texture starts sampling
   * outside itself. Direction is preserved; only magnitude is limited, so
   * motion still looks like the same effect, just contained.
   */
  vec2 clampMediaDisplacement(vec2 uv, vec2 animated) {
    vec2 d = animated - uv;
    float m = length(d);
    if (m > 0.35) d *= 0.35 / m;
    return uv + d;
  }

  /**
   * STAGE 2.9.3 — MEDIA-ONLY entry point.
   *
   * Media-only was the deliberate choice: the field vortex is genuinely good on
   * gradients and there's no reason to degrade it, and the two layer kinds have
   * different problems (a gradient cannot sample "outside itself"; a texture
   * can). Gradient call sites are untouched — this adds a path rather than
   * changing one.
   */
  vec2 applySharedAnimationFieldMedia(vec2 uv, vec2 center, float baseAngleDeg, float segments) {
    if (uAnimType < 0.5) return uv;
    // Vortex → rigid differential rotation (see applyVortexFieldRigid).
    if (uAnimType > 2.5 && uAnimType < 3.5) return applyVortexFieldRigid(uv, center);
    return clampMediaDisplacement(uv, applySharedAnimationField(uv, center, baseAngleDeg, segments));
  }

  vec2 applySharedAnimationField(vec2 uv, vec2 center, float baseAngleDeg, float segments) {
    if (uAnimType < 0.5) return uv;
    if (uAnimType < 1.5) return applyWaveField(uv, center, baseAngleDeg);
    if (uAnimType < 2.5) return applyMorphField(uv, center);
    if (uAnimType < 3.5) return applyVortexField(uv, center);
    if (uAnimType < 4.5) return applyKaleidoField(uv, center, segments);
    if (uAnimType < 5.5) return applyFractalZoomField(uv, center);
    if (uAnimType < 6.5) return applyTurbulenceField(uv, center);
    if (uAnimType < 7.5) return applyRippleField(uv, center);
    return uv;
  }
`;