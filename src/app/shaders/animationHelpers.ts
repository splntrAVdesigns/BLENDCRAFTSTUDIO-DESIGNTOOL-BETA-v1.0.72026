/**
 * Shared Animation Field Helpers for GLSL Shaders
 * Reusable block for shader-driven gradient animation families
 * PREMIUM REFINED VERSION v2 - Production Quality with Polish
 */

export const SHARED_ANIMATION_HELPERS = `
  const float TAU = 6.28318530718;

  // SPRINT 3.1.2: Glitch-only controls, declared here (not per-shader) since
  // this block is injected into every gradient shader already.
  uniform float uGlitchSeed;
  uniform float uGlitchChaos;

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

  // Single-float hash — same magic constants already used for dithering
  // elsewhere in these shaders (see gradientShaders.ts), reused here for
  // Glitch's discrete per-block/per-frame randomness.
  float hash11(float p) {
    return fract(sin(p * 12.9898) * 43758.5453123);
  }

  // ===================================================================
  // PREMIUM ANIMATION FIELD TRANSFORMS
  // ===================================================================

  // 1. WAVE - One coherent travelling sheet (flag/fabric/scanline-sweep
  // character), not stacked competing frequencies.
  // SPRINT 3.1.1 REDESIGN: dropped the nested cross-modulation and the
  // independent "secondary" wave entirely — those were what made Wave read
  // as just another wobble field, similar to Morph/Ripple. Now a single
  // primary travelling wave along dir, with a subtle perpendicular
  // shimmer phase-locked to it (not an independent frequency), so the
  // motion stays visually singular. Rate unchanged (8x TAU/30s), so this
  // still closes at the declared 30s cycle.
  vec2 applyWaveField(vec2 uv, vec2 center, float baseAngleDeg) {
    vec2 dir = animDirFromAngle(baseAngleDeg);
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 p = uv - center;

    float t = uAnimTime;
    float travel = dot(p, dir) * 8.0 + t * 1.6755;
    float primary = sin(travel);

    float edgeBoost = animEdgeWeight(uv, center, 0.7);
    float amp = (0.024 + 0.014 * animSoftMod()) * uAnimIntensity;
    amp *= (1.0 + edgeBoost * 0.35);

    // Phase-locked shimmer (half the primary's own phase) — a hint of
    // lateral sway riding the same wave, not a second competing frequency.
    float shimmer = sin(travel * 0.5) * 0.30;

    p += perp * primary * amp;
    p += dir * shimmer * amp * 0.4;

    return p + center;
  }

  // 2. MORPH - True domain-warped liquid flow: noise sampled at a position
  // itself displaced by noise, producing continuous fluid blob-morphing
  // (the "liquid gradient mesh" look) instead of stacked sine wobble.
  // SPRINT 3.1.1 REDESIGN: this was previously four independent sine terms
  // plus a crossfade blend — structurally similar to Wave/Ripple, which was
  // the "not enough variety" problem. Domain warping is a genuinely
  // different mechanism. Both warp stages share the same 1x(TAU/16) base
  // rate (sign-flipped between axes for organic asymmetry), so the field
  // still closes at the declared 16s cycle.
  vec2 applyMorphField(vec2 uv, vec2 center) {
    vec2 p = uv - center;
    float t = uAnimTime;

    vec2 warpFreq = p * 2.4;
    vec2 warp1 = vec2(
      noise(warpFreq + vec2(t * 0.3927, 17.3)),
      noise(warpFreq + vec2(31.9, t * 0.3927))
    ) - 0.5;

    vec2 warpedP = p + warp1 * 0.7 * uAnimIntensity;
    vec2 warp2 = vec2(
      noise(warpedP * 1.7 + vec2(-t * 0.3927, 53.7)),
      noise(warpedP * 1.7 + vec2(67.1, -t * 0.3927))
    ) - 0.5;

    vec2 result = p + (warp1 * 0.55 + warp2 * 0.45) * 0.11 * uAnimIntensity;
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

  // 7. RIPPLE - Literal expanding rings from fixed point sources:
  // sin(distance*freq - time*speed) with distance-decayed amplitude. Reads
  // as genuine water ripples, not positional bobbing.
  // SPRINT 3.1.1 REDESIGN: previously the source POINTS themselves orbited
  // and bobbed via several independent frequencies — structurally similar
  // to Wave/Drift, the "not enough variety" problem. Sources are now fixed;
  // the rings expanding outward from them are what reads as motion, which
  // is a genuinely different mechanism. Rates are 4x/3x (TAU/16), so this
  // still closes at the declared 16s cycle.
  vec2 applyRippleField(vec2 uv, vec2 center) {
    float t = uAnimTime;
    vec2 p = uv - center;

    vec2 src1 = vec2(-0.18, 0.12);
    vec2 src2 = vec2(0.20, -0.15);

    float r1 = length(p - src1);
    float r2 = length(p - src2);

    float ring1 = sin(r1 * 26.0 - t * 1.5708) * exp(-r1 * 1.4);
    float ring2 = sin(r2 * 22.0 - t * 1.1781 + 1.0) * exp(-r2 * 1.4);

    vec2 dir1 = (r1 > 0.0001) ? (p - src1) / r1 : vec2(0.0);
    vec2 dir2 = (r2 > 0.0001) ? (p - src2) / r2 : vec2(0.0);

    vec2 displacement = dir1 * ring1 * 0.045 + dir2 * ring2 * 0.045;

    return uv + displacement * uAnimIntensity;
  }

  // 4. KALEIDOSCOPE - Continuous crystalline modulation with no phase snap.
  // SPRINT 3.1.0 (revised): retuned to close at 30s (was 60s, per feedback
  // that 60s felt too long) — same 17/2/23/13 harmonic multipliers, doubled
  // absolute rate since the base period halved.
  vec2 applyKaleidoField(vec2 uv, vec2 center, float segments) {
    vec2 p = uv - center;
    float r = max(length(p), 0.02);
    float a = atan(p.y, p.x);
    float seg = TAU / max(segments, 1.0);

    a = mod(a, seg);
    a = abs(a - seg * 0.5);

    float edgeWeight = animEdgeWeight(uv, center, 0.8);
    float t = uAnimTime;
    float facet = sin(a * 12.0 + r * 10.0 + t * 3.560 + sin(t * 0.4189) * 0.8);
    float facetAmp = (0.014 + 0.028 * animSoftMod()) * uAnimIntensity;
    facetAmp *= (0.7 + edgeWeight * 0.8);
    float tunnel = sin(r * 20.0 + t * 4.817) * 0.02 * uAnimIntensity;
    float foldJitter = sin(t * 2.723 + r * 7.5) * 0.028 * uAnimIntensity;

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

  // 8. GLITCH - Digital datamosh: quantised horizontal block-tearing and
  // occasional larger "stale macroblock" jumps, driven by a discrete
  // glitch-frame clock rather than the continuous sin/cos motion every
  // other field uses. That discreteness IS the glitch character — it's
  // deliberately NOT smoothed.
  // SPRINT 3.1.1: previously glitch was pure JS whole-frame position/
  // rotation/scale jitter, which read as "shaking the frame" rather than a
  // glitch — see calculateAnimationOffset()'s 'glitch' case, now reduced to
  // a brief accent flicker. This field is where glitch's actual identity
  // now lives: bands of the image intermittently tear sideways as if a
  // corrupted motion vector displaced that block, the way real datamosh
  // artifacts look.
  // SPRINT 3.1.2: added uGlitchSeed (shifts the entire hash sequence, so
  // toggling to a new seed — or two layers with different seeds — tear in a
  // different pattern each time, instead of the identical layout every time)
  // and uGlitchChaos (0 = sparse/chunky tearing, 1 = dense/aggressive).
  // Defaults (seed baseline, chaos=0.5) reproduce the original fixed-constant
  // behaviour almost exactly, so existing projects don't visibly jump.
  vec2 applyGlitchField(vec2 uv, vec2 center) {
    float t = uAnimTime;
    float seed = uGlitchSeed * 97.0;
    float chaos = clamp(uGlitchChaos, 0.0, 1.0);

    float glitchFrame = floor(t * 12.0);
    float activeThreshold = mix(0.85, 0.35, chaos);
    float isActive = step(activeThreshold, hash11(glitchFrame * 3.71 + seed));

    float bandCount = 3.0 + floor(hash11(glitchFrame * 1.19 + seed) * mix(4.0, 14.0, chaos));
    float bandIndex = floor((uv.y - center.y + 0.5) * bandCount);
    float bandSeed = hash11(bandIndex * 7.13 + glitchFrame * 2.63 + seed);
    float bandThreshold = mix(0.75, 0.35, chaos);
    float bandActive = step(bandThreshold, bandSeed);
    float shearAmp = mix(0.06, 0.20, chaos);
    float shear = (hash11(bandIndex * 3.31 + glitchFrame * 4.09 + seed) - 0.5) * shearAmp;

    float jumpAmp = mix(0.14, 0.40, chaos);
    float blockJump = step(0.93, hash11(glitchFrame * 5.53 + seed)) *
      (hash11(glitchFrame * 6.91 + seed) - 0.5) * jumpAmp;

    float xOffset = (shear * bandActive + blockJump) * isActive * uAnimIntensity;

    return vec2(uv.x + xOffset, uv.y);
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
    if (uAnimType < 8.5) return applyGlitchField(uv, center);
    return uv;
  }
`;