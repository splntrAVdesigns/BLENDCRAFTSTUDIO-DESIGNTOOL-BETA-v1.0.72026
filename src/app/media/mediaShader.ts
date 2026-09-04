/**
 * media/mediaShader.ts — Stage 2 (2B/2C/2D)
 *
 * ShaderMaterial for media layers. Composition order per fragment:
 *
 *   displacement → drift → shared animation field (wave/morph/vortex/
 *   kaleidoscope/fractal-zoom/turbulence/ripple) → turbulence noise → twist →
 *   FIT (cover/contain/stretch) → USER TRANSFORM (scale·rotation·offset,
 *   animated by uRotation/uScale/uPulse) → sample → TONE (lift/gamma/gain/
 *   invert) → GRADIENT LUT (luminance → layer color-stop ramp) → hue
 *   rotation → TEXTURE OVERLAY (applyTexture from SHARED_FUNCTIONS) →
 *   mask wrapper (appended by wrapShaderWithMask).
 *
 * REUSE ARCHITECTURE (2D): the fragment embeds the exact SHARED_FUNCTIONS +
 * SHARED_ANIMATION_HELPERS chunks the gradient shaders use, and declares the
 * same uniform names. The existing uniform sweep + RAF loop then drive
 * textures, texture animation, and every animation type on media layers with
 * ZERO new writer code — all their uniform writes are name-guarded.
 *
 * GRADIENT LUT (2C): getGradientColor() reads the standard colors[10]/
 * positions[10]/colorCount uniforms — which the colors sweep keeps synced
 * with the layer's Color Stops UI. The user's existing gradient editor IS
 * the LUT editor. Dark pixels take early stops, bright pixels take late
 * stops (Photoshop Gradient Map semantics).
 *
 * INVARIANT: every uniform the sweep/RAF may write must be declared in the
 * JS uniforms map at creation — THREE binds locations at compile time.
 */

import * as THREE from '../lib/three';
import { vertexShader, SHARED_FUNCTIONS } from '../shaders/gradientShaders';
import { SHARED_ANIMATION_HELPERS } from '../shaders/animationHelpers';
import { wrapShaderWithMask } from '../shaders/maskShaderWrapper';
import { withOutputColorSpace } from '../shaders/outputColorSpace';
import type { MediaConfig } from './types';
import { toneToShaderUnits } from './types';

export const MEDIA_FIT_MODE_VALUES: Record<MediaConfig['fit'], number> = {
  cover: 0,
  contain: 1,
  stretch: 2,
  tile: 3,   // 2.7 — repeat the source across the canvas (pattern workflows)
};

const mediaFragmentShader = `
  // ── Gradient / LUT uniforms (synced by the colors sweep) ──
  uniform vec3 colors[10];
  uniform float positions[10];
  uniform int colorCount;
  uniform float angle;
  uniform float intensity;
  uniform float scale;

  // ── Clock / texture-system uniforms (synced by uniform sweep + RAF) ──
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
  uniform float ridgeCount;
  uniform float ridgeIrregularity;
  uniform float blockIrregularity;
  uniform float turbulence;
  uniform float waveCount;
  uniform float colorIntensity;
  uniform float elevationShift;
  uniform float lineThickness;

  // ── Animation uniforms (RAF-written, same names as gradient shaders) ──
  uniform float uRotation;
  uniform float uScale;
  uniform float uDriftX;
  uniform float uDriftY;
  uniform float uPulse;
  uniform float uTurbulence;
  uniform float uTwist;
  uniform float uHueRotation;
  uniform float uAnimPhase;
  uniform float uAnimEased;
  uniform float uAnimTime;
  uniform float uAnimIntensity;
  uniform float uAnimType;
  uniform sampler2D uDisplacementMap;
  uniform float uDisplacementStrength;

  // ── Media-specific uniforms ──
  uniform sampler2D uMediaTexture;
  uniform float uMediaAspect;       // media width / height
  uniform float uMediaCanvasAspect; // canvas width / height
  uniform float uMediaFitMode;      // 0 cover, 1 contain, 2 stretch
  uniform float uMediaLift;
  uniform float uMediaGamma;
  uniform float uMediaGain;
  uniform float uMediaInvert;
  uniform float uMediaScale;        // user transform scale (1 = 100%)
  uniform float uMediaRotation;     // user transform rotation (degrees)
  uniform vec2  uMediaOffset;       // user transform pan (-0.5..0.5 UV)
  uniform float uMediaLutIntensity; // 0..1 gradient-map mix
  uniform float uMediaLutPreserveLuma; // 0/1
  uniform float uMediaFlipH;        // 0/1  (2.7)
  uniform float uMediaFlipV;        // 0/1  (2.7)
  uniform float uMediaTileRepeat;   // tile count when fit == tile (2.7)

  varying vec2 vUv;

  ${SHARED_FUNCTIONS}
  ${SHARED_ANIMATION_HELPERS}

  // Same interpolation as every gradient shader — the layer's Color Stops
  // editor drives this ramp, making it the per-layer LUT editor.
  vec3 getGradientColor(float t) {
    t = clamp(t, 0.0, 1.0);
    for (int i = 0; i < 9; i++) {
      if (i >= colorCount - 1) break;
      if (t <= positions[i + 1]) {
        float localT = (t - positions[i]) / max(positions[i + 1] - positions[i], 0.0001);
        return mix(colors[i], colors[i + 1], localT);
      }
    }
    return colors[colorCount - 1];
  }

  vec3 mediaHueRotate(vec3 color, float degrees) {
    float rad = radians(degrees);
    float cosA = cos(rad);
    float sinA = sin(rad);
    mat3 m = mat3(
      0.299 + 0.701 * cosA + 0.168 * sinA, 0.587 - 0.587 * cosA + 0.330 * sinA, 0.114 - 0.114 * cosA - 0.497 * sinA,
      0.299 - 0.299 * cosA - 0.328 * sinA, 0.587 + 0.413 * cosA + 0.035 * sinA, 0.114 - 0.114 * cosA + 0.292 * sinA,
      0.299 - 0.300 * cosA + 1.250 * sinA, 0.587 - 0.588 * cosA - 1.050 * sinA, 0.114 + 0.886 * cosA - 0.203 * sinA
    );
    return clamp(color * m, 0.0, 1.0);
  }

  void main() {
    // 1) Interactive displacement + drift + shared animation field (2D).
    //    Same UV pipeline order as the gradient shaders so animation types
    //    feel identical across layer kinds.
    vec2 animatedUV = applyDisplacement(vUv, uDisplacementMap, uDisplacementStrength);
    animatedUV += vec2(uDriftX, uDriftY);

    // STAGE 3.0.5b: AUDIO MOTION GLITCH — the shared shader chunk owns both
    // the uAudioGlitch declaration and its implementation. Keeping one source
    // of truth prevents duplicate GLSL declarations when this media shader
    // embeds SHARED_FUNCTIONS.
    animatedUV = applyAudioGlitch(animatedUV);
    // STAGE 2.9.3: media-safe field — vortex becomes a rigid differential
    // rotation, and every other field is magnitude-bounded so a texture can
    // never be pushed outside itself (see animationHelpers).
    animatedUV = applySharedAnimationFieldMedia(animatedUV, vec2(0.5), angle, 1.0);
    if (uTurbulence > 0.01) {
      animatedUV.x += noise(animatedUV * 5.0 + time) * uTurbulence * 0.1;
      animatedUV.y += noise(animatedUV * 5.0 - time) * uTurbulence * 0.1;
    }
    animatedUV = applyEnhancedTwist(animatedUV, vec2(0.5), uTwist, uDisplacementStrength);

    // 2) FIT transform (canvas space → media space).
    vec2 mUv = animatedUV - 0.5;
    float r = uMediaCanvasAspect / max(uMediaAspect, 0.0001);
    if (uMediaFitMode < 0.5) {
      if (r > 1.0) { mUv.y /= r; } else { mUv.x *= r; }      // COVER
    } else if (uMediaFitMode < 1.5) {
      if (r > 1.0) { mUv.x *= r; } else { mUv.y /= r; }      // CONTAIN
    } else if (uMediaFitMode > 2.5) {
      // TILE (2.7.4 FIX) — the previous build fell through to STRETCH here and
      // never applied uMediaTileRepeat, so fract() below wrapped a SINGLE copy
      // (one stretched image, no grid — exactly the reported symptom). Apply
      // aspect-correction (so tiles aren't distorted on a non-square canvas)
      // AND the repeat multiplier, so fract(mUv) in the sampling step produces
      // an NxN grid of the source.
      if (r > 1.0) { mUv.x *= r; } else { mUv.y /= r; }
      mUv *= max(uMediaTileRepeat, 1.0);
    }
    // STRETCH — direct mapping (fitMode 2, no-op)

    // 3) USER TRANSFORM (2B), animated by the RAF transform uniforms:
    //    rotation adds the animation angle; scale multiplies uScale AND
    //    uPulse so the pulse animation becomes a zoom-breathe on media
    //    (brightness pulsing reads wrong on photographic content).
    float rotDeg = uMediaRotation + uRotation;
    float rotRad = radians(rotDeg);
    float cosR = cos(rotRad);
    float sinR = sin(rotRad);
    mUv = vec2(mUv.x * cosR - mUv.y * sinR, mUv.x * sinR + mUv.y * cosR);
    float effScale = max(uMediaScale * uScale * uPulse, 0.0001);
    mUv /= effScale;
    mUv -= uMediaOffset;
    mUv += 0.5;

    // FLIP (2.7) — mirror AFTER the transform so it flips what the user SEES.
    if (uMediaFlipH > 0.5) mUv.x = 1.0 - mUv.x;
    if (uMediaFlipV > 0.5) mUv.y = 1.0 - mUv.y;

    vec4 texel;
    float inBounds;
    if (uMediaFitMode > 2.5) {
      // TILE (2.7): wrap instead of clamp — every fragment is in-bounds.
      inBounds = 1.0;
      texel = texture2D(uMediaTexture, fract(mUv));
    } else {
      // Outside-media region renders transparent (contain letterbox / pan).
      inBounds = step(0.0, mUv.x) * step(mUv.x, 1.0) * step(0.0, mUv.y) * step(mUv.y, 1.0);
      texel = texture2D(uMediaTexture, clamp(mUv, 0.0, 1.0));
    }

    // 4) TONE: gain → lift → gamma → invert.
    vec3 color = texel.rgb * uMediaGain + vec3(uMediaLift);
    color = pow(clamp(color, 0.0, 4.0), vec3(1.0 / max(uMediaGamma, 0.05)));
    color = clamp(color, 0.0, 1.0);
    if (uMediaInvert > 0.5) {
      color = vec3(1.0) - color;
    }

    // 5) GRADIENT LUT (2C): luminance samples the layer's color-stop ramp.
    if (uMediaLutIntensity > 0.001) {
      vec3 LUMA_W = vec3(0.299, 0.587, 0.114);
      float luma = dot(color, LUMA_W);
      vec3 ramp = getGradientColor(luma) * intensity;
      if (uMediaLutPreserveLuma > 0.5) {
        // Keep original luminance, take the ramp's chroma.
        float rampLuma = dot(ramp, LUMA_W);
        ramp = clamp(ramp + vec3(luma - rampLuma), 0.0, 1.0);
      }
      color = mix(color, clamp(ramp, 0.0, 1.0), clamp(uMediaLutIntensity, 0.0, 1.0));
    }

    // 6) Hue rotation animation (same semantics as gradient shaders).
    if (abs(uHueRotation) > 0.01) {
      color = mediaHueRotate(color, uHueRotation);
    }

    // 7) TEXTURE OVERLAY (2D): identical call to the gradient shaders —
    //    screen-space vUv so textures don't rotate with the media transform.
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

    gl_FragColor = vec4(color, texel.a * inBounds * layerOpacity);
  }
`;

/**
 * Full mask uniform default set — identical values to gradientRenderer's
 * baseUniforms mask block (compile-time binding invariant).
 */
function createMaskUniformDefaults() {
  return {
    hasMask: { value: 0.0 },
    uMaskType: { value: 0.0 },
    uMaskTexture: { value: null as THREE.Texture | null },
    uMaskOpacity: { value: 1.0 },
    uMaskFeather: { value: 0.0 },
    uMaskInvert: { value: 0.0 },
    uMaskMode: { value: 0.0 },
    uMaskFit: { value: 1.0 },
    uMaskAspect: { value: 1.0 },
    uCanvasAspect: { value: 1.0 },
    uMaskScale: { value: 1.0 },
    uMaskOffset: { value: new THREE.Vector2(0.0, 0.0) },
    uMaskRotation: { value: 0.0 },
    uMaskExpand: { value: 0.0 },
    uMaskTexelSize: { value: new THREE.Vector2(1.0 / 1024.0, 1.0 / 1024.0) },
    uMaskSourceKind: { value: 0.0 },
    uBitmapSourceMode: { value: 0.0 },
    uBitmapThreshold: { value: 0.5 },
    uMaskBlurQuality: { value: 0.0 },
    uMaskTileMode: { value: 0.0 },
    uMaskTileScale: { value: 1.0 },
    uMaskEdgeDetect: { value: 0.0 },
    uMaskEdgeThickness: { value: 2.0 },
  };
}

/**
 * Gradient / texture / animation uniform defaults — every name declared in
 * the fragment must exist here at creation. Values are neutral; the uniform
 * sweep and RAF loop populate them from layer state on the next pass.
 */
function createSharedSystemUniformDefaults() {
  const colorVectors: THREE.Vector3[] = [];
  for (let i = 0; i < 10; i++) colorVectors.push(new THREE.Vector3(0, 0, 0));
  return {
    // Gradient / LUT ramp
    colors: { value: colorVectors },
    positions: { value: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
    colorCount: { value: 2 },
    angle: { value: 0.0 },
    intensity: { value: 1.0 },
    scale: { value: 1.0 },
    // Clock / texture system
    time: { value: 0.0 },
    textureTime: { value: 0.0 },
    textureAnimationType: { value: 0.0 },
    hasTexture: { value: 0.0 },
    textureType: { value: 0.0 },
    textureIntensity: { value: 0.0 },
    textureScale: { value: 1.0 },
    textureOpacity: { value: 1.0 },
    blur: { value: 0.0 },
    distortion: { value: 0.0 },
    blendMode: { value: 0.0 },
    textureAngle: { value: 0.0 },
    gridSize: { value: 10.0 },
    complexity: { value: 1.0 },
    chromaticShift: { value: 0.0 },
    animationSpeed: { value: 1.0 },
    ridgeCount: { value: 8.0 },
    ridgeIrregularity: { value: 0.5 },
    blockIrregularity: { value: 0.5 },
    turbulence: { value: 0.0 },
    waveCount: { value: 5.0 },
    colorIntensity: { value: 1.0 },
    elevationShift: { value: 0.0 },
    lineThickness: { value: 1.0 },
    // Texture pattern system (declared inside SHARED_FUNCTIONS)
    uPatternTexture: { value: null as THREE.Texture | null },
    uPatternAR: { value: 1.0 },
    animateTexture: { value: 0.0 },
    uTextureLOD: { value: 0.0 },
    uInvertTexture: { value: 0.0 },
    uPatternOffset: { value: new THREE.Vector2(0.0, 0.0) },
    uPatternDensity: { value: 1.0 },
    uPatternRandomRotation: { value: 0.0 },
    uPatternAlternateFlip: { value: 0.0 },
    uPatternStaggerRows: { value: 0.0 },
    uPatternScaleVariance: { value: 0.0 },
    uPatternOpacityCurve: { value: 0.0 },
    uPatternOpacityCurveMode: { value: 0.0 },
    // Animation transforms (RAF-written)
    uRotation: { value: 0.0 },
    uScale: { value: 1.0 },
    uDriftX: { value: 0.0 },
    uDriftY: { value: 0.0 },
    uPulse: { value: 1.0 },
    uTurbulence: { value: 0.0 },
    uTwist: { value: 0.0 },
    uHueRotation: { value: 0.0 },
    uAnimPhase: { value: 0.0 },
    uAnimEased: { value: 0.0 },
    uAnimTime: { value: 0.0 },
    uAnimIntensity: { value: 1.0 },
    uAudioGlitch: { value: new THREE.Vector2(0, 0) },
    uAnimType: { value: 0.0 },
    uDisplacementMap: { value: null as THREE.Texture | null },
    uDisplacementStrength: { value: 0.0 },
    layerOpacity: { value: 1.0 },
  };
}

export interface CreateMediaMaterialOptions {
  media: MediaConfig;
  canvasAspect: number;
}

/**
 * Build the media layer material. The media texture is assigned by
 * GradientCanvas's media effect (async decode / video attach); the material
 * renders transparent until it arrives.
 */
export function createMediaMaterial({ media, canvasAspect }: CreateMediaMaterialOptions): THREE.ShaderMaterial {
  const tone = toneToShaderUnits(media);
  const mediaAspect =
    media.naturalWidth && media.naturalHeight
      ? media.naturalWidth / media.naturalHeight
      : 1.0;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMediaTexture: { value: null },
      uMediaAspect: { value: mediaAspect },
      uMediaCanvasAspect: { value: canvasAspect },
      uMediaFitMode: { value: MEDIA_FIT_MODE_VALUES[media.fit] ?? 0 },
      uMediaLift: { value: tone.lift },
      uMediaGamma: { value: tone.gamma },
      uMediaGain: { value: tone.gain },
      uMediaInvert: { value: media.invert ? 1.0 : 0.0 },
      uMediaScale: { value: (media.mediaScale ?? 100) / 100 },
      uMediaRotation: { value: media.rotationDeg ?? 0 },
      uMediaOffset: { value: new THREE.Vector2((media.offsetX ?? 0) / 100, (media.offsetY ?? 0) / 100) },
      uMediaLutIntensity: { value: (media.lutIntensity ?? 0) / 100 },
      uMediaLutPreserveLuma: { value: media.lutPreserveLuma ? 1.0 : 0.0 },
      uMediaFlipH: { value: media.flipH ? 1.0 : 0.0 },
      uMediaFlipV: { value: media.flipV ? 1.0 : 0.0 },
      uMediaTileRepeat: { value: media.tileRepeat ?? 3 },
      ...createSharedSystemUniformDefaults(),
      ...createMaskUniformDefaults(),
    },
    vertexShader,
    fragmentShader: withOutputColorSpace(wrapShaderWithMask(mediaFragmentShader)),
    transparent: true,
  });

  (material.userData as Record<string, unknown>).isMediaMaterial = true;
  return material;
}

/**
 * STAGE 2.7.9 (A) — CANONICAL MEDIA-SOURCE PREDICATE.
 *
 * True when a media config has pixels we can actually render, from EITHER of
 * the two legitimate source forms:
 *
 *   1. src  — an object/data URL minted this session.
 *   2. blob — the live Blob (2.7.5). This is the AUTHORITATIVE form after an
 *               autosave restore: src is deliberately stripped on save
 *               (object URLs are document-scoped and die across an iframe doc
 *               swap / reload), and only the Blob is rehydrated from IndexedDB.
 *
 * ROOT CAUSE THIS FIXES (the long-running "restore shows only the gradient
 * layer" bug): the loader path was taught about blob in 2.7.5, but the
 * MATERIAL-SELECTION path still tested !!media.src. A restored video layer
 * therefore classified as "not a media layer", so its mesh was built with the
 * GRADIENT material — which has no media uniforms at all. No amount of texture
 * loading could ever display it. Two predicates, one updated, one missed.
 *
 * INVARIANT: every "is this a media layer?" test in the app must route through
 * this function (or isMediaLayerActive). Do not re-derive it from src.
 */
export function hasMediaSource(media?: MediaConfig): boolean {
  if (!media) return false;
  if (media.blob instanceof Blob && media.blob.size > 0) return true;
  return typeof media.src === 'string' && media.src.trim().length > 0;
}

/** True when a layer should render its media source instead of a gradient. */
export function isMediaLayerActive(media?: MediaConfig): boolean {
  return !!media && media.enabled === true && hasMediaSource(media);
}
