import * as THREE from '../lib/three';
import { EffectsConfig } from '../components/controls/EffectsControls';

// ── The "finishing" pass ─────────────────────────────────────────────────
// Sprint 1.4 note: this material used to also handle Chromatic Aberration,
// Blur, Pixelate, Shape Overlay, Quad Mirror, Noise Displacement, Graphic
// Slice, Vignette, Film Grain, Posterize, Halftone, and Fresnel — all 12
// now run as their own ping-pong passes in src/app/postfx/ BEFORE this
// material ever runs — see pingPongCompositor.ts (multi-tap filters like
// Blur need real neighbor-pixel access to the previous stage's output,
// which a single fragment shader invocation can't get from anything short
// of an actual prior render pass; the 5 folded in during Sprint 1.4 never
// had that problem — they're pure per-pixel color transforms — but moved
// into the same system anyway so they can be freely reordered relative to
// the other 7 in the unified Effects Layering list). This shader now only
// owns what's explicitly NOT meant to be layerable: Color Adjustments
// (saturation/brightness/contrast/hue shift), Temperature/Tint, Invert,
// and Flash — all fixed position, applied after the layering chain
// resolves. Its `tDiffuse` input is whatever that chain produced (or the
// raw composited frame, unchanged, when no layerable stage is active).
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
    uniform float saturation;
    uniform float brightness;
    uniform float contrast;
    uniform float hueShift;
    uniform float temperature;
    uniform float tint;
    uniform bool invert;
    uniform float time;
    uniform vec2 resolution;
    // STAGE 3.0.5: audio SHAKE. A UV offset applied to the composited frame, so
    // the IMAGERY jolts while the quad stays put. Because it shifts the sample
    // coordinate (not the mesh), the frame never leaves its bounds — clamped
    // edges smear rather than reveal black. Zero when audio isn't driving it,
    // so a non-shaking frame samples exactly as before.
    uniform vec2 uShake;

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
    
    // Hue shift
    vec3 applyHueShift(vec3 color, float shift) {
      if (abs(shift) < 0.001) return color;
      
      vec3 hsv = rgb2hsv(color);
      hsv.x = fract(hsv.x + shift / 360.0);
      return hsv2rgb(hsv);
    }
    
    void main() {
      // STAGE 3.0.5: apply audio shake FIRST, so every downstream sample
      // reads from the jolted coordinate. Clamp so the smeared edge stays
      // in-bounds rather than wrapping.
      vec2 uv = clamp(vUv + uShake, 0.0, 1.0);

      // Sprint 1.2: tDiffuse is now whatever the spatial FX chain (Mirror /
      // Displace / Slice / Chroma / Blur / Pixelate / Shape Overlay — see
      // src/app/postfx/) produced upstream of this pass, or the raw
      // composited frame unchanged if no spatial stage was active this
      // frame. This shader no longer does any of that work itself.
      vec4 initialSample = texture2D(tDiffuse, uv);
      vec3 color = initialSample.rgb;
      float alpha = initialSample.a;

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
      saturation: { value: effects.saturation },
      brightness: { value: effects.brightness },
      contrast: { value: effects.contrast },
      hueShift: { value: effects.hueShift },
      temperature: { value: effects.temperature || 0 },
      tint: { value: effects.tint || 0 },
      invert: { value: effects.invert || false },
      time: { value: 0 },
      resolution: { value: new THREE.Vector2(1920, 1080) },
      // STAGE 3.0.5: audio shake offset (UV space). Driven per-frame from the
      // global audio deltas; stays (0,0) whenever nothing routes to Shake.
      uShake: { value: new THREE.Vector2(0, 0) },
      // Sprint 2: shader-based flash — driven by flash RAF loop in GradientCanvas
      uFlashOpacity:   { value: 0.0 },
      uFlashColor:     { value: new THREE.Vector3(1, 1, 1) },
      uFlashPosition:  { value: 0 },
      uFlashBeatGroup: { value: 0 },
      uFlashBlendMode: { value: 0 }, // 0=screen (light), 1=multiply (dark)
    },
    vertexShader,
    fragmentShader,
    transparent: true, // Enable transparency to respect alpha channel
    depthWrite: false, // Disable depth writing for proper alpha blending
  });
}

// Check if any effects are active — spans BOTH the spatial chain
// (postfx/) and this finishing pass, since both need to know whether to
// run at all. Whichever material actually implements a given effect
// doesn't change what counts as "on".
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
    effects.flashEnabled ||   // Flash FX — needs post-process path to run the flash shader
    // Sprint 1.1/1.2: Spatial FX chain — same amount-threshold pattern the
    // postfx stage modules use, so this predicate and their own isActive()
    // checks never disagree about "is this on".
    effects.quadMirrorEnabled ||
    (effects.noiseDisplaceEnabled && (effects.noiseDisplaceAmount || 0) > 0.001) ||
    (effects.graphicSliceEnabled && (effects.graphicSliceAmount || 0) > 0.001)
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
  // Sprint 2.1
  displaceAmountAdd: number;
  sliceAmountAdd: number;
  sliceRateAdd: number;
  pixelateAmountAdd: number;
  filmGrainAmountAdd: number;
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
    audio.strobeAdd > 0.001 ||
    // Sprint 2.1: audio-only-driven versions of these (base slider at 0,
    // effect toggled on, audio provides all the visible amount) must still
    // engage post-process. sliceRateAdd deliberately excluded — rate alone
    // with zero amount produces nothing visible, matching
    // graphicSliceStage's own isActive gate (amount-only).
    audio.displaceAmountAdd > 0.001 ||
    audio.sliceAmountAdd > 0.001 ||
    audio.pixelateAmountAdd > 0.001 ||
    audio.filmGrainAmountAdd > 0.001;
}
