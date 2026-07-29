// MASK_SHADER_SOURCE_REVISION: 7.3D.4B-stale-program-guard
/**
 * maskShaderWrapper.ts  —  v4
 *
 * FIXES in v4 (over v3):
 * ──────────────────────────────────────────────────────────────────────────
 *
 * FIX 1 — BLUR: "Edge shadow" instead of proper blur
 *   ROOT CAUSE (v3): blurMaskSample sampled RAW (un-thresholded) source values
 *   and mixed them at 65% with the already-sharp thresholded maskValue.
 *   Two different signals (sharp binary + soft raw halo) blended together
 *   produced a shadow artifact at the edge boundary.
 *   FIX: Introduce blurThreshAtUV() that recomputes tLo/tHi from uniforms and
 *   blurs THRESHOLDED binary (0/1) values.  Blur fully REPLACES maskValue
 *   (no mix) and runs INSIDE the mask UV block so outside-UV pixels are not
 *   contaminated.  Blurring a binary mask produces the correct soft gradient
 *   near the edge boundary — matches Photoshop/DaVinci Resolve behavior.
 *
 * FIX 2 — MIRROR TILE: Mirror identical to Repeat mode
 *   ROOT CAUSE (v3): fract(centered * 0.5) * 2.0 created one single reversed
 *   sweep across the entire canvas — not a per-tile reflection.  At sub-100%
 *   scale both modes showed a single zoomed tile, so they looked identical.
 *   FIX: Use mod(floor(centered), 2.0) per-tile flip.  Even tile columns/rows
 *   map forward (0→1), odd ones map backward (1→0) — true checkerboard
 *   reflection at the same density as Repeat.  Gradient colors visibly
 *   reverse direction in adjacent tiles, clearly distinct from Repeat.
 *
 * FIX 3 — EDGE DETECT: Uneven/oblong edges, thickness slider no effect
 *   ROOT CAUSES (v3):
 *   a) Sobel used uMaskTexelSize.x and .y separately; on non-square canvas
 *      tx.x ≠ tx.y → anisotropic offsets → thinner edges on one axis (oblong).
 *   b) Sobel always produces a ~1-texel gradient regardless of thickness
 *      slider because kernel radius is fixed — slider only scaled the 1-texel
 *      gradient, not the actual edge width.
 *   FIX: Replace Sobel with isotropic MINMAX edge detector.
 *   • 8 equal-angle taps at radius ∝ uMaskEdgeThickness × max(texelSize).
 *   • Edge = maxTap - minTap → 0 deep inside, 0 deep outside, >0 at boundary.
 *   • Isotropic: scalar radius ensures circular, even edges on any canvas AR.
 *   • Thickness slider now directly scales the boundary zone width.
 * ──────────────────────────────────────────────────────────────────────────
 */

export function wrapShaderWithMask(fragmentShader: string): string {
  if (fragmentShader.includes('// MASK_UNIFORMS')) {
    return fragmentShader;
  }

  const mainStart = fragmentShader.indexOf('void main()');
  if (mainStart === -1) {
    console.error('[maskShaderWrapper] Could not find main() in shader');
    return fragmentShader;
  }

  if (!fragmentShader.includes('varying vec2 vUv')) {
    fragmentShader =
      fragmentShader.substring(0, mainStart) +
      'varying vec2 vUv;\n\n' +
      fragmentShader.substring(mainStart);
  }

  const uniformsSection = fragmentShader.substring(0, mainStart);

  const maskUniforms = `
// MASK_UNIFORMS
uniform float hasMask;
uniform float uMaskType;          // 0=none  1=self-alpha  2=self-lum  3=layer  4=image
uniform sampler2D uMaskTexture;
uniform float uMaskOpacity;
uniform float uMaskFeather;       // 0-1  (from 0-100 slider /100)
uniform float uMaskInvert;
uniform float uMaskMode;          // 0=clip  1=add  2=subtract  3=intersect
uniform float uMaskFit;
uniform float uMaskAspect;
uniform float uCanvasAspect;
uniform float uMaskScale;
uniform vec2  uMaskOffset;
uniform float uMaskRotation;
uniform float uMaskExpand;        // -1..1 (from -100..100 slider /100)
uniform vec2  uMaskTexelSize;     // (1/texW, 1/texH) from actual loaded texture
uniform float uMaskSourceKind;    // 0=bitmap  1=svg/vector
uniform float uMaskBlurQuality;   // 0=none 1=fast(5-tap) 2=medium(3x3) 3=high(5x5)
uniform float uMaskTileMode;      // 0=single 1=repeat 2=mirror
uniform float uMaskTileScale;     // 0.1-5.0, multiplies UV for tile density (>1=more tiles)
uniform float uMaskEdgeDetect;    // 0=off 1=on (isotropic minmax outline)
uniform float uMaskEdgeThickness; // 1-20, directly scales edge boundary radius
uniform float uBitmapSourceMode;  // 0=alpha   1=luminance
uniform float uBitmapThreshold;   // 0-1

// ─── RAW SOURCE SAMPLER ─────────────────────────────────────────────────────
float sampleMaskSource(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  vec4 s = texture2D(uMaskTexture, uv);
  if (uMaskSourceKind > 0.5) return s.a;
  if (uBitmapSourceMode < 0.5) return s.a;
  if (s.a < 0.01) return 0.0;
  vec3 c = clamp(s.rgb / max(s.a, 0.001), 0.0, 1.0);
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  float boosted = smoothstep(0.0, 0.8, lum);
  return s.a * mix(0.3, 1.0, boosted);
}

// ── Tile mode ───────────────────────────────────────────────────────────────
// Tile mode: Single / Repeat / Mirror-Kaleidoscope
//
// MIRROR design rationale:
//   The previous approach (mod(floor, 2) per-tile checkerboard) required tile
//   scale > 100% before any tiling appeared.  At 80% or 55% scale, floor(centered)
//   was 0 everywhere so all tiles evaluated as "even" — identical to single mode.
//   Result: Mirror and Repeat looked the same at any sub-100% scale.
//
//   Fix: continuous triangle-wave fold.
//   Formula:  1 - abs(fract(centered) * 2 - 1)
//   Maps t ∈ [0,1] → [0, 1, 0]  (hat/pyramid shape, NOT a sawtooth)
//
//   What this means visually:
//   • The CENTER of each tile shows UV = 1.0 (texture center/right)
//   • The EDGES of each tile show UV = 0.0 (texture left)
//   • This creates a mirror reflection WITHIN each tile — visible at ANY scale
//   • At scale 100% (single tile = full canvas): gradient is symmetric from edges to center
//   • At scale 200%+: multiple symmetric mirror tiles — kaleidoscope look
//
//   Repeat  → sawtooth (0→1 per tile, identical tiles)
//   Mirror  → triangle wave (0→1→0 per tile, each tile is a reflected palindrome)
//   These are ALWAYS visually distinct regardless of scale or shape symmetry.
vec2 applyMaskTileMode(vec2 uv) {
  if (uMaskTileMode < 0.5) {
    return clamp(uv, 0.0, 1.0);
  }
  float s = max(0.1, uMaskTileScale);
  vec2 centered = (uv - 0.5) * s + 0.5;

  if (uMaskTileMode < 1.5) {
    // Repeat — sawtooth: each tile is identical (0 → 1)
    return fract(centered);
  } else {
    // Mirror / Kaleidoscope — triangle wave: each tile reflects (0 → 1 → 0)
    // Works at ANY scale including sub-100%, always distinct from Repeat.
    vec2 t = fract(centered);
    return 1.0 - abs(t * 2.0 - 1.0);
  }
}

// ── Threshold helper ─────────────────────────────────────────────────────────
float sampleThresh(vec2 uv, float tLo, float tHi) {
  return smoothstep(tLo, tHi, sampleMaskSource(uv));
}

// ── Threshold-aware blur helper ──────────────────────────────────────────────
// FIX 1: Blurs THRESHOLDED values — no raw source signal, no edge shadow.
// Recomputes tLo/tHi from uniforms so it is self-contained.
float blurThreshAtUV(vec2 uv) {
  float threshold   = uMaskSourceKind < 0.5 ? clamp(uBitmapThreshold, 0.0, 1.0) : 0.5;
  float aaTexelBand = max(uMaskTexelSize.x, uMaskTexelSize.y);
  float userBand    = uMaskSourceKind < 0.5 ? mix(0.18, 0.04, threshold) : 0.03;
  float tBand = aaTexelBand + userBand;
  float tLo   = max(0.0, threshold - tBand);
  float tHi   = min(1.0, threshold + tBand);
  return smoothstep(tLo, tHi, sampleMaskSource(applyMaskTileMode(uv)));
}

// Gaussian blur over THRESHOLDED values — fully replaces maskValue.
float blurMaskSample(vec2 uv) {
  float iso       = max(uMaskTexelSize.x, uMaskTexelSize.y);
  float blurScale = uMaskBlurQuality < 1.5 ? 8.0 : (uMaskBlurQuality < 2.5 ? 16.0 : 32.0);
  float step      = iso * blurScale;

  if (uMaskBlurQuality < 1.5) {
    // Fast — 5-tap cross
    float c  = blurThreshAtUV(uv);
    float l  = blurThreshAtUV(uv - vec2(step, 0.0));
    float r  = blurThreshAtUV(uv + vec2(step, 0.0));
    float u2 = blurThreshAtUV(uv - vec2(0.0,  step));
    float d2 = blurThreshAtUV(uv + vec2(0.0,  step));
    return (c * 2.0 + l + r + u2 + d2) / 6.0;
  }
  if (uMaskBlurQuality < 2.5) {
    // Medium — 3x3 Gaussian
    float acc = 0.0; float wt = 0.0;
    for (int dx = -1; dx <= 1; dx++) {
      for (int dy = -1; dy <= 1; dy++) {
        float adx = float(abs(dx)); float ady = float(abs(dy));
        float w = adx + ady == 0.0 ? 4.0 : (adx + ady == 1.0 ? 2.0 : 1.0);
        acc += blurThreshAtUV(uv + vec2(float(dx) * step, float(dy) * step)) * w;
        wt  += w;
      }
    }
    return acc / wt;
  }
  // High — 5x5 approximate Gaussian
  float acc3 = 0.0; float wt3 = 0.0;
  float step2 = step * 0.6;
  for (int dx = -2; dx <= 2; dx++) {
    for (int dy = -2; dy <= 2; dy++) {
      float w = max(1.0, 5.0 - float(abs(dx) + abs(dy)));
      acc3 += blurThreshAtUV(uv + vec2(float(dx) * step2, float(dy) * step2)) * w;
      wt3  += w;
    }
  }
  return acc3 / wt3;
}

// ── Expand bounds-checked sample ─────────────────────────────────────────────
// sampleThresh(tiledUV + offset) would use the already-clamped tiledUV as the
// base, so when maskUV is out-of-bounds and clamped to the texture edge the
// expand taps could incorrectly "see" the shape right at that edge and produce
// ghost copies (the 3-shape artifact at non-orthogonal rotations).
// This helper operates on the raw pre-tile maskUV, adds the offset, and in
// Single-tile mode returns 0 if the result is out of [0,1] — matching the
// outsideUV early-zero that protects the center sample.
float sampleExpandThresh(vec2 rawUV, vec2 offset, float tLo, float tHi) {
  vec2 sampleRaw = rawUV + offset;
  if (uMaskTileMode < 0.5) {
    // Single tile: reject any sample outside the unit square
    if (sampleRaw.x < 0.0 || sampleRaw.x > 1.0 ||
        sampleRaw.y < 0.0 || sampleRaw.y > 1.0) {
      return 0.0;
    }
  }
  return sampleThresh(applyMaskTileMode(sampleRaw), tLo, tHi);
}

// ── Isotropic MINMAX edge detector ───────────────────────────────────────────
// 8 equal-angle taps at scalar radius. edge = maxTap - minTap.
// Boundary-proximity weight: pixels deeply inside (center≈1) or outside (center≈0)
// the shape cannot be on the edge — their max-min spike comes from distant taps
// crossing a far boundary, not from the local edge. Weighting by how close the
// CENTER pixel is to the transition zone (center≈0.5) suppresses false corners at
// sharp-angle tips where taps straddle two different edges simultaneously.
float edgeDetectMask(vec2 uv, float tLo, float tHi) {
  float baseStep = max(uMaskTexelSize.x, uMaskTexelSize.y);
  float r        = baseStep * max(2.0, uMaskEdgeThickness * 3.0);
  float d        = r * 0.7071;

  // Sample through the bounds-aware helper so Single Tile masks do not create
  // artificial outlines where the texture ends.
  float center = sampleExpandThresh(uv, vec2( 0.0,  0.0), tLo, tHi);
  float v0 = sampleExpandThresh(uv, vec2( r,    0.0), tLo, tHi);
  float v1 = sampleExpandThresh(uv, vec2(-r,    0.0), tLo, tHi);
  float v2 = sampleExpandThresh(uv, vec2( 0.0,  r  ), tLo, tHi);
  float v3 = sampleExpandThresh(uv, vec2( 0.0, -r  ), tLo, tHi);
  float v4 = sampleExpandThresh(uv, vec2( d,    d  ), tLo, tHi);
  float v5 = sampleExpandThresh(uv, vec2(-d,    d  ), tLo, tHi);
  float v6 = sampleExpandThresh(uv, vec2( d,   -d  ), tLo, tHi);
  float v7 = sampleExpandThresh(uv, vec2(-d,   -d  ), tLo, tHi);

  float minVal = min(center, min(v0, min(v1, min(v2, min(v3, min(v4, min(v5, min(v6, v7))))))));
  float maxVal = max(center, max(v0, max(v1, max(v2, max(v3, max(v4, max(v5, max(v6, v7))))))));
  float rawEdge = clamp(maxVal - minVal, 0.0, 1.0);

  // The min/max neighborhood difference is already a robust boundary signal for
  // both hard SVG alpha masks and softened bitmap masks. Shape it with valid,
  // ascending smoothstep thresholds instead of multiplying by a center-pixel gate
  // that can collapse hard edges to zero.
  return smoothstep(0.04, 0.35, rawEdge);
}
`;

  const mainEnd = fragmentShader.lastIndexOf('}');
  if (mainEnd === -1) {
    console.error('[maskShaderWrapper] Could not find end of main()');
    return fragmentShader;
  }

  const afterEnd = fragmentShader.substring(mainEnd);

  const maskCode = `

  // ── Apply mask ───────────────────────────────────────────────────────────
  if (hasMask > 0.5) {
    float maskValue = 1.0;

    if (uMaskType < 0.5) {
      maskValue = 1.0;

    } else if (uMaskType < 1.5) {
      maskValue = gl_FragColor.a;

    } else if (uMaskType < 2.5) {
      float rawLum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
      maskValue = pow(rawLum, 0.7);

    } else if (uMaskType > 3.5) {
      // ── Uploaded source mask (PNG or rasterised SVG) ──────────────────────

      vec2 maskUV = vUv;

      // Aspect-ratio contain fit
      if (uMaskAspect > 0.0 && uCanvasAspect > 0.0) {
        if (uMaskAspect > uCanvasAspect) {
          float sY = uMaskAspect / uCanvasAspect;
          maskUV.y = (maskUV.y - 0.5) * sY + 0.5;
        } else {
          float sX = uCanvasAspect / uMaskAspect;
          maskUV.x = (maskUV.x - 0.5) * sX + 0.5;
        }
      }

      // User transform: scale + rotation + offset
      float safeScale = clamp(uMaskScale, 0.1, 3.0);
      maskUV -= 0.5;
      float cosR = cos(uMaskRotation);
      float sinR = sin(uMaskRotation);
      maskUV = mat2(cosR, -sinR, sinR, cosR) * (maskUV / safeScale);
      maskUV += 0.5 + uMaskOffset;

      bool outsideUV = (maskUV.x < 0.0 || maskUV.x > 1.0 || maskUV.y < 0.0 || maskUV.y > 1.0);
      if (outsideUV && uMaskTileMode < 0.5) {
        maskValue = 0.0;
      } else {
        // Pre-apply tile mode to get the working UV for all steps
        vec2 tiledUV = uMaskTileMode > 0.5 ? applyMaskTileMode(maskUV) : maskUV;

        bool isBitmapMask = uMaskSourceKind < 0.5;

        // ── STEP 1: THRESHOLD ───────────────────────────────────────────────
        float threshold   = isBitmapMask ? clamp(uBitmapThreshold, 0.0, 1.0) : 0.5;
        float aaTexelBand = max(uMaskTexelSize.x, uMaskTexelSize.y);
        float userBand    = isBitmapMask ? mix(0.18, 0.04, threshold) : 0.03;
        float tBand = aaTexelBand + userBand;
        float tLo   = max(0.0, threshold - tBand);
        float tHi   = min(1.0, threshold + tBand);

        float maskCenter = sampleThresh(tiledUV, tLo, tHi);

        // ── STEP 2: EXPAND / CONTRACT ───────────────────────────────────────
        float expandNorm   = clamp(uMaskExpand, -1.0, 1.0);
        float eR           = abs(expandNorm) * 0.04;
        float expandedMask = maskCenter;

        if (eR > 0.0005) {
          vec2 eO  = vec2(eR);
          vec2 eDg = eO * 0.7071;

          if (expandNorm > 0.0) {
            expandedMask = max(expandedMask, sampleExpandThresh(maskUV, vec2( eO.x,   0.0   ), tLo, tHi));
            expandedMask = max(expandedMask, sampleExpandThresh(maskUV, vec2(-eO.x,   0.0   ), tLo, tHi));
            expandedMask = max(expandedMask, sampleExpandThresh(maskUV, vec2( 0.0,    eO.y  ), tLo, tHi));
            expandedMask = max(expandedMask, sampleExpandThresh(maskUV, vec2( 0.0,   -eO.y  ), tLo, tHi));
            expandedMask = max(expandedMask, sampleExpandThresh(maskUV, vec2( eDg.x,  eDg.y ), tLo, tHi));
            expandedMask = max(expandedMask, sampleExpandThresh(maskUV, vec2(-eDg.x,  eDg.y ), tLo, tHi));
            expandedMask = max(expandedMask, sampleExpandThresh(maskUV, vec2( eDg.x, -eDg.y ), tLo, tHi));
            expandedMask = max(expandedMask, sampleExpandThresh(maskUV, vec2(-eDg.x, -eDg.y ), tLo, tHi));
          } else {
            expandedMask = min(expandedMask, sampleExpandThresh(maskUV, vec2( eO.x,   0.0   ), tLo, tHi));
            expandedMask = min(expandedMask, sampleExpandThresh(maskUV, vec2(-eO.x,   0.0   ), tLo, tHi));
            expandedMask = min(expandedMask, sampleExpandThresh(maskUV, vec2( 0.0,    eO.y  ), tLo, tHi));
            expandedMask = min(expandedMask, sampleExpandThresh(maskUV, vec2( 0.0,   -eO.y  ), tLo, tHi));
            expandedMask = min(expandedMask, sampleExpandThresh(maskUV, vec2( eDg.x,  eDg.y ), tLo, tHi));
            expandedMask = min(expandedMask, sampleExpandThresh(maskUV, vec2(-eDg.x,  eDg.y ), tLo, tHi));
            expandedMask = min(expandedMask, sampleExpandThresh(maskUV, vec2( eDg.x, -eDg.y ), tLo, tHi));
            expandedMask = min(expandedMask, sampleExpandThresh(maskUV, vec2(-eDg.x, -eDg.y ), tLo, tHi));
          }
        }

        // ── STEP 3: FEATHER ─────────────────────────────────────────────────
        maskValue = expandedMask;

        float fR = uMaskFeather * 0.036;
        if (fR > 0.0005) {
          vec2 fO  = vec2(fR);
          vec2 fDg = fO * 0.7071;
          float fSum = 0.0;
          fSum += sampleThresh(tiledUV + vec2( fO.x,   0.0   ), tLo, tHi);
          fSum += sampleThresh(tiledUV + vec2(-fO.x,   0.0   ), tLo, tHi);
          fSum += sampleThresh(tiledUV + vec2( 0.0,    fO.y  ), tLo, tHi);
          fSum += sampleThresh(tiledUV + vec2( 0.0,   -fO.y  ), tLo, tHi);
          fSum += sampleThresh(tiledUV + vec2( fDg.x,  fDg.y ), tLo, tHi);
          fSum += sampleThresh(tiledUV + vec2(-fDg.x,  fDg.y ), tLo, tHi);
          fSum += sampleThresh(tiledUV + vec2( fDg.x, -fDg.y ), tLo, tHi);
          fSum += sampleThresh(tiledUV + vec2(-fDg.x, -fDg.y ), tLo, tHi);
          maskValue = mix(expandedMask, fSum / 8.0, uMaskFeather);
        }

        // ── STEP 4: BLUR ─────────────────────────────────────────────────────
        // FIX 1: Inside UV block, blurs thresholded values, fully replaces maskValue.
        // No mix with sharp result → no edge shadow artifact.
        if (uMaskBlurQuality > 0.5) {
          maskValue = blurMaskSample(maskUV);
        }

        // ── STEP 5: EDGE DETECT ───────────────────────────────────────────────
        // FIX 3: Isotropic minmax outline using tLo/tHi from STEP 1.
        if (uMaskEdgeDetect > 0.5) {
          maskValue = edgeDetectMask(maskUV, tLo, tHi);
        }

        maskValue = clamp(maskValue, 0.0, 1.0);
      }

    } else {
      maskValue = 1.0; // layer mask — reserved
    }

    // Invert + Opacity
    maskValue = clamp(maskValue, 0.0, 1.0);
    if (uMaskInvert > 0.5) maskValue = 1.0 - maskValue;
    maskValue *= uMaskOpacity;
    maskValue  = clamp(maskValue, 0.0, 1.0);

    // Blend Mode
    if (uMaskOpacity >= 0.01) {
      if (uMaskMode < 0.5) {
        gl_FragColor.rgb *= maskValue;
        gl_FragColor.a   *= maskValue;
      } else if (uMaskMode < 1.5) {
        gl_FragColor.rgb = clamp(gl_FragColor.rgb + vec3(maskValue * 0.5), 0.0, 1.0);
      } else if (uMaskMode < 2.5) {
        gl_FragColor.rgb = clamp(gl_FragColor.rgb - vec3(maskValue * 0.5), 0.0, 1.0);
      } else {
        float iv = maskValue * maskValue;
        gl_FragColor.rgb *= iv;
        gl_FragColor.a   *= iv;
      }
    }
  }
`;

  return (
    uniformsSection +
    maskUniforms +
    fragmentShader.substring(mainStart, mainEnd) +
    maskCode +
    afterEnd
  );
}