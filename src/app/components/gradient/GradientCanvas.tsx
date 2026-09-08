/**
 * GradientCanvas - WebGL gradient renderer with interactive pan/zoom.
 */


import { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback, memo } from 'react';
import * as THREE from '../../lib/three';
import { toast } from 'sonner';
import { Layer, InteractionState, CanvasSettings, LayerTransformState, GradientConfig, EasingType, RenderApi } from '../../types/gradient';
import { EffectsConfig } from '../controls/EffectsControls';
import { renderGradientLayer, getAnimationTypeValue } from '../../utils/gradientRenderer';
import { calculateAnimationOffset, applyEasing, estimateCycleTime } from '../../hooks/useLayerAnimations';
import { getAudioDeltasForLayer, tickAudioFrame, getGlobalAudioDeltas, tickAudioExportFrame } from '../../audio/audioReactiveRender';
import { bakeEnvelope, clearBakedEnvelope, getBakedInfo } from '../../audio/envelopeBaker';
import { getDecodedAudioBuffer } from '../../audio/audioEngine';
import { beatClockDelta } from '../../audio/beatClock';
import { publishLayerRoster } from '../../audio/audioLayerRoster';
import { pumpAnalysisFrame, setAnalysisExternallyDriven } from '../../audio/audioEngine';
import { beginAnalysis, endAnalysis, installAudioPerf } from '../../audio/audioPerf';
import { phaseBegin, phaseEnd, installFrameProfile } from '../../utils/frameProfile';
import { createEffectsMaterial, hasActiveEffects, shouldUsePostProcess, spatialChainOrderToShaderInts } from '../../utils/effectsRenderer';
import { InteractiveControls } from '../controls/InteractiveControls';
import { sortColorStops } from '../../utils/colorStopValidation';
import { hexToShaderRgb } from '../../utils/colors';
import { getPatternCanvas, createPatternThreeTexture } from '../../utils/texturePatternCache';
import { mapTextureAnimationSpeed, mapLayerAnimationSpeed, advanceExportLayerTimeline, encodeTextureType, encodePatternFlipMode, encodePatternOpacityCurveMode } from './gradientMath';
import { applyMaskAnimation } from './maskAnimation';
import { applyRendererSize, getDrawingBufferSize, resizeRenderTargets } from './canvasSizing';
import { disposeMesh, disposeTextureMap, disposeGeometryMap, disposeRenderTargetRef } from './textureDisposal';
import { markRenderNeededNextFrame, cancelFrame } from './renderInvalidation';
import { getShapeById } from '../../lib/maskShapes';
import { encodeMediaForLayersDataKey, toneToShaderUnits } from '../../media/types';
import { createMediaTexture, disposeMediaTextureMap } from '../../media/mediaTextureManager';
import { MEDIA_FIT_MODE_VALUES, isMediaLayerActive } from '../../media/mediaShader';
import { MediaVideoManager } from '../../media/mediaVideoManager';
import { putBlob as persistMediaBlob, deleteBlob as deleteMediaBlob } from '../../media/mediaBlobStore';

// ── Flash FX module-level helpers ──────────────────────────────────────────
// Defined at module scope so they are never re-allocated on React renders and
// cannot capture stale component-level references via closure.

import { canonicalExportTimeSeconds } from '../../utils/deterministicAnimation';
import { createExportRenderCache, invalidateExportRenderCache, resizeExportRenderCache, type ExportRenderCache } from '../../utils/exportRenderCache';
import { runExportCleanup } from '../../utils/exportCleanup';
import { applyTextureQualityPolicy } from '../../utils/exportRenderQuality';
import { attachLatestExportCleanup } from '../../utils/exportStressCertification';
import type { RenderedTimelineFrameState, RenderedTimelineLayerState } from '../../utils/exportTimelineCertification';

function flashHexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  if (h.length !== 6) return [1, 1, 1];
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function flashHslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function flashPosToInt(pos: string): number {
  return ({ full: 0, topbottom: 1, sides: 2, corners: 3,
    cornersAlt: 4, opposite: 5, centerBurst: 6 } as Record<string, number>)[pos] ?? 0;
}

interface FlashState {
  opacity: number; r: number; g: number; b: number;
  beatGroup: number; posInt: number; blendMode: number;
}

/**
 * computeFlashState — pure, module-level, no closures over component refs.
 * @param ef      Current EffectsConfig snapshot
 * @param t       Time value in seconds (independent clock or animation master)
 * @param layerColors First visible layer's color stops (for 'color' flash type)
 */
function computeFlashState(
  ef: EffectsConfig,
  t: number,
  layerColors?: Array<{ color: string }> | null,
): FlashState {
  if (!ef.flashEnabled) return { opacity: 0, r: 1, g: 1, b: 1, beatGroup: 0, posInt: 0, blendMode: 0 };
  const hz    = Math.max(0.1, ef.flashSpeed ?? 2);
  const phase = (t * hz) % 1;
  const beat  = Math.floor(t * hz);

  // LFO waveform
  let raw = 0;
  switch (ef.flashMode ?? 'stutter') {
    case 'oscillate': raw = (1 + Math.sin(phase * Math.PI * 2 - Math.PI / 2)) / 2; break;
    case 'pulse':     raw = Math.pow(Math.max(0, Math.sin(phase * Math.PI)), 3);     break;
    case 'beatDrop':  raw = Math.exp(-phase * 8.0);                                 break;
    case 'breathe':   raw = Math.pow((1 + Math.sin(phase * Math.PI * 2 - Math.PI / 2)) / 2, 0.3); break;
    case 'sawtooth':  raw = 1 - phase;                                               break;
    default:          raw = Math.pow(Math.max(0, Math.sin(phase * Math.PI * 2)), 10);
  }

  const shaped  = applyEasing(raw, (ef.flashEasing ?? 'easeOut') as EasingType);
  const opacity = Math.max(0, Math.min(1, shaped * (ef.flashIntensity ?? 0.7)));

  // Color and blend mode
  let hexColor  = '#ffffff';
  let blendMode = 0; // 0=screen (light), 1=multiply (dark)
  if (ef.flashType === 'dark') {
    blendMode = 1; // multiply blend → darkens toward black
  } else if (ef.flashType === 'color' && layerColors?.length) {
    hexColor = layerColors[beat % layerColors.length]?.color ?? '#ffffff';
  } else if (ef.flashType === 'hueRotate') {
    hexColor = flashHslToHex((t * hz * 60) % 360, 100, 65);
  }
  const [r, g, b] = flashHexToRgb01(hexColor);

  const maxGroup = ef.flashPosition === 'cornersAlt' ? 4 : 2;
  return { opacity, r, g, b, beatGroup: beat % maxGroup, posInt: flashPosToInt(ef.flashPosition ?? 'full'), blendMode };
}
// ── end Flash FX module-level helpers ──────────────────────────────────────

function getSvgIntrinsicSize(svgText: string, fallback = { width: 1024, height: 1024 }) {
  const viewBoxMatch = svgText.match(/viewBox\s*=\s*["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/i);
  if (viewBoxMatch) {
    const width = Math.max(1, Number(viewBoxMatch[3]) || fallback.width);
    const height = Math.max(1, Number(viewBoxMatch[4]) || fallback.height);
    return { width, height };
  }

  const widthMatch = svgText.match(/width\s*=\s*["']\s*([-\d.]+)(px)?\s*["']/i);
  const heightMatch = svgText.match(/height\s*=\s*["']\s*([-\d.]+)(px)?\s*["']/i);
  const width = Math.max(1, Number(widthMatch?.[1]) || fallback.width);
  const height = Math.max(1, Number(heightMatch?.[1]) || fallback.height);
  return { width, height };
}

async function createSvgMaskTexture(
  svgText: string,
  renderer: THREE.WebGLRenderer | null,
  viewBox?: { x: number; y: number; width: number; height: number },
  renderMode?: 'fill' | 'wireframe',
  strokeWidth?: number
): Promise<THREE.Texture> {
  // Validate SVG text
  if (!svgText || svgText.trim().length === 0) {
    throw new Error('SVG text is empty');
  }

  let processedSvg = svgText.trim();

  // Check if this is just a path string (starts with M, m, or common path commands)
  const isPathOnly = /^[MmLlHhVvCcSsQqTtAaZz\s\d.,\-]+$/.test(processedSvg);

  if (isPathOnly && viewBox) {
    // Wrap path in a proper SVG document
    // Apply stroke width if provided, regardless of render mode
    const isWireframe = renderMode === 'wireframe';
    const effectiveStroke = strokeWidth !== undefined ? strokeWidth : (isWireframe ? 3 : 0);

    let pathAttrs: string;
    if (isWireframe) {
      // Wireframe: stroke only, no fill
      pathAttrs = `fill="none" stroke="white" stroke-width="${effectiveStroke}"`;
    } else if (effectiveStroke > 0) {
      // Filled with stroke outline
      pathAttrs = `fill="white" stroke="white" stroke-width="${effectiveStroke}"`;
    } else {
      // Filled only, no stroke
      pathAttrs = `fill="white"`;
    }

    // FIX: Stroke is centered on the path â€” half extends OUTSIDE the viewBox.
    // Expand the viewBox by strokeWidth/2 on every side so the outer half of
    // the stroke has room to render instead of being clipped by the SVG viewport.
    // Add an extra 1px safety margin for sub-pixel AA fringe.
    const strokeExpand = effectiveStroke > 0 ? Math.ceil(effectiveStroke / 2) + 1 : 0;
    const expandedVB = {
      x: viewBox.x - strokeExpand,
      y: viewBox.y - strokeExpand,
      width:  viewBox.width  + strokeExpand * 2,
      height: viewBox.height + strokeExpand * 2,
    };
    processedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${expandedVB.x} ${expandedVB.y} ${expandedVB.width} ${expandedVB.height}" overflow="visible"><path d="${processedSvg}" ${pathAttrs}/></svg>`;

    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      if (import.meta.env?.DEV) console.log(`[SVG Mask] Wrapped path-only data (mode: ${renderMode || 'fill'}, stroke: ${effectiveStroke})`);
    }
  } else if (!processedSvg.includes('<svg') && !processedSvg.includes('<?xml')) {
    throw new Error('Invalid SVG: Not a valid SVG document or path data');
  }

  // Ensure SVG has proper namespace
  if (processedSvg.includes('<svg') && !processedSvg.includes('xmlns')) {
    processedSvg = processedSvg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  // FIX: Ensure overflow="visible" on ALL SVG documents so strokes near the
  // viewBox boundary are never clipped by the browser's SVG viewport scissor.
  // This handles full SVG documents (not path-only) where shapes sit at x=0/y=0.
  if (processedSvg.includes('<svg') && !processedSvg.includes('overflow=')) {
    processedSvg = processedSvg.replace(/(<svg[^>]*)(>)/, '$1 overflow="visible"$2');
  }

  const intrinsic = getSvgIntrinsicSize(processedSvg);
  const longest = Math.max(intrinsic.width, intrinsic.height);
  const baseLongSide = Math.min(4096, Math.max(2048, longest));
  const scale = baseLongSide / longest;
  const contentWidth = Math.max(1, Math.round(intrinsic.width * scale));
  const contentHeight = Math.max(1, Math.round(intrinsic.height * scale));

  // Add generous padding for stroke width to prevent clipping
  // Stroke width is in original SVG coordinates, so we scale it AND add extra safety margin
  const strokePadding = strokeWidth ? Math.ceil(strokeWidth * scale * 6) : 0;
  const basePad = Math.max(48, Math.round(Math.max(contentWidth, contentHeight) * 0.15));
  const pad = Math.max(basePad, strokePadding);

  const rasterWidth = contentWidth + pad * 2;
  const rasterHeight = contentHeight + pad * 2;

  const blob = new Blob([processedSvg], { type: 'image/svg+xml;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();

      // Add timeout to prevent hanging
      const timeout = setTimeout(() => {
        image.onload = null;
        image.onerror = null;
        reject(new Error('SVG loading timeout (10s)'));
      }, 10000);

      image.onload = () => {
        clearTimeout(timeout);
        resolve(image);
      };

      image.onerror = (event) => {
        clearTimeout(timeout);
        if (import.meta.env?.DEV) console.error('SVG load error event:', event);
        reject(new Error('Failed to load SVG: Invalid SVG data or browser restriction'));
      };

      image.src = blobUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = rasterWidth;
    canvas.height = rasterHeight;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      throw new Error('Failed to create SVG mask canvas context');
    }

    ctx.clearRect(0, 0, rasterWidth, rasterHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, pad, pad, contentWidth, contentHeight);

    const texture = new THREE.CanvasTexture(canvas);
    // Three r183's WebGL1 colour-conversion path can fault when a CanvasTexture
    // is uploaded with NoColorSpace inside the Figma Chromium iframe
    // (`Cannot read properties of undefined (reading 'primaries')`). Masks use
    // alpha coverage only, so sRGB tagging is GPU-safe and does not alter the
    // sampled alpha channel used by the mask shader.
    applyTextureQualityPolicy(texture, {
      colorSpace: THREE.LinearSRGBColorSpace,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      anisotropy: renderer?.capabilities.getMaxAnisotropy() || 1,
    });
    (texture.userData as any).sourceType = 'svg';
    (texture.userData as any).maskCoverageChannel = 'alpha';
    texture.needsUpdate = true;
    return texture;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}


async function createBitmapMaskTexture(
  imageUrl: string,
  renderer: THREE.WebGLRenderer | null
): Promise<THREE.Texture> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load bitmap mask image'));
    image.src = imageUrl;
  });

  const srcW = Math.max(1, img.naturalWidth || img.width || 1024);
  const srcH = Math.max(1, img.naturalHeight || img.height || 1024);
  const longest = Math.max(srcW, srcH);

  // P1 FIX: Do NOT upsample bitmaps.
  // Upsampling via canvas drawImage uses bilinear interpolation which blurs
  // sharp alpha-channel edges.  Those blurred edge pixels then produce the
  // ghost / 3-D-outline artefact visible in the shader.
  // Strategy: draw at native resolution, only downscale if source exceeds
  // the GPU texture size limit (4096 px).
  const scale = longest > 4096 ? 4096 / longest : 1.0;
  const rasterWidth  = Math.max(1, Math.round(srcW * scale));
  const rasterHeight = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = rasterWidth;
  canvas.height = rasterHeight;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('Failed to create bitmap mask canvas context');

  ctx.clearRect(0, 0, rasterWidth, rasterHeight);
  // Only enable smoothing when downscaling (scale < 1); for 1:1 it adds blur
  ctx.imageSmoothingEnabled = scale < 1.0;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, rasterWidth, rasterHeight);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; // POLISH: Ensure sRGB color space for mask textures
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = renderer?.capabilities.getMaxAnisotropy() || 1;
  texture.needsUpdate = true;
  (texture.userData as any).sourceType = 'image';
  return texture;
}



interface GradientCanvasProps {
  layers: Layer[];
  canvasSettings: CanvasSettings;
  effects: EffectsConfig;
  isPlaying?: boolean;
  interactionEnabled?: boolean;
  onInteraction?: (state: InteractionState) => void;
  activeLayerId?: string;
  onUpdateLayer?: (layerId: string, updates: Partial<Layer>) => void;
  /** PATCHED v1.85.1 CRIT-02: fired after first rendered frame so App.tsx knows
   *  the canvas is live and can start the app fade-in. */
  onReady?: () => void;
  /**
   * STAGE 2.8.1: use the CANONICAL RenderApi from types/gradient.ts.
   *
   * This prop previously carried an inline duplicate of that interface, which
   * had already drifted — it was missing `getExportFlashOverlay`, so the ref
   * assignment below only typechecked by accident. types/gradient.ts states the
   * invariant plainly ("Any new method added to GradientCanvas must be added
   * here — not duplicated per-file"); this makes the code obey it, so the next
   * API addition can't silently diverge again.
   */
  renderApiRef?: React.MutableRefObject<RenderApi | null>;
}

/**
 * STAGE 3.0.3 (perf) — hoisted out of the render loop.
 *
 * Which animation types drive a SHADER UV field. Pure-transform types
 * (rotation, pulse, scale, drift…) stay at 0: JS handles them fully and a
 * shader field would double the motion. Morphing types need the UV distortion
 * for their liquid/swirl character.
 *
 * Frozen so an accidental write is a loud failure rather than a silent
 * cross-frame mutation.
 */
const SHADER_ANIM_TYPE_MAP: Readonly<Record<string, number>> = Object.freeze({
  wave:        1.0,  // applyWaveField — travelling wave sheet
  morph:       2.0,  // applyMorphField — organic UV morphing
  liquid:      2.0,  // applyMorphField — liquid uses morph UV field
  vortex:      3.0,  // applyVortexField — spiral whirlpool swirl
  fractalZoom: 5.0,  // applyFractalZoomField — recursive zoom texture
  turbulence:  6.0,  // applyTurbulenceField — multi-freq liquid chaos
  ripple:      7.0,  // applyRippleField — chaotic multi-source ripples
});

export const GradientCanvas = memo(function GradientCanvas({
  layers,
  canvasSettings,
  effects,
  isPlaying = false,
  interactionEnabled = false,
  onInteraction,
  activeLayerId,
  onUpdateLayer,
  onReady,
  renderApiRef,
}: GradientCanvasProps) {
  // STAGE 3.0.1: this canvas owns the audio analysis pump for its lifetime, so
  // the engine stops running its own RAF (see setAnalysisExternallyDriven).
  // Registered in a layout effect so the handoff happens before the first
  // animate() tick calls pumpAnalysisFrame().
  useLayoutEffect(() => {
    installAudioPerf();
    installFrameProfile();
    setAnalysisExternallyDriven(true);
    return () => setAnalysisExternallyDriven(false);
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);

  // STAGE 3.0.2a: publish id+name for the audio panel's layer-target picker.
  // Done here because this component already holds `layers`; the alternative
  // was threading the list through App → AppHeader → Mount → Panel purely for
  // a dropdown. The store compares before notifying, so an unchanged roster
  // costs nothing (see audioLayerRoster.ts).
  useEffect(() => {
    publishLayerRoster(layers.map((l) => ({ id: l.id, name: l.name })));
  }, [layers]);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const meshesRef = useRef<THREE.Mesh[]>([]);
  const animationFrameRef = useRef<number>();
  const renderTargetRef = useRef<THREE.WebGLRenderTarget | null>(null);
  // Separate read-back RT used by readFramePixels for accurate PNG/video export.
  // The scene RT stores linear values; we need to capture the POST-PROCESS output
  // (which includes the sRGB encoding applied during the composite pass).
  // We render the composited final frame into this RT so readFramePixels gets
  // exactly what the user sees on screen.
  const captureRTRef = useRef<THREE.WebGLRenderTarget | null>(null);
  // FIX (export perf): Cached export render target — reused across all renderAtTime
  // calls during a single export session. The old code allocated a new WebGLRenderTarget
  // on EVERY frame (~300x for a 5s/60fps export), causing GPU texture alloc+dealloc churn
  // that was the primary source of export slowness and canvas stutter during recording.
  // Now: created once when export starts, reused every frame, disposed after export ends.
  // Keyed by {width, height} — only recreated if export dimensions change mid-session.
  const exportRTCacheRef = useRef<{
    rt: THREE.WebGLRenderTarget;
    width: number;
    height: number;
  } | null>(null);
  // SPRINT 3 FIX: reusable CPU-side readback buffer for readFramePixels.
  // Without this, every video frame allocates a new Uint8Array(w*h*4).
  // At 4K (3840×2160×4 = 33MB/frame) over 300 frames that is ~10GB of short-lived
  // allocations, creating GC pressure that causes visible frame stalls mid-export.
  // Buffer is resized lazily and reused when dimensions match. It is tied to the
  // component lifecycle via useRef — no cross-instance leaks.
  const _readbackBufRef = useRef<Uint8Array | null>(null);
  const _readbackBufByteCount = useRef<number>(0);
  const postProcessSceneRef = useRef<THREE.Scene | null>(null);
  const postProcessCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const postProcessQuadRef = useRef<THREE.Mesh | null>(null);
  const effectsMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const maskTexturesRef = useRef<Map<string, THREE.Texture>>(new Map());
  const patternTexturesRef = useRef<Map<string, THREE.Texture>>(new Map());
  const mediaTexturesRef = useRef<Map<string, THREE.Texture>>(new Map()); // Media Layer System (Stage 1)
  const mediaVideoManagerRef = useRef<MediaVideoManager | null>(null);     // Stage 2E: live video playback
  if (mediaVideoManagerRef.current === null) {
    mediaVideoManagerRef.current = new MediaVideoManager();
  }
  const [isInitialized, setIsInitialized] = useState(false);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [maskTextureVersion, setMaskTextureVersion] = useState(0); // Force re-render when mask texture loads
  const [patternTextureVersion, setPatternTextureVersion] = useState(0); // Force re-render when pattern texture loads
  const [mediaTextureVersion, setMediaTextureVersion] = useState(0); // Force re-render when media texture loads
  
  // Invalidation-based rendering: only render when needed
  const needsRenderRef = useRef(true);
  const renderScheduledRef = useRef(false);
  // Independent texture-only clock — advances whenever animateTexture is on,
  // regardless of whether Play is pressed. Feeds textureTime uniform so
  // always-on liquid effects (Spackle, HeatMelt, Topography) run without Play.
  const textureOnlyTimeRef = useRef(0);
  // Cached visible-layer array â€” rebuilt only when layer structure changes, not every RAF tick.
  // Avoids Array.filter() allocation on every frame during animation playback.
  const cachedVisibleLayersRef = useRef<Layer[]>([]);
  // Warm-up flag: on first play-start the RAF fires one 0-dt frame so shaders are fully
  // compiled and GPU is warmed before the clock starts advancing â€” prevents first-frame skip.
  const warmupFramePendingRef = useRef(false);

  // Export state - prevents RAF conflicts during export
  const isExportingRef = useRef(false);
  // Phase 1 Export Timeline Authority: the exporter configures one fixed frame
  // duration before rendering. Every deterministic subsystem uses this instead
  // of guessing from live RAF timing.
  const exportTimelineRef = useRef<{ fps: number; totalFrames: number; durationMs: number; frameDurationSeconds: number; loopLockEnabled: boolean } | null>(null);
  // Phase 3: one persistent cache per export session. It retains references to
  // existing meshes/materials/uniforms/textures instead of rediscovering or
  // rebuilding them for every encoded frame.
  type ExportLayerCacheEntry = {
    layerId: string;
    mesh: any;
    layer: Layer;
    uniforms: Record<string, { value: any }>;
    maskTextureWidth: number;
    maskTextureHeight: number;
  };
  const exportRenderCacheRef = useRef<ExportRenderCache<ExportLayerCacheEntry> | null>(null);
  // STAGE 3.1: previous export frame time, for deterministic per-frame dt in the
  // baked-audio tick. Reset to -1 at export start so frame 0 gets a sane dt.
  const lastExportTimeRef = useRef(-1);
  // Per-layer deterministic continuation state. Both phase and the preview's
  // in-flight speed smoother cross the export boundary, so frame 0 is the
  // visible frame and later frames follow the same speed transition as preview.
  const exportPhaseAccumRef = useRef<Map<string, { phase: number; smoothedSpeed: number }>>(new Map());
  const exportSnapshotRef = useRef<{
    masterTime: number;
    textureTime: number;
    flashTime: number;
    rendererWidth: number;
    rendererHeight: number;
    pixelRatio: number;
    cssWidth: string;
    cssHeight: string;
    logicalWidth: number;
    logicalHeight: number;
    wasPlaying: boolean;
    accumulatedTime: number;
    cameraPosition: [number, number, number];
    cameraZoom: number;
    viewport: [number, number, number, number];
    scissor: [number, number, number, number];
    scissorTest: boolean;
  } | null>(null);
  // v2.2.5.4: per-layer texture transport snapshot used by deterministic exports.
  // This prevents procedural/texture-native animation from being recomputed from
  // absolute export time, which made fractal/native motion run much faster than
  // the live preview after WebM export started.
  const exportTextureSnapshotRef = useRef<Map<string, { base: number; speed: number; active: boolean }>>(new Map());
  // Trigger to restart animation loop after export completes
  const [exportRestartTrigger, setExportRestartTrigger] = useState(0);
  const animationMasterTimeRef = useRef(0);
  const animationAccumulatedTimeRef = useRef(0);
  const animationPlayStartRef = useRef<number | null>(null);
  // EMA-smoothed delta â€” damps vsync jitter (16.6ms â†” 17.3ms oscillation)
  // at slow animation speeds without adding latency to fast animations.
  // alpha=0.25: time constant ~3 frames â†’ settles faster than old 0.12 (7-frame window).
  // Absorbs single-frame vsync jitter (16.6â†”4 17.3ms) with no perceptible latency.
  const smoothedDeltaRef = useRef(0.01667); // initialised to 60fps
  // Float precision guard: wrap accumulated time every ~300s to prevent
  // sin/cos precision decay after long sessions without resetting phase.
  // 300s is safely below the point where 64-bit float loses sub-ms resolution.
  const PRECISION_WRAP_INTERVAL = 300; // seconds
  // Warm-up: only burn the first-play frame once per component lifetime.
  // After shaders are compiled, the warm-up delay is unnecessary and causes
  // a visible extra skip on every pause/resume cycle.
  const hasEverPlayedRef = useRef(false);

  // PATCHED v1.85.1 CRIT-02: fire onReady after first rendered frame.
  // Stored in a ref so the animate() closure captures it without re-creating
  // the loop. Fires once â€” subsequent frames are no-ops.
  const onReadyRef = useRef(onReady);
  const hasCalledOnReadyRef = useRef(false);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  // Custom timer for frame delta tracking with Page Visibility API support
  const lastFrameTimeRef = useRef<number>(performance.now());
  const isPageVisibleRef = useRef<boolean>(true);

  // Shared preview clocks. Keep them in refs so motion stays continuous even if
  // React updates occur mid-playback.
  const textureMasterTimeRef = useRef(0);
  const previewLastFrameTimeRef = useRef<number | null>(null);
  const textureTransportRef = useRef<Map<string, { lastMasterTime: number; accumulated: number }>>(new Map());
  
  // Displacement system refs for Interactive Warp Mode
  const displacementCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displacementCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const displacementTextureRef = useRef<THREE.Texture | null>(null);
  const [brushPosition, setBrushPosition] = useState<{ x: number; y: number } | null>(null);
  
  // PERFORMANCE FIX: Throttle interaction state updates to 8-12 fps (~83-120ms intervals)
  // This prevents excessive re-renders in parent App.tsx while maintaining smooth visual feedback
  const lastInteractionUpdateRef = useRef<number>(0);
  // Interaction throttle: 16ms = native 60fps cadence. The old 100ms (10fps) was
  // the primary cause of jerky/chaotic interactive mode movement. We push parent
  // state updates at 60fps here; the RAF loop already smooths via adaptive lerp.
  const INTERACTION_THROTTLE_MS = 16; // 60fps â€” matches TouchTexture's per-frame update

  // Throttled interaction callback - memoized to prevent recreation
  const throttledOnInteraction = useCallback((state: InteractionState) => {
    const now = performance.now();
    if (now - lastInteractionUpdateRef.current >= INTERACTION_THROTTLE_MS) {
      onInteraction?.(state);
      lastInteractionUpdateRef.current = now;
    }
  }, [onInteraction]);
  
  // Cumulative animation state for each layer (persists across play/pause)
  const layerStatesRef = useRef<Map<string, LayerTransformState>>(new Map());
  
  // Store current layers in a ref to avoid restarting animation loop on every layer change
  const layersRef = useRef<Layer[]>(layers);
  // Store current effects in a ref â€” gives the animate() closure live access
  // without adding 'effects' to the animation loop's useEffect deps.
  const effectsRef = useRef<typeof effects>(effects);
  
  // Store interaction state in refs to ensure animation loop has latest values
  const interactionEnabledRef = useRef(interactionEnabled);
  const isPlayingRef = useRef(isPlaying);
  const activeLayerIdRef = useRef(activeLayerId);
  
  const interactionState = useRef<InteractionState>({
    mouseX: 0,
    mouseY: 0,
    intensity: 0, // Start at 0 to prevent jump when toggling ON
  });
  
  // Smooth interpolation state for fluid dragging (lerp for smooth motion)
  const targetInteraction = useRef({ mouseX: 0, mouseY: 0, intensity: 0, shiftKey: false, altKey: false, currentParameter: '' });
  const currentInteraction = useRef({ mouseX: 0, mouseY: 0, intensity: 0, shiftKey: false, altKey: false, currentParameter: '' });

  // Update layers ref whenever layers change (but doesn't trigger useEffect cleanup)
  // PATCHED v1.85.1 CRIT-04: Merged two separate single-line ref-sync effects
  // (layers â†’ layersRef, effects â†’ effectsRef) into one combined effect.
  // Both ran on every render cycle anyway; merging halves the scheduler overhead.
  useEffect(() => {
    layersRef.current = layers;
    effectsRef.current = effects;
    // Invalidate visible-layer cache whenever the full layer list changes
    cachedVisibleLayersRef.current = [];
  }, [layers, effects]);

  // Setup Page Visibility API to pause on tab switch
  useEffect(() => {
    const handleVisibilityChange = () => {
      isPageVisibleRef.current = !document.hidden;
      if (!document.hidden) {
        // Reset frame time when returning to avoid large delta spike
        lastFrameTimeRef.current = performance.now();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Sprint C: WebGL context loss recovery
  // GPU driver resets (heavy FX, long sessions, mobile) silently black out the
  // canvas without this handler. Stop RAF loops on loss, notify user, re-arm on restore.
  useEffect(() => {
    const canvas = rendererRef.current?.domElement;
    if (!canvas) return;

    const handleContextLost = (e: Event) => {
      e.preventDefault(); // required — signals we handle (and want) recovery
      // Do NOT cancel the master RAF loop: the in-loop context-loss guard makes
      // it a cheap no-op while lost, and keeping it alive means playback resumes
      // the instant the context comes back. (Only the flash RAF is cancelled.)
      if (flashRafRef.current) {
        cancelAnimationFrame(flashRafRef.current);
        flashRafRef.current = 0;
      }
      // Mark that a full uniform re-seed is needed once we recover — every
      // material's GPU-side program is gone and must be repopulated.
      (window as any).__blendcraftContextLost = true;
      toast.error('Graphics briefly overloaded — recovering…', {
        duration: 4000,
        id: 'webgl-context-lost',
      });
    };

    const handleContextRestored = () => {
      toast.dismiss('webgl-context-lost');
      toast.success('Graphics recovered.');
      (window as any).__blendcraftContextLost = false;
      // Force a full structural + uniform refresh: bump the version refs the
      // sweeps depend on so every material is repopulated from real state,
      // and request an immediate repaint.
      setMediaTextureVersion(v => v + 1);
      setMaskTextureVersion(v => v + 1);
      needsRenderRef.current = true;
    };

    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);
    return () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
    };
  }, [isInitialized]); // re-attach after renderer is (re)initialised

  // PATCHED v1.85.1 CRIT-04: Merged interactionEnabled and activeLayerId ref
  // syncs into one effect â€” both are cheap ref writes with no side effects.
  useEffect(() => {
    interactionEnabledRef.current = interactionEnabled;
    activeLayerIdRef.current = activeLayerId;
  }, [interactionEnabled, activeLayerId]);
  
  // â”€â”€ isPlaying sync â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // useLayoutEffect fires BEFORE browser paint (synchronous with the DOM commit).
  // This guarantees isPlayingRef.current is updated before the very next RAF
  // callback executes, eliminating the 1â€“3 frame delay where the loop keeps
  // animating after the user clicks Pause.
  useLayoutEffect(() => {
    const now = performance.now();
    const wasPlaying = isPlayingRef.current;

    if (isPlaying && !wasPlaying) {
      // Sync the ref immediately â€” RAF loop reads this on the very next tick
      isPlayingRef.current = true;
      // Reset frame-time anchor to prevent a delta spike on play
      lastFrameTimeRef.current = now;
      smoothedDeltaRef.current  = 0.01667; // reset EMA to 60fps baseline
      // Warm-up only on very first play â€” GPU compiles shaders once.
      if (!hasEverPlayedRef.current) {
        warmupFramePendingRef.current = true;
        hasEverPlayedRef.current = true;
      }
      if (animationPlayStartRef.current == null) {
        animationPlayStartRef.current = now;
      }
      previewLastFrameTimeRef.current = now;
    } else if (!isPlaying && wasPlaying) {
      // NOTE: smoothedDeltaRef is NOT reset here on pause â€” we want it to
      // retain the last stable ~60fps value so the NEXT resume starts smooth.
      // Sync the ref immediately â€” stops the RAF loop on the very next tick
      isPlayingRef.current = false;
      // Freeze the accumulated clock at exactly this moment
      if (animationPlayStartRef.current != null) {
        animationAccumulatedTimeRef.current += Math.max(
          0,
          (now - animationPlayStartRef.current) / 1000
        );
        animationMasterTimeRef.current  = animationAccumulatedTimeRef.current;
        textureMasterTimeRef.current    = animationMasterTimeRef.current;
        animationPlayStartRef.current   = null;
      }
      previewLastFrameTimeRef.current = now;
      // Trigger one final RAF render so the canvas shows the exact frozen frame.
      // The RAF loop will see isPlayingRef=false, skip clock advance, but still
      // render once because needsRenderRef=true, then go idle.
      needsRenderRef.current = true;
    }
    // isPlayingRef already updated above in each branch;
    // this covers the edge case where isPlaying didn't change (re-render only)
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Create stable dependency key for mesh recreation - only changes when structure actually changes
  // PATCHED: gradient.type REMOVED from this key. Type changes no longer force a full
  // geometry rebuild (dispose + recreate PlaneGeometry). All gradient types share the
  // same PlaneGeometry â€” only the shader material differs. A separate meshMaterialKey
  // effect below handles material swaps, which is ~60% faster than full rebuilds.
  const meshStructureKey = useMemo(() => {
    // STAGE 2.7A: visibility REMOVED from this key. Previously it filtered to
    // visible layers, so toggling ANY layer's eye icon changed the key and
    // tore down + rebuilt EVERY mesh in the scene. The rebuilt materials start
    // with default uniform values and are only repopulated by the uniform
    // sweep on a LATER effect pass — which is exactly the "unhides at full
    // brightness, then snaps to its real settings" flicker. Meshes now exist
    // for ALL layers and visibility is a per-frame `mesh.visible` flag, so
    // hide/show costs nothing and destroys no state.
    //
    // PHASE 7.3E.10 STATE-CONTINUITY LOCK: texture enable/type is NOT structural.
    // All gradient materials already expose the shared texture uniforms; toggling grain
    // or another texture must not rebuild the mesh or reset animation/gradient phase.
    // Tracks only TRUE structural changes: layer identity, media on/off, displacement.
    const key = layers.map(l =>
      // media on/off swaps the layer's shader program (media material vs
      // gradient material) — structural change requiring a mesh rebuild.
      // STAGE 2.7.9 (A): route through isMediaLayerActive — the canonical
      // predicate that accepts a live Blob as a source. The previous inline
      // `l.media?.src` test classified every RESTORED media layer as 'nomedia'
      // (src is stripped on save by design), so the mesh was rebuilt with the
      // gradient material and the restored video/image could never appear.
      `${l.id}-${l.displacement ? 'disp' : 'no'}-${isMediaLayerActive(l.media) ? 'media' : 'nomedia'}`
    ).join('|');
    return key;
  }, [layers]);

  // Material-swap key: triggers when only the gradient shader type changes.
  // Uses a fast path (material swap) instead of the full mesh rebuild.
  const meshMaterialKey = useMemo(() => {
    // STAGE 2.7A: pairs against ALL layers (meshes now exist for all layers).
    return layers.map(l => `${l.id}-${l.gradient?.type}`).join('|');
  }, [layers]);

  // Create stable dependency key for gradient colors - CRITICAL for palette updates
  // ── Stable layer data key ──────────────────────────────────────────────────
  // Encodes all mutable layer data as one primitive string.
  // useMemos that previously used [layers] (object ref, changes every setState)
  // now use [layersDataKey] so React can compare with value equality.
  // Result: only the keys whose data actually changed get recomputed.
  const layersDataKey = useMemo(() =>
    layers.map(l => {
      const colorStr = l.gradient?.colors?.map(c => `${c.color}@${c.position}`).join(',') ?? '';
      // animStr: only type and enabled need to be tracked here.
      // animation.speed is consumed directly by the RAF loop each frame —
      // it does NOT drive any shader uniform via a useEffect, so including it
      // in layersDataKey causes 6 downstream memos to recompute on every
      // Speed slider commit even though all output strings stay identical.
      const animStr  = `${l.animation?.enabled}-${l.animation?.type}`;
      // texStr: shapePatternId is intentionally included — changing the shape requires
      // a full pattern texture re-bake, so patternPropertiesKey (which gates that
      // re-bake) must recompute when the shape changes.
      // patternSpacing/OffsetX/OffsetY/Rotation/FillMode also included for same reason —
      // they are all tracked by patternPropertiesKey and require a re-bake.
      const texStr   = `${l.texture?.type ?? 'none'}-${l.texture?.shapePatternId ?? ''}-${l.texture?.patternSpacing ?? 0}-${l.texture?.patternOffsetX ?? 0}-${l.texture?.patternOffsetY ?? 0}-${l.texture?.patternRotation ?? 0}-${l.texture?.patternFillMode ?? 'fill'}-${l.texture?.opacity}-${l.texture?.intensity}-${l.texture?.scale}-${l.texture?.blur}-${l.texture?.distortion}-${l.texture?.angle}-${l.texture?.gridSize}-${l.texture?.complexity}-${l.texture?.chromaticShift}-${l.texture?.animateTexture}-${l.texture?.animationSpeed}-${l.texture?.blendMode}-${l.texture?.textureAnimationType}-${l.texture?.waveCount}-${l.texture?.turbulence}-${l.texture?.colorIntensity}-${l.texture?.lineThickness}-${l.texture?.invertTexture ? '1' : '0'}-${l.texture?.patternDensity}-${l.texture?.patternRandomRotation}-${l.texture?.patternAlternateFlip}-${l.texture?.patternStaggerRows}-${l.texture?.patternScaleVariance}-${l.texture?.patternOpacityCurve}-${l.texture?.patternOpacityCurveMode}-${l.texture?.patternOutlineThickness}`;
      const xfStr    = `${l.gradient?.angle}-${l.gradient?.scale}-${l.gradient?.scaleBoost}-${l.gradient?.centerX}-${l.gradient?.centerY}-${l.gradient?.twist}-${l.gradient?.turbulence}-${l.gradient?.segments}-${l.gradient?.frequency}-${l.gradient?.intensity}-${l.gradient?.octaves}-${l.gradient?.stripeCount}-${l.gradient?.waveAmplitude}-${l.gradient?.gridRows}-${l.gradient?.gridCols}-${l.gradient?.blobCount}`;
      // maskStr: all mask properties that feed the uniform sweep useEffect must be
      // represented here. When any mask slider changes, layersDataKey changes →
      // maskPropertiesKey recomputes → the uniform sweep fires → shader sees the update.
      const maskStr  = l.mask
        ? [
            l.mask.type         ?? 'none',
            l.mask.visible      ?? true,
            l.mask.opacity      ?? 1,
            l.mask.feather      ?? 0,
            l.mask.invert       ?? false,
            l.mask.mode         ?? 'clip',
            l.mask.maskScale    ?? 1,
            l.mask.positionX    ?? 0,
            l.mask.positionY    ?? 0,
            l.mask.rotation     ?? 0,
            l.mask.expand       ?? 0,
            l.mask.sourceType   ?? '',
            l.mask.svgText      ? l.mask.svgText.length : 0,
            l.mask.svgShapeId   ?? '',
            l.mask.svgRenderMode   ?? 'fill',
            l.mask.svgStrokeWidth  ?? 3,
            l.mask.imageUrl     ?? '',
            l.mask.imageFit     ?? 'contain',
            l.mask.blurQuality  ?? 'none',
            l.mask.tileMode     ?? 'single',
            l.mask.tileScale    ?? 1,
            l.mask.edgeDetect   ?? false,
            l.mask.edgeThickness   ?? 2,
            l.mask.bitmapSourceMode   ?? 'alpha',
            l.mask.bitmapThreshold    ?? 50,
            l.mask.sourceLayerId   ?? '',
          ].join('-')
        : 'none';
      // mediaStr: every media property read by the media uniform effect must
      // be represented here (same invariant as maskStr — missing fields become
      // silently-dropped sliders). Encoded via the media module's single
      // source-of-truth encoder.
      const mediaStr = encodeMediaForLayersDataKey(l.media);
      // opacityBlendStr: STAGE 2.5 FIX — layersDataKey itself must change when
      // opacity/blendMode change, or the gradientTransformKey memo (which
      // depends on [layersDataKey]) never re-executes its body at all, no
      // matter what fields are added inside it.
      const opacityBlendStr = `${l.opacity}-${l.blendMode}`;
      return `${l.id}:${l.visible}:${opacityBlendStr}:${colorStr}:${animStr}:${texStr}:${xfStr}:${maskStr}:${mediaStr}`;
    }).join('||'),
    [layers]
  );

  // Create stable dependency key for mask updates
  const maskPropertiesKey = useMemo(() => {
    // STAGE 2.7A: meshes now exist for ALL layers, so masks must stay in sync
    // regardless of visibility (a hidden layer that gets unhidden must already
    // have correct mask uniforms — no rebuild happens to fix them up anymore).
    const layersWithMasks = layers.filter(l => l.mask);
    return layersWithMasks.map(l => {
      const mask = l.mask;
      return [
        l.id,
        mask?.type,
        mask?.imageUrl,
        mask?.opacity,
        mask?.feather,
        mask?.invert,
        mask?.mode,
        mask?.visible ?? true,
        mask?.maskScale ?? 1,
        mask?.positionX ?? 0,
        mask?.positionY ?? 0,
        mask?.rotation ?? 0,
        mask?.expand ?? 0,
        mask?.sourceType ?? '',
        mask?.svgText ?? '',
        mask?.sourceLayerId ?? '',
        mask?.imageFit ?? 'contain',
      l.opacity,
      mask?.blurQuality ?? 'none',   // Blur Quality dropdown
      mask?.tileMode ?? 'single',    // Tile Mode dropdown
      mask?.tileScale ?? 1,          // Tile Scale slider
      mask?.edgeDetect ?? false,     // Edge Detect toggle
      mask?.edgeThickness ?? 2,      // Edge Thickness slider — was missing, caused slider to never trigger uniform update
      mask?.svgStrokeWidth ?? 3,     // Stroke Width slider — must be here so the SVG re-rasterizes (cacheKey includes it but the effect is gated on this key)
      mask?.svgRenderMode ?? 'fill', // Fill/Wireframe — same reason: changes the rasterized output
      mask?.bitmapSourceMode ?? 'luminance', // 2.7: read by the sweep for image + media-layer masks — was MISSING, so the Luminance/Alpha selector would have silently no-op'd
    ].join('-');
  }).join('|');
  // Dep restored to [layers]: maskPropertiesKey's own template covers all mask props,
  // so the string-change gate is sufficient. Using [layersDataKey] caused ALL mask
  // slider writes to be silently dropped when the prop wasn't in layersDataKey's maskStr.
}, [layers]);

  // Create stable dependency key for pattern texture properties
  const patternPropertiesKey = useMemo(() => {
    // Encodes all shape-pattern properties that require a texture re-bake.
    // Columns/rows removed — grid is fixed 4×4 internally; density = shader scale.
    // texturePropertiesKey handles scale changes (no re-bake needed for scale).
    const layersWithPatterns = layers.filter(
      l => l.visible && l.texture?.type === 'shape-pattern'
    );
    return layersWithPatterns.map(l => {
      const texture = l.texture;
      return [
        l.id,
        texture?.shapePatternId   ?? 'circle',
        texture?.patternSpacing   ?? 20,
        // patternOffsetX / patternOffsetY are intentionally NOT here — they are
        // applied as the uPatternOffset shader uniform (see patternRenderer.ts:
        // "offsetX / offsetY intentionally destructured-out"). Including them
        // forced a redundant 1024×1024 (~4MB) re-bake on every offset-slider drag,
        // which churned the GC and triggered the high-memory warnings.
        texture?.patternRotation  ?? 0,   // baked into canvas via ctx.rotate — must stay
        texture?.patternFillMode  ?? 'fill',
        texture?.patternOutlineThickness ?? 3,
      ].join('-');
    }).join('|');
  // Dep restored to [layers]: see maskPropertiesKey comment above — same root cause.
  // patternPropertiesKey gates the canvas texture re-bake; [layers] ensures every
  // shape/spacing/offset/rotation change reaches the bake path.
  }, [layers]);

  // Create stable dependency key for gradient transform properties
  // STAGE 2.5 FIX (opacity/blend mode never live-updating): layer.opacity and
  // layer.blendMode were previously absent from EVERY key string derived from
  // layersDataKey. The effect that actually writes material.opacity,
  // material.uniforms.layerOpacity.value, and material.blending depends on
  // gradientTransformKey (string equality, not the memo re-running) — so
  // moving the Opacity slider or changing Blend Mode changed React state but
  // produced an IDENTICAL key string, and the effect never re-fired. Both are
  // now included here so any change is visible to that effect's dependency
  // check. This is the fix for both bugs at once — no other key needed.
  const gradientTransformKey = useMemo(() =>
    layers.map(l => `${l.id}-${l.opacity}-${l.blendMode}-${l.gradient?.angle}-${l.gradient?.centerX}-${l.gradient?.centerY}-${l.gradient?.scale}-${l.gradient?.scaleBoost}-${l.gradient?.twist}-${l.gradient?.turbulence}-${l.gradient?.segments}-${l.gradient?.frequency}-${l.gradient?.intensity}-${l.gradient?.octaves}-${l.gradient?.stripeCount}-${l.gradient?.waveAmplitude}-${l.gradient?.gridRows}-${l.gradient?.gridCols}-${l.gradient?.blobCount}`).join('|'),
    [layersDataKey]
  );

  const gradientColorsKey = useMemo(() =>
    layers.map(l => {
      const colorStr = l.gradient?.colors?.map(c => `${c.color}-${c.position}`).join(',') || '';
      return `${l.id}-${colorStr}`;
    }).join('|'),
    [layersDataKey]  // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Create stable dependency key for animation properties
  const animationPropertiesKey = useMemo(() =>
    layers.map(l => `${l.id}-${l.animation?.enabled}-${l.animation?.type}`).join('|'),
    [layersDataKey]
  );

  // Create stable dependency key for texture properties
  const texturePropertiesKey = useMemo(() => {
    // Template includes ALL texture properties that the uniform sweep reads.
    // patternSpacing/OffsetX/Y/Rotation/FillMode/OutlineThickness added so the
    // uniform sweep fires when any of these sliders change — previously missing,
    // causing those sliders to have no visible effect on the canvas.
    const key = layers.map(l => `${l.id}-${l.texture?.type}-${l.texture?.opacity}-${l.texture?.intensity}-${l.texture?.scale}-${l.texture?.blur}-${l.texture?.distortion}-${l.texture?.angle}-${l.texture?.gridSize}-${l.texture?.complexity}-${l.texture?.chromaticShift}-${l.texture?.animateTexture}-${l.texture?.animationSpeed}-${l.texture?.blendMode}-${l.texture?.textureAnimationType}-${l.texture?.waveCount}-${l.texture?.turbulence}-${l.texture?.colorIntensity}-${l.texture?.lineThickness}-${l.texture?.invertTexture ? '1' : '0'}-${l.texture?.patternDensity}-${l.texture?.patternRandomRotation}-${l.texture?.patternAlternateFlip}-${l.texture?.patternStaggerRows}-${l.texture?.patternScaleVariance}-${l.texture?.patternOpacityCurve}-${l.texture?.patternOpacityCurveMode}-${l.texture?.patternOutlineThickness}-${l.texture?.shapePatternId}-${l.texture?.patternSpacing}-${l.texture?.patternOffsetX}-${l.texture?.patternOffsetY}-${l.texture?.patternRotation}-${l.texture?.patternFillMode}`).join('|');
    return key;
  // Dep restored to [layers]: texturePropertiesKey gates the uniform sweep; [layers]
  // ensures any texture slider commit reaches the GPU without double-tracking in layersDataKey.
  }, [layers]);

  // Create minimal key ONLY for texture animation state (to avoid full scene rebuilds)
  // S1 FIX: was [layers] — recomputed on every parent render regardless of data change.
  const textureAnimationStateKey = useMemo(() =>
    layers.map(l => `${l.id}-${l.texture?.animateTexture ? '1' : '0'}`).join('|'),
    [layersDataKey] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Initialize transform state for each layer
  useEffect(() => {
    layers.forEach(layer => {
      if (!layerStatesRef.current.has(layer.id)) {
        const gradient = layer.gradient;
        const defaultState: LayerTransformState = {
          currentAngle: gradient?.angle || 0,
          currentCenterX: gradient?.centerX || 0.5,
          currentCenterY: gradient?.centerY || 0.5,
          currentScale: gradient?.scale || 1,
          currentIntensity: gradient?.intensity || 1,
          animationTime: 0,
          baseAngle: gradient?.angle || 0,
          baseCenterX: gradient?.centerX || 0.5,
          baseCenterY: gradient?.centerY || 0.5,
          baseScale: gradient?.scale || 1,
          signedPhase: 0,
          smoothedSpeed: mapLayerAnimationSpeed(layer.animation?.speed),
        };
        layerStatesRef.current.set(layer.id, defaultState);
      }
    });

    // Clean up removed layers
    // Prune stale layer state when layers are added/removed
    // Uses meshStructureKey (encodes layer IDs) instead of raw layers — only
    // fires when layer structure changes, not on every property update.
    const layerIds = new Set(layersRef.current.map(l => l.id));
    Array.from(layerStatesRef.current.keys()).forEach(id => {
      if (!layerIds.has(id)) {
        layerStatesRef.current.delete(id);
        textureTransportRef.current.delete(id);
      }
    });
  }, [meshStructureKey]);

  // Watch for animation reset triggers (resetCounter changes)
  useEffect(() => {
    layers.forEach(layer => {
      if (layer.animation?.resetCounter !== undefined) {
        const layerState = layerStatesRef.current.get(layer.id);
        if (layerState) {
          layerStatesRef.current.set(layer.id, {
            ...layerState,
            animationTime: 0,
            signedPhase: 0,
            // Snap smoothedSpeed to current target on reset â€” no ease-in from zero
            smoothedSpeed: mapLayerAnimationSpeed(layer.animation?.speed),
          });
        }
        // Also reset texture transport so texture animation restarts from 0
        textureTransportRef.current.delete(layer.id);
      }
    });
    // Reset the global accumulated clock and EMA smoother so the shader
    // time uniform goes back to 0 and motion restarts cleanly.
    animationAccumulatedTimeRef.current = 0;
    animationMasterTimeRef.current      = 0;
    textureMasterTimeRef.current        = 0;
    flashTimeRef.current                = 0; // sync independent flash clock to restart
    animationPlayStartRef.current       = null; // force re-anchor on next play
    smoothedDeltaRef.current            = 0.01667;
    needsRenderRef.current              = true;
  }, [layers.map(l => l.animation?.resetCounter).join(',')]); // Watch resetCounter for all layers

  // Update base transforms when gradient properties change (not during animation).
  // SNAP-BACK FIX: isPlaying is REMOVED from the deps array.
  // Previously: when user pressed Pause, isPlayingâ†’false fired this effect,
  // the `if (isPlaying) return` guard passed (isPlaying was now false), and
  // ALL layerState was reset to base position â†’ the visual snap.
  // Fix: guard with isPlayingRef.current (synchronous, never stale) so this
  // effect only runs when gradient properties actually change, not on play/pause.
  useEffect(() => {
    // Update base transform values when sliders change.
    // We always update even while playing because:
    //   baseAngle/baseScale = the SLIDER value (what user sets)
    //   currentAngle/currentScale = baseAngle + animationOffset (computed in RAF)
    // Blocking this while playing was causing rotation/scale sliders to be unresponsive.
    layers.forEach(layer => {
      const state = layerStatesRef.current.get(layer.id);
      if (state && layer.gradient) {
        const playing = isPlayingRef.current;
        layerStatesRef.current.set(layer.id, {
          ...state,
          baseAngle:      layer.gradient.angle    ?? 0,
          baseCenterX:    layer.gradient.centerX  ?? 0.5,
          baseCenterY:    layer.gradient.centerY  ?? 0.5,
          baseScale:      layer.gradient.scale    ?? 1,
          // Only update current values when NOT playing — playing uses RAF-computed values
          currentAngle:   playing ? state.currentAngle   : (layer.gradient.angle    ?? 0),
          currentCenterX: playing ? state.currentCenterX : (layer.gradient.centerX  ?? 0.5),
          currentCenterY: playing ? state.currentCenterY : (layer.gradient.centerY  ?? 0.5),
          currentScale:   playing ? state.currentScale   : (layer.gradient.scale    ?? 1),
        });
      }
    });
  }, [gradientTransformKey]);

  // Load mask textures for layers with image/SVG masks
  useEffect(() => {
    let cancelled = false;
    // P2 FIX: removed dead `new THREE.TextureLoader()` â€” it was instantiated on every
    // maskPropertiesKey change but never used. Bitmap/SVG textures load via
    // createBitmapMaskTexture / createSvgMaskTexture which manage their own fetch.

    const applyLoadedTexture = (layerId: string, cacheKey: string, texture: THREE.Texture) => {
      if (cancelled) {
        texture.dispose();
        return;
      }

      (texture.userData as any).url = cacheKey;
      // Mask coverage is alpha-only, so keep this texture linear and avoid an
      // unnecessary RGB transfer while retaining the r183 WebGL1-safe path.
      applyTextureQualityPolicy(texture, {
        colorSpace: THREE.LinearSRGBColorSpace,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
        anisotropy: rendererRef.current?.capabilities.getMaxAnisotropy() || 1,
      });
      texture.needsUpdate = true;

      const existing = maskTexturesRef.current.get(layerId);
      maskTexturesRef.current.set(layerId, texture);

      // Bind the replacement texture synchronously before invalidating React.
      // Otherwise the current material can render one more frame with a disposed
      // texture while maskTextureVersion is still waiting to commit.
      const layerIndex = layersRef.current.findIndex(candidate => candidate.id === layerId);
      const material = layerIndex >= 0
        ? (meshesRef.current[layerIndex]?.material as THREE.ShaderMaterial | undefined)
        : undefined;
      if (material?.uniforms?.uMaskTexture) {
        material.uniforms.uMaskTexture.value = texture;
      }
      if (material?.uniforms?.hasMask) {
        material.uniforms.hasMask.value = 1.0;
      }

      setMaskTextureVersion(prev => prev + 1);
      needsRenderRef.current = true;
      // Dispose only after the replacement has had an opportunity to bind and
      // render. This avoids a transient GL upload fault during shape switching.
      if (existing && existing !== texture) {
        requestAnimationFrame(() => requestAnimationFrame(() => existing.dispose()));
      }
    };

    const loadBitmapMaskTexture = (layerId: string, imageUrl: string, cacheKey: string) => {
      createBitmapMaskTexture(imageUrl, rendererRef.current)
        .then((texture) => {
          applyLoadedTexture(layerId, cacheKey, texture);
        })
        .catch((error) => {
          if (import.meta.env?.DEV) console.error(`Failed to load mask texture for layer ${layerId}:`, error);
        });
    };

    layers.forEach(layer => {
      const mask = layer.mask;
      const hasBitmapSource = mask?.type === 'image' && typeof mask.imageUrl === 'string' && mask.imageUrl.length > 0;
      const hasSvgSource = mask?.type === 'image' && mask.sourceType === 'svg' && (
        (typeof mask.svgText === 'string' && mask.svgText.trim().length > 0) ||
        !!mask.svgShapeId
      );
      if (hasBitmapSource || hasSvgSource) {
        // Sprint 4: Re-hydrate svgText when it was stripped for storage efficiency.
        // sanitizeLayer strips svgText for preset library shapes (svgShapeId present)
        // to keep autosave/history lean. Restore it here from the maskShapes library
        // before the rasterization checks below.
        let effectiveMask = mask;
        if (!mask.svgText && mask.svgShapeId && mask.sourceType === 'svg') {
          const libraryShape = getShapeById(mask.svgShapeId);
          if (libraryShape?.svgPath) {
            effectiveMask = { ...mask, svgText: libraryShape.svgPath };
          }
        }
        // Validate SVG data before attempting to use it
        const hasSvgText = !!effectiveMask.svgText && effectiveMask.svgText.trim().length > 0;
        const isFullSvg = hasSvgText && (effectiveMask.svgText!.includes('<svg') || effectiveMask.svgText!.includes('<?xml'));
        // Library paths are already trusted application data. Do not reject valid SVG
        // path syntax with a narrow character whitelist (scientific notation, plus
        // signs and newer command formatting were previously rejected silently).
        // createSvgMaskTexture remains the actual parser/validation boundary.
        const isPathOnly = hasSvgText && !isFullSvg && !!effectiveMask.svgViewBox;
        const isSvgValid = hasSvgText && (isFullSvg || isPathOnly);
        const isSvgSource = effectiveMask.sourceType === 'svg' && hasSvgText && isSvgValid;
        if (effectiveMask.sourceType === 'svg' && hasSvgText && !isSvgValid && import.meta.env?.DEV) {
          if (import.meta.env?.DEV) console.warn(`[SVG Mask] Layer ${layer.id} invalid SVG.`);
        }

        // Cache key: prefer svgShapeId so stripped-svgText states cache correctly
        const svgIdent = effectiveMask.svgShapeId ? `id:${effectiveMask.svgShapeId}` : `len:${effectiveMask.svgText?.length ?? 0}`;
        const cacheKey = isSvgSource
          ? `svg:${svgIdent}:${effectiveMask.svgViewBox?.width ?? ''}x${effectiveMask.svgViewBox?.height ?? ''}:${effectiveMask.svgRenderMode ?? 'fill'}:${effectiveMask.svgStrokeWidth ?? 0}`
          : (effectiveMask.imageUrl ?? '');

        const existingTexture = maskTexturesRef.current.get(layer.id);
        if (!existingTexture || (existingTexture.userData as any).url !== cacheKey) {
          if (isSvgSource && effectiveMask.svgText) {
            if (import.meta.env?.DEV) console.log(`[SVG Mask] Layer ${layer.id}: Loading (${effectiveMask.svgShapeId ?? 'uploaded'})`);

            createSvgMaskTexture(effectiveMask.svgText, rendererRef.current, effectiveMask.svgViewBox, effectiveMask.svgRenderMode, effectiveMask.svgStrokeWidth)
              .then((texture) => {
                texture.minFilter = THREE.LinearFilter;
                applyLoadedTexture(layer.id, cacheKey, texture);
              })
              .catch((error) => {
                if (import.meta.env?.DEV) console.error(`Failed to rasterize SVG mask for layer ${layer.id}:`, error);
                // Only fallback to bitmap if imageUrl is available
                if (mask.imageUrl) {
                  if (import.meta.env?.DEV) console.warn(`SVG mask failed - bitmap fallback for layer ${layer.id}`);
                  loadBitmapMaskTexture(layer.id, mask.imageUrl, cacheKey);
                } else {
                  if (import.meta.env?.DEV) console.error(`No bitmap fallback for layer ${layer.id}`);
                  // Clear failed texture
                  const existing = maskTexturesRef.current.get(layer.id);
                  if (existing) {
                    existing.dispose();
                    maskTexturesRef.current.delete(layer.id);
                  }
                }
              });
          } else if (hasBitmapSource && mask.imageUrl) {
            loadBitmapMaskTexture(layer.id, mask.imageUrl, cacheKey);
          } else {
            // Keep the previous texture from flashing away while an SVG source is
            // being rehydrated. A missing source is reported rather than invoking
            // Image with an undefined URL.
            if (import.meta.env?.DEV) {
              console.warn(`[Mask] Layer ${layer.id} has no usable SVG or bitmap source.`);
            }
          }
        }
      } else {
        const existingTexture = maskTexturesRef.current.get(layer.id);
        if (existingTexture) {
          existingTexture.dispose();
          maskTexturesRef.current.delete(layer.id);
        }
      }
    });

    const layerIds = new Set(layers.map(l => l.id));
    Array.from(maskTexturesRef.current.keys()).forEach(id => {
      if (!layerIds.has(id)) {
        const texture = maskTexturesRef.current.get(id);
        if (texture) texture.dispose();
        maskTexturesRef.current.delete(id);
      }
    });

    return () => {
      cancelled = true;
    };
  // canvasSettings.width / canvasSettings.height intentionally included:
  // the canvas resize effect (deps: [canvasSettings.width, canvasSettings.height])
  // calls disposeTextureMap(maskTexturesRef.current), wiping all mask textures.
  // Without these deps here, the mask was permanently gone after any resolution
  // change because maskPropertiesKey doesn't change on resize.
  }, [maskPropertiesKey, canvasSettings.width, canvasSettings.height]);

  // ── STAGE 2.7A: LIVE VISIBILITY SYNC ─────────────────────────────────────
  // Visibility no longer participates in meshStructureKey, so toggling the eye
  // icon does NOT rebuild meshes. This effect just flips `mesh.visible` on the
  // already-built meshes — zero allocation, zero uniform loss, zero flicker.
  // Mesh index maps 1:1 to the real layers array (see mesh creation).
  const layerVisibilityKey = useMemo(
    () => layers.map(l => (l.visible ? '1' : '0')).join(''),
    [layers]
  );

  useEffect(() => {
    if (!isInitialized || meshesRef.current.length === 0) return;
    meshesRef.current.forEach((mesh, index) => {
      const layer = layersRef.current[index];
      if (!layer) return;
      const shouldBeVisible = layer.visible && !(mesh.userData as any).isPlaceholder;
      if (mesh.visible !== shouldBeVisible) {
        mesh.visible = shouldBeVisible;
      }
    });
    needsRenderRef.current = true;
  }, [layerVisibilityKey, isInitialized, meshStructureKey]);

  // ── MEDIA LAYER SYSTEM (Stage 1) ─────────────────────────────────────────
  // Source key: gates async texture (re)loads. Only identity fields — tone/fit
  // changes are uniform-only and must NOT trigger a texture reload.
  // INVARIANT: property key memos depend on [layers], never [layersDataKey].
  const mediaSourceKey = useMemo(() =>
    // STAGE 2.7.8 (C): include fileName + blob SIZE so a REPLACE (same-length
    // src, blob present both before and after) still changes the key and
    // re-runs the load effect. Previously the key used only src.length + a
    // boolean "has blob", so replacing one video with another of similar src
    // length produced an identical key and the new source never loaded.
    layers.map(l => {
      const m: any = l.media;
      const blobSig = m?.blob ? `B${m.blob.size ?? 0}` : '';
      return `${l.id}-${m?.enabled ? 1 : 0}-${m?.sourceKind ?? ''}-${m?.src?.length ?? 0}-${m?.fileName ?? ''}-${m?.fileSize ?? 0}-${blobSig}`;
    }).join('|'),
    [layers]  // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Uniform key: every media property the uniform effect below writes.
  // All of these fields are encoded in layersDataKey's mediaStr (invariant).
  const mediaUniformKey = useMemo(() =>
    layers.map(l => encodeMediaForLayersDataKey(l.media)).join('|'),
    [layers]  // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Load media textures for layers with an active media source.
  // Mirrors the mask texture load effect: async decode → cache by source
  // identity in texture.userData → version bump triggers the uniform effect.
  useEffect(() => {
    let cancelled = false;

    // Manager-aware disposal: video textures are owned by MediaVideoManager
    // (which also owns the <video> element and rVFC handle); image textures
    // are disposed directly.
    const releaseLayerMedia = (layerId: string) => {
      const existing = mediaTexturesRef.current.get(layerId);
      if (!existing) return;
      if ((existing.userData as any).managerOwned) {
        mediaVideoManagerRef.current?.dispose(layerId);
      } else {
        existing.dispose();
      }
      mediaTexturesRef.current.delete(layerId);
    };

    layers.forEach(layer => {
      const media = layer.media;

      // STAGE 2.7.4 FIX (autosave restore "Image could not be decoded"):
      // A media layer persists with enabled:true but its `src` is stripped by
      // sanitizeMediaForStorage (object URLs are dead across sessions). On
      // reload the layer therefore has enabled:true and NO usable src. We must
      // NOT attempt to decode in that state — the panel shows a "re-upload to
      // restore" notice instead. Also guard against empty/whitespace and
      // revoked-object-URL strings, which would otherwise reach the decoder and
      // throw. A blob: URL from a previous session is invalid immediately.
      // STAGE 2.7.5: a live Blob on the config is the authoritative source for
      // video — if we have it, we can always (re)mint a URL, regardless of
      // whether the persisted src string is still valid. So a present blob
      // counts as usable on its own.
      const hasLiveBlob = !!(media as any)?.blob;
      const hasUsableSrc =
        hasLiveBlob ||
        (typeof media?.src === 'string' &&
          media.src.trim().length > 0 &&
          // A blob: URL only lives for the session that created it. After reload
          // any persisted blob: reference is already revoked → decode throws.
          !(media.src.startsWith('blob:') && (media as any).__fromRestore === true));

      if (media?.enabled && hasUsableSrc) {
        // Cache identity: prefer the stable fileName+size (survives URL churn);
        // fall back to the src string. Prevents needless rebuilds when only the
        // minted URL differs.
        const cacheKey = hasLiveBlob
          ? `${media.sourceKind}:blob:${media.fileName ?? ''}:${media.fileSize ?? 0}`
          : `${media.sourceKind}:${media.src!.length}:${media.src!.slice(0, 96)}`;
        const existing = mediaTexturesRef.current.get(layer.id);
        if (existing && (existing.userData as any).mediaCacheKey === cacheKey) return;

        // Stage 2E: LIVE VIDEO — object-URL video sources get a manager-owned
        // texture gated on requestVideoFrameCallback. (Stage-1 saves stored
        // poster-frame data URLs with sourceKind 'video'; those still route
        // through the image decoder below.)
        // STAGE 2.7.5: a live blob always takes the video path; a data: URL
        // (poster) takes the image path below.
        const isDataUrl = typeof media.src === 'string' && media.src.startsWith('data:');
        if (media.sourceKind === 'video' && (hasLiveBlob || !isDataUrl)) {
          releaseLayerMedia(layer.id);
          const manager = mediaVideoManagerRef.current!;
          // STAGE 2.7.5: pass the live Blob so the manager mints its own fresh
          // object URL (the persisted blob: string may already be dead in the
          // Figma Make iframe — net::ERR_FILE_NOT_FOUND).
          const liveBlob = (media as any).blob as Blob | undefined;
          const texture = manager.ensure(layer.id, media.src ?? '', liveBlob);
          (texture.userData as any).mediaCacheKey = cacheKey;
          (texture.userData as any).managerOwned = true;
          mediaTexturesRef.current.set(layer.id, texture);
          setMediaTextureVersion(v => v + 1);
          needsRenderRef.current = true;
          // STAGE 2.7.7: persist the blob to IndexedDB so the video survives a
          // reload (localStorage can't hold it). Only when we have a live blob
          // that didn't itself come from a restore rehydration — avoids
          // re-writing the same bytes we just read back. Fire-and-forget; a
          // storage failure just falls back to "re-upload to restore".
          if (liveBlob && !(media as any).__rehydrated) {
            void persistMediaBlob(layer.id, liveBlob, {
              fileName: media.fileName,
              sourceKind: media.sourceKind,
            });
          }
          return;
        }

        // STAGE 2.8.0 — IMAGE PATH now honors the blob as an authoritative
        // source, exactly like the video path above. A rehydrated image layer
        // has NO src (stripped on save by design) and only a Blob; previously
        // this line dereferenced media.src! and the decode rejected. We mint a
        // fresh object URL from the blob in THIS document's context (the same
        // invariant the video manager follows — a persisted blob: string may
        // already be dead after a Figma Make iframe swap) and revoke it once
        // the decode settles either way.
        const imageBlob = (media as any).blob as Blob | undefined;
        const mintedUrl = !media.src && imageBlob ? URL.createObjectURL(imageBlob) : null;
        const imageSrc = media.src ?? mintedUrl;
        if (!imageSrc) { releaseLayerMedia(layer.id); return; }

        // Backstop persist for images (mirror of the video branch above):
        // covers Duplicate Layer — the copy shares the blob in memory but has
        // its own id, which needs its own persisted record to survive reload.
        if (imageBlob && !(media as any).__rehydrated) {
          void persistMediaBlob(layer.id, imageBlob, {
            fileName: media.fileName,
            sourceKind: media.sourceKind,
          });
        }

        createMediaTexture(imageSrc, media.sourceKind)
          .then(({ texture }) => {
            if (mintedUrl) URL.revokeObjectURL(mintedUrl);
            if (cancelled) {
              texture.dispose();
              return;
            }
            (texture.userData as any).mediaCacheKey = cacheKey;
            releaseLayerMedia(layer.id);
            mediaTexturesRef.current.set(layer.id, texture);
            setMediaTextureVersion(v => v + 1);
            needsRenderRef.current = true;
          })
          .catch((error) => {
            if (mintedUrl) URL.revokeObjectURL(mintedUrl);
            // A real decode failure (corrupt/unsupported file), not the
            // reload-with-stripped-src case (that no longer reaches here).
            if (import.meta.env?.DEV) console.warn(`[Media] Could not decode media for layer ${layer.id} — the source may be missing or unsupported. Re-upload to restore.`, error);
            // Ensure no half-state lingers.
            releaseLayerMedia(layer.id);
          });
      } else {
        releaseLayerMedia(layer.id);
      }
    });

    // Drop textures for deleted layers.
    const layerIds = new Set(layers.map(l => l.id));
    Array.from(mediaTexturesRef.current.keys()).forEach(id => {
      if (!layerIds.has(id)) {
        releaseLayerMedia(id);
        // STAGE 2.7.7: the layer is gone — purge its persisted blob so the
        // IndexedDB store doesn't accumulate orphans.
        void deleteMediaBlob(id as string);
      }
    });

    return () => { cancelled = true; };
  }, [mediaSourceKey]);

  // Stage 2E: video manager wiring — needs-render ping on every new decoded
  // frame (no new RAF; the master loop polls needsRenderRef), and playback
  // synced to the master Play state.
  /**
   * STAGE 2.7.9 (B) — SYNCHRONOUS media-texture rebind.
   *
   * The video manager swaps in a fresh CanvasTexture whenever its upload canvas
   * is resized (the only way to force a new GPU allocation — see the
   * offset-overflow note in mediaVideoManager). The existing rebind path went
   * through React state (setMediaTextureVersion), which lands a tick LATER.
   * That is fine for the live preview, but the export loop renders frames
   * back-to-back with no React tick in between: entering export raises the
   * resolution cap, which swaps textures, and frame 0 would otherwise be drawn
   * with the stale binding. This walks the meshes and rebinds immediately.
   * Cheap (a Map lookup per video layer) and idempotent.
   */
  const rebindManagerTextures = useCallback((): number => {
    const manager = mediaVideoManagerRef.current;
    if (!manager) return 0;
    let rebound = 0;
    try {
      manager.layerIds().forEach((id) => {
        const tex = manager.getTexture(id);
        if (!tex || !(tex.userData as any).rebindRequired) return;
        (tex.userData as any).rebindRequired = false;
        (tex.userData as any).managerOwned = true;
        mediaTexturesRef.current.set(id, tex);
        const layerIndex = layersRef.current.findIndex(l => l.id === id);
        const mesh = layerIndex >= 0 ? meshesRef.current[layerIndex] : undefined;
        const mat = mesh?.material as THREE.ShaderMaterial | undefined;
        if (mat?.uniforms?.uMediaTexture) {
          mat.uniforms.uMediaTexture.value = tex;
        }
        rebound++;
        needsRenderRef.current = true;
      });
    } catch {
      /* transient dispose/replace race — next frame recovers */
    }
    return rebound;
  }, []);

  useEffect(() => {
    const manager = mediaVideoManagerRef.current!;
    // STAGE 2.7.9 (B): tell the manager how large the video actually needs to
    // be uploaded. It reads this lazily each frame, so a window resize or a
    // canvas-size change is picked up with zero subscription plumbing. We
    // report the DRAWING BUFFER long edge (device pixels, what the shader
    // actually samples onto), falling back to the project size before the
    // renderer exists.
    manager.setDisplayLongEdgeProvider(() => {
      const el = rendererRef.current?.domElement;
      const w = el?.width || canvasSettings.width;
      const h = el?.height || canvasSettings.height;
      return Math.max(w || 0, h || 0);
    });
    manager.setOnFrame(() => {
      needsRenderRef.current = true;
      // STAGE 2.7.6/2.7.9: the manager may swap a layer's texture (on upload
      // canvas resize). rebindManagerTextures() rebinds the material uniform
      // SYNCHRONOUSLY; the version bump below then lets the media uniform
      // effect refresh the derived values (aspect etc.) on the next tick.
      // Bumping only when a swap actually happened keeps this off the hot path.
      if (rebindManagerTextures() > 0) setMediaTextureVersion(v => v + 1);
    });
    return () => {
      manager.setOnFrame(null);
      manager.setDisplayLongEdgeProvider(null);
    };
  }, [rebindManagerTextures, canvasSettings.width, canvasSettings.height]);

  useEffect(() => {
    mediaVideoManagerRef.current?.setPlaying(isPlaying);
  }, [isPlaying]);

  // Media textures are resolution-independent — no resize disposal needed.
  // Unmount-only cleanup releases GPU memory when the canvas leaves the tree.
  useEffect(() => {
    return () => {
      // Video textures are disposed by the manager; skip them in the map pass.
      mediaTexturesRef.current.forEach((texture, id) => {
        if (!(texture.userData as any).managerOwned) texture.dispose();
      });
      mediaTexturesRef.current.clear();
      mediaVideoManagerRef.current?.disposeAll();
    };
  }, []);

  // Media uniform effect: pushes texture + fit + tone uniforms into media
  // materials. Runs on texture load (version), any media property commit
  // (mediaUniformKey via layersDataKey chain), mesh rebuilds
  // (meshStructureKey — fresh meshes have a null texture slot), and canvas
  // aspect changes.
  useEffect(() => {
    if (!isInitialized || meshesRef.current.length === 0) return;

    meshesRef.current.forEach((mesh, index) => {
      const layer = layersRef.current[index];
      if (!layer || !isMediaLayerActive(layer.media)) return;
      const material = mesh.material as THREE.ShaderMaterial;
      if (!material?.uniforms?.uMediaTexture) return;

      const media = layer.media!;
      const texture = mediaTexturesRef.current.get(layer.id) ?? null;
      material.uniforms.uMediaTexture.value = texture;

      // Aspect from the decoded texture (authoritative), falling back to
      // probe metadata while the async decode is in flight.
      // STAGE 2.7.5: a <video> reports size as videoWidth/videoHeight (the
      // width/height props are display attrs, ~0 for our hidden element), so
      // read those first — otherwise video layers got a wrong/zero aspect.
      const img: any = texture?.image;
      const iw = img ? (img.videoWidth || img.width) : 0;
      const ih = img ? (img.videoHeight || img.height) : 0;
      if (iw && ih) {
        material.uniforms.uMediaAspect.value = iw / ih;
      } else if (media.naturalWidth && media.naturalHeight) {
        material.uniforms.uMediaAspect.value = media.naturalWidth / media.naturalHeight;
      }

      material.uniforms.uMediaCanvasAspect.value =
        canvasSettings.height > 0 ? canvasSettings.width / canvasSettings.height : 1;
      material.uniforms.uMediaFitMode.value = MEDIA_FIT_MODE_VALUES[media.fit] ?? 0;

      const tone = toneToShaderUnits(media);
      material.uniforms.uMediaLift.value = tone.lift;
      material.uniforms.uMediaGamma.value = tone.gamma;
      material.uniforms.uMediaGain.value = tone.gain;
      material.uniforms.uMediaInvert.value = media.invert ? 1.0 : 0.0;

      // Stage 2B: user transform (animated further by RAF uRotation/uScale/uPulse)
      if (material.uniforms.uMediaScale) {
        material.uniforms.uMediaScale.value = (media.mediaScale ?? 100) / 100;
      }
      if (material.uniforms.uMediaRotation) {
        material.uniforms.uMediaRotation.value = media.rotationDeg ?? 0;
      }
      if (material.uniforms.uMediaOffset) {
        material.uniforms.uMediaOffset.value.set((media.offsetX ?? 0) / 100, (media.offsetY ?? 0) / 100);
      }
      // Stage 2C: gradient LUT (ramp colors arrive via the standard colors sweep)
      if (material.uniforms.uMediaLutIntensity) {
        material.uniforms.uMediaLutIntensity.value = (media.lutIntensity ?? 0) / 100;
      }
      if (material.uniforms.uMediaLutPreserveLuma) {
        material.uniforms.uMediaLutPreserveLuma.value = media.lutPreserveLuma ? 1.0 : 0.0;
      }
      // STAGE 2.7 — flip + tile
      if (material.uniforms.uMediaFlipH) material.uniforms.uMediaFlipH.value = media.flipH ? 1.0 : 0.0;
      if (material.uniforms.uMediaFlipV) material.uniforms.uMediaFlipV.value = media.flipV ? 1.0 : 0.0;
      if (material.uniforms.uMediaTileRepeat) material.uniforms.uMediaTileRepeat.value = media.tileRepeat ?? 3;

      // STAGE 2.7E — push video playback options to the manager. Cheap and
      // idempotent (it only writes properties that actually differ).
      if (media.sourceKind === 'video' && !media.posterOnly) {
        mediaVideoManagerRef.current?.applyOptions(layer.id, {
          playbackRate: media.playbackRate,
          loopMode: media.loopMode,
          trimStart: media.trimStart,
          trimEnd: media.trimEnd,
          freeze: media.freeze,
          freezeTime: media.freezeTime,
          muted: media.muted,
          volume: media.volume,
          // STAGE 2.7.9 (B): magnification factor for the upload-resolution
          // cap. A layer zoomed past 100% must not be fed a display-sized
          // texture or it softens visibly. 'tile' fit MINIFIES, so it needs no
          // headroom.
          qualityScale: media.fit === 'tile'
            ? 1
            : Math.max(1, (media.mediaScale ?? 100) / 100),
        });
      }
    });

    // needsRenderRef is polled by the RAF loop every tick — sufficient for
    // paused-state re-render (same mechanism as the mask/texture uniform
    // sweep). Effect B (below invalidate's declaration) additionally calls
    // invalidate() on mediaTextureVersion bumps for async texture arrivals.
    needsRenderRef.current = true;
  }, [isInitialized, mediaUniformKey, mediaTextureVersion, meshStructureKey,
      canvasSettings.width, canvasSettings.height]);

  // Load pattern textures for shape-pattern texture type
  useEffect(() => {
    let cancelled = false;

    const loadPatternTexture = async (layer: Layer) => {
      if (cancelled || !layer.texture || layer.texture.type !== 'shape-pattern') return;

      try {
        // Static import keeps Vite/Figma Make bundling reliable for shape-pattern textures.
        // canvasSettings args removed — patternRenderer always uses 1024×1024 POT;
        // canvas dimensions are no longer baked into the texture.
        const patternCanvas = await getPatternCanvas(layer.texture);
        if (!patternCanvas || cancelled) return;

        const texture = await createPatternThreeTexture(patternCanvas);
        if (cancelled) {
          texture.dispose();
          return;
        }

        // Dispose existing texture if any
        const existing = patternTexturesRef.current.get(layer.id);
        if (existing) existing.dispose();

        patternTexturesRef.current.set(layer.id, texture);

        // ── Direct uniform write — search by layer.id, not array index ────────
        const visLayers = layersRef.current; // STAGE 2.7A
        const layerIndex = visLayers.findIndex(l => l.id === layer.id);
        if (layerIndex !== -1 && meshesRef.current[layerIndex]) {
          const mat = meshesRef.current[layerIndex].material as THREE.ShaderMaterial;
          if (mat?.uniforms?.uPatternTexture) {
            texture.needsUpdate = true;
            mat.uniforms.uPatternTexture.value = texture;
            // Force THREE.js to re-bind all uniforms for this material.
            // Without this, the texture upload to GPU may be deferred
            // and the sampler sees the old null binding on the first render.
            mat.needsUpdate = true;
          }
          if (mat?.uniforms?.uPatternAR) {
            mat.uniforms.uPatternAR.value = canvasSettings.width / canvasSettings.height;
          }
        }

        // Also bump the version so the uniform update effect re-syncs on the
        // next React render (keeps the uniform in sync if meshes rebuild later).
        setPatternTextureVersion(prev => prev + 1);
        needsRenderRef.current = true;
        invalidate();
      } catch (error) {
        if (import.meta.env?.DEV) console.error(`Failed to load pattern texture for layer ${layer.id}:`, error);
      }
    };

    // Load pattern textures for all layers with shape-pattern type
    layers.forEach(layer => {
      if (layer.visible && layer.texture?.type === 'shape-pattern') {
        loadPatternTexture(layer);
      } else {
        // Clean up pattern texture if layer no longer uses shape-pattern
        const existing = patternTexturesRef.current.get(layer.id);
        if (existing) {
          existing.dispose();
          patternTexturesRef.current.delete(layer.id);
        }
      }
    });

    // Clean up orphaned pattern textures
    const layerIds = new Set(layers.map(l => l.id));
    Array.from(patternTexturesRef.current.keys()).forEach(id => {
      const layerStillExists = layerIds.has(id);
      // Also dispose if layer's texture type changed AWAY from shape-pattern
      const layer = layers.find(l => l.id === id);
      const stillShapePattern = layer?.texture?.type === 'shape-pattern';
      if (!layerStillExists || !stillShapePattern) {
        const texture = patternTexturesRef.current.get(id);
        if (texture) texture.dispose();
        patternTexturesRef.current.delete(id);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [patternPropertiesKey]);

  // Displacement canvas removed — Warp Mode is disabled for beta (UI hidden).
  // DisplacementConfig type and uDisplacementMap uniforms are preserved for future use.

  // Clean up base geometry cache when canvas size changes
  useEffect(() => {
    // Clear cache to avoid memory leaks when canvas size changes
    disposeGeometryMap(baseGeometryCacheRef.current);
  }, [canvasSettings.width, canvasSettings.height]);

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;


    const container = containerRef.current;
    
    const width = canvasSettings.width;
    const height = canvasSettings.height;

    // Clean up old renderer if it exists
    if (rendererRef.current) {
      const oldRenderer = rendererRef.current;
      if (container.contains(oldRenderer.domElement)) {
        container.removeChild(oldRenderer.domElement);
      }
      // Unregister from global export reference
      if ((window as any).__blendcraftLiveCanvas === oldRenderer.domElement) {
        (window as any).__blendcraftLiveCanvas = null;
      }
      oldRenderer.dispose();
    }

    // Clean up old render target
    disposeRenderTargetRef(renderTargetRef);
    disposeRenderTargetRef(captureRTRef);

    // Create scene for gradient rendering
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(canvasSettings.backgroundColor);
    sceneRef.current = scene;

    // Create orthographic camera
    const camera = new THREE.OrthographicCamera(
      -width / 2,
      width / 2,
      height / 2,
      -height / 2,
      0.1,
      1000
    );
    camera.position.z = 10;
    cameraRef.current = camera;

    // Create renderer â€” tuned for smooth 60fps animation on the live preview.
    //
    // preserveDrawingBuffer: TRUE â€” the live preview never calls toBlob/toDataURL.
    //   Export uses createExportRenderer() with its own isolated canvas+context.
    //   With preserveDrawingBuffer:true the GPU driver copies the full framebuffer
    //   to a CPU-readable surface every frame â€” a 15-30% GPU tax even at idle.
    //
    // antialias: FALSE â€” gradients are full-screen mathematical quads with no
    //   polygon edges. Hardware MSAA antialiases pixels that don't need it and
    //   costs 2-4x fill rate on integrated/mobile GPUs with zero visual benefit.
    //   The post-process pass handles any edge softening needed via the shader.
    const renderer = new THREE.WebGLRenderer({
      antialias: false,            // No polygon edges in gradient quads â€” MSAA wasted
      preserveDrawingBuffer: true, // MediaRecorder fallback ONLY -- primary WebCodecs path uses captureRTRef/readFramePixels instead.
                                   //   Known cost: ~15-30% GPU overhead at idle. Safe to set false if fallback is removed.
      alpha: true,
      premultipliedAlpha: false,   // Straight alpha for clean mask edges
      precision: 'highp',
      powerPreference: 'high-performance',
      stencil: false,              // Not used â€” saves a buffer allocation
      depth: false,                // 2D quads â€” no depth test needed
    });
    // IMPORTANT: pixel ratio must be applied before setSize so the backing buffer
    // and post-FX chain match the real drawing buffer dimensions.
    applyRendererSize(renderer, width, height); // false = don't update canvas style
    // Disable auto-clear â€” we manage targets explicitly per render pass.
    // Prevents a redundant clear call before each renderer.render().
    renderer.autoClear = false;
    
    // Enable alpha channel and proper clearing for masked layers
    renderer.setClearColor(0x000000, 0); // Clear to transparent (alpha = 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.margin = '0';
    renderer.domElement.style.width = '100%';
    // Register as the live export canvas so exportUtils can find it
    // without needing a prop callback. This is the same technique used
    // by grainrad.com and tooooools.app to locate the render target.
    renderer.domElement.setAttribute('data-blendcraft-live', 'true');
    (window as any).__blendcraftLiveCanvas = renderer.domElement;
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.imageRendering = 'auto';
    renderer.domElement.style.position = 'relative';
    renderer.domElement.style.borderRadius = '0.5rem';
    
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Offscreen render target for the post-process pass.
    //
    // UnsignedByteType (8-bit RGBA): sufficient for gradient display at 2x
    // lower memory bandwidth than HalfFloatType (16-bit). Gradient colours
    // sit well within 0-1 range â€” no HDR precision needed here.
    //
    // samples: omitted (0) â€” MSAA on an FBO rendering fullscreen quads is
    // pure overhead. The GPU would process each pixel 4x for a smooth
    // mathematical gradient with no subpixel polygon edges.
    const drawingBufferSize = getDrawingBufferSize(renderer);
    const renderTarget = new THREE.WebGLRenderTarget(drawingBufferSize.x, drawingBufferSize.y, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,  // 8-bit RGBA â€” half the bandwidth of HalfFloat
      colorSpace: THREE.SRGBColorSpace,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      // samples intentionally absent â€” no MSAA on gradient quads
    });
    renderTargetRef.current = renderTarget;

    // Linear working-space target used for diagnostics and compatibility
    // fallbacks. Production image/video capture uses the final sRGB
    // presentation canvas after Three.js applies the output transfer.
    captureRTRef.current = new THREE.WebGLRenderTarget(
      drawingBufferSize.x, drawingBufferSize.y, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        colorSpace: THREE.SRGBColorSpace,
        depthBuffer: false,
        stencilBuffer: false,
      }
    );

    // Create post-processing scene (full-screen quad)
    const postProcessScene = new THREE.Scene();
    postProcessSceneRef.current = postProcessScene;

    // Create camera for post-process pass (simple orthographic covering -1 to 1)
    const postProcessCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    postProcessCameraRef.current = postProcessCamera;

    // Create full-screen quad geometry
    const quadGeometry = new THREE.PlaneGeometry(2, 2);
    
    // Create effects material
    const effectsMaterial = createEffectsMaterial(effects);
    effectsMaterial.uniforms.tDiffuse.value = renderTarget.texture;
    effectsMaterial.uniforms.resolution.value.set(drawingBufferSize.x, drawingBufferSize.y);
    effectsMaterialRef.current = effectsMaterial;

    // Create mesh for post-processing
    const postProcessQuad = new THREE.Mesh(quadGeometry, effectsMaterial);
    postProcessScene.add(postProcessQuad);
    postProcessQuadRef.current = postProcessQuad;

    // Store camera for post-processing
    cameraRef.current = camera;

    setIsInitialized(true);

    return () => {
      setIsInitialized(false);

      // Cancel any pending animation frames
      cancelFrame(animationFrameRef);

      // MEMORY LEAK FIX: Dispose all meshes and their materials/geometries
      meshesRef.current.forEach(mesh => {
        if (scene.children.includes(mesh)) {
          scene.remove(mesh);
        }
        disposeMesh(mesh);
      });
      meshesRef.current = [];

      // MEMORY LEAK FIX: Dispose all mask textures
      disposeTextureMap(maskTexturesRef.current);

      // Dispose render targets and materials
      disposeRenderTargetRef(renderTargetRef);
      disposeRenderTargetRef(captureRTRef);
      if (effectsMaterialRef.current) {
        effectsMaterialRef.current.dispose();
        effectsMaterialRef.current = null;
      }

      // Dispose post-process scene objects
      if (postProcessQuadRef.current) {
        if (postProcessScene.children.includes(postProcessQuadRef.current)) {
          postProcessScene.remove(postProcessQuadRef.current);
        }
        postProcessQuadRef.current = null;
      }

      // POLISH: Clear texture transport refs to prevent memory leaks
      textureTransportRef.current.clear();

      // POLISH: Clear base geometry cache to prevent memory leaks
      disposeGeometryMap(baseGeometryCacheRef.current);

      // Dispose geometries
      quadGeometry.dispose();

      // Dispose renderer and remove canvas
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [canvasSettings.backgroundColor, canvasSettings.width, canvasSettings.height]);

  // Update layers - recreate meshes when structure changes
  useEffect(() => {
    if (!isInitialized || !sceneRef.current || !containerRef.current) return;

    const scene = sceneRef.current;
    const width = canvasSettings.width;
    const height = canvasSettings.height;


    // Clear existing meshes
    meshesRef.current.forEach(mesh => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => m.dispose());
      } else {
        mesh.material.dispose();
      }
    });
    meshesRef.current = [];
    // Invalidate the per-frame visible-layer cache so the next animate() tick rebuilds it
    cachedVisibleLayersRef.current = [];
    // STAGE 2.7.3: force a repaint after ANY structural change. Without this the
    // canvas can keep displaying a stale frame (e.g. a deleted media layer still
    // visibly on screen) until some unrelated interaction happens to request a
    // render. needsRenderRef is polled by the master RAF loop — no new loop.
    needsRenderRef.current = true;

    // Create meshes for each visible layer
    // STAGE 2.7A: a mesh is created for EVERY layer (visible or not) so that
    // hiding/showing never rebuilds geometry or resets uniforms. Mesh index
    // therefore maps 1:1 to the real `layers` array index — which also removes
    // the entire class of index-drift bugs that came from pairing meshes
    // against a filtered array.
    layers.forEach((layer, index) => {
      let mesh = renderGradientLayer(
        layer,
        width,
        height,
        { mouseX: 0, mouseY: 0, intensity: 1 }
      );

      // STAGE 2.7A — INDEX INTEGRITY: renderGradientLayer returns null for a
      // layer with no gradient / texture / media source. Skipping it would
      // shift every subsequent mesh index and silently break the 1:1
      // mesh↔layer mapping this whole rewrite depends on. Insert an inert,
      // invisible placeholder instead so index alignment is guaranteed by
      // construction. It carries no `uniforms`, and every uniform consumer
      // already guards on `if (!material.uniforms) return`.
      if (!mesh) {
        const placeholder = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ visible: false, transparent: true, opacity: 0 })
        );
        (placeholder.userData as any).isPlaceholder = true;
        mesh = placeholder;
      }

      if (mesh) {
        mesh.position.z = index * 0.01;
        // STAGE 2.7A: visibility is a cheap per-mesh flag, NOT a rebuild trigger.
        mesh.visible = layer.visible && !(mesh.userData as any).isPlaceholder;
        // Tag mesh with gradient type so the material-swap effect can detect changes
        (mesh.userData as any).gradientType = layer.gradient?.type;
        scene.add(mesh);
        meshesRef.current.push(mesh);

        // STAGE 2.6 FIX (media disappearing after hide→show): previously the
        // freshly-created media material's uMediaTexture stayed null until a
        // SEPARATE effect (gated on meshStructureKey among other keys) ran in
        // a later pass to reattach it. Two effects coordinating the same
        // piece of state across an async gap is exactly the kind of seam
        // that drops a frame's worth of state under reordering/visibility
        // churn. Fixed by attaching the (already-decoded, still-cached —
        // mesh disposal never touches mediaTexturesRef) texture and its
        // core uniforms SYNCHRONOUSLY, in the same pass the mesh is built.
        // The separate media uniform effect still owns LIVE property edits
        // (slider drags) — this is purely the "mesh was just (re)built"
        // path, so there is no double-write risk.
        if (isMediaLayerActive(layer.media)) {
          const mat = mesh.material as THREE.ShaderMaterial;
          const media = layer.media!;
          const texture = mediaTexturesRef.current.get(layer.id) ?? null;
          if (mat?.uniforms?.uMediaTexture) {
            mat.uniforms.uMediaTexture.value = texture;
            const img: any = texture?.image;
            if (img?.width && img?.height) {
              mat.uniforms.uMediaAspect.value = img.width / img.height;
            } else if (media.naturalWidth && media.naturalHeight) {
              mat.uniforms.uMediaAspect.value = media.naturalWidth / media.naturalHeight;
            }
            mat.uniforms.uMediaCanvasAspect.value = height > 0 ? width / height : 1;
            mat.uniforms.uMediaFitMode.value = MEDIA_FIT_MODE_VALUES[media.fit] ?? 0;
            const tone = toneToShaderUnits(media);
            mat.uniforms.uMediaLift.value = tone.lift;
            mat.uniforms.uMediaGamma.value = tone.gamma;
            mat.uniforms.uMediaGain.value = tone.gain;
            mat.uniforms.uMediaInvert.value = media.invert ? 1.0 : 0.0;
            if (mat.uniforms.uMediaScale) mat.uniforms.uMediaScale.value = (media.mediaScale ?? 100) / 100;
            if (mat.uniforms.uMediaRotation) mat.uniforms.uMediaRotation.value = media.rotationDeg ?? 0;
            if (mat.uniforms.uMediaOffset) mat.uniforms.uMediaOffset.value.set((media.offsetX ?? 0) / 100, (media.offsetY ?? 0) / 100);
            if (mat.uniforms.uMediaLutIntensity) mat.uniforms.uMediaLutIntensity.value = (media.lutIntensity ?? 0) / 100;
            if (mat.uniforms.uMediaLutPreserveLuma) mat.uniforms.uMediaLutPreserveLuma.value = media.lutPreserveLuma ? 1.0 : 0.0;
          }
        }

        // Re-seed textureTime uniform from the preserved transport entry so
        // the rebuilt mesh shows the correct paused texture position immediately
        // rather than snapping to 0 on the first rendered frame.
        const transport = textureTransportRef.current.get(layer.id);
        const mat = mesh.material as THREE.ShaderMaterial;
        if (transport && mat?.uniforms?.textureTime) {
          mat.uniforms.textureTime.value = transport.accumulated;
        }
      }
    });

    // FIX: After meshes are recreated (e.g. texture toggled off/on), the new meshes
    // have blank uniforms â€” no mask is applied. Bump maskTextureVersion to trigger the
    // mask uniform useEffect to re-apply all mask settings to the fresh meshes.
    // Without this, toggling texture off clears the mask shape from the canvas.
    setMaskTextureVersion(prev => prev + 1);

    // FIX (black canvas on texture toggle): New meshes with new texture shaders require
    // GPU recompilation. On the first frame after rebuild the compiled program may not
    // be ready yet, causing a single black frame. Forcing two consecutive render ticks
    // gives the GPU one warmup frame then a second frame with the compiled shader.
    needsRenderRef.current = true;

    // SHADER PRE-WARM: compile all materials now in the scene so the GPU driver
    // finishes GLSL compilation before the first user-visible render frame.
    // Without this, Three.js compiles on the first renderer.render() call —
    // a ~100-300ms synchronous stall that shows as a black flash on type switches.
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.compile(sceneRef.current, cameraRef.current);
    }
  }, [
    isInitialized, 
    canvasSettings.width, 
    canvasSettings.height, 
    meshStructureKey,
  ]);

  // Material-swap effect: runs when gradient type changes without a geometry rebuild.
  // PATCHED: Previously, gradient.type was in meshStructureKey which forced a full
  // PlaneGeometry disposal + recreation on every type change (~300-600ms stall).
  // Now we just replace the Three.js material on the existing mesh (~10-30ms).
  useEffect(() => {
    if (!isInitialized || meshesRef.current.length === 0) return;
    const scene = sceneRef.current;
    if (!scene) return;

    const visibleLayers = layers; // STAGE 2.7A: meshes exist for all layers

    meshesRef.current.forEach((mesh, index) => {
      const layer = visibleLayers[index];
      if (!layer) return;

      // MEDIA GUARD (Stage 1): while a media source is active, the layer's
      // material is a media material — gradient type changes don't apply to
      // the render. Swapping here would install a FRESH media material with
      // a null texture slot that no effect re-populates (mediaUniformKey /
      // mediaTextureVersion / meshStructureKey all unchanged) → blank layer.
      // Record the pending type so the skip check stays consistent; when
      // media is disabled, meshStructureKey changes → full rebuild applies
      // the correct gradient type.
      if (isMediaLayerActive(layer.media)) {
        (mesh.userData as any).gradientType = layer.gradient?.type;
        return;
      }

      const currentType = (mesh.userData as any).gradientType;
      if (currentType === layer.gradient?.type) return; // Already correct â€” skip

      // Create a new material for the new gradient type (reuse geometry)
      const tempMesh = renderGradientLayer(
        layer,
        canvasSettings.width,
        canvasSettings.height,
        { mouseX: 0, mouseY: 0, intensity: 1 }
      );
      if (!tempMesh) return;

      // Swap the material on the existing mesh â€” geometry stays (saves ~200-400ms)
      const oldMaterial = mesh.material as THREE.ShaderMaterial;
      mesh.material = tempMesh.material;
      (mesh.userData as any).gradientType = layer.gradient?.type;

      // Dispose old material to free its GPU shader program
      oldMaterial.dispose();

      // Dispose only the temp mesh's geometry (we only needed its material)
      tempMesh.geometry.dispose();

      // After swap, immediately populate the new material's uniforms with the layer's
      // current gradient data. Without this, the new shader renders black until the
      // gradient-properties useEffect fires (which only triggers on key changes, not
      // on material changes — so it won't re-fire just because the material swapped).
      const newMat = mesh.material as THREE.ShaderMaterial;
      if (newMat.uniforms && layer.gradient) {
        const g = layer.gradient;
        // Colors
        if (newMat.uniforms.colors && g.colors) {
          // Sort before writing — same reason as in the live update block:
          // getGradientColor() assumes positions[] is sorted ascending.
          const _swapSorted = sortColorStops(g.colors);
          _swapSorted.forEach((stop, i) => {
            const c = hexToShaderRgb(stop.color);
            if (newMat.uniforms.colors.value[i] instanceof THREE.Vector3) {
              newMat.uniforms.colors.value[i].set(c.r, c.g, c.b);
            } else {
              newMat.uniforms.colors.value[i] = new THREE.Vector3(c.r, c.g, c.b);
            }
            if (newMat.uniforms.positions?.value[i] !== undefined)
              newMat.uniforms.positions.value[i] = stop.position;
          });
          // Clear trailing slots
          for (let i = _swapSorted.length; i < 10; i++) {
            if (newMat.uniforms.colors.value[i] instanceof THREE.Vector3)
              (newMat.uniforms.colors.value[i] as THREE.Vector3).set(0, 0, 0);
            if (newMat.uniforms.positions?.value[i] !== undefined)
              newMat.uniforms.positions.value[i] = 1.0;
          }
          if (newMat.uniforms.colorCount) newMat.uniforms.colorCount.value = _swapSorted.length;
        }
        // Core transform
        if (newMat.uniforms.intensity) newMat.uniforms.intensity.value = g.intensity ?? 1;
        if (newMat.uniforms.angle)     newMat.uniforms.angle.value     = g.angle      ?? 0;
        if (newMat.uniforms.uRotation) newMat.uniforms.uRotation.value = g.angle      ?? 0;
        if (newMat.uniforms.scale)     newMat.uniforms.scale.value     = (g.scale ?? 1) * (g.scaleBoost ?? 1);
        if (newMat.uniforms.uScale)    newMat.uniforms.uScale.value    = g.scale      ?? 1;
        if (newMat.uniforms.uPulse)    newMat.uniforms.uPulse.value    = 1.0;
        // Kaleidoscope / structural properties
        if (newMat.uniforms.segments)  newMat.uniforms.segments.value  = g.segments   ?? 6;
        if (newMat.uniforms.frequency) newMat.uniforms.frequency.value = g.type === 'wave' ? (g.stripeCount || g.frequency || 5) : (g.frequency ?? 2);
        if (newMat.uniforms.octaves)   newMat.uniforms.octaves.value   = g.octaves    ?? 4;
        // complexity: only map from twist for types that use it as "corner spread" or "decay"
        // plasma/marble/concentric/mandala use complexity as octave-like structural param — 
        // do NOT overwrite with twist at type-switch time.
        if (newMat.uniforms.complexity) {
          const complexityFromTwistTypes = ['four-corners', 'radial-waves'];
          newMat.uniforms.complexity.value = complexityFromTwistTypes.includes(g.type ?? '')
            ? (g.twist ?? 0.3)
            : (newMat.uniforms.complexity.value); // keep value set by renderer additionalUniforms
        }
        if (newMat.uniforms.center)    newMat.uniforms.center.value?.set(g.centerX ?? 0.5, g.centerY ?? 0.5);
        if (newMat.uniforms.centerX)   newMat.uniforms.centerX.value   = g.centerX    ?? 0.5;
        if (newMat.uniforms.centerY)   newMat.uniforms.centerY.value   = g.centerY    ?? 0.5;
      }

      // PATCH M2A.1: gradient type changes swap the shader material. Re-apply
      // the active texture uniforms immediately so Shape Pattern scale/density
      // remains layer-controlled and does not appear to jump/reset when users
      // switch gradient types.
      const t = layer.texture;
      if (newMat.uniforms && t) {
        if (newMat.uniforms.hasTexture)        newMat.uniforms.hasTexture.value        = 1.0;
        if (newMat.uniforms.textureType)       newMat.uniforms.textureType.value       = encodeTextureType(t.type);
        if (newMat.uniforms.textureOpacity)    newMat.uniforms.textureOpacity.value    = t.opacity ?? 1.0;
        if (newMat.uniforms.textureScale)      newMat.uniforms.textureScale.value      = t.scale ?? 1.0;
        if (newMat.uniforms.textureIntensity)  newMat.uniforms.textureIntensity.value  = t.intensity ?? 0.0;
        if (newMat.uniforms.textureAngle)      newMat.uniforms.textureAngle.value      = t.angle ?? 90;
        if (newMat.uniforms.animateTexture)    newMat.uniforms.animateTexture.value    = t.animateTexture ? 1.0 : 0.0;
        if (newMat.uniforms.animationSpeed)    newMat.uniforms.animationSpeed.value    = t.animationSpeed ?? 1.0;
        if (newMat.uniforms.uPatternTexture)   newMat.uniforms.uPatternTexture.value   = t.type === 'shape-pattern' ? (patternTexturesRef.current.get(layer.id) || null) : null;
        if (newMat.uniforms.uPatternAR)        newMat.uniforms.uPatternAR.value        = canvasSettings.width / canvasSettings.height;
        if (newMat.uniforms.uPatternOffset)    newMat.uniforms.uPatternOffset.value.set((t.patternOffsetX ?? 0) / 100, (t.patternOffsetY ?? 0) / 100);
        if (newMat.uniforms.uPatternDensity)   newMat.uniforms.uPatternDensity.value   = t.patternDensity ?? 50;
        if (newMat.uniforms.uPatternRandomRotation) newMat.uniforms.uPatternRandomRotation.value = t.patternRandomRotation ?? 0;
        if (newMat.uniforms.uPatternAlternateFlip)  newMat.uniforms.uPatternAlternateFlip.value  = encodePatternFlipMode(t.patternAlternateFlip);
        if (newMat.uniforms.uPatternStaggerRows)    newMat.uniforms.uPatternStaggerRows.value    = t.patternStaggerRows ?? 0;
        if (newMat.uniforms.uPatternScaleVariance)  newMat.uniforms.uPatternScaleVariance.value  = t.patternScaleVariance ?? 0;
        if (newMat.uniforms.uPatternOpacityCurve)   newMat.uniforms.uPatternOpacityCurve.value   = t.patternOpacityCurve ?? 0;
        if (newMat.uniforms.uPatternOpacityCurveMode) newMat.uniforms.uPatternOpacityCurveMode.value = encodePatternOpacityCurveMode(t.patternOpacityCurveMode);
      }
      // Re-seed textureTime from preserved transport so paused texture position is kept
      const transport = textureTransportRef.current.get(layer.id);
      const mat = mesh.material as THREE.ShaderMaterial;
      if (transport && mat?.uniforms?.textureTime) {
        mat.uniforms.textureTime.value = transport.accumulated;
      }
    });

    // Re-apply mask textures to the new materials
    setMaskTextureVersion(prev => prev + 1);
    // SHADER PRE-WARM: compile the scene immediately after swapping the material.
    // Forces the GPU driver to finish GLSL compilation synchronously before the
    // first needsRender tick — eliminates the black-flash on gradient type switches.
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.compile(sceneRef.current, cameraRef.current);
    }
    needsRenderRef.current = true;
    markRenderNeededNextFrame(needsRenderRef);
  }, [meshMaterialKey, isInitialized, canvasSettings.width, canvasSettings.height]);

  // Handle mesh resolution changes separately (without full recreation)
  useEffect(() => {
    if (!isInitialized || !sceneRef.current) return;

    const visibleLayers = layers; // STAGE 2.7A: meshes exist for all layers
    meshesRef.current.forEach((mesh, index) => {
      const layer = visibleLayers[index];
      if (!layer?.displacement) return;

      const currentGeometry = mesh.geometry as THREE.PlaneGeometry;
      const currentSegments = currentGeometry.parameters?.widthSegments || 1;
      const targetResolution = layer.displacement.meshResolution || 64;

      // Only recreate geometry if resolution actually changed
      if (currentSegments !== targetResolution && layer.displacement) {
        const newGeometry = new THREE.PlaneGeometry(
          canvasSettings.width,
          canvasSettings.height,
          targetResolution,
          targetResolution
        );
        
        mesh.geometry.dispose();
        mesh.geometry = newGeometry;
        
        // Force THREE.js to recognize the geometry change
        newGeometry.attributes.position.needsUpdate = true;
        if (newGeometry.attributes.uv) {
          newGeometry.attributes.uv.needsUpdate = true;
        }
        
        // NOTE: Vertex offsets are already cleared by the mesh quality buttons (L/H)
        // No need to clear them here - that would cause unnecessary re-renders
        
        needsRenderRef.current = true;
      }
    });
  }, [meshStructureKey, isInitialized, canvasSettings.width, canvasSettings.height]);

  // Update layer uniforms when properties change.
  // PERF: Skip during active playback â€” the RAF loop handles all uniform updates
  // every frame while playing. Running this heavy loop on top of the RAF loop
  // causes double-writes per frame and stutter during animation playback.
  useEffect(() => {
    if (!isInitialized || meshesRef.current.length === 0) return;
    // When playing, the RAF loop handles gradient/color/texture per-frame updates.
    // But mask uniforms are NEVER written by the RAF loop, so they must always run
    // regardless of play state (fixes: texture-toggle-while-playing drops mask shape,
    // blur/tile/edge not applying while animation is active).
    const isCurrentlyPlaying = isPlayingRef.current;

    meshesRef.current.forEach((mesh, index) => {
        const layer = layersRef.current[index]; // STAGE 2.7A
        if (!layer) return;

        const material = mesh.material as any;
        if (!material.uniforms) return;

        const gradient = layer.gradient;

        // â”€â”€ TEXTURE PROPERTY UNIFORMS â”€â”€ written outside isCurrentlyPlaying guard â”€â”€
        // Static values (scale, intensity, type, sliders) are never touched by the RAF
        // loop. Writing them here regardless of play state ensures slider changes apply
        // in real-time while animation is playing, enabling live fine-tuning for export.
        if (gradient && layer.texture) {
          const texture = layer.texture;
          if (material.uniforms.hasTexture) {
            material.uniforms.hasTexture.value = (texture.opacity > 0 && texture.intensity > 0) ? 1.0 : 0.0;
          }
          // LOD: shader quality hint based on canvas resolution.
          // 0 = full quality (1080p+), 1 = medium (720p), 2 = low (540p and below).
          // Shaders that have expensive paths (Frosted Glass, Topography) can check
          // this uniform to skip the most costly samples at low resolutions.
          if (material.uniforms.uTextureLOD) {
            const px = canvasSettings.width * canvasSettings.height;
            material.uniforms.uTextureLOD.value =
              px >= 1920 * 1080 ? 0.0 : px >= 1280 * 720 ? 1.0 : 2.0;
          }
          if (material.uniforms.textureType) {
            const texTypeMap: Record<string, number> = {
              'grain': 0.0, 'noise': 1.0, 'dots': 2.0, 'lines': 3.0, 'organic': 4.0,
              'camoShadows': 5.0, 'linearGlass': 6.0, 'frostedGlass': 7.0, 'blockGlass': 8.0,
              'fractalGlass': 9.0, 'heatMelt': 10.0, 'waveSignal': 11.0, 'topography': 12.0,
              'plasma': 13.0, 'shape-pattern': 14.0, 'spackle': 15.0, 'grunge': 16.0,
            };
            material.uniforms.textureType.value = texTypeMap[texture.type] || 0.0;
          }
          if (material.uniforms.textureOpacity)   material.uniforms.textureOpacity.value   = texture.opacity;
          if (material.uniforms.textureScale)     material.uniforms.textureScale.value     = texture.scale;
          if (material.uniforms.textureIntensity) material.uniforms.textureIntensity.value = texture.intensity;
          if (material.uniforms.animateTexture)   material.uniforms.animateTexture.value   = texture.animateTexture ? 1.0 : 0.0;
          if (material.uniforms.animationSpeed)   material.uniforms.animationSpeed.value   = texture.animationSpeed || 1.0;
          if (material.uniforms.blur) {
            material.uniforms.blur.value = (texture.type === 'plasma' && texture.turbulence !== undefined)
              ? texture.turbulence / 100 : (texture.blur ?? 0.5);
          }
          if (material.uniforms.distortion)    material.uniforms.distortion.value    = texture.distortion ?? 0.5;
          if (material.uniforms.textureAngle)  material.uniforms.textureAngle.value  = texture.angle ?? 90;
          if (material.uniforms.gridSize)      material.uniforms.gridSize.value      = texture.type === 'plasma' ? (texture.waveCount ?? 5) : (texture.gridSize ?? 10);
          if (material.uniforms.complexity)    material.uniforms.complexity.value    = texture.type === 'frostedGlass' ? (texture.gridSize ?? 10) : (texture.complexity ?? 4);
          if (material.uniforms.chromaticShift) material.uniforms.chromaticShift.value = texture.type === 'plasma' ? (texture.colorIntensity ?? 70) : (texture.chromaticShift ?? 5);
          if (material.uniforms.blendMode) {
            const bmMap: Record<string, number> = {
              'normal': 0, 'multiply': 1, 'screen': 2, 'overlay': 3, 'soft-light': 4,
              'hard-light': 5, 'difference': 6, 'exclusion': 7, 'lighten': 8, 'darken': 9,
              'color-burn': 10, 'color-dodge': 11,
            };
            material.uniforms.blendMode.value = bmMap[texture.blendMode] ?? 0.0;
          }
          if (material.uniforms.textureAnimationType) {
            const atMap: Record<string, number> = {
              'spin': 0, 'warp': 1, 'ping-pong': 2, 'scale': 3, 'drift': 4,
              'tectonic': 5, 'breathe': 6, 'seismic': 7, 'shear': 8, 'vortex': 9,
            };
            const newAnimType = atMap[texture.textureAnimationType || 'drift'] ?? 4.0;
            if (material.uniforms.textureAnimationType.value !== newAnimType) {
              material.uniforms.textureAnimationType.value = newAnimType;
              material.needsUpdate = true;
            }
          }
          if (!material.uniforms.ridgeCount)         material.uniforms.ridgeCount         = { value: 25.0 };
          if (!material.uniforms.ridgeIrregularity)  material.uniforms.ridgeIrregularity  = { value: 0.0 };
          if (!material.uniforms.blockIrregularity)  material.uniforms.blockIrregularity  = { value: 0.0 };
          if (!material.uniforms.turbulence)         material.uniforms.turbulence         = { value: 50.0 };
          if (!material.uniforms.waveCount)          material.uniforms.waveCount          = { value: 5.0 };
          if (!material.uniforms.colorIntensity)     material.uniforms.colorIntensity     = { value: 50.0 };
          if (!material.uniforms.elevationShift)     material.uniforms.elevationShift     = { value: 0.0 };
          if (!material.uniforms.lineThickness)      material.uniforms.lineThickness      = { value: 50.0 };
          material.uniforms.ridgeCount.value         = texture.ridgeCount        ?? 25.0;
          material.uniforms.ridgeIrregularity.value  = texture.ridgeIrregularity ?? 0.0;
          material.uniforms.blockIrregularity.value  = texture.blockIrregularity ?? 0.0;
          material.uniforms.turbulence.value         = texture.turbulence        ?? 20;
          material.uniforms.waveCount.value          = texture.waveCount         ?? 5;
          material.uniforms.colorIntensity.value     = texture.colorIntensity    ?? 15;
          material.uniforms.elevationShift.value     = texture.elevationShift    ?? 0;
          material.uniforms.lineThickness.value      = texture.lineThickness     ?? 50;
          if (!material.uniforms.uInvertTexture) material.uniforms.uInvertTexture = { value: 0.0 };
          material.uniforms.uInvertTexture.value = texture.invertTexture ? 1.0 : 0.0;
          if (!material.uniforms.uPatternTexture) material.uniforms.uPatternTexture = { value: null };
          material.uniforms.uPatternTexture.value = texture.type === 'shape-pattern'
            ? (patternTexturesRef.current.get(layer.id) || null)
            : null;
          // AR correction: pattern baked on 1024×1024 square canvas; scale UV.x
          // by the canvas AR so shapes aren't distorted on 16:9 canvases.
          if (!material.uniforms.uPatternAR) material.uniforms.uPatternAR = { value: 1.0 };
          material.uniforms.uPatternAR.value = canvasSettings.width / canvasSettings.height;
          // Pattern offset — drives Offset X/Y sliders. Normalized to [-0.5, 0.5].
          // Must be set here (alongside uPatternAR) so slider changes reach the GPU.
          // The uniform is declared in SHARED_FUNCTIONS and applied inside tiledUV
          // (not inside fract) so RepeatWrapping handles the wrap seamlessly.
          if (!material.uniforms.uPatternOffset) {
            material.uniforms.uPatternOffset = { value: new THREE.Vector2(0, 0) };
          }
          material.uniforms.uPatternOffset.value.set(
            (texture.patternOffsetX ?? 0) / 100,
            (texture.patternOffsetY ?? 0) / 100
          );
          if (!material.uniforms.uPatternDensity) material.uniforms.uPatternDensity = { value: 50.0 };
          if (!material.uniforms.uPatternRandomRotation) material.uniforms.uPatternRandomRotation = { value: 0.0 };
          if (!material.uniforms.uPatternAlternateFlip) material.uniforms.uPatternAlternateFlip = { value: 0.0 };
          if (!material.uniforms.uPatternStaggerRows) material.uniforms.uPatternStaggerRows = { value: 0.0 };
          if (!material.uniforms.uPatternScaleVariance) material.uniforms.uPatternScaleVariance = { value: 0.0 };
          if (!material.uniforms.uPatternOpacityCurve) material.uniforms.uPatternOpacityCurve = { value: 0.0 };
          if (!material.uniforms.uPatternOpacityCurveMode) material.uniforms.uPatternOpacityCurveMode = { value: 0.0 };
          material.uniforms.uPatternDensity.value = texture.patternDensity ?? 50;
          material.uniforms.uPatternRandomRotation.value = texture.patternRandomRotation ?? 0;
          material.uniforms.uPatternAlternateFlip.value = encodePatternFlipMode(texture.patternAlternateFlip);
          material.uniforms.uPatternStaggerRows.value = texture.patternStaggerRows ?? 0;
          material.uniforms.uPatternScaleVariance.value = texture.patternScaleVariance ?? 0;
          material.uniforms.uPatternOpacityCurve.value = texture.patternOpacityCurve ?? 0;
          material.uniforms.uPatternOpacityCurveMode.value = encodePatternOpacityCurveMode(texture.patternOpacityCurveMode);
        } else if (!layer.texture && material.uniforms.hasTexture) {
          // STAGE 2.7C — HARD TEXTURE TEARDOWN. Previously this only zeroed
          // `hasTexture`, leaving uPatternTexture still BOUND and the pattern
          // still cached. Any later code path that set hasTexture back to 1
          // (e.g. a rebuild, or the texture-animation sweep) resurrected the
          // old pattern — which is exactly the "can't remove the shape pattern,
          // Reset doesn't clear it, picking another texture doesn't replace it"
          // bug. Now the binding itself is severed, so there is nothing left to
          // resurrect.
          material.uniforms.hasTexture.value = 0.0;
          if (material.uniforms.textureType)      material.uniforms.textureType.value = 0.0;
          if (material.uniforms.textureIntensity) material.uniforms.textureIntensity.value = 0.0;
          if (material.uniforms.textureOpacity)   material.uniforms.textureOpacity.value = 0.0;
          if (material.uniforms.animateTexture)   material.uniforms.animateTexture.value = 0.0;
          if (material.uniforms.uPatternTexture)  material.uniforms.uPatternTexture.value = null;
        }

        // â”€â”€ STATIC GRADIENT UNIFORMS â€” always write, even while playing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // The RAF loop only updates ANIMATED TRANSFORM values (angle offset, scale, center).
        // Colors, palette data, intensity, and noise properties are never touched by RAF.
        // Keeping them inside a !isCurrentlyPlaying guard was the root cause of:
        //   (a) color palette changes not applying during animation
        //   (b) Reset sliders not updating canvas while animation plays
        if (gradient) {
          // â”€â”€ Color palette & stops â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          if (material.uniforms.colors && gradient.colors) {
            // CRITICAL: Sort stops by position before writing to uniforms.
            // getGradientColor() in every shader assumes positions[] is monotonically
            // increasing. Writing stops in unsorted array order (which reflects drag
            // sequence, not position order) makes the shader map colors to completely
            // wrong gradient positions — visible as wrong palette colors on canvas.
            const sortedStops = sortColorStops(gradient.colors);
            sortedStops.forEach((stop, i) => {
              const existing = material.uniforms.colors.value[i];
              const shaderColor = hexToShaderRgb(stop.color);
              if (existing instanceof THREE.Vector3) {
                existing.set(shaderColor.r, shaderColor.g, shaderColor.b);
              } else {
                material.uniforms.colors.value[i] = new THREE.Vector3(shaderColor.r, shaderColor.g, shaderColor.b);
              }
              if (material.uniforms.positions?.value[i] !== undefined) {
                material.uniforms.positions.value[i] = stop.position;
              }
            });

            // Clear trailing ghost slots when stop count decreases.
            // Stale values at indices >= colorCount can bleed through if colorCount
            // is momentarily wrong during rapid add/remove sequences.
            for (let i = sortedStops.length; i < 10; i++) {
              if (material.uniforms.colors.value[i] instanceof THREE.Vector3) {
                (material.uniforms.colors.value[i] as THREE.Vector3).set(0, 0, 0);
              }
              if (material.uniforms.positions?.value[i] !== undefined) {
                material.uniforms.positions.value[i] = 1.0;
              }
            }

            if (material.uniforms.colorCount) {
              material.uniforms.colorCount.value = sortedStops.length;
            }
          }

          // â”€â”€ Gradient intensity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          if (material.uniforms.intensity) material.uniforms.intensity.value = gradient.intensity ?? 1;

          // â”€â”€ Noise/fractal/structural properties â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          if (material.uniforms.octaves)       material.uniforms.octaves.value       = gradient.octaves       || 4;
          // wave type (waveGradientShader2) uses `frequency` for band count but the UI
          // Stripe Count slider writes to gradient.stripeCount — bridge them here.
          if (material.uniforms.frequency)     material.uniforms.frequency.value     =
            (gradient.type === 'wave'
              ? (gradient.stripeCount ?? gradient.frequency ?? 5)
              : (gradient.frequency ?? 2));
          if (material.uniforms.segments)      material.uniforms.segments.value      = gradient.segments      || 6;
          if (material.uniforms.stripeCount)   material.uniforms.stripeCount.value   = gradient.stripeCount   || 5;
          if (material.uniforms.waveAmplitude) material.uniforms.waveAmplitude.value = gradient.waveAmplitude ?? 0.2;
          if (material.uniforms.gridRows)      material.uniforms.gridRows.value      = gradient.gridRows      || 2;
          if (material.uniforms.gridCols)      material.uniforms.gridCols.value      = gradient.gridCols      || 2;
          if (material.uniforms.blobCount) {
            const newCount = Math.min(gradient.blobCount ?? 3, 5);
            material.uniforms.blobCount.value = newCount;
            // Recompute deterministic blob positions/sizes for the new count so
            // added blobs appear at useful positions rather than the origin (0,0).
            if (material.uniforms.blobPositions && material.uniforms.blobSizes) {
              for (let _bi = 0; _bi < 5; _bi++) {
                if (_bi < newCount) {
                  const _angle = (_bi / newCount) * Math.PI * 2;
                  material.uniforms.blobPositions.value[_bi]?.set(
                    0.5 + Math.cos(_angle) * 0.3,
                    0.5 + Math.sin(_angle) * 0.3
                  );
                  if (material.uniforms.blobSizes.value[_bi] !== undefined) {
                    material.uniforms.blobSizes.value[_bi] = 0.4;
                  }
                } else {
                  material.uniforms.blobPositions.value[_bi]?.set(0, 0);
                  if (material.uniforms.blobSizes.value[_bi] !== undefined) {
                    material.uniforms.blobSizes.value[_bi] = 0;
                  }
                }
              }
            }
          }
        }

        // â”€â”€ TRANSFORM / ANIMATED UNIFORMS â€” only when paused â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // These are written every frame by the RAF loop while playing.
        // Writing them here while playing would race and cause single-frame position snaps.
        if (!isCurrentlyPlaying && gradient) {
      
      // Get current layer state (use base transforms when not animating)
      const layerState = layerStatesRef.current.get(layer.id);
      // Read the ref instead of the prop â€” ref is always synchronously accurate
      // even when isPlaying is mid-update in React's batch.
      const hasFrozenAnimationState = !!layer.animation?.enabled && !!layerState && layerState.animationTime > 0;
      const useAnimatedValues = !!layer.animation?.enabled && (isPlayingRef.current || hasFrozenAnimationState);
      
      // Calculate base values and offsets separately
      const baseAngle = gradient.angle ?? 0;
      const baseScale = gradient.scale ?? 1;
      const baseCenterX = gradient.centerX ?? 0.5;
      const baseCenterY = gradient.centerY ?? 0.5;
      
      // When animating, use current values; otherwise use base values
      const currentAngle = useAnimatedValues && layerState 
        ? layerState.currentAngle 
        : baseAngle;
      const currentScale = useAnimatedValues && layerState 
        ? layerState.currentScale 
        : baseScale;
      const currentCenterX = useAnimatedValues && layerState 
        ? layerState.currentCenterX 
        : baseCenterX;
      const currentCenterY = useAnimatedValues && layerState 
        ? layerState.currentCenterY 
        : baseCenterY;
      
      // Calculate animation offsets (0 when not animating)
      const angleOffset = useAnimatedValues && layerState 
        ? (currentAngle - baseAngle)
        : 0;
      
      // Update gradient angle (linear, stripe, wave, angular gradients)
      // CRITICAL: shader does `angle + uRotation`, so pass base and offset separately
      if (material.uniforms.angle) {
        material.uniforms.angle.value = baseAngle; // Pass ONLY base angle
      }
      
      // Update gradient center (radial, conic, angular, etc.)
      if (material.uniforms.center) {
        material.uniforms.center.value.set(currentCenterX, currentCenterY);
      }
      // radial-waves shader declares centerX/centerY as separate floats (not vec2).
      // Write both forms so every gradient type responds to Center X/Y sliders.
      if (material.uniforms.centerX !== undefined) {
        material.uniforms.centerX.value = currentCenterX;
      }
      if (material.uniforms.centerY !== undefined) {
        material.uniforms.centerY.value = currentCenterY;
      }
      
      // Update gradient scale (radial, noise, etc.)
      // CRITICAL: Apply scaleBoost multiplier for all gradient types
      if (material.uniforms.scale) {
        material.uniforms.scale.value = currentScale * (gradient.scaleBoost ?? 1);
      }

      // Update gradient intensity
      if (material.uniforms.intensity) {
        material.uniforms.intensity.value = gradient.intensity ?? 1;
      }

      // Update complexity uniform — type-aware:
      // four-corners uses complexity as "Corner Spread" (maps from twist slider)
      // radial-waves uses complexity as wave decay (maps from twist slider)
      // plasma, marble, concentric, mandala use complexity as a structural param
      //   set via their own sliders (octaves) — do NOT overwrite with twist here.
      if (material.uniforms.complexity) {
        const complexityTypes = ['four-corners', 'radial-waves'];
        if (complexityTypes.includes(gradient.type)) {
          material.uniforms.complexity.value = gradient.twist !== undefined ? gradient.twist : 0.5;
        }
        // For all other types complexity is left as set by their renderer case /
        // the octaves update below — no blanket overwrite.
      }

      // Update animation/transform uniforms (for ALL gradient types)
      // CRITICAL: Pass ONLY animation offset to uRotation (shader adds it to angle)
      if (material.uniforms.uRotation) {
        material.uniforms.uRotation.value = angleOffset;
      }
      if (material.uniforms.uScale) {
        material.uniforms.uScale.value = currentScale;
      }
      if (material.uniforms.uTwist) {
        material.uniforms.uTwist.value = gradient.twist ?? 0;
      }
      if (material.uniforms.uTurbulence) {
        material.uniforms.uTurbulence.value = gradient.turbulence ?? 0;
      }

      // Preserve shader-driven animation uniforms while paused so the canvas holds
      // exactly where playback stopped. Only clear them when animation is disabled.
      if (!layer.animation?.enabled) {
        if (material.uniforms.uAnimPhase) material.uniforms.uAnimPhase.value = 0.0;
        if (material.uniforms.uAnimEased) material.uniforms.uAnimEased.value = 0.0;
        if (material.uniforms.uAnimTime) material.uniforms.uAnimTime.value = 0.0;
        if (material.uniforms.uAnimIntensity) material.uniforms.uAnimIntensity.value = 0.0;
        if (material.uniforms.uAnimType) material.uniforms.uAnimType.value = 0.0;
      }
      
      // Update texture properties
      const texture = layer.texture;
      // FIX: Always update texture uniforms regardless of intensity value to prevent gradient reset
      if (texture) {
        // Texture type/property uniforms now written above (outside playing guard)
        if (material.uniforms.textureOpacity) {
          material.uniforms.textureOpacity.value = texture.opacity;
        }
        if (material.uniforms.textureScale) {
          material.uniforms.textureScale.value = texture.scale;
        }
        if (material.uniforms.textureIntensity) {
          material.uniforms.textureIntensity.value = texture.intensity;
        }
        if (material.uniforms.animateTexture) {
          // CRITICAL FIX: Disable texture animations when layer animations are active
          material.uniforms.animateTexture.value = texture.animateTexture ? 1.0 : 0.0;
        }
        if (material.uniforms.animationSpeed) {
          material.uniforms.animationSpeed.value = texture.animationSpeed || 1.0;
        }
        if (material.uniforms.textureAnimationType) {
          // Map texture animation type to shader value (EXPANDED with topography modes!)
          const textureAnimationTypeMap: Record<string, number> = {
            'spin': 0.0,
            'rotation': 0.0, // Backwards compatibility
            'warp': 1.0,
            'pingPong': 2.0,
            'scale': 3.0,
            'drift': 4.0,
            'tectonic': 5.0, // NEW: Slow terrain drift (formerly topography-only)
            'breathing': 6.0, // NEW: Elevation pulsing (formerly topography-only)
            'seismic': 7.0, // Radial wave patterns
            'shear': 8.0, // Layered directional slippage
            'vortex': 9.0, // Rotational field around center
            'fluid': 10.0, // Organic water-like recirculating motion
          };
          const animType = texture.textureAnimationType || 'drift';
          // CRITICAL FIX: Use 'in' check instead of || to handle 0.0 for spin (0 is falsy!)
          const newValue = animType in textureAnimationTypeMap ? textureAnimationTypeMap[animType] : 4.0;
          const oldValue = material.uniforms.textureAnimationType.value;
          material.uniforms.textureAnimationType.value = newValue;
        }
        // Glass/texture specific uniforms
        if (material.uniforms.blur) {
          // Map texture-specific properties to blur uniform
          const blurValue = texture.type === 'plasma' && texture.turbulence !== undefined ? texture.turbulence / 100 :
                           (texture.blur !== undefined ? texture.blur : 0.5);
          material.uniforms.blur.value = blurValue;
        }
        if (material.uniforms.distortion) {
          material.uniforms.distortion.value = texture.distortion !== undefined ? texture.distortion : 0.5;
        }
        // Texture angle (for linearGlass, waveSignal, lines, etc.)
        if (material.uniforms.textureAngle) {
          // Now that topography animation modes use textureAnimationType,
          // textureAngle is just for geometric rotation (linearGlass, waveSignal, lines)
          material.uniforms.textureAngle.value = texture.angle !== undefined ? texture.angle : 90;
        }
        if (material.uniforms.gridSize) {
          // Map texture-specific properties to gridSize uniform
          const gridSizeValue = texture.type === 'plasma' ? (texture.waveCount ?? 5) :
                                (texture.gridSize ?? 10);
          material.uniforms.gridSize.value = gridSizeValue;
        }
        if (material.uniforms.complexity) {
          // Map texture-specific properties to complexity uniform
          // CRITICAL: Only override if texture is enabled, otherwise preserve gradient complexity
          if (texture.opacity > 0 && texture.intensity > 0) {
            const complexityValue = texture.complexity ?? 4;
            material.uniforms.complexity.value = complexityValue;
          }
        }
        if (material.uniforms.chromaticShift) {
          // Map texture-specific properties to chromaticShift uniform
          const chromaticValue = texture.type === 'plasma' ? (texture.colorIntensity ?? 70) :
                                 (texture.chromaticShift ?? 5);
          material.uniforms.chromaticShift.value = chromaticValue;
        }
        if (material.uniforms.blendMode) {
          const blendModeMap: Record<string, number> = {
            'normal': 0.0,
            'multiply': 1.0,
            'screen': 2.0,
            'overlay': 3.0,
            'soft-light': 4.0,
            'hard-light': 5.0,
          };
          material.uniforms.blendMode.value = blendModeMap[texture.blendMode] || 0.0;
        }

        // Initialize and map texture-specific parameters if they don't exist
        if (!material.uniforms.ridgeCount) {
          material.uniforms.ridgeCount = { value: 25.0 };
        }
        if (!material.uniforms.ridgeIrregularity) {
          material.uniforms.ridgeIrregularity = { value: 0.0 };
        }
        if (!material.uniforms.blockIrregularity) {
          material.uniforms.blockIrregularity = { value: 0.0 };
        }
        if (!material.uniforms.turbulence) {
          material.uniforms.turbulence = { value: 50.0 };
        }
        if (!material.uniforms.waveCount) {
          material.uniforms.waveCount = { value: 5.0 };
        }
        if (!material.uniforms.colorIntensity) {
          material.uniforms.colorIntensity = { value: 50.0 };
        }
        if (!material.uniforms.elevationShift) {
          material.uniforms.elevationShift = { value: 0.0 };
        }
        if (!material.uniforms.lineThickness) {
          material.uniforms.lineThickness = { value: 50.0 };
        }

        // Update texture-specific parameter values
        material.uniforms.ridgeCount.value = texture.ridgeCount ?? 25.0;
        material.uniforms.ridgeIrregularity.value = texture.ridgeIrregularity ?? 0.0;
        material.uniforms.blockIrregularity.value = texture.blockIrregularity ?? 0.0;
        material.uniforms.turbulence.value = texture.turbulence ?? 50.0;
        material.uniforms.waveCount.value = texture.waveCount ?? 5.0;
        material.uniforms.colorIntensity.value = texture.colorIntensity ?? 50.0;
        material.uniforms.elevationShift.value = texture.elevationShift ?? 0.0;
        material.uniforms.lineThickness.value = texture.lineThickness ?? 50.0;

        // Initialize and update uInvertTexture uniform (spackle invert toggle)
        if (!material.uniforms.uInvertTexture) {
          material.uniforms.uInvertTexture = { value: 0.0 };
        }
        material.uniforms.uInvertTexture.value = (texture.invertTexture === true) ? 1.0 : 0.0;

        // Initialize and update pattern texture uniform for shape-pattern type
        if (!material.uniforms.uPatternTexture) {
          material.uniforms.uPatternTexture = { value: null };
        }
        if (texture.type === 'shape-pattern') {
          const patternTexture = patternTexturesRef.current.get(layer.id);
          material.uniforms.uPatternTexture.value = patternTexture || null;
        } else {
          material.uniforms.uPatternTexture.value = null;
        }
      } else {
        if (material.uniforms.hasTexture) {
          material.uniforms.hasTexture.value = 0.0;
        }
      }

        } // end: transform/texture block (only when paused)

      // Update mask properties
      const mask = layer.mask;
      const maskTexture = maskTexturesRef.current.get(layer.id);
      
      // Check if mask is active AND visible (visible defaults to true)
      const isMaskVisible = mask && mask.type !== 'none' && (mask.visible ?? true);
      
      if (isMaskVisible) {
        try {
          // Initialize mask uniforms if they don't exist
          if (!material.uniforms.hasMask) {
            material.uniforms.hasMask = { value: 0.0 };
            material.uniforms.uMaskType = { value: 0.0 };
            material.uniforms.uMaskTexture = { value: null };
            material.uniforms.uMaskOpacity = { value: 1.0 };
            material.uniforms.uMaskFeather = { value: 0.0 };
            material.uniforms.uMaskInvert = { value: 0.0 };
            material.uniforms.uMaskMode = { value: 0.0 }; // 0=clip, 1=add, 2=subtract, 3=intersect
            material.uniforms.uMaskFit = { value: 1.0 }; // Always 1.0 (contain mode)
            material.uniforms.uMaskAspect = { value: 1.0 };
            material.uniforms.uCanvasAspect = { value: 1.0 };
            material.uniforms.uMaskScale = { value: 1.0 };
            material.uniforms.uMaskOffset = { value: new THREE.Vector2(0, 0) };
            material.uniforms.uMaskRotation = { value: 0.0 };
            material.uniforms.uMaskExpand = { value: 0.0 };
            material.uniforms.uMaskBlurQuality = { value: 0.0 }; // 0=none 1=fast 2=medium 3=high
            material.uniforms.uMaskTileMode   = { value: 0.0 }; // 0=single 1=repeat 2=mirror
            material.uniforms.uMaskTileScale  = { value: 1.0 }; // tile density (>1=denser)
            material.uniforms.uMaskEdgeDetect = { value: 0.0 }; // 0=off 1=on
            // P1 FIX: 1/2048 sentinel â€” replaced immediately from actual texture dims once loaded
            material.uniforms.uMaskTexelSize = { value: new THREE.Vector2(1 / 2048, 1 / 2048) };
            material.uniforms.uMaskSourceKind = { value: 0.0 };
            material.uniforms.uBitmapSourceMode = { value: 0.0 };
            material.uniforms.uBitmapThreshold = { value: 0.5 };
            // Advanced mask uniforms
            material.uniforms.uMaskBlurQuality = { value: 0.0 }; // 0=none 1=fast 2=medium 3=high
            material.uniforms.uMaskTileMode   = { value: 0.0 }; // 0=single 1=repeat 2=mirror
            material.uniforms.uMaskTileScale  = { value: 1.0 }; // tile density
            material.uniforms.uMaskTileScale = { value: 1.0 };
            material.uniforms.uMaskEdgeDetect = { value: 0.0 };
            material.uniforms.uMaskEdgeThickness = { value: 2.0 };
          }
          
          // Update mask settings
          // Skip animated properties if mask animation is enabled
          const maskAnimEnabled = mask.animation?.enabled;
          const maskAnimType = mask.animation?.type;

          material.uniforms.uMaskFeather.value = mask.feather / 100.0;
          material.uniforms.uMaskInvert.value = mask.invert ? 1.0 : 0.0;

          // Only set static values if not being animated
          if (!maskAnimEnabled || maskAnimType !== 'pulse') {
            material.uniforms.uMaskOpacity.value = mask.opacity;
          }

          if (!maskAnimEnabled || maskAnimType !== 'scale') {
            material.uniforms.uMaskScale.value = Math.min(3.0, Math.max(0.1, mask.maskScale || 1.0));
          }

          if (!maskAnimEnabled || (maskAnimType !== 'drift' && maskAnimType !== 'swing')) {
            if (material.uniforms.uMaskOffset?.value?.set) {
              material.uniforms.uMaskOffset.value.set(mask.positionX || 0, mask.positionY || 0);
            }
          }

          if (!maskAnimEnabled || maskAnimType !== 'rotate') {
            if (material.uniforms.uMaskRotation) {
              material.uniforms.uMaskRotation.value = ((mask.rotation || 0) * Math.PI) / 180.0;
            }
          }

          if (material.uniforms.uMaskExpand) {
            material.uniforms.uMaskExpand.value = Math.max(-1.0, Math.min(1.0, (mask.expand || 0) / 100.0));
          }

          if (material.uniforms.uBitmapSourceMode) {
            material.uniforms.uBitmapSourceMode.value = (mask.bitmapSourceMode || 'alpha') === 'luminance' ? 1.0 : 0.0;
          }

          if (material.uniforms.uBitmapThreshold) {
            material.uniforms.uBitmapThreshold.value = Math.max(0.0, Math.min(1.0, mask.bitmapThreshold ?? 0.5));
          }

          // Advanced mask parameters
          if (material.uniforms.uMaskBlurQuality) {
            const qualityMap: Record<string, number> = { 'none': 0, 'fast': 1, 'medium': 2, 'high': 3 };
            material.uniforms.uMaskBlurQuality.value = qualityMap[mask.blurQuality || 'none'] ?? 0;
          }

          if (material.uniforms.uMaskTileMode) {
            const tileModeMap: Record<string, number> = { 'single': 0, 'repeat': 1, 'mirror': 2 };
            material.uniforms.uMaskTileMode.value = tileModeMap[mask.tileMode || 'single'] ?? 0;
          }

          if (material.uniforms.uMaskTileScale) {
            material.uniforms.uMaskTileScale.value = Math.max(0.1, Math.min(5.0, mask.tileScale || 1.0));
          }

          if (material.uniforms.uMaskEdgeDetect) {
            material.uniforms.uMaskEdgeDetect.value = mask.edgeDetect ? 1.0 : 0.0;
          }

          if (material.uniforms.uMaskEdgeThickness) {
            material.uniforms.uMaskEdgeThickness.value = Math.max(1.0, Math.min(10.0, mask.edgeThickness || 2.0));
          }

          // Set mask type: 0=none, 1=alpha, 2=luminance, 3=layer, 4=image
          const maskTypeMap: Record<string, number> = {
            'none': 0,
            'alpha': 1,
            'luminance': 2,
            'layer': 3,
            'image': 4
          };
          material.uniforms.uMaskType.value = maskTypeMap[mask.type] || 0;
          
          // Set mask mode: 0=clip, 1=add, 2=subtract, 3=intersect
          const maskModeMap: Record<string, number> = {
            'clip': 0,
            'add': 1,
            'subtract': 2,
            'intersect': 3
          };
          material.uniforms.uMaskMode.value = maskModeMap[mask.mode || 'clip'] || 0;
          
          // Calculate aspect ratios
          const canvasAspect = canvasSettings.width / canvasSettings.height;
          material.uniforms.uCanvasAspect.value = canvasAspect;
          
          // For uploaded source masks (bitmap or SVG data URL), apply the rasterized texture if loaded
          if (mask.type === 'image') {
            if (maskTexture && maskTexture.image) {
              material.uniforms.hasMask.value = 1.0;
              material.uniforms.uMaskTexture.value = maskTexture;
              
              // Get mask texture dimensions
              const maskImage = maskTexture.image as { width?: number; height?: number };
              if (maskImage && maskImage.width && maskImage.height) {
                const maskAspect = maskImage.width / maskImage.height;
                material.uniforms.uMaskAspect.value = maskAspect;
                if (material.uniforms.uMaskTexelSize?.value?.set) {
                  material.uniforms.uMaskTexelSize.value.set(1 / maskImage.width, 1 / maskImage.height);
                }
              }
              if (material.uniforms.uMaskSourceKind) {
                const sourceKind = (maskTexture.userData as any)?.sourceType === 'svg' ? 1.0 : 0.0;
                material.uniforms.uMaskSourceKind.value = sourceKind;
              }
            } else {
              // Image mask selected but texture not loaded yet - disable mask temporarily
              material.uniforms.hasMask.value = 0.0;
            }
          } else if (mask.type === 'alpha' || mask.type === 'luminance') {
            // These mask types don't need a texture - handled in shader
            material.uniforms.hasMask.value = 1.0;
            material.uniforms.uMaskTexture.value = null;
            if (material.uniforms.uMaskSourceKind) material.uniforms.uMaskSourceKind.value = 0.0;
          } else if (mask.type === 'layer') {
            // STAGE 2.7 — MEDIA AS MASK SOURCE (previously a disabled stub).
            // Uses another layer's decoded MEDIA texture as this layer's mask.
            // Reuses the existing bitmap-mask path wholesale: the media texture
            // is already decoded and cached in mediaTexturesRef, and the shader
            // already supports luminance/alpha sampling via uBitmapSourceMode.
            const sourceTexture = mask.sourceLayerId
              ? mediaTexturesRef.current.get(mask.sourceLayerId) ?? null
              : null;
            if (sourceTexture) {
              material.uniforms.hasMask.value = 1.0;
              // Route through the shader's IMAGE mask branch (uMaskType 4 per
              // maskTypeMap above) — that's the branch that samples uMaskTexture.
              material.uniforms.uMaskType.value = 4.0;
              material.uniforms.uMaskTexture.value = sourceTexture;
              if (material.uniforms.uMaskSourceKind) material.uniforms.uMaskSourceKind.value = 0.0;
              if (material.uniforms.uBitmapSourceMode) {
                // Luminance is the sane default for photographic media.
                material.uniforms.uBitmapSourceMode.value =
                  (mask.bitmapSourceMode || 'luminance') === 'luminance' ? 1.0 : 0.0;
              }
              const img: any = sourceTexture.image;
              if (img?.width && img?.height) {
                material.uniforms.uMaskAspect.value = img.width / img.height;
                if (material.uniforms.uMaskTexelSize?.value?.set) {
                  material.uniforms.uMaskTexelSize.value.set(1 / img.width, 1 / img.height);
                }
              }
            } else {
              // Source layer has no media (or it's still decoding) — no mask.
              material.uniforms.hasMask.value = 0.0;
              material.uniforms.uMaskType.value = 0.0;
            }
          } else {
            material.uniforms.hasMask.value = 0.0;
          }
        } catch (error) {
          if (import.meta.env?.DEV) console.error('Error setting mask uniforms:', error);
          // Disable mask on error
          if (material.uniforms.hasMask) {
            material.uniforms.hasMask.value = 0.0;
          }
        }
      } else {
        // No mask applied
        if (material.uniforms.hasMask) {
          material.uniforms.hasMask.value = 0.0;
          material.uniforms.uMaskType.value = 0.0;
        }
      }
      
      // Update layer opacity and transparency
      material.opacity = layer.opacity;
      material.transparent = layer.opacity < 1;
      
      // Update layerOpacity uniform (for shader alpha channel)
      if (material.uniforms.layerOpacity) {
        material.uniforms.layerOpacity.value = layer.opacity;
      }
      
      // Update displacement uniforms for Interactive Warp Mode
      if (material.uniforms.uDisplacementMap && material.uniforms.uDisplacementStrength) {
        const displacement = layer.displacement;
        if (displacement?.enabled && displacementTextureRef.current && layer.id === activeLayerId && interactionEnabled) {
          material.uniforms.uDisplacementMap.value = displacementTextureRef.current;
          material.uniforms.uDisplacementStrength.value = displacement.strength / 100;
        } else {
          material.uniforms.uDisplacementMap.value = null;
          material.uniforms.uDisplacementStrength.value = 0.0;
        }
      }
      
      // Update blend mode (only if changed to avoid triggering needsUpdate)
      let targetBlending: THREE.Blending = THREE.NormalBlending;
      switch (layer.blendMode) {
        case 'multiply':
          targetBlending = THREE.MultiplyBlending;
          break;
        case 'screen':
        case 'lighten':
          targetBlending = THREE.AdditiveBlending;
          break;
        case 'normal':
        default:
          targetBlending = THREE.NormalBlending;
          break;
      }
      
      if (material.blending !== targetBlending) {
        material.blending = targetBlending;
        // STAGE 2.5 FIX: THREE.WebGLState requires premultipliedAlpha = true
        // whenever blending is MultiplyBlending, or it warns every frame.
        // Must be set here too — this is the runtime path (Blend Mode
        // dropdown after initial creation), separate from gradientRenderer.ts's
        // creation-time switch.
        material.premultipliedAlpha = targetBlending === THREE.MultiplyBlending;
        material.needsUpdate = true; // Only update when blending mode actually changes
      }
    });

    // Trigger a re-render so tile mode, blur quality, edge detect,
    // and any other uniform-only changes are visible when paused.
    // The RAF loop polls needsRenderRef on every tick â€” setting it true
    // is sufficient; no forcePreviewRender call needed.
    needsRenderRef.current = true;
  // isPlaying intentionally removed from deps â€” reading isPlayingRef.current instead.
  // This prevents a full uniform sweep on every play/pause toggle.
  }, [isInitialized, gradientTransformKey, gradientColorsKey, interactionEnabled, activeLayerId,
      maskPropertiesKey,
      maskTextureVersion,
      mediaTextureVersion,   // 2.7: media-layer masks read from mediaTexturesRef — re-run when a source texture decodes
      texturePropertiesKey,
      patternTextureVersion,   // pattern loads async — this triggers the uniform update
      // ★ STAGE 2.7.3 ROOT-CAUSE FIX ★
      // meshStructureKey was MISSING from this list. Whenever the mesh-rebuild
      // effect runs (media added/removed, layer deleted, texture type changed,
      // canvas resized) every layer gets a BRAND-NEW material whose uniforms are
      // at their compile-time DEFAULTS. This sweep is what repopulates them —
      // but it only re-runs when one of its OWN keys changes VALUE. A media
      // toggle or a layer delete doesn't alter gradientTransformKey /
      // gradientColorsKey / texturePropertiesKey, so the sweep never fired and
      // the fresh materials kept their defaults forever:
      //    layerOpacity = 1   → 12% opacity rendered full-bright
      //    uAnimType    = 0   → shader animations dead
      //    texture uniforms   → reset to defaults / stale pattern
      //    stale content      → old media still drawn until some other slider
      //                          happened to change one of the keys above
      // Adding meshStructureKey guarantees the sweep runs immediately after any
      // rebuild, so new materials are always populated from real layer state.
      meshStructureKey,
      canvasSettings.width,    // Fix C: uCanvasAspect must refresh when resolution changes
      canvasSettings.height,   //   so masks stay circular on non-square canvases
  ]);

  // Update effects material uniforms when effects change
  useEffect(() => {
    if (!effectsMaterialRef.current) return;
    
    // Update uniforms synchronously - no need for requestAnimationFrame
    // Guard: only write if value changed — avoids marking ShaderMaterial dirty
    // every time the effects object ref changes (e.g. any slider drag).
    const material = effectsMaterialRef.current;
    const setUniform = (key: string, value: number | boolean | THREE.Color | THREE.Vector2) => {
      if (material.uniforms[key] === undefined) return;
      // Skip write if value unchanged (avoids GPU dirty flag per frame)
      if (material.uniforms[key].value === value) return;
      material.uniforms[key].value = value;
    };
      
      // Check if any layer has active hueShift animation
      const hasActiveHueShiftAnimation = isPlaying && layersRef.current.some(
        layer => layer.visible && layer.animation?.enabled && layer.animation.type === 'hueShift'
      );
    
    // Update all effect uniforms
    material.uniforms.blur.value = effects.blur;
    material.uniforms.chromaticAberration.value = effects.chromaticAberration;
    material.uniforms.vignette.value = effects.vignette;
    material.uniforms.saturation.value = effects.saturation;
    material.uniforms.brightness.value = effects.brightness;
    material.uniforms.contrast.value = effects.contrast;
    
    // Only update hueShift if there's NO active hueShift animation
    // (otherwise the animation loop will handle it)
    if (!hasActiveHueShiftAnimation) {
      material.uniforms.hueShift.value = effects.hueShift;
    }
    
    material.uniforms.filmGrain.value = effects.filmGrain || 0;
    material.uniforms.filmGrainSize.value = effects.filmGrainSize || 1;
    material.uniforms.temperature.value = effects.temperature || 0;
    material.uniforms.tint.value = effects.tint || 0;
    material.uniforms.posterize.value = effects.posterize || 0;
    if (material.uniforms.ditherStrength) material.uniforms.ditherStrength.value = effects.ditherStrength ?? 65;
    if (material.uniforms.ditherScale) material.uniforms.ditherScale.value = effects.ditherScale ?? 50;
    material.uniforms.halftone.value = effects.halftone || 0;
    material.uniforms.halftoneAngle.value = effects.halftoneAngle || 0;
    material.uniforms.shapeOverlay.value = effects.shapeOverlay || 0;
    material.uniforms.pixelate.value = effects.pixelate || 0;
    material.uniforms.posterizeEnabled.value = effects.posterizeEnabled || false;
    material.uniforms.halftoneEnabled.value = effects.halftoneEnabled || false;
    material.uniforms.shapeOverlayEnabled.value = effects.shapeOverlayEnabled || false;
    material.uniforms.pixelateEnabled.value = effects.pixelateEnabled || false;
    material.uniforms.invert.value = effects.invert || false;
    
    // PHASE 1: Update Fresnel Effect uniforms
    material.uniforms.fresnelEnabled.value = effects.fresnelEnabled || false;
    material.uniforms.fresnelPower.value = effects.fresnelPower || 2;
    material.uniforms.fresnelIntensity.value = effects.fresnelIntensity || 0.5;

    // Sprint 1.1: Spatial FX chain — order + the three new effects.
    if (material.uniforms.u_chainOrder) {
      material.uniforms.u_chainOrder.value = spatialChainOrderToShaderInts(effects.spatialChainOrder);
    }
    if (material.uniforms.quadMirrorEnabled) material.uniforms.quadMirrorEnabled.value = effects.quadMirrorEnabled || false;
    if (material.uniforms.quadMirrorCenter) material.uniforms.quadMirrorCenter.value.set(
      effects.quadMirrorCenterX ?? 0.5, effects.quadMirrorCenterY ?? 0.5
    );
    if (material.uniforms.noiseDisplaceEnabled) material.uniforms.noiseDisplaceEnabled.value = effects.noiseDisplaceEnabled || false;
    if (material.uniforms.noiseDisplaceAmount) material.uniforms.noiseDisplaceAmount.value = effects.noiseDisplaceAmount ?? 0.1;
    if (material.uniforms.noiseDisplaceScale) material.uniforms.noiseDisplaceScale.value = effects.noiseDisplaceScale ?? 2;
    if (material.uniforms.noiseDisplaceSpeed) material.uniforms.noiseDisplaceSpeed.value = effects.noiseDisplaceSpeed ?? 0.5;
    if (material.uniforms.graphicSliceEnabled) material.uniforms.graphicSliceEnabled.value = effects.graphicSliceEnabled || false;
    if (material.uniforms.graphicSliceBands) material.uniforms.graphicSliceBands.value = effects.graphicSliceBands ?? 16;
    if (material.uniforms.graphicSliceAmount) material.uniforms.graphicSliceAmount.value = effects.graphicSliceAmount ?? 0.08;
    if (material.uniforms.graphicSliceRate) material.uniforms.graphicSliceRate.value = effects.graphicSliceRate ?? 8;
    
    // Update new uniforms for shape and dithering
    const shapeMap: Record<string, number> = {
      'square': 0, 'circle': 1, 'hexagon': 2, 'diamond': 3, 'triangle': 4, 'lines': 5
    };
    const ditheringMap: Record<string, number> = {
      'none': 0,
      'bayer': 1,
      'noise': 2,
      'blueNoise': 3,
      'scanline': 4,
      'dotDiffusion': 5,
      'crosshatch': 6,
    };
      material.uniforms.creativeShape.value = shapeMap[effects.creativeShape || 'square'] || 0;
      material.uniforms.posterizeDithering.value = ditheringMap[effects.posterizeDithering || 'none'] || 0;
      
      // No need for material.needsUpdate when only updating uniforms
  }, [effects, animationPropertiesKey]); // isPlaying removed â€” no uniform changes needed on play/pause here

  // Main animation loop
  useEffect(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    if (!renderTargetRef.current || !postProcessSceneRef.current || !effectsMaterialRef.current) return;

    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const renderTarget = renderTargetRef.current;
    const postProcessScene = postProcessSceneRef.current;
    const postProcessCamera = postProcessCameraRef.current;
    const effectsMaterial = effectsMaterialRef.current;
    if (!postProcessCamera) return;
    
    const animate = () => {
      // RAF is scheduled at the BOTTOM of this function, AFTER render completes.
      // This matches the TouchTexture reference pattern â€” if the GPU stalls on a frame,
      // the next frame waits rather than piling up. Eliminates the micro-stutter caused
      // by queuing work ahead of the GPU's ability to consume it.

      // STAGE 2.7.4 (F) — CONTEXT-LOSS GUARD.
      // Under heavy stacked load (media textures + animated gradients + a live
      // texture rebuild in the same frame) the WebGL context can be lost. Doing
      // ANY gl work after that point throws and takes the whole app down. If the
      // context is gone, skip all render work this frame but KEEP the loop
      // alive, so playback resumes automatically once the browser restores the
      // context (handleContextRestored re-arms needsRenderRef).
      const glCtx = rendererRef.current?.getContext?.();
      if (glCtx && glCtx.isContextLost && glCtx.isContextLost()) {
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      const now = performance.now();
      // Export owns all animation clocks. Hidden preview time is intentionally paused.
      if (isExportingRef.current || document.hidden) {
        lastFrameTimeRef.current = now;
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      // STAGE 3.0.1: pull one audio analysis frame from THIS loop rather than
      // letting the engine run its own RAF. Two independent RAF loops in one
      // app is a classic source of unexplained jitter; driving analysis from
      // the canvas loop keeps audio and visuals on the same clock. No-ops
      // cheaply when no audio is loaded (the engine early-returns).
      //
      // STAGE 3.0.2a: timed, so __audioPerf can report what analysis actually
      // costs per frame instead of it remaining an unmeasured suspect.
      phaseBegin('total');
      phaseBegin('audio');
      beginAnalysis();
      pumpAnalysisFrame();
      endAnalysis();
      phaseEnd('audio');

      // ── Visible layer cache + shouldAnimateTextures ────────────────────
      // MUST be defined here, BEFORE the texture clock below, to avoid a
      // JavaScript TDZ ReferenceError that silently crashes animate() every frame.
      if (cachedVisibleLayersRef.current.length === 0) {
        cachedVisibleLayersRef.current = layersRef.current; // STAGE 2.7A: pairs to mesh index
      }
      const hasTextureAnimation = cachedVisibleLayersRef.current.some(
        l => l.texture?.animateTexture
      );
      const shouldAnimateTextures = hasTextureAnimation;

      // Note: previewLastFrameTimeRef is used as a wall-clock anchor for the master
      // animation clock start.  We update it here at the top of every real tick.

      // Foreground elapsed time is not truncated: slow rendering must not
      // silently slow animation, masks, or textures relative to export.
      const rawDelta = Math.max(0, (now - lastFrameTimeRef.current) / 1000);
      lastFrameTimeRef.current = now;

      // STAGE 3.0.3: advance signal conditioning + every mapping's
      // attack/release envelope EXACTLY once per frame. This cannot live in
      // the per-layer loop — stepping an envelope once per layer would make
      // smoothing speed depend on how many layers happen to be visible.
      // Uses rawDelta (true wall clock) so envelope timing stays correct.
      tickAudioFrame(rawDelta);

      // No EMA — Figma iframe is locked at 24fps. EMA adds latency at fixed rates.
      // Using rawDelta directly gives consistent frame advancement without catch-up lag.
      const clockDelta = (isPlayingRef.current && isPageVisibleRef.current)
        ? rawDelta
        : 0;


      if (isPlayingRef.current) {
        if (animationPlayStartRef.current == null) {
          animationPlayStartRef.current = now;
        }
        // STAGE 3.0.6: BEAT-AS-CLOCK. When the beat clock is conducting (enabled
        // + confident/tapped), advance the animation accumulator in MUSICAL time
        // derived from the detected tempo instead of raw wall time. Returns null
        // when not conducting, so we fall back to the wall-clock delta exactly
        // as before — ambient/low-confidence material is unaffected.
        //
        // This is the ONLY change to the clock: the accumulator still feeds a
        // monotonic time into useLayerAnimations, which applies per-layer speed
        // downstream unchanged. Under this clock that speed reads as a musical
        // ratio (0.5× half-time, 2× double-time). Invariant preserved.
        const beatDelta = clockDelta > 0 ? beatClockDelta(clockDelta) : null;
        animationAccumulatedTimeRef.current += beatDelta !== null ? beatDelta : clockDelta;

        // Float precision guard â€” wrap at PRECISION_WRAP_INTERVAL to prevent
        // sin/cos inputs growing so large that 64-bit float loses sub-ms resolution.
        // The wrap is invisible because all drivers are periodic (sin/cos).
        if (animationAccumulatedTimeRef.current > PRECISION_WRAP_INTERVAL) {
          animationAccumulatedTimeRef.current -= PRECISION_WRAP_INTERVAL;
        }

        animationMasterTimeRef.current = animationAccumulatedTimeRef.current;
      } else {
        animationMasterTimeRef.current = animationAccumulatedTimeRef.current;
      }
      const animationTime = animationMasterTimeRef.current;

      // ── Texture clock ──────────────────────────────────────────────────
      // Advances when Play is pressed (isPlayingRef.current) AND animateTexture is on.
      // Gating on isPlaying means Play button controls texture animation movement
      // — consistent with gradient animation behavior.
      if (shouldAnimateTextures && isPlayingRef.current) {
        textureOnlyTimeRef.current += clockDelta;
        if (textureOnlyTimeRef.current > 3600) textureOnlyTimeRef.current -= 3600;
      }

      // â”€â”€ Warm-up frame guard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // On the very first tick after Play is pressed, hold the master clock at
      // its current value.  This gives the GPU one full vsync interval to finish
      // any pending shader compilation before animation visibly moves, eliminating
      // the first-frame skip/stutter users see when starting playback.
      // Warm-up guard: on very first play, render one static frame so the
      // GPU finishes shader compilation before the clock starts advancing.
      // We do NOT return early â€” we fall through to the render call below
      // so the user sees the first frame immediately (no black flash).
      // Clock advance is prevented by clockDelta staying 0 this tick.
      if (warmupFramePendingRef.current) {
        warmupFramePendingRef.current = false;
        smoothedDeltaRef.current = 0.01667; // reset EMA to 60fps baseline
        needsRenderRef.current   = true;
        // Force clockDelta to 0 for this tick only â€” the next tick advances normally
        // (achieved by resetting the play-start anchor to now)
        animationPlayStartRef.current  = now;
        lastFrameTimeRef.current       = now;
      }

      // â”€â”€ Cached visible layers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Rebuild only when the layer list itself changes (handled in the meshStructureKey
      // useEffect). During steady-state animation, reuse the cached array to avoid an
      // Array.filter() allocation on every RAF tick.
      // shouldAnimateTextures already defined above (before clock section — TDZ fix).
      const shouldRenderFrame = isPlayingRef.current || interactionEnabledRef.current ||
        needsRenderRef.current || shouldAnimateTextures;
      // Cache the effects-active flag so hasActiveEffects() isn't called on every frame
      // (it checks ~18 conditions). Only recalculates when effects change via effectsRef.
      // Preview and deterministic export share this exact render-graph decision.
      // This prevents a neutral export from being forced through a shader pass
      // that the live preview did not use.
      const activeEffectsThisFrame = shouldUsePostProcess(
        effectsRef.current,
        getGlobalAudioDeltas(),
      );
      if (!shouldRenderFrame || isExportingRef.current) {
        // STAGE 3.0.3: close the frame phase on this early-return path too —
        // otherwise idle/export frames would open 'total' and never close it,
        // and the profiler would silently under-report.
        phaseEnd('total');
        // Still schedule next frame so the loop stays alive during idle/export
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      const visibleLayers = cachedVisibleLayersRef.current;

      // Update animation state for each layer
      phaseBegin('layerAnim');
      // ── STAGE 3.0.4: LAYER PUNCH + SHAKE — own unconditional pass ──
      // Moved OUT of the isPlaying-gated animation loop. These are mesh
      // transforms driven by audio, and audio can be running (and the beat
      // pulsing) independently of whether the animation TRANSPORT is playing.
      // Gating them behind isPlaying was part of why they read as "not working"
      // — they'd silently do nothing whenever the animation clock wasn't also
      // advancing. Runs every frame, cheap (3-layer cap), self-zeroing.
      //
      // This is also the answer to "what does Scale actually scale?": Gradient
      // Scale moves the PATTERN inside the layer (a shader uniform); Layer
      // Punch moves everything the layer renders — gradient, media, textures
      // and mask — together, via the mesh transform. One target per answer.
      meshesRef.current.forEach((mesh, index) => {
        const layer = visibleLayers[index];
        if (!layer) return;
        const d = getAudioDeltasForLayer(layer.id);
        mesh.scale.x = d.layerPunchMul;
        mesh.scale.y = d.layerPunchMul;
        // STAGE 3.0.5: SHAKE moved OUT of here. Translating this mesh moved the
        // whole frame (the mesh fills the canvas), which is the "shakes the
        // frame not the contents" bug. Shake is now a post-process UV offset —
        // see the uShake write near the effects uniforms below. Punch stays: it
        // scales the layer's imagery, which is exactly what it should do.

        // STAGE 3.0.5b: MOTION — audio UV glitch. Its own effect, applied here
        // (above the animation guard) so it works on EVERY visible layer
        // regardless of animation type or whether animation is enabled at all.
        // The shader skips the branch entirely when this is (0,0), so a layer
        // with no Motion mapping renders unchanged.
        const gm = mesh.material as unknown as { uniforms?: Record<string, { value: { set(x: number, y: number): void } }> };
        if (gm?.uniforms?.uAudioGlitch) {
          gm.uniforms.uAudioGlitch.value.set(d.glitchX, d.glitchY);
        }
      });

      if (isPlayingRef.current) {
        meshesRef.current.forEach((mesh, index) => {
          const layer = visibleLayers[index];
          if (!layer) return;

          // STAGE 3.0.2a: resolve audio PER LAYER for the shader-uniform
          // targets (gradient scale / hue / intensity / motion).
          const audioDeltas = getAudioDeltasForLayer(layer.id);

          if (!layer.animation?.enabled) return;

          const layerState = layerStatesRef.current.get(layer.id);
          if (!layerState) return;

          const gradient = layer.gradient;
          if (!gradient) return;

          // â”€â”€ SPEED SMOOTHING (patch for chaotic speed-slider jumps) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          // Root cause: signedTime = animationTime * speed. When speed changes mid-
          // drag, animationTime (accumulated clock, e.g. 15s) is multiplied by the
          // new speed instantly â†’ massive phase jump â†’ chaotic visual.
          //
          // Fix: track signedPhase independently per layer.
          //   signedPhase += clockDelta * smoothedSpeed  (accumulated each frame)
          //   smoothedSpeed = EMA(current, target, alpha)  (glides to new speed)
          //
          // signedPhase grows at exactly the right rate regardless of when speed
          // changes â€” no multiplication by the large accumulated clock value.
          // The EMA (alpha=0.15 â‰ˆ 6 frames â‰ˆ 100ms) ensures a smooth ramp.
          const targetSpeed = mapLayerAnimationSpeed(layer.animation.speed);
          const prevSmoothed = layerState.smoothedSpeed ?? targetSpeed;
          // One shared, time-based smoother drives preview and deterministic
          // export. At 60 fps this is identical to the established 0.15 EMA;
          // at other frame rates it retains the same real-time response.
          const continued = advanceExportLayerTimeline({
            previous: { phase: layerState.signedPhase ?? 0, smoothedSpeed: prevSmoothed },
            capturedPhase: layerState.signedPhase ?? 0,
            capturedSpeed: prevSmoothed,
            targetSpeed,
            deltaSeconds: clockDelta,
            speedMultiplier: audioDeltas.speedMul,
          });
          const newSmoothedSpeed = continued.smoothedSpeed;
          const newSignedPhase = continued.phase;
          layerState.smoothedSpeed = newSmoothedSpeed;
          layerState.signedPhase = newSignedPhase;

          // Drive animation from signedPhase (already encodes smooth speed).
          // Pass speed=1.0 so calculateAnimationOffset does not re-multiply by speed â€”
          // the phase is pre-scaled. cycleSeconds computed at speed=1 is correct
          // because signedPhase itself grows at newSmoothedSpeed rate.
          const newAnimationTime = animationTime;
          const offset = calculateAnimationOffset(
            layer.animation.type,
            newSignedPhase,       // pre-computed continuous phase â€” no jumps on speed change
            1.0,                  // speed=1: phase already encodes the speed
            layer.animation.intensity,
            layer.animation.easing || 'linear',
            layer.animation.direction || 'forward',
            layer.animation.loop !== false
          );

          // Apply offsets to base transforms
          // CRITICAL FIX: Use base intensity multiplied by offset (not compound previous intensity)
          const baseIntensity = layer.gradient?.intensity || 1;
          layerState.animationTime = newAnimationTime;
          layerState.currentAngle = layerState.baseAngle + offset.angleOffset;
          layerState.currentScale = layerState.baseScale + offset.scaleOffset;
          layerState.currentCenterX = layerState.baseCenterX + offset.xOffset;
          layerState.currentCenterY = layerState.baseCenterY + offset.yOffset;
          layerState.currentIntensity = baseIntensity * offset.intensityMultiplier; // FIX: Don't compound, use base
          const newState = layerState;

          // Update shader uniforms with current state
          const material = mesh.material as THREE.ShaderMaterial;
          if (!material.uniforms) return;

          // Update time uniform for shader-based animations
          // PATCHED: was `newAnimationTime * layer.animation.speed`
          // That multiplication was the second source of speed-change jumps:
          // animationTime is large (e.g. 30s), so speed 1â†’5 jumped time by 120s.
          // signedPhase already encodes the smooth speed â€” use it directly.
          if (material.uniforms.time) {
            material.uniforms.time.value = newSignedPhase;
          }

          // Update transform uniforms
          // CRITICAL FIX: shader does `angle + uRotation`, so pass base angle and offset separately
          if (material.uniforms.uRotation) {
            material.uniforms.uRotation.value = offset.angleOffset; // Pass ONLY the animation offset
          }
          if (material.uniforms.angle) {
            material.uniforms.angle.value = layerState.baseAngle; // Pass ONLY the base angle
          }
          if (material.uniforms.uScale) {
            // STAGE 3.0.2: audio scale multiplier. uScale/scale are consumed
            // unconditionally by every gradient shader, which is why scale is
            // the DEFAULT audio target — unlike uAnimIntensity it cannot be
            // silently inert. See audioMapping.ts for that whole story.
            material.uniforms.uScale.value = newState.currentScale * audioDeltas.gradientScaleMul;
          }
          if (material.uniforms.scale) {
            material.uniforms.scale.value =
              newState.currentScale * (gradient.scaleBoost ?? 1) * audioDeltas.gradientScaleMul;
          }
          if (material.uniforms.center) {
            material.uniforms.center.value.set(newState.currentCenterX, newState.currentCenterY);
          }
          if (material.uniforms.uDriftX) {
            material.uniforms.uDriftX.value = newState.currentCenterX - layerState.baseCenterX;
          }
          if (material.uniforms.uDriftY) {
            material.uniforms.uDriftY.value = newState.currentCenterY - layerState.baseCenterY;
          }
          if (material.uniforms.uPulse) {
            // Guard: prevent NaN when baseScale is 0 (e.g. kaleidoscope on first frame)
            const safeBase = Math.max(0.001, layerState.baseScale);
            material.uniforms.uPulse.value = Math.max(0.01, newState.currentScale / safeBase);
          }
          // Write intensity uniform from currentIntensity so vortex/pulse/wave/liquid
          // intensity multipliers are visible in the gradient shader.
          // Without this, intensityMultiplier is calculated but never reaches the GPU.
          if (material.uniforms.intensity) {
            material.uniforms.intensity.value = newState.currentIntensity * audioDeltas.intensityMul;
          }
          
          // Apply hueShiftOffset to uHueRotation for ALL animation types that produce it.
          // Previously only 'hueShift' triggered this, but liquid/kaleidoscope/dualShifter/
          // ripple/chromaticPulse all produce hueShiftOffset — their hue effects were silently lost.
          if (material.uniforms.uHueRotation) {
            if (offset.hueShiftOffset !== undefined && Math.abs(offset.hueShiftOffset) > 0.01) {
              // STAGE 3.0.2: + audio hue delta, wrapped once at the end so the
              // sum can't escape 0–360.
              const wrappedHue = (((offset.hueShiftOffset + audioDeltas.hueAdd) % 360) + 360) % 360;
              material.uniforms.uHueRotation.value = wrappedHue;
            } else {
              // Audio drives hue even when no hue ANIMATION is active — without
              // this, routing Mid→Hue would silently do nothing on most layers.
              material.uniforms.uHueRotation.value = ((audioDeltas.hueAdd % 360) + 360) % 360;
            }
          }

          // JS transforms are the sole animation authority for all layer animation types.
          // Setting uAnimType = 0.0 disables shader-side procedural animation which would
          // otherwise compound with JS transforms, causing double-animation effects:
          // vortex gets intensity pulse from JS + intensity pulse from shader = chromatic shimmer;
          // ripple gets drift from JS + drift from shader = zoom-pulse hybrid.
          // Preview and export now produce identical animation output.
          if (material.uniforms.uAnimPhase) {
            material.uniforms.uAnimPhase.value = offset.phase01;
          }
          if (material.uniforms.uAnimEased) {
            material.uniforms.uAnimEased.value = offset.eased01;
          }
          if (material.uniforms.uAnimTime) {
            material.uniforms.uAnimTime.value = offset.signedTime;
          }
          if (material.uniforms.uAnimIntensity) {
            // STAGE 3.0.1: additive audio-reactive boost. audioIntensityBoost()
            // returns 0 whenever the feature is off or audio isn't playing, so
            // a scene that isn't using audio is bit-for-bit unchanged. This is
            // the single seam between the audio module and the render loop; in
            // 3.0.2 the one function becomes the mapping resolver and this call
            // site stays identical.
            // STAGE 3.0.2: the 'motion' target. Honest caveat — uAnimIntensity
            // is only READ inside the shader field functions, gated by
            // uAnimType, so it contributes for the seven field animation types
            // and is inert for the rest. Exactly why it is no longer default.
            // STAGE 3.0.5b: Motion no longer touches uAnimIntensity. It's now a
            // self-contained UV glitch (uAudioGlitch, written in the
            // unconditional pass above) that works on all animation types, so
            // this uniform returns to carrying only the layer's own intensity.
            material.uniforms.uAnimIntensity.value = layer.animation.intensity;
          }
          if (material.uniforms.uAnimType) {
            // Map each animation type to its shader UV-distortion mode.
            // Pure-transform types (rotation, pulse, scale, drift, etc.) stay at 0 —
            // JS handles them fully and shader distortion would double the effect.
            // Morphing types need shader UV distortion for their liquid/swirl character.
            // STAGE 3.0.3 (perf): this table used to be an object literal built
            // HERE — inside the per-layer loop, every frame. It is a constant,
            // so it now lives at module scope (SHADER_ANIM_TYPE_MAP) and this
            // is a plain lookup. Removes one allocation per layer per frame.
            material.uniforms.uAnimType.value = SHADER_ANIM_TYPE_MAP[layer.animation.type] ?? 0.0;
          }
        });
      }

      phaseEnd('layerAnim');

      // Update mask animations
      phaseBegin('maskAnim');
      if (isPlayingRef.current) {
        meshesRef.current.forEach((mesh, index) => {
          const layer = visibleLayers[index];
          const mask = layer?.mask;
          const material = mesh.material as THREE.ShaderMaterial;
          if (!material.uniforms) return;

          applyMaskAnimation(material, mask, animationTime);
        });
      }

      // Drive texture animation clock.
      // When animateTexture is on: use textureOnlyTimeRef (ticks without Play).
      // When animateTexture is off: keep synced to animationTime for continuity.
      textureMasterTimeRef.current = shouldAnimateTextures
        ? textureOnlyTimeRef.current
        : animationTime;
      meshesRef.current.forEach((mesh, index) => {
        const layer = visibleLayers[index];
        const material = mesh.material as THREE.ShaderMaterial;
        const texture = layer?.texture;
        if (!material.uniforms || !material.uniforms.textureTime || !layer) return;

        // P2 FIX: Restructured texture transport for two goals:
        //
        // 1. IDLE CLOCK SYNC â€” always keep lastMasterTime current even when the
        //    layer isn't animating.  If we skipped this, re-enabling animation
        //    would compute a dtMaster equal to the entire idle period and snap
        //    the texture forward by potentially minutes of accumulated time.
        //
        //
        // 3. SKIP UNIFORM WRITE when not animating â€” avoids unnecessary
        //    CPUâ†’GPU traffic each RAF tick for layers with static textures.

        // Texture animation runs whenever animateTexture is enabled, regardless of
        // whether the Play button is pressed. This matches how Plasma always looks
        // animated — its sin(time) waves advance whenever time advances, not only
        // when Play is on. The always-on liquid motion in Spackle/HeatMelt/Topography
        // needs this too, otherwise it only moves when Play is pressed.
        const isActiveAnimation = !!layer.texture?.animateTexture;

        const existing = textureTransportRef.current.get(layer.id) ?? {
          lastMasterTime: textureMasterTimeRef.current,
          accumulated: material.uniforms.textureTime.value || 0,
        };

        // Account for the full foreground interval, including skipped render ticks.
        const dtMaster = Math.max(0, textureMasterTimeRef.current - existing.lastMasterTime);
        existing.lastMasterTime = textureMasterTimeRef.current; // always sync, even when idle

        if (isActiveAnimation) {
          const animationSpeed = mapTextureAnimationSpeed(texture?.animationSpeed);
          existing.accumulated += dtMaster * animationSpeed;
          textureTransportRef.current.set(layer.id, existing);
          material.uniforms.textureTime.value = existing.accumulated;
        } else {
          // Idle â€” sync the transport clock but skip the uniform write.
          // This keeps lastMasterTime fresh so re-enabling animation doesn't
          // compute a huge dtMaster from the idle period.
          textureTransportRef.current.set(layer.id, existing);
        }
      });

      // â”€â”€ Interaction lerp â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Early-exit when interaction is completely idle â€” avoids per-mesh uniform
      // writes and object spread allocation on every RAF tick during pure animation.
      const interactionIsIdle =
        !interactionEnabledRef.current &&
        Math.abs(currentInteraction.current.intensity) < 0.0005 &&
        Math.abs(targetInteraction.current.intensity) < 0.0005;

      if (!interactionIsIdle) {
        const distanceX = Math.abs(targetInteraction.current.mouseX - currentInteraction.current.mouseX);
        const distanceY = Math.abs(targetInteraction.current.mouseY - currentInteraction.current.mouseY);
        const maxDistance = Math.max(distanceX, distanceY);
        // Smooth lerp: 0.18 gives ~5-frame settle (83ms at 60fps) â€” feels eased and
        // deliberate. The old 0.65 value settled in ~2 frames which felt erratic.
        // shiftKey (pan mode) uses 0.12 for extra precision.
        const baseLerpFactor = currentInteraction.current.shiftKey ? 0.12 : 0.18;
        currentInteraction.current.mouseX    += (targetInteraction.current.mouseX    - currentInteraction.current.mouseX)    * baseLerpFactor;
        currentInteraction.current.mouseY    += (targetInteraction.current.mouseY    - currentInteraction.current.mouseY)    * baseLerpFactor;
        currentInteraction.current.intensity += (targetInteraction.current.intensity - currentInteraction.current.intensity) * baseLerpFactor;
        currentInteraction.current.shiftKey         = targetInteraction.current.shiftKey;
        currentInteraction.current.altKey           = targetInteraction.current.altKey;
        currentInteraction.current.currentParameter = targetInteraction.current.currentParameter;
        interactionState.current = { ...currentInteraction.current };
      }

      // Update mouse uniforms for shader effects (parallax, mouse glow, etc.)
      // Pan/zoom are driven by pointer handlers directly â€” NOT from here.
      // The old scale/rotation writes (mouseX*1.5, mouseY*90) caused the
      // huge-decimal rotation bug by fighting the delta-accumulation system.
      if (interactionEnabledRef.current && currentInteraction.current.intensity > 0.001) {
        meshesRef.current.forEach((mesh, index) => {
          const layer = visibleLayers[index];
          if (!layer || !layer.gradient) return;
          const material = mesh.material as THREE.ShaderMaterial;
          if (!material.uniforms) return;
          if (material.uniforms.mouseX) material.uniforms.mouseX.value = currentInteraction.current.mouseX;
          if (material.uniforms.mouseY) material.uniforms.mouseY.value = currentInteraction.current.mouseY;
          if (material.uniforms.mouseIntensity) material.uniforms.mouseIntensity.value = currentInteraction.current.intensity;
        });
      } else if (!interactionEnabled) {
        meshesRef.current.forEach((mesh, index) => {
          const layer = visibleLayers[index];
          if (!layer || !layer.gradient) return;
          const material = mesh.material as THREE.ShaderMaterial;
          if (!material.uniforms) return;
          if (material.uniforms.mouseX) material.uniforms.mouseX.value = 0;
          if (material.uniforms.mouseY) material.uniforms.mouseY.value = 0;
          if (material.uniforms.mouseIntensity) material.uniforms.mouseIntensity.value = 0;
        });
      }

      // Update effects material uniforms with current time
      // Use the precision-wrapped animation clock for effects time too.
      // `now * 0.001` grows unboundedly (millions of seconds) causing float
      // precision decay in film grain and other time-driven effects shaders.
      phaseEnd('maskAnim');
      phaseBegin('effects');
      effectsMaterial.uniforms.time.value = animationTime;

      // ── STAGE 3.0.3: AUDIO-DRIVEN POST FX ──
      // RGB Split and Brightness are POST-PROCESSING: they act on the
      // composited frame, so unlike the per-layer targets they have no layer
      // scope — routing them at a specific layer would be a promise the
      // pipeline can't keep, and the panel says so.
      //
      // Written every frame ON TOP of the user's slider values rather than
      // replacing them, so a scene with chromatic aberration already dialled in
      // gets audio movement around that setting instead of having it reset.
      {
        const g = getGlobalAudioDeltas();
        if (effectsMaterial.uniforms.chromaticAberration) {
          effectsMaterial.uniforms.chromaticAberration.value =
            effectsRef.current.chromaticAberration + g.chromaAdd;
        }
        if (effectsMaterial.uniforms.brightness) {
          // Strobe maps to brightness: a full hit flashes the frame white.
          effectsMaterial.uniforms.brightness.value =
            effectsRef.current.brightness + g.brightnessAdd + g.strobeAdd;
        }
        if (effectsMaterial.uniforms.blur) {
          effectsMaterial.uniforms.blur.value =
            effectsRef.current.blur + g.blurAdd;
        }
        if (effectsMaterial.uniforms.saturation) {
          effectsMaterial.uniforms.saturation.value =
            effectsRef.current.saturation + g.saturationAdd;
        }
        if (effectsMaterial.uniforms.vignette) {
          effectsMaterial.uniforms.vignette.value =
            effectsRef.current.vignette + g.vignetteAdd;
        }
        // STAGE 3.0.5: audio SHAKE — whole-frame UV jolt. Set every frame;
        // (0,0) when nothing routes to Shake, so a still frame is unaffected.
        if (effectsMaterial.uniforms.uShake) {
          effectsMaterial.uniforms.uShake.value.set(g.shakeX, g.shakeY);
        }
      }

      // PERF: Single-pass render when no effects are active (the common case
      // during animation preview). Bypasses the offscreen RT entirely, halving
      // GPU work per frame. Falls back to the full FBOâ†’post-process chain when
      // blur, vignette, film grain, etc. are enabled.
      // STAGE 2.7.4 (F) — RENDER SAFETY NET.
      // The render dispatch is the one place a transient GL fault under heavy
      // stacked load (mesh rebuild + texture decode + animation writes in the
      // same frame) would throw and take the whole app down. Wrapping it turns
      // a hard crash into a single skipped frame: the loop stays alive, the
      // context-loss handler (if the context actually dropped) drives recovery,
      // and the next frame retries. This does NOT mask logic bugs — it only
      // prevents a GPU hiccup from being fatal.
      phaseEnd('effects');
      phaseBegin('render');
      try {
        if (activeEffectsThisFrame) {
          // Double-pass: scene â†’ offscreen RT â†’ post-process quad â†’ screen + captureRT
          renderer.setRenderTarget(renderTarget);
          renderer.clear();
          renderer.render(scene, camera);
          // Update post-process tDiffuse
          if (postProcessQuadRef.current?.material) {
            const pm = postProcessQuadRef.current.material as THREE.ShaderMaterial;
            if (pm.uniforms?.tDiffuse) pm.uniforms.tDiffuse.value = renderTarget.texture;
          }
          // Render composite â†’ captureRT first (so readFramePixels is always fresh)
          if (captureRTRef.current) {
            renderer.setRenderTarget(captureRTRef.current);
            renderer.clear();
            renderer.render(postProcessScene, postProcessCamera);
          }
          // Then render composite â†’ screen
          renderer.setRenderTarget(null);
          renderer.clear();
          renderer.render(postProcessScene, postProcessCamera);
        } else {
          // Single-pass: scene â†’ captureRT AND scene â†’ screen
          if (captureRTRef.current) {
            renderer.setRenderTarget(captureRTRef.current);
            renderer.clear();
            renderer.render(scene, camera);
          }
          renderer.setRenderTarget(null);
          renderer.clear();
          renderer.render(scene, camera);
        }
      } catch (renderErr) {
        // Reset render target so a partial double-pass state can't wedge the
        // next frame, and let the loop continue. Throttle the warning.
        try { renderer.setRenderTarget(null); } catch { /* context already gone */ }
        if (import.meta.env?.DEV && !(window as any).__renderErrLogged) {
          (window as any).__renderErrLogged = true;
          console.warn('[Render] Frame skipped after a GL fault — recovering on next frame.', renderErr);
        }
      }

      needsRenderRef.current = false;

      // PATCHED v1.85.1 CRIT-02: signal App.tsx that the canvas is live.
      // Fires once after the very first completed frame â€” App fades in exactly
      // when the canvas is rendering, not on a guessed timer.
      if (!hasCalledOnReadyRef.current && onReadyRef.current) {
        hasCalledOnReadyRef.current = true;
        // Defer by one rAF so the painted frame is visible before fade-in starts
        requestAnimationFrame(() => {
          onReadyRef.current?.();
        });
      }

      phaseEnd('render');
      phaseEnd('total');

      // Schedule next frame AFTER render completes â€” back-pressure pattern.
      // If GPU is under load, the next tick waits naturally instead of queuing up.
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    // Start the loop â€” RAF fires AFTER first render to establish clean timing baseline
    previewLastFrameTimeRef.current = performance.now();
    // Use immediate RAF to kick off loop; subsequent calls schedule AFTER render (see animate body)
    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelFrame(animationFrameRef);
    };
  }, [isInitialized, exportRestartTrigger]);
  // NOTE: 'layers' is intentionally NOT in dependencies - we use layersRef.current instead
  // NOTE: 'texturePropertiesKey' is also NOT in dependencies to prevent full scene rebuilds
  // Texture animation state is handled by a separate useEffect below
  // NOTE: exportRestartTrigger restarts the animation loop cleanly after export completes

  // Texture animation now runs from the shared master RAF loop above.
  // Keep this effect lightweight so toggling texture animation flags the preview
  // for redraw without spinning up a second animation loop.
  useEffect(() => {
    const master = animationMasterTimeRef.current;
    layers.forEach(layer => {
      const state = textureTransportRef.current.get(layer.id);
      if (state) state.lastMasterTime = master;
    });
    needsRenderRef.current = true;
  }, [textureAnimationStateKey]);

  // â”€â”€ Texture animation CONTROL uniforms â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // These 3 uniforms must update instantly when the user changes them, including
  // DURING active playback. They are intentionally excluded from the big uniform
  // useEffect (which has an isPlayingRef guard) so they get their own thin effect.
  //
  // animateTexture     â€” on/off toggle (shader reads this to decide whether to animate)
  // textureAnimationType â€” spin/warp/drift/fluid/pingPong/etc (shader selects motion mode)
  // animationSpeed     â€” speed multiplier written to the RAF transport on next tick
  //
  // These are lightweight (3 values per layer) so running them during playback
  // costs negligible time and fixes the "animation type doesn't change" bug.
  useEffect(() => {
    if (!isInitialized || meshesRef.current.length === 0) return;

    const textureAnimationTypeMap: Record<string, number> = {
      'spin': 0.0, 'rotation': 0.0,
      'warp': 1.0, 'pingPong': 2.0, 'scale': 3.0, 'drift': 4.0,
      'tectonic': 5.0, 'breathing': 6.0, 'seismic': 7.0,
      'shear': 8.0, 'vortex': 9.0, 'fluid': 10.0,
    };

    meshesRef.current.forEach((mesh, index) => {
      const layer = layersRef.current[index]; // STAGE 2.7A
      if (!layer?.texture) return;

      const material = mesh.material as THREE.ShaderMaterial;
      if (!material.uniforms) return;

      const texture = layer.texture;

      // animateTexture toggle
      if (material.uniforms.animateTexture) {
        material.uniforms.animateTexture.value = texture.animateTexture ? 1.0 : 0.0;
      }

      // textureAnimationType â€” which motion mode the shader uses
      if (material.uniforms.textureAnimationType) {
        const animType = texture.textureAnimationType || 'drift';
        material.uniforms.textureAnimationType.value =
          animType in textureAnimationTypeMap ? textureAnimationTypeMap[animType] : 4.0;
      }

      // animationSpeed â€” also update the transport so the RAF picks it up instantly
      if (material.uniforms.animationSpeed) {
        material.uniforms.animationSpeed.value = texture.animationSpeed || 50;
      }
    });

    needsRenderRef.current = true;
  }, [texturePropertiesKey, isInitialized]); // runs during playback â€” intentionally no isPlayingRef guard

  // PERFORMANCE FIX: Invalidation-based rendering - only render when state changes
  // Request a render on next frame (throttled)
  const invalidate = useCallback(() => {
    needsRenderRef.current = true;
    
    // Use isPlayingRef.current (always fresh) instead of captured isPlaying (stale closure risk).
    // isPlaying is NOT in the dependency array [effects], so the closure value can be stale
    // when play/pause happens without effects changing â€” causing the RAF to be wrongly
    // skipped (when isPlayingRef=false but stale closure says true) or wrongly fired
    // (when isPlayingRef=true but stale closure says false).
    if (!renderScheduledRef.current && !isPlayingRef.current) {
      renderScheduledRef.current = true;
      requestAnimationFrame(() => {
        renderScheduledRef.current = false;
        
        // Re-read isPlayingRef.current here too â€” by the time the RAF fires,
        // play state may have changed again.
        if (needsRenderRef.current && !isPlayingRef.current) {
          needsRenderRef.current = false;
          
          const renderer = rendererRef.current;
          const scene = sceneRef.current;
          const camera = cameraRef.current;
          const renderTarget = renderTargetRef.current;
          const postProcessScene = postProcessSceneRef.current;
          const postProcessCamera = postProcessCameraRef.current;
          
          if (renderer && scene && camera && renderTarget && postProcessScene && postProcessCamera) {
            const hasEffects = hasActiveEffects(effects);
            
            if (hasEffects) {
              // BUG FIX: renderer.autoClear = false (set at init) means we MUST call
              // renderer.clear() manually before each render pass â€” exactly as the
              // animate loop does.  Without it, when a mask is active the transparent
              // areas outside the mask shape are NOT cleared, so the old palette's
              // content persists in the render target.  The post-process then composites
              // stale pixel data through the effects, making the palette appear unchanged.
              renderer.setRenderTarget(renderTarget);
              renderer.clear();                           // â† required: autoClear = false
              renderer.render(scene, camera);
              // BUG FIX: always refresh tDiffuse before the post-process render.
              // The animate loop does this every frame as a safety guard.  If the
              // render target is ever recreated (e.g. on resize), the effectsMaterial's
              // tDiffuse uniform still points to the OLD texture without this update.
              if (postProcessQuadRef.current?.material) {
                const pm = postProcessQuadRef.current.material as THREE.ShaderMaterial;
                if (pm.uniforms?.tDiffuse) pm.uniforms.tDiffuse.value = renderTarget.texture;
              }
              renderer.setRenderTarget(null);
              renderer.clear();                           // â† required: autoClear = false
              renderer.render(postProcessScene, postProcessCamera);
            } else {
              renderer.setRenderTarget(null);
              renderer.clear();                           // â† required: autoClear = false
              renderer.render(scene, camera);
            }
          }
        }
      });
    }
  // isPlaying removed â€” effects material doesn't need a full refresh on every play/pause.
  // isPlayingRef.current is read directly inside the callback for always-fresh play state.
  }, [effects]);

  // PATCHED v1.85.1 CRIT-04: Merged four separate invalidation/filter effects into one.
  //
  // BEFORE: Four individual effects all calling invalidate() with partially overlapping
  //   deps ([layers, effects, canvasSettings], [maskTextureVersion], [patternTextureVersion],
  //   [effects, isInitialized]) fired independently, causing 2â€“4 invalidate() calls
  //   per state change when mask/pattern textures loaded alongside layer changes.
  //
  // AFTER: One combined effect. React batches all state updates into one commit,
  //   so this fires exactly once per batch regardless of how many deps change together.
  //   The pattern-texture uniform push (which has logic beyond just invalidating) is
  //   preserved inline. The canvas CSS filter clear is merged in too.
  //   Net result: single invalidate() call per React commit instead of 2â€“4.
  // Effect A: Layer/effects/canvas changes → clear CSS artifacts + request render
  // S1 FIX: skip entirely during playback — the RAF loop already renders every frame.
  // Clearing style.filter and calling invalidate() while playing is pure overhead.
  // Static re-renders are only needed when paused (user changed a property at rest).
  useEffect(() => {
    if (!isInitialized) return;
    if (isPlayingRef.current) return; // RAF loop handles rendering during play
    if (rendererRef.current) {
      rendererRef.current.domElement.style.filter = '';
    }
    invalidate();
  }, [layers, effects, canvasSettings, isInitialized, invalidate]);

  // Effect B: Async texture loads → push uniforms + request render.
  // Separate from Effect A so slider drags don't re-evaluate the pattern push logic.
  useEffect(() => {
    if (!isInitialized) return;
    if (patternTextureVersion > 0) {
      meshesRef.current.forEach((mesh, index) => {
        const layer = layersRef.current[index]; // STAGE 2.7A
        if (!layer?.texture || layer.texture.type !== 'shape-pattern') return;
        const material = mesh.material as THREE.ShaderMaterial;
        if (!material?.uniforms) return;
        const patternTexture = patternTexturesRef.current.get(layer.id);
        if (!material.uniforms.uPatternTexture) {
          material.uniforms.uPatternTexture = { value: null };
        }
        material.uniforms.uPatternTexture.value = patternTexture ?? null;
        material.needsUpdate = true;
      });
    }
    invalidate();
  }, [maskTextureVersion, patternTextureVersion, mediaTextureVersion, isInitialized, invalidate]);


  // Performance: Debounce texture updates to once per frame
  const textureUpdateScheduledRef = useRef(false);
  
  // Store base geometry for calculating offsets (performance optimization)
  const baseGeometryCacheRef = useRef<Map<string, THREE.PlaneGeometry>>(new Map());
  
  // PERFORMANCE FIX: Throttle warp mesh updates and use adaptive resolution during drag
  const lastWarpUpdateRef = useRef<number>(0);
  const WARP_THROTTLE_MS = 8; // FIXED: Reduced from 16ms to 8ms for more responsive warping (~120fps)
  const isWarpDraggingRef = useRef(false);
  const originalWarpResolutionRef = useRef<number | null>(null);


  // sensRef: passed to InteractiveControls for future sensitivity control
  const sensRef = useRef<number>(5);

  // FIX: fadeFlowMap was referenced in JSX but never declared — caused ReferenceError
  // crash the moment Interactive Mode was enabled, taking down the entire canvas.
  // Warp Mode is disabled for beta (UI hidden) so this is a graceful stub that fades
  // the displacement flow-map canvas toward neutral grey over ~30 frames.
  const fadeFlowMap = useCallback(() => {
    const canvas = displacementCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    // Blend toward neutral grey (128,128,128) = no displacement
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = 'rgb(127,127,127)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1.0;
    if (displacementTextureRef.current) {
      displacementTextureRef.current.needsUpdate = true;
    }
    invalidate();
  }, [invalidate]);

  // â”€â”€ Interactive Mode: pan (drag) + zoom (wheel) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Drag anywhere â†’ moves gradient center X/Y (pan).
  // Scroll wheel â†’ zoom scale Â±3% per tick.
  // No axis locking, no momentum, no sensitivity math.
  // Simple 1:1 cursor-to-gradient feel â€” same model as Figma/Lightroom move tool.
  // ── Light Flash Effects — shader-based ─────────────────────────────────
  // Flash helpers (hexToRgb01, hslToHex, flashPosToInt, computeFlashState)
  // are module-level functions above the component to avoid stale closures.

    const flashRafRef     = useRef<number>(0);
  const flashTimeRef    = useRef<number>(0);
  const flashBeatRef    = useRef<number>(-1);
  const flashColorRef   = useRef<string>('#ffffff');
  // After-glow: tracks decaying peak opacity between frames
  const flashPeakRef    = useRef<number>(0);

  useEffect(() => {
    if (flashRafRef.current) cancelAnimationFrame(flashRafRef.current);

    // Zero flash uniforms immediately when disabled
    if (!effects.flashEnabled) {
      const mat = effectsMaterialRef.current;
      if (mat?.uniforms?.uFlashOpacity) mat.uniforms.uFlashOpacity.value = 0;
      return;
    }

    let last = performance.now();

    const tick = () => {
      const now = performance.now();
      const dt  = Math.min((now - last) / 1000, 0.05); last = now;

      // Clock source:
      // • Sync mode: use animationMasterTimeRef directly as seconds.
      //   phase = fract(masterTime / cycleSeconds) → 1 flash per cycle.
      //   flashSpeed slider becomes "beats per cycle" (labeled accordingly in UI).
      // • Independent mode: own accumulator, flashSpeed = Hz (beats/sec).
      let t: number;
      if (effects.flashSyncAnimation) {
        const activeLayer = layersRef.current.find(l => l.visible && l.animation?.enabled);
        if (activeLayer?.animation) {
          const cycleSeconds = estimateCycleTime(activeLayer.animation.type, activeLayer.animation.speed || 1) / 1000;
          // Normalize master time into full-cycle counts so phase stays 0-1 per cycle.
          // Multiply by flashSpeed to allow N flashes per cycle.
          t = (animationMasterTimeRef.current / Math.max(0.001, cycleSeconds)) * (effects.flashSpeed ?? 1);
        } else {
          flashTimeRef.current += dt;
          t = flashTimeRef.current;
        }
      } else {
        flashTimeRef.current += dt;
        t = flashTimeRef.current;
      }

      // Get colors from the first visible layer for the 'color' flash type
      const layerColors = layersRef.current.find(l => l.visible)?.gradient?.colors ?? null;

      // computeFlashState is now a module-level pure function — no stale closures
      const state = computeFlashState(effectsRef.current, t, layerColors);

      // After-glow: peak memory with exponential decay
      const afterGlow = effects.flashAfterGlow ?? 0;
      if (afterGlow > 0) {
        flashPeakRef.current = Math.max(state.opacity, flashPeakRef.current * Math.exp(-6 * dt * (1 - afterGlow * 0.9)));
        state.opacity = Math.max(state.opacity, flashPeakRef.current * afterGlow);
      } else {
        flashPeakRef.current = state.opacity;
      }

      // Write to shader uniforms — no DOM, no CSS
      const mat = effectsMaterialRef.current;
      if (mat?.uniforms) {
        mat.uniforms.uFlashOpacity.value    = state.opacity;
        mat.uniforms.uFlashColor.value.set(state.r, state.g, state.b);
        mat.uniforms.uFlashPosition.value   = state.posInt;
        mat.uniforms.uFlashBeatGroup.value  = state.beatGroup;
        mat.uniforms.uFlashBlendMode.value  = state.blendMode;
        // Critical Fix: force the main animate loop to render this frame.
        // Without this, the canvas is frozen when animation is paused because
        // shouldRenderFrame = false and the loop exits early every tick.
        if (state.opacity > 0.001) needsRenderRef.current = true;
      }

      flashBeatRef.current  = Math.floor(t * (effects.flashSpeed ?? 2));
      flashRafRef.current   = requestAnimationFrame(tick);
    };

    flashRafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(flashRafRef.current);
  }, [effects.flashEnabled, effects.flashMode, effects.flashSpeed,
      effects.flashIntensity, effects.flashType, effects.flashEasing,
      effects.flashPosition, effects.flashAfterGlow, effects.flashSyncAnimation, layersRef]);

    const panStartRef = useRef<{
      centerX: number; centerY: number;
      startAngle: number;
      clientX: number; clientY: number;
    } | null>(null);

    // FIX (perf): Cache getBoundingClientRect on pointerdown — reading it on every
    // mousemove forces a browser layout reflow each frame. Invalidated on canvas resize.
    const canvasRectRef = useRef<DOMRect | null>(null);

    // FIX (perf): Brush cursor uses a direct DOM ref instead of useState so the
    // cursor position update never triggers a React re-render of GradientCanvas.
    const brushCursorRef = useRef<HTMLDivElement | null>(null);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactionEnabledRef.current || !rendererRef.current) return;

    // FIX (perf): Update brush cursor via direct DOM ref — zero React re-render.
    // setBrushPosition(setState) was called on every mousemove, triggering a full
    // GradientCanvas re-render each frame even when nothing visible changed.
    if (brushCursorRef.current) {
      brushCursorRef.current.style.left = `${e.clientX}px`;
      brushCursorRef.current.style.top  = `${e.clientY}px`;
    }

    if (!panStartRef.current) return;

    // FIX (perf): Use cached rect from pointerdown — getBoundingClientRect() forces
    // a browser layout reflow on every call, stalling the main thread each frame.
    const rect = canvasRectRef.current ?? rendererRef.current.domElement.getBoundingClientRect();
    const ddx  = (e.clientX - panStartRef.current.clientX) / rect.width;
    const ddy  = (e.clientY - panStartRef.current.clientY) / rect.height;

    const vis = layersRef.current; // STAGE 2.7A

    // ── Shift held: rotate gradient angle ──────────────────────────────────────
    // FIX: Shift+drag rotates gradient angle. Drag down = clockwise (+degrees),
    // drag up = counter-clockwise (−degrees). Full canvas height = 360° range.
    if (e.shiftKey) {
      // ddy positive = drag down = clockwise. Multiply by 360 so a full-height
      // drag sweeps a full rotation. Negate for counter-clockwise on drag up.
      const newAngle = panStartRef.current.startAngle + ddy * 360;

      meshesRef.current.forEach((mesh, idx) => {
        if (vis[idx]?.id !== activeLayerIdRef.current) return;
        const mat = mesh.material as THREE.ShaderMaterial;
        if (!mat.uniforms) return;
        if (mat.uniforms.angle) mat.uniforms.angle.value = newAngle;
      });

      targetInteraction.current = {
        mouseX: 0, mouseY: 0,
        intensity: 1, shiftKey: true, altKey: false,
        currentParameter: `Rotate ${Math.round(((newAngle % 360) + 360) % 360)}°`,
      };
      currentInteraction.current = { ...targetInteraction.current };
      throttledOnInteraction(targetInteraction.current);
      invalidate();
      return; // skip pan logic
    }

    // ── Normal drag: pan gradient center ───────────────────────────────────────
    // FIX (Y inversion): CSS Y grows downward; WebGL UV Y=1 is TOP.
    // Previously: newCY = centerY + ddy → drag down increased centerY → center moved UP.
    // Fix: negate ddy so drag down moves center DOWN to match cursor direction.
    const newCX = Math.max(0, Math.min(1, panStartRef.current.centerX + ddx * 0.8));
    const newCY = Math.max(0, Math.min(1, panStartRef.current.centerY - ddy * 0.8));

    meshesRef.current.forEach((mesh, idx) => {
      if (vis[idx]?.id !== activeLayerIdRef.current) return;
      const mat = mesh.material as THREE.ShaderMaterial;
      if (!mat.uniforms) return;
      if (mat.uniforms.center)  mat.uniforms.center.value.set(newCX, newCY);
      if (mat.uniforms.centerX) mat.uniforms.centerX.value = newCX;
      if (mat.uniforms.centerY) mat.uniforms.centerY.value = newCY;
      if (mat.uniforms.mouseX)  mat.uniforms.mouseX.value  = (newCX - 0.5) * 2;
      if (mat.uniforms.mouseY)  mat.uniforms.mouseY.value  = -(newCY - 0.5) * 2;
      if (mat.uniforms.mouseIntensity) mat.uniforms.mouseIntensity.value = 1;
    });

    targetInteraction.current = {
      mouseX: (newCX - 0.5) * 2, mouseY: -(newCY - 0.5) * 2,
      intensity: 1, shiftKey: false, altKey: false, currentParameter: 'Pan',
    };
    currentInteraction.current = { ...targetInteraction.current };
    throttledOnInteraction(targetInteraction.current);
    invalidate();
  };

  const handlePointerLeave = () => {
    if (!interactionEnabledRef.current) return;
    setIsPointerDown(false);
    // Brush cursor: hide via direct DOM ref (no setState re-render needed)
    if (brushCursorRef.current) brushCursorRef.current.style.display = 'none';
    panStartRef.current = null;
    canvasRectRef.current = null; // invalidate cached rect
    targetInteraction.current.intensity = 0;
    currentInteraction.current.intensity = 0;
    invalidate();
  };
  // Wheel: zoom scale Â±3% per tick (interactive mode only).


  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactionEnabledRef.current || !rendererRef.current) return;
    setIsPointerDown(true);

    // FIX (perf): Show brush cursor via DOM ref — no setState re-render.
    if (brushCursorRef.current) {
      brushCursorRef.current.style.display = 'block';
      brushCursorRef.current.style.left = `${e.clientX}px`;
      brushCursorRef.current.style.top  = `${e.clientY}px`;
    }

    // FIX (perf): Cache rect once on pointerdown so handlePointerMove never
    // calls getBoundingClientRect() (which forces layout reflow each frame).
    canvasRectRef.current = rendererRef.current.domElement.getBoundingClientRect();

    const activeLayer = layersRef.current.find(l => l.id === activeLayerIdRef.current);
    const g = activeLayer?.gradient;

    // Snapshot center AND angle — pan is relative to center at drag start,
    // Shift+rotate is relative to angle at drag start.
    panStartRef.current = {
      centerX: g?.centerX ?? 0.5,
      centerY: g?.centerY ?? 0.5,
      startAngle: g?.angle ?? 0,
      clientX: e.clientX,
      clientY: e.clientY,
    };

    targetInteraction.current = {
      mouseX: 0, mouseY: 0, intensity: 1,
      shiftKey: e.shiftKey, altKey: false,
      currentParameter: e.shiftKey ? 'Rotate' : 'Pan',
    };
    currentInteraction.current = { ...targetInteraction.current };
    throttledOnInteraction(targetInteraction.current);
    invalidate();
  };

  const handlePointerUp = () => {
    if (!interactionEnabledRef.current) return;
    setIsPointerDown(false);
    canvasRectRef.current = null; // invalidate cached rect

    const activeLayer = layersRef.current.find(l => l.id === activeLayerIdRef.current);
    if (activeLayer?.gradient && onUpdateLayer && panStartRef.current) {
      const vis = layersRef.current; // STAGE 2.7A
      const idx = vis.findIndex(l => l.id === activeLayerIdRef.current);
      if (idx !== -1 && meshesRef.current[idx]) {
        const mat = meshesRef.current[idx].material as THREE.ShaderMaterial;

        // Commit center (pan) OR angle (Shift+rotate) depending on what the drag did.
        // We detect by checking whether angle changed from startAngle.
        const finalAngle = mat.uniforms?.angle?.value ?? activeLayer.gradient.angle ?? 0;
        const angleChanged = Math.abs(finalAngle - (panStartRef.current.startAngle)) > 0.01;

        if (angleChanged) {
          // Commit rotated angle — sync layerState so RAF doesn't snap back.
          const state = layerStatesRef.current.get(activeLayerIdRef.current!);
          if (state) {
            layerStatesRef.current.set(activeLayerIdRef.current!, {
              ...state,
              baseAngle: finalAngle,
              currentAngle: finalAngle,
            });
          }
          onUpdateLayer(activeLayerIdRef.current!, {
            gradient: { ...activeLayer.gradient, angle: Math.round(finalAngle) },
          });
        } else {
          // Commit panned center — sync layerState to prevent RAF snap-back.
          const cx = mat.uniforms?.centerX?.value ?? activeLayer.gradient.centerX ?? 0.5;
          const cy = mat.uniforms?.centerY?.value ?? activeLayer.gradient.centerY ?? 0.5;
          const state = layerStatesRef.current.get(activeLayerIdRef.current!);
          if (state) {
            layerStatesRef.current.set(activeLayerIdRef.current!, {
              ...state,
              baseCenterX: cx,
              baseCenterY: cy,
              currentCenterX: cx,
              currentCenterY: cy,
            });
          }
          onUpdateLayer(activeLayerIdRef.current!, {
            gradient: { ...activeLayer.gradient, centerX: cx, centerY: cy },
          });
        }
      }
    }

    panStartRef.current = null;
    targetInteraction.current.intensity = 0;
    currentInteraction.current.intensity = 0;
    invalidate();
  };

  // Wheel: zoom scale Â±3% per tick (interactive mode only).
  // FIX (zoom smoothness): accumulate wheel delta in a ref, apply to GPU uniforms
  // immediately (zero React overhead), commit to React state 200ms after last tick.
  // Old approach: onUpdateLayer on every wheel event → React re-render → visible stutter.
  const wheelAccumRef = useRef(0);
  const wheelCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveScaleRef = useRef<number>(0); // 0 = sentinel (not active)

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!interactionEnabledRef.current) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    const activeLayer = layersRef.current.find(l => l.id === activeLayerIdRef.current);
    if (!activeLayer?.gradient || !onUpdateLayer) return;

    // Start from live scale if mid-scroll, otherwise from layer state
    const baseScale = liveScaleRef.current > 0 ? liveScaleRef.current : (activeLayer.gradient.scale ?? 1);
    const newScale = Math.max(0.05, Math.min(8.0, baseScale + dir * 0.04));
    liveScaleRef.current = newScale;

    // Write directly to GPU uniforms — no React state update, no re-render
    const vis = layersRef.current; // STAGE 2.7A
    meshesRef.current.forEach((mesh, idx) => {
      if (vis[idx]?.id !== activeLayerIdRef.current) return;
      const mat = mesh.material as THREE.ShaderMaterial;
      if (!mat.uniforms) return;
      if (mat.uniforms.scale)  mat.uniforms.scale.value  = newScale * (activeLayer.gradient?.scaleBoost || 1);
      if (mat.uniforms.uScale) mat.uniforms.uScale.value = newScale;
    });
    invalidate();

    // Debounce: commit final scale to React state 200ms after last wheel event
    if (wheelCommitTimerRef.current) clearTimeout(wheelCommitTimerRef.current);
    wheelCommitTimerRef.current = setTimeout(() => {
      const layer = layersRef.current.find(l => l.id === activeLayerIdRef.current);
      if (layer?.gradient && onUpdateLayer) {
        const finalScale = liveScaleRef.current;
        // Sync layerState immediately so RAF doesn’t overwrite with stale base scale
        const st = layerStatesRef.current.get(activeLayerIdRef.current!);
        if (st) layerStatesRef.current.set(activeLayerIdRef.current!, {
          ...st, baseScale: finalScale, currentScale: finalScale,
        });
        onUpdateLayer(activeLayerIdRef.current!, {
          gradient: { ...layer.gradient, scale: finalScale },
        });
      }
      liveScaleRef.current = 0; // reset sentinel
    }, 200);
  }, [activeLayerIdRef, layersRef, meshesRef, onUpdateLayer, interactionEnabledRef, invalidate]);

  const forcePreviewRender = useCallback(() => {
    if (isPlayingRef.current && !isExportingRef.current) return;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const renderTarget = renderTargetRef.current;
    const postProcessScene = postProcessSceneRef.current;
    const postProcessCamera = postProcessCameraRef.current;
    if (!renderer || !scene || !camera || !renderTarget || !postProcessScene || !postProcessCamera) return;
    try {
      renderer.setRenderTarget(renderTarget);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postProcessScene, postProcessCamera);
    } catch {}
  }, [])

;

  const waitForMaskTextures = useCallback(async (timeoutMs = 2500) => {
    const start = performance.now();

    const pendingMasks = () => layersRef.current.filter(layer => {
      const mask = layer.mask;
      if (!layer.visible || !mask || mask.type !== 'image' || !(mask.visible ?? true) || !mask.imageUrl) {
        return false;
      }

      const texture = maskTexturesRef.current.get(layer.id);
      const image = texture?.image as { width?: number; height?: number } | undefined;
      return !image?.width || !image.height;
    });

    while (pendingMasks().length > 0) {
      if (performance.now() - start > timeoutMs) {
        if (import.meta.env?.DEV) console.warn('Timed out waiting for mask textures before render/export');
        break;
      }
      await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
    }
  }, []);

  // Deterministic render function for exports
  // Renders at a specific time value instead of using real-time
  // Optional exportRenderer for isolated high-quality exports
  /**
   * @param opts.seekMedia  Default TRUE (video export: deterministic timeline).
   *   Pass FALSE for a "capture what is on screen right now" render (PNG).
   *
   * STAGE 2.8.1 — ROOT CAUSE OF THE PNG CANVAS JUMP.
   *   seekAll(time) seeks every video to `time % duration`, where `time` is the
   *   MASTER ANIMATION CLOCK — a free-running accumulator that has no relation
   *   to where the video actually is. Pause a 4.6s clip at 2.1s while master
   *   time reads 47.3s and PNG export seeked to 47.3 % 4.6 = 1.1s: a totally
   *   unrelated frame. The canvas visibly jumped to it and that jumped frame is
   *   what got exported.
   *
   *   That behaviour is CORRECT for video export, where the whole point is to
   *   drive a deterministic timeline. It is wrong for a still capture, which
   *   must freeze exactly what the user is looking at. One flag, two honest
   *   modes — rather than making one of them lie.
   */
  const renderAtTime = useCallback(async (
    time: number,
    exportRenderer?: THREE.WebGLRenderer,
    opts?: { seekMedia?: boolean },
  ) => {
    // Mask/texture readiness is an export-session concern, not a per-frame task.
    // Once the persistent cache exists all referenced resources are already bound.
    if (!exportRenderCacheRef.current) {
      await waitForMaskTextures();
    }

    // Phase 2 Animation Certification: snap every subsystem to the configured
    // export frame grid. This prevents tiny caller/codec floating-point differences
    // from producing different shader, mask, audio or texture phases.
    const exportFps = exportTimelineRef.current?.fps ?? 30;
    const deterministicTime = canonicalExportTimeSeconds(time, exportFps);

    // Stage 2E — EXPORT SEEK PROTOCOL: seek every live video layer to
    // (time % duration) and await decoded frames BEFORE rendering, so video
    // exports are frame-exact and deterministic (WebM and MP4 alike).
    // No-op (fast path) when no videos are registered.
    const seekMedia = opts?.seekMedia !== false;
    if (mediaVideoManagerRef.current?.hasVideos() && seekMedia) {
      await mediaVideoManagerRef.current.seekAll(deterministicTime);
      // STAGE 2.7.9 (B): entering export lifts the upload downscale cap, which
      // swaps in full-resolution textures. Rebind them HERE — synchronously,
      // in the same turn as the render — because the export loop runs
      // frame-to-frame without a React tick, so the state-driven rebind would
      // land too late and frame 0 would ship the preview-grade texture.
      rebindManagerTextures();
    } else if (mediaVideoManagerRef.current?.hasVideos()) {
      // STILL-CAPTURE MODE: do not move the playhead. Refresh the texture from
      // the frame already on screen (beginExport lifted the upload cap to full
      // source resolution, so this re-uploads at export quality in place), then
      // rebind synchronously so the capture reads the new texture, not the
      // preview-grade one.
      mediaVideoManagerRef.current.refreshFrames();
      rebindManagerTextures();
    }

    // Use export renderer if provided, otherwise use live renderer.
    // Disable autoClear on the export renderer too â€” we clear explicitly
    // per pass to match the live renderer's behaviour.
    const renderer = exportRenderer || rendererRef.current;
    if (exportRenderer) {
      exportRenderer.autoClear = false;
    }
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const postProcessScene = postProcessSceneRef.current;
    const postProcessCamera = postProcessCameraRef.current;

    if (!renderer || !scene || !camera || !postProcessScene || !postProcessCamera) {
      return;
    }

    // Phase 3 — build the export resource table exactly once. Geometry,
    // materials, textures, gradient programs and uniform objects remain owned by
    // the live renderer; this cache keeps stable references to them for every
    // export frame and avoids repeated map lookups / resource reconstruction.
    if (!exportRenderCacheRef.current) {
      const entries: ExportLayerCacheEntry[] = meshesRef.current.map((mesh: any, index: number) => {
        const layer = layersRef.current[index];
        const material = mesh.material as THREE.ShaderMaterial;
        const maskTexture = layer ? maskTexturesRef.current.get(layer.id) : undefined;
        const maskImage = maskTexture?.image as { width?: number; height?: number } | undefined;
        return {
          layerId: layer?.id ?? `layer-${index}`,
          mesh,
          layer,
          uniforms: (material.uniforms ?? {}) as Record<string, { value: any }>,
          maskTextureWidth: maskImage?.width || 0,
          maskTextureHeight: maskImage?.height || 0,
        };
      }).filter((entry: ExportLayerCacheEntry) => Boolean(entry.layer));

      exportRenderCacheRef.current = createExportRenderCache({
        entries,
        visibleGradientColors: layersRef.current.find((layer: Layer) => layer.visible)?.gradient?.colors ?? null,
        width: renderer.domElement.width || canvasSettings.width,
        height: renderer.domElement.height || canvasSettings.height,
      });
    }

    const exportCache = exportRenderCacheRef.current;
    resizeExportRenderCache(
      exportCache,
      renderer.domElement.width || canvasSettings.width,
      renderer.domElement.height || canvasSettings.height,
    );

    // Compile/link shader programs once at export resolution before frame 0.
    // Later frames mutate cached uniform values only.
    if (!exportCache.shaderWarmupComplete) {
      const compileAsync = (renderer as any).compileAsync as undefined | ((scene: any, camera: any) => Promise<void>);
      if (typeof compileAsync === 'function') {
        await compileAsync.call(renderer, scene, camera);
      } else {
        renderer.compile(scene, camera);
      }
      exportCache.shaderWarmupComplete = true;
    }

    // FIX (export perf): Reuse cached export render target instead of allocating per-frame.
    // Old: new THREE.WebGLRenderTarget() on every renderAtTime call = GPU alloc/dealloc churn.
    // New: allocate once (or when dimensions change), reuse every frame, dispose on export end.
    let exportRenderTarget: THREE.WebGLRenderTarget | null = null;
    const renderTarget = exportRenderer
      ? (() => {
          const w = renderer.domElement.width;
          const h = renderer.domElement.height;
          const cached = exportRTCacheRef.current;
          // Reuse the cached RT if dimensions match; otherwise dispose and reallocate.
          if (cached && cached.width === w && cached.height === h) {
            exportRenderTarget = cached.rt;
          } else {
            // Dimensions changed or first frame — create a new RT and cache it.
            cached?.rt.dispose();
            const rt = new THREE.WebGLRenderTarget(w, h, {
              minFilter: THREE.LinearFilter,
              magFilter: THREE.LinearFilter,
              format: THREE.RGBAFormat,
              colorSpace: THREE.LinearSRGBColorSpace,
            });
            if ((renderer.capabilities as any).isWebGL2) {
              (rt as any).samples = 4;
            }
            exportRTCacheRef.current = { rt, width: w, height: h };
            exportRenderTarget = rt;
          }
          return exportRenderTarget;
        })()
      : renderTargetRef.current;

    // â”€â”€ EFFECTS UNIFORMS: refresh before rendering so post-FX are export-accurate â”€â”€
    // The live animate() loop updates these every frame. Since pauseAnimation() stops
    // the loop before export starts, the last-written values remain in the material.
    // For most exports this is correct. Explicitly refreshing here ensures any
    // effects state change between pause and export start is captured correctly.
    if (effectsMaterialRef.current?.uniforms) {
      const eu = effectsMaterialRef.current.uniforms;
      const ef = effectsRef.current;
      // SPRINT 1 FIX: sync time so film grain and animated dither advance per-frame in
      // video exports. The live animate() loop writes this each frame; renderAtTime must
      // write it too so the effects shader sees the correct export clock, not the frozen
      // live-pause timestamp from when pauseAnimation() was called.
      if (eu.time) eu.time.value = Math.max(0, (exportSnapshotRef.current?.masterTime ?? 0) + deterministicTime);
      // SPRINT 1 FIX: sync resolution to export dimensions so film grain noise frequency,
      // dither pixel density, halftone cell size, chromatic aberration offset, and all
      // other resolution-dependent effects compute at the target export size rather than
      // the preview viewport size. renderer.domElement is already at export size here
      // because setExportSize() is called before every renderAtTime invocation.
      if (eu.resolution) eu.resolution.value.set(renderer.domElement.width, renderer.domElement.height);
      if (eu.blur)               eu.blur.value               = ef.blur;
      if (eu.chromaticAberration)eu.chromaticAberration.value = ef.chromaticAberration;
      if (eu.vignette)           eu.vignette.value            = ef.vignette;
      if (eu.saturation)         eu.saturation.value          = ef.saturation;
      if (eu.brightness)         eu.brightness.value          = ef.brightness;
      if (eu.contrast)           eu.contrast.value            = ef.contrast;
      if (eu.filmGrain)          eu.filmGrain.value           = ef.filmGrain || 0;
      if (eu.filmGrainSize)      eu.filmGrainSize.value       = ef.filmGrainSize || 1;
      if (eu.temperature)        eu.temperature.value         = ef.temperature || 0;
      if (eu.tint)               eu.tint.value                = ef.tint || 0;
      if (eu.posterize)          eu.posterize.value           = ef.posterize || 0;
      if (eu.ditherStrength)     eu.ditherStrength.value      = ef.ditherStrength ?? 65;
      if (eu.ditherScale)        eu.ditherScale.value         = ef.ditherScale ?? 50;
      if (eu.halftone)           eu.halftone.value            = ef.halftone || 0;
      if (eu.halftoneAngle)      eu.halftoneAngle.value       = ef.halftoneAngle || 0;
      if (eu.shapeOverlay)       eu.shapeOverlay.value        = ef.shapeOverlay || 0;
      if (eu.pixelate)           eu.pixelate.value            = ef.pixelate || 0;
      if (eu.posterizeEnabled)   eu.posterizeEnabled.value    = ef.posterizeEnabled || false;
      if (eu.halftoneEnabled)    eu.halftoneEnabled.value     = ef.halftoneEnabled || false;
      if (eu.shapeOverlayEnabled)eu.shapeOverlayEnabled.value = ef.shapeOverlayEnabled || false;
      if (eu.pixelateEnabled)    eu.pixelateEnabled.value     = ef.pixelateEnabled || false;
      if (eu.invert)             eu.invert.value              = ef.invert || false;
      if (eu.fresnelEnabled)     eu.fresnelEnabled.value      = ef.fresnelEnabled || false;
      if (eu.fresnelPower)       eu.fresnelPower.value        = ef.fresnelPower || 2;
      if (eu.fresnelIntensity)   eu.fresnelIntensity.value    = ef.fresnelIntensity || 0.5;
      // Sprint 1.1: Spatial FX chain — pulled forward from the 1.4 export-
      // parity task since it's the same refresh block; without this, an
      // export triggered right after a slider change (before the next RAF
      // tick) could ship stale/default mirror/displace/slice values.
      if (eu.u_chainOrder)       eu.u_chainOrder.value        = spatialChainOrderToShaderInts(ef.spatialChainOrder);
      if (eu.quadMirrorEnabled)  eu.quadMirrorEnabled.value   = ef.quadMirrorEnabled || false;
      if (eu.quadMirrorCenter)   eu.quadMirrorCenter.value.set(ef.quadMirrorCenterX ?? 0.5, ef.quadMirrorCenterY ?? 0.5);
      if (eu.noiseDisplaceEnabled) eu.noiseDisplaceEnabled.value = ef.noiseDisplaceEnabled || false;
      if (eu.noiseDisplaceAmount)  eu.noiseDisplaceAmount.value  = ef.noiseDisplaceAmount ?? 0.1;
      if (eu.noiseDisplaceScale)   eu.noiseDisplaceScale.value   = ef.noiseDisplaceScale ?? 2;
      if (eu.noiseDisplaceSpeed)   eu.noiseDisplaceSpeed.value   = ef.noiseDisplaceSpeed ?? 0.5;
      if (eu.graphicSliceEnabled)  eu.graphicSliceEnabled.value  = ef.graphicSliceEnabled || false;
      if (eu.graphicSliceBands)    eu.graphicSliceBands.value    = ef.graphicSliceBands ?? 16;
      if (eu.graphicSliceAmount)   eu.graphicSliceAmount.value   = ef.graphicSliceAmount ?? 0.08;
      if (eu.graphicSliceRate)     eu.graphicSliceRate.value     = ef.graphicSliceRate ?? 8;
    }

    const targetWidth = renderer.domElement.width || canvasSettings.width;
    const targetHeight = renderer.domElement.height || canvasSettings.height;
    const targetAspect = exportCache.aspect;

    // PHASE 7.3E FOUNDATION FREEZE: deterministic export time is owned by
    // renderAtTime + the configured export timeline. Do not reconnect export
    // frames to requestAnimationFrame, Date.now(), or live preview delta time.
    const exportSnapshot = exportSnapshotRef.current;
    const exportMasterTime = Math.max(0, (exportSnapshot?.masterTime ?? 0) + deterministicTime);
    const exportTextureTimeBase = Math.max(0, exportSnapshot?.textureTime ?? exportMasterTime);
    const loopTimeline = exportTimelineRef.current;
    const exportLoopEnabled = loopTimeline?.loopLockEnabled === true && (loopTimeline.durationMs ?? 0) > 0;
    const exportLoopPhase = exportLoopEnabled
      ? ((deterministicTime / (loopTimeline!.durationMs / 1000)) % 1 + 1) % 1
      : 0;

    animationMasterTimeRef.current = exportMasterTime;

    // ── STAGE 3.1: DETERMINISTIC AUDIO FOR EXPORT ──
    // Advance the audio chain from the BAKED envelope at this frame's exact
    // time, so the rendered video reacts identically every run. dt is derived
    // from the monotonic export timeline; frame 0 uses a nominal 1/30 so the
    // first envelope step is sane rather than huge.
    const configuredFrameDuration = exportTimelineRef.current?.frameDurationSeconds ?? (1 / 30);
    const exportDt = lastExportTimeRef.current < 0
      ? configuredFrameDuration
      : Math.max(0, deterministicTime - lastExportTimeRef.current);
    lastExportTimeRef.current = deterministicTime;
    const exportAudioActive = tickAudioExportFrame(exportMasterTime, exportDt);
    const exportGlobal = getGlobalAudioDeltas();
    const timelineLayerStates: RenderedTimelineLayerState[] = [];

    // Flash FX must be written BEFORE the frame is rendered. Previously the export
    // callback updated flash uniforms while staging the already-rendered frame,
    // producing a one-frame delay and making frame 0 depend on prior preview state.
    const flashEffects = effectsRef.current;
    const flashMaterial = effectsMaterialRef.current;
    if (flashMaterial?.uniforms) {
      const flashBase = exportSnapshot?.flashTime ?? flashTimeRef.current ?? 0;
      const flashState = computeFlashState(
        flashEffects,
        Math.max(0, flashBase + deterministicTime),
        exportCache.visibleGradientColors as any,
      );
      if (flashMaterial.uniforms.uFlashOpacity) flashMaterial.uniforms.uFlashOpacity.value = flashState.opacity;
      if (flashMaterial.uniforms.uFlashColor) flashMaterial.uniforms.uFlashColor.value.set(flashState.r, flashState.g, flashState.b);
      if (flashMaterial.uniforms.uFlashPosition) flashMaterial.uniforms.uFlashPosition.value = flashState.posInt;
      if (flashMaterial.uniforms.uFlashBeatGroup) flashMaterial.uniforms.uFlashBeatGroup.value = flashState.beatGroup;
      if (flashMaterial.uniforms.uFlashBlendMode) flashMaterial.uniforms.uFlashBlendMode.value = flashState.blendMode;
    }

    // Update all layer animations to exact time
    exportCache.entries.forEach(({ mesh, layer, uniforms }) => {
      if (!layer) return;

      // STAGE 3.1: per-layer audio deltas for this export frame (null when
      // nothing is baked/routed, so a non-audio export is unchanged).
      const exAudio = exportAudioActive ? getAudioDeltasForLayer(layer.id) : null;

      // Layer Punch + glitch apply regardless of animation state, same as live.
      if (exAudio) {
        mesh.scale.x = exAudio.layerPunchMul;
        mesh.scale.y = exAudio.layerPunchMul;
        const exMat = mesh.material as unknown as { uniforms?: Record<string, { value: { set(x: number, y: number): void } }> };
        if (exMat?.uniforms?.uAudioGlitch) {
          exMat.uniforms.uAudioGlitch.value.set(exAudio.glitchX, exAudio.glitchY);
        }
      } else {
        mesh.scale.x = 1; mesh.scale.y = 1;
        const exMat = mesh.material as unknown as { uniforms?: Record<string, { value: { set(x: number, y: number): void } }> };
        if (exMat?.uniforms?.uAudioGlitch) exMat.uniforms.uAudioGlitch.value.set(0, 0);
      }

      const layerState = layerStatesRef.current.get(layer.id);
      if (!layerState) return;

      const gradient = layer.gradient;
      if (!gradient) return;

      // Only calculate animation offset if animation is enabled
      if (layer.animation?.enabled) {
        // FIX ping-pong: start export from capturedPhase (snapshotted in pauseAnimation).
        // OLD: exportSignedTime = time * speed â†’ starts at phase 0, different from
        //   wherever the live canvas was â†’ visible snap + wrong-phase motion on frame 0.
        // NEW: exportSignedTime = capturedPhase + time * speed
        //   Frame 0 renders exactly what the canvas showed at pause time.
        //   Subsequent frames advance forward from that phase â†’ seamless continuation.
        const capturedPhase = layerState.capturedPhase ?? layerState.signedPhase ?? 0;
        const capturedSpeed = layerState.capturedSpeed ?? layerState.smoothedSpeed ?? mapLayerAnimationSpeed(layer.animation.speed);
        const capturedTargetSpeed = layerState.capturedTargetSpeed ?? mapLayerAnimationSpeed(layer.animation.speed);
        // Continue both phase and the actual preview speed smoother from the
        // pause boundary. Frame 0 is byte-for-byte the captured preview phase;
        // each later fixed-FPS frame advances using the same time-based smoother
        // as the live RAF path. Audio speed modulation remains integrated per
        // frame, never multiplied against total elapsed time.
        const exSpeedMul = exAudio ? exAudio.speedMul : 1;
        const accum = exportPhaseAccumRef.current;
        const previous = accum.get(layer.id);
        const continued = advanceExportLayerTimeline({
          previous: exAudio ? previous : { phase: capturedPhase, smoothedSpeed: capturedSpeed },
          capturedPhase,
          capturedSpeed,
          targetSpeed: capturedTargetSpeed,
          deltaSeconds: exAudio ? exportDt : deterministicTime,
          speedMultiplier: exSpeedMul,
        });
        const effectiveSpeed = continued.smoothedSpeed;
        const exportSignedTime = continued.phase;
        accum.set(layer.id, continued);
        timelineLayerStates.push({
          layerId: layer.id,
          capturedPhase,
          effectiveSpeed,
          renderedPhase: exportSignedTime,
        });
        const offset = calculateAnimationOffset(
          layer.animation.type,
          exportSignedTime,
          1.0,
          layer.animation.intensity,
          layer.animation.easing || 'linear',
          layer.animation.direction || 'forward',
          layer.animation.loop !== false
        );

        // Apply offsets to base transforms
        const baseIntensity = layer.gradient?.intensity || 1;
        layerState.animationTime = deterministicTime;
        layerState.currentAngle = layerState.baseAngle + offset.angleOffset;
        layerState.currentScale = layerState.baseScale + offset.scaleOffset;
        layerState.currentCenterX = layerState.baseCenterX + offset.xOffset;
        layerState.currentCenterY = layerState.baseCenterY + offset.yOffset;
        layerState.currentIntensity = baseIntensity * offset.intensityMultiplier;
        const newState = layerState;

        // Update shader uniforms
        const material = mesh.material as THREE.ShaderMaterial;
        material.uniforms = uniforms as any;
        if (!material.uniforms) return;

        // Use pre-scaled exportSignedTime â€” consistent with offset calculation above
        if (material.uniforms.time) {
          material.uniforms.time.value = exportSignedTime;
        }
        if (material.uniforms.uCanvasAspect) {
          material.uniforms.uCanvasAspect.value = targetAspect;
        }

        // Update transform uniforms
        // CRITICAL FIX: shader does `angle + uRotation`, so pass base angle and offset separately
        if (material.uniforms.uRotation) {
          material.uniforms.uRotation.value = offset.angleOffset; // Pass ONLY the animation offset
        }
        if (material.uniforms.angle) {
          material.uniforms.angle.value = layerState.baseAngle; // Pass ONLY the base angle
        }
        if (material.uniforms.uScale) {
          material.uniforms.uScale.value = newState.currentScale * (exAudio ? exAudio.gradientScaleMul : 1);
        }
        if (material.uniforms.scale) {
          material.uniforms.scale.value = newState.currentScale * (gradient.scaleBoost ?? 1) * (exAudio ? exAudio.gradientScaleMul : 1);
        }
        if (material.uniforms.center) {
          material.uniforms.center.value.set(newState.currentCenterX, newState.currentCenterY);
        }
        if (material.uniforms.centerX) {
          material.uniforms.centerX.value = newState.currentCenterX;
        }
        if (material.uniforms.centerY) {
          material.uniforms.centerY.value = newState.currentCenterY;
        }
        if (material.uniforms.intensity) {
          material.uniforms.intensity.value = newState.currentIntensity * (exAudio ? exAudio.intensityMul : 1);
        }
        if (material.uniforms.uDriftX) {
          material.uniforms.uDriftX.value = newState.currentCenterX - layerState.baseCenterX;
        }
        if (material.uniforms.uDriftY) {
          material.uniforms.uDriftY.value = newState.currentCenterY - layerState.baseCenterY;
        }
        if (material.uniforms.uPulse) {
          const safeBase = Math.max(0.001, layerState.baseScale);
          material.uniforms.uPulse.value = Math.max(0.01, newState.currentScale / safeBase);
        }
        if (material.uniforms.uHueRotation) {
          if (offset.hueShiftOffset !== undefined && Math.abs(offset.hueShiftOffset) > 0.01) {
            material.uniforms.uHueRotation.value = (((offset.hueShiftOffset + (exAudio ? exAudio.hueAdd : 0)) % 360) + 360) % 360;
          } else {
            material.uniforms.uHueRotation.value = exAudio ? ((exAudio.hueAdd % 360) + 360) % 360 : 0.0;
          }
        }

        // Export uses the same animation authority split as the live preview:
        // JS writes canonical transforms while shader UV-distortion remains enabled
        // only for morphing animation types that need procedural fields.
        if (material.uniforms.uAnimPhase) {
          material.uniforms.uAnimPhase.value = offset.phase01;
        }
        if (material.uniforms.uExportLoopEnabled) {
          material.uniforms.uExportLoopEnabled.value = exportLoopEnabled ? 1.0 : 0.0;
        }
        if (material.uniforms.uExportLoopPhase) {
          material.uniforms.uExportLoopPhase.value = exportLoopPhase;
        }
        if (material.uniforms.uAnimEased) {
          material.uniforms.uAnimEased.value = offset.eased01;
        }
        if (material.uniforms.uAnimTime) {
          material.uniforms.uAnimTime.value = offset.signedTime;
        }
        if (material.uniforms.uAnimIntensity) {
          // STAGE 3.0.1: NO audio boost here, deliberately. This is the EXPORT
          // path. Reading live analyser values during an export would bake
          // real-time, non-deterministic audio into the file — exactly the
          // drift the plan calls out. Deterministic audio-reactive export is
          // 3.0.4's job, via an OfflineAudioContext envelope sampled at the
          // export's own fps. Until then, exports render the base animation and
          // the live preview reacts; that split is intentional, not a gap.
          material.uniforms.uAnimIntensity.value = layer.animation.intensity;
        }
        if (material.uniforms.uAnimType) {
          const shaderAnimTypeMap: Record<string, number> = {
            wave:        1.0,
            morph:       2.0,
            liquid:      2.0,
            vortex:      3.0,
            fractalZoom: 5.0,
            turbulence:  6.0,
            ripple:      7.0,
          };
          material.uniforms.uAnimType.value = shaderAnimTypeMap[layer.animation.type] ?? 0.0;
        }
      }
    });

    // Update texture animation time using the transport-based system for consistency
    // CRITICAL FIX: Sync with the same transport logic used in live preview to ensure
    // texture patterns render identically in exports vs. preview
    textureMasterTimeRef.current = exportTextureTimeBase;
    // Apply dimension- and texture-dependent static uniforms once per cache
    // build/resize. Animated values are still mutated below every frame.
    if (!exportCache.staticUniformsApplied) {
      exportCache.entries.forEach(({ uniforms, maskTextureWidth, maskTextureHeight }) => {
        if (uniforms.uCanvasAspect) uniforms.uCanvasAspect.value = targetAspect;
        if (uniforms.uMaskTexelSize && maskTextureWidth > 0 && maskTextureHeight > 0) {
          uniforms.uMaskTexelSize.value.set(1 / maskTextureWidth, 1 / maskTextureHeight);
        }
      });
      exportCache.staticUniformsApplied = true;
    }

    exportCache.entries.forEach(({ mesh, layer, uniforms }) => {
      const material = mesh.material as THREE.ShaderMaterial;
      material.uniforms = uniforms as any;
      if (!material.uniforms) return;

      // v2.2.5: one deterministic export clock for native/procedural gradient motion.
      // Layer transform animation may overwrite `time` with its signed phase above,
      // but native gradient types (fractal/noise/internal procedural motion) still
      // need a stable export-time value even when layer animation is disabled.
      if (material.uniforms.time && !layer?.animation?.enabled) {
        material.uniforms.time.value = exportMasterTime;
      }
      if (material.uniforms.uTime) {
        material.uniforms.uTime.value = exportMasterTime;
      }
      if (material.uniforms.iTime) {
        material.uniforms.iTime.value = exportMasterTime;
      }

      // Phase 3: canvas aspect and mask texel size are session-cached above.

      // CRITICAL FIX: Use transport-based texture time calculation for export consistency
      // This ensures textures animate at the exact same phase in exports as in preview
      if (material.uniforms?.textureTime) {
        const texSnap = layer ? exportTextureSnapshotRef.current.get(layer.id) : undefined;
        if (texSnap?.active) {
          // Continue from the exact live texture/procedural phase captured at export start.
          // Do not derive from animationMasterTime/export absolute time; that double-counts
          // or remaps procedural motion and makes fractal/native gradients look erratic.
          material.uniforms.textureTime.value = texSnap.base + (deterministicTime * Math.max(0, texSnap.speed));
        } else if (texSnap) {
          material.uniforms.textureTime.value = texSnap.base;
        } else {
          material.uniforms.textureTime.value = material.uniforms.textureTime.value || 0;
        }
      }
    });

    // â”€â”€ MASK ANIMATION IN EXPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Apply mask animations from the captured live clock so exported frames match preview speed/phase.
    // Mirrors the mask animation block in the live animate() loop exactly.
    const exportMaskTime = exportMasterTime;
    exportCache.entries.forEach(({ mesh, layer, uniforms }) => {
      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms = uniforms as typeof mat.uniforms;
      applyMaskAnimation(mat, layer?.mask, exportMaskTime);
    });

    // â”€â”€ EXPORT RENDER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // FIX pixel-accuracy shimmer: render at export dimensions so post-process effects
    // (vignette, chromaticAberration) operate at target resolution, not preview-res
    // scaled up 2x by drawImage. A 2px chromatic fringe at 960p becomes 4px at 1080p â€”
    // visible as a shimmer/flash artifact in exported video. Temporarily resizing and
    // restoring the renderer (no DOM reflow â€” CSS width:100% keeps the box unchanged)
    // ensures effects are pixel-accurate at every export resolution.
    // v2.2.2: isolated export renderers must never use live render targets.
    // THREE render targets belong to the WebGL context that created them; using
    // captureRTRef with an export renderer can corrupt/shift the live preview.
    const captureRT = exportRenderer ? null : captureRTRef.current;
    const liveW = renderer.domElement.width;
    const liveH = renderer.domElement.height;
    const needsResize = (targetWidth !== liveW || targetHeight !== liveH) &&
      targetWidth > 0 && targetHeight > 0;

    if (needsResize) {
      renderer.setSize(targetWidth, targetHeight, false);
      resizeRenderTargets(targetWidth, targetHeight, renderTargetRef.current, captureRT);
      // SPRINT 1 FIX: update effects resolution for this transient export-size render so
      // all resolution-dependent FX (film grain, dither, halftone, chromatic aberration)
      // operate at the correct pixel density during the export frame pass.
      if (effectsMaterialRef.current?.uniforms.resolution) {
        effectsMaterialRef.current.uniforms.resolution.value.set(targetWidth, targetHeight);
      }
    }

    // STAGE 3.1: bake the global audio post-FX (Shake / RGB Split / Brightness /
    // Blur / Saturation / Vignette / Strobe) into the effects material for this
    // export frame, on top of the user's manual effect settings — mirroring the
    // live global write so the exported frame matches the preview.
    if (exportAudioActive && effectsMaterialRef.current?.uniforms) {
      const eu = effectsMaterialRef.current.uniforms;
      const base = effectsRef.current;
      if (eu.chromaticAberration) eu.chromaticAberration.value = base.chromaticAberration + exportGlobal.chromaAdd;
      if (eu.brightness) eu.brightness.value = base.brightness + exportGlobal.brightnessAdd + exportGlobal.strobeAdd;
      if (eu.blur) eu.blur.value = base.blur + exportGlobal.blurAdd;
      if (eu.saturation) eu.saturation.value = base.saturation + exportGlobal.saturationAdd;
      if (eu.vignette) eu.vignette.value = base.vignette + exportGlobal.vignetteAdd;
      if (eu.uShake) eu.uShake.value.set(exportGlobal.shakeX, exportGlobal.shakeY);
    }

    // Use the same render-graph authority as the live RAF path. Previously the
    // mere existence of renderTarget forced every export through post-process,
    // even when preview used the single-pass scene path.
    const exportUsesPostProcess = shouldUsePostProcess(effectsRef.current, exportGlobal);

    if (renderTarget && exportUsesPostProcess) {
      renderer.setRenderTarget(renderTarget);
      renderer.clear();
      renderer.render(scene, camera);
      if (postProcessQuadRef.current?.material) {
        const pm = postProcessQuadRef.current.material as THREE.ShaderMaterial;
        if (pm.uniforms?.tDiffuse) pm.uniforms.tDiffuse.value = renderTarget.texture;
      }
      if (captureRT) {
        renderer.setRenderTarget(captureRT);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
      }
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(postProcessScene, postProcessCamera);
    } else {
      if (captureRT) {
        renderer.setRenderTarget(captureRT);
        renderer.clear();
        renderer.render(scene, camera);
      }
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(scene, camera);
    }

    if (needsResize) {
      renderer.setSize(liveW, liveH, false);
      resizeRenderTargets(liveW, liveH, renderTargetRef.current, captureRT);
      // SPRINT 1 FIX: restore effects resolution to live preview size after the export
      // frame pass so subsequent live-preview renders use the correct viewport density.
      if (effectsMaterialRef.current?.uniforms.resolution) {
        effectsMaterialRef.current.uniforms.resolution.value.set(liveW, liveH);
      }
    }

    // NOTE: exportRenderTarget is NO LONGER disposed here — it is cached in exportRTCacheRef
    // and reused across all frames in the same export session. The cache is disposed by
    // restoreSize() (called at export end) and by the renderer initialization cleanup effect.
    // Only dispose here if we somehow got an RT that isn't in the cache (error path).
    if (exportRenderTarget && exportRTCacheRef.current?.rt !== exportRenderTarget) {
      exportRenderTarget.dispose();
    }

    const timelineState: RenderedTimelineFrameState = {
      renderedDeterministicTime: deterministicTime,
      layers: timelineLayerStates,
      motion: exportCache.entries.map(({ layer, uniforms }) => ({
        layerId: layer.id,
        maskRotation: uniforms.uMaskRotation?.value ?? null,
        maskScale: uniforms.uMaskScale?.value ?? null,
        maskOpacity: uniforms.uMaskOpacity?.value ?? null,
        maskOffset: uniforms.uMaskOffset?.value
          ? [uniforms.uMaskOffset.value.x, uniforms.uMaskOffset.value.y] as [number, number] : null,
        textureTime: uniforms.textureTime?.value ?? null,
        mediaTime: mediaVideoManagerRef.current?.getExportTime(layer.id) ?? null,
        configuredLayerSpeed: layer.animation?.speed ?? null,
        configuredMaskSpeed: layer.mask?.animation?.speed ?? null,
        configuredTextureSpeed: layer.texture?.animationSpeed ?? null,
        configuredMediaSpeed: layer.media?.playbackRate ?? null,
      })),
    };
    return timelineState;
  }, [canvasSettings.height, canvasSettings.width, effects, waitForMaskTextures, rebindManagerTextures]);

  // ============================================================
  // EXPORT API - Used by ExportPanel and App.tsx for high-quality exports
  // Uses LIVE renderer (same WebGL context = GPU resources shared correctly)
  // ============================================================

  /** Export sizing is now isolated from the live preview renderer.
   *  Keep this API as a no-op for backward compatibility with callers.
   */
  // Saved preview dimensions for restoring after export
  const previewSizeRef = useRef<{ logicalW: number; logicalH: number; pixelRatio: number; cssWidth: string; cssHeight: string } | null>(null);

  const setExportSize = useCallback((exportWidth: number, exportHeight: number) => {
    // v2.2.3 corrective safety path:
    // Export renders at exact output dimensions using the live WebGL context so all
    // masks/textures/shader resources are guaranteed available. We snapshot the
    // preview buffer once, resize only the drawing buffer for capture, then restore
    // immediately after export. CSS layout is not changed, so the UI box does not jump.
    const renderer = rendererRef.current;
    if (!renderer) return;

    const w = Math.max(2, Math.round(exportWidth));
    const h = Math.max(2, Math.round(exportHeight));
    if (!previewSizeRef.current) {
      const canvas = renderer.domElement;
      const logical = renderer.getSize(new THREE.Vector2());
      previewSizeRef.current = {
        logicalW: Math.max(2, logical.x || canvasSettings.width),
        logicalH: Math.max(2, logical.y || canvasSettings.height),
        pixelRatio: renderer.getPixelRatio(),
        cssWidth: canvas.style.width,
        cssHeight: canvas.style.height,
      };
    }

    renderer.domElement.style.transition = '';
    renderer.domElement.style.opacity = '1';
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    resizeRenderTargets(w, h, renderTargetRef.current, captureRTRef.current);
    // SPRINT 1 FIX: keep effects resolution uniform in sync with the export renderer size.
    // This is the primary update point — setExportSize is called once before each export
    // session, sizing the renderer from preview to export dimensions. Without this, every
    // resolution-dependent effect (film grain noise density, dither pixel pitch, halftone
    // cell size, chromatic aberration offset) computes at preview size even in 4K exports.
    if (effectsMaterialRef.current?.uniforms.resolution) {
      effectsMaterialRef.current.uniforms.resolution.value.set(w, h);
    }
    needsRenderRef.current = true;
  }, [canvasSettings.height, canvasSettings.width]);

  const restoreSize = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const saved = previewSizeRef.current;
    if (saved) {
      renderer.setPixelRatio(saved.pixelRatio);
      renderer.setSize(saved.logicalW, saved.logicalH, false);
      renderer.domElement.style.width = saved.cssWidth || '100%';
      renderer.domElement.style.height = saved.cssHeight || '100%';
      const drawW = Math.max(2, renderer.domElement.width);
      const drawH = Math.max(2, renderer.domElement.height);
      resizeRenderTargets(drawW, drawH, renderTargetRef.current, captureRTRef.current);
      // SPRINT 1 FIX: restore effects resolution to preview size after export so the live
      // canvas renders film grain, dither, halftone, and chromatic aberration at the
      // correct density for the preview viewport — not the export resolution.
      if (effectsMaterialRef.current?.uniforms.resolution) {
        effectsMaterialRef.current.uniforms.resolution.value.set(drawW, drawH);
      }
      previewSizeRef.current = null;
    }
    // FIX (export perf): Dispose the cached export RT when export ends.
    // The RT was held at export dimensions (e.g. 1920×1080) during the export session.
    // After restoreSize(), the renderer is back at preview size — the old export RT is
    // no longer valid. Disposing it here frees the VRAM immediately.
    if (exportRTCacheRef.current) {
      exportRTCacheRef.current.rt.dispose();
      exportRTCacheRef.current = null;
    }
    renderer.domElement.style.transition = '';
    renderer.domElement.style.opacity = '1';
    needsRenderRef.current = true;
    forcePreviewRender();
  }, [forcePreviewRender]);

  // Resize renderer + render target when canvas dimensions change.
  // Both must be updated together to keep the post-process chain aligned.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const displayPixelRatio = renderer.getPixelRatio();
    const w = canvasSettings.width;
    const h = canvasSettings.height;

    renderer.setSize(w, h, false);
    renderer.domElement.style.width  = '100%';
    renderer.domElement.style.height = '100%';

    // Rebuild the offscreen RT at the new drawing-buffer size so the
    // post-process pass samples at the correct resolution.
    if (renderTargetRef.current) {
      const newW = Math.round(w * displayPixelRatio);
      const newH = Math.round(h * displayPixelRatio);
      renderTargetRef.current.setSize(newW, newH);
    }
    needsRenderRef.current = true;
  }, [canvasSettings.width, canvasSettings.height]);

  /** Pause the animation loop before export to prevent RAF conflicts */
  const pauseAnimation = useCallback((options?: { resetExportPhase?: boolean }) => {
    isExportingRef.current = true;
    // Stage 2E: suspend live video playback — the export seek protocol owns
    // video currentTime for the duration of the export.
    mediaVideoManagerRef.current?.beginExport(options?.resetExportPhase ?? false);
    previewLastFrameTimeRef.current = performance.now();
    if (isPlayingRef.current && animationPlayStartRef.current != null) {
      // The RAF loop has already accumulated this interval. Capture the last
      // visible phase, without adding the playback interval a second time.
      animationPlayStartRef.current = null;
    }
    // FIX ping-pong: snapshot each layer's current signedPhase so renderAtTime
    // can start the export from the exact phase the canvas was at.
    // Without this, renderAtTime starts at t=0 which is a different phase position
    // than the live canvas, causing a visible snap on frame 0 of the export.
    const layerById = new Map(layersRef.current.map(layer => [layer.id, layer]));
    layerStatesRef.current.forEach((state, layerId) => {
      const layer = layerById.get(layerId);
      state.capturedPhase = options?.resetExportPhase ? 0 : (state.signedPhase ?? 0);
      // Preserve the speed the visible preview is actually using at this exact
      // boundary. The committed slider value is a target, not the current
      // rendered speed while smoothing is in flight.
      const targetSpeed = mapLayerAnimationSpeed(layer?.animation?.speed);
      state.capturedSpeed = state.smoothedSpeed ?? targetSpeed;
      state.capturedTargetSpeed = targetSpeed;
    });

    exportTextureSnapshotRef.current.clear();
    layersRef.current.forEach(layer => {
      const transport = textureTransportRef.current.get(layer.id);
      const base = options?.resetExportPhase ? 0 : (transport?.accumulated ?? 0);
      const speed = mapTextureAnimationSpeed(layer.texture?.animationSpeed);
      exportTextureSnapshotRef.current.set(layer.id, {
        base,
        speed,
        active: !!layer.texture?.animateTexture,
      });
    });
    const renderer = rendererRef.current;
    exportSnapshotRef.current = {
      masterTime: options?.resetExportPhase ? 0 : animationMasterTimeRef.current,
      textureTime: options?.resetExportPhase ? 0 : textureOnlyTimeRef.current,
      flashTime: options?.resetExportPhase ? 0 : flashTimeRef.current,
      rendererWidth: renderer?.domElement.width ?? canvasSettings.width,
      rendererHeight: renderer?.domElement.height ?? canvasSettings.height,
      pixelRatio: renderer?.getPixelRatio?.() ?? 1,
      cssWidth: renderer?.domElement.style.width ?? '',
      cssHeight: renderer?.domElement.style.height ?? '',
      logicalWidth: renderer ? renderer.getSize(new THREE.Vector2()).x : canvasSettings.width,
      logicalHeight: renderer ? renderer.getSize(new THREE.Vector2()).y : canvasSettings.height,
      wasPlaying: isPlayingRef.current,
      accumulatedTime: animationAccumulatedTimeRef.current,
      cameraPosition: cameraRef.current ? [cameraRef.current.position.x, cameraRef.current.position.y, cameraRef.current.position.z] : [0, 0, 1],
      cameraZoom: cameraRef.current?.zoom ?? 1,
      viewport: renderer ? (() => { const v = renderer.getViewport(new THREE.Vector4()); return [v.x, v.y, v.z, v.w] as [number, number, number, number]; })() : [0, 0, canvasSettings.width, canvasSettings.height],
      scissor: renderer ? (() => { const v = renderer.getScissor(new THREE.Vector4()); return [v.x, v.y, v.z, v.w] as [number, number, number, number]; })() : [0, 0, canvasSettings.width, canvasSettings.height],
      scissorTest: renderer?.getScissorTest?.() ?? false,
    };
  }, [canvasSettings.height, canvasSettings.width]);

  /** Resume the animation loop after export completes */
  const resumeAnimation = useCallback(() => {
    isExportingRef.current = false;
    // Stage 2E: restore live video playback state after export.
    mediaVideoManagerRef.current?.endExport();
    const now = performance.now();
    previewLastFrameTimeRef.current = now;
    lastFrameTimeRef.current = now; // Reset frame time to prevent delta spike

    // If animation is playing, re-anchor the play start time
    if (isPlayingRef.current && animationPlayStartRef.current == null) {
      animationPlayStartRef.current = now;
    }

    const snapshot = exportSnapshotRef.current;
    if (snapshot) {
      animationAccumulatedTimeRef.current = snapshot.accumulatedTime;
      animationMasterTimeRef.current = snapshot.masterTime;
      textureOnlyTimeRef.current = snapshot.textureTime;
      textureMasterTimeRef.current = snapshot.textureTime;
      flashTimeRef.current = snapshot.flashTime;
    }
    layerStatesRef.current.forEach((state, layerId) => {
      const layer = layersRef.current.find(l => l.id === layerId);
      const capturedSpeed = state.capturedSpeed;
      state.signedPhase = state.capturedPhase ?? state.signedPhase ?? 0;
      state.capturedPhase = undefined;
      state.capturedSpeed = undefined;
      state.capturedTargetSpeed = undefined;
      // Resume from the exact pre-export smoother value. The normal live path
      // continues toward the committed target without a visible post-export snap.
      state.smoothedSpeed = capturedSpeed ?? mapLayerAnimationSpeed(layer?.animation?.speed);
    });
    exportSnapshotRef.current = null;
    exportTextureSnapshotRef.current.clear();
    exportTimelineRef.current = null;
    // Force a render to ensure the canvas updates
    needsRenderRef.current = true;
    renderScheduledRef.current = false;
    smoothedDeltaRef.current = 0.01667; // Reset EMA to 60fps baseline
    forcePreviewRender();
  }, [forcePreviewRender]);


  const cleanupExportSession = useCallback(async () => {
    const snapshot = exportSnapshotRef.current;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const report = await runExportCleanup([
      { step: 'renderer', run: () => { renderer?.setRenderTarget(null); renderer?.state?.reset?.(); } },
      { step: 'clock', run: () => { lastFrameTimeRef.current = performance.now(); previewLastFrameTimeRef.current = performance.now(); smoothedDeltaRef.current = 0.01667; } },
      { step: 'timeline', run: () => { invalidateExportRenderCache(exportRenderCacheRef.current); exportRenderCacheRef.current = null; exportTimelineRef.current = null; lastExportTimeRef.current = -1; exportPhaseAccumRef.current.clear(); } },
      { step: 'camera', run: () => { if (snapshot && camera) { camera.position.set(...snapshot.cameraPosition); camera.zoom = snapshot.cameraZoom; camera.updateProjectionMatrix(); } } },
      { step: 'animation-phase', run: () => { exportTextureSnapshotRef.current.clear(); } },
      { step: 'canvas-size', run: () => { restoreSize(); } },
      { step: 'viewport', run: () => { if (snapshot && renderer) { renderer.setViewport(...snapshot.viewport); renderer.setScissor(...snapshot.scissor); renderer.setScissorTest(snapshot.scissorTest); } } },
      { step: 'texture-bindings', run: () => { renderer?.setRenderTarget(null); renderer?.resetState?.(); } },
      { step: 'temporary-buffers', run: () => { renderer?.info?.reset?.(); } },
      { step: 'encoder', run: () => { /* encoder ownership lives in exportUtils finally */ } },
      { step: 'memory-pool', run: () => { if (exportRTCacheRef.current) { exportRTCacheRef.current.rt.dispose(); exportRTCacheRef.current = null; } } },
      // Resume only after the preview buffer, viewport and camera are restored.
      // Resuming earlier scheduled one visible RAF at export dimensions, which
      // caused the center canvas to jump/shrink after download handoff.
      { step: 'play-state', run: () => { resumeAnimation(); } },
    ]);
    try { (window as any).__blendcraftExportCleanup = report; } catch {}
    attachLatestExportCleanup(report);
    if (!report.completed) console.warn('[Export cleanup] One or more cleanup steps failed', report);
    needsRenderRef.current = true;
    forcePreviewRender();
  }, [forcePreviewRender, restoreSize, resumeAnimation]);

  // Sprint 2: Flash is now baked into the WebGL effects shader via uniforms.
  // getExportFlashOverlay computes flash state for the export time and sets the
  // shader uniforms directly — so the correct flash state is captured by readFramePixels.
  // Returns null so exportUtils does NOT apply a CSS overlay on the staging canvas.
  const getExportFlashOverlay = useCallback((time: number): { opacity: number; color: string; position: string } | null => {
    const ef = effectsRef.current;
    if (!ef.flashEnabled) {
      if (effectsMaterialRef.current?.uniforms?.uFlashOpacity) {
        effectsMaterialRef.current.uniforms.uFlashOpacity.value = 0;
      }
      return null;
    }
    const snapshot = exportSnapshotRef.current;
    const t = Math.max(0, (snapshot?.flashTime ?? flashTimeRef.current ?? 0) + time);
    const layerColors = layersRef.current.find(l => l.visible)?.gradient?.colors ?? null;
    const state = computeFlashState(ef, t, layerColors);
    const mat = effectsMaterialRef.current;
    if (mat?.uniforms) {
      mat.uniforms.uFlashOpacity.value   = state.opacity;
      mat.uniforms.uFlashColor.value.set(state.r, state.g, state.b);
      mat.uniforms.uFlashPosition.value  = state.posInt;
      mat.uniforms.uFlashBeatGroup.value = state.beatGroup;
      mat.uniforms.uFlashBlendMode.value = state.blendMode;
    }
    return null; // Flash is in the shader; no CSS overlay needed on staging canvas
  }, []);

  // Expose render API when component is ready
  useEffect(() => {
    if (isInitialized && renderApiRef && rendererRef.current) {
      renderApiRef.current = { 
        renderAtTime,
        // STAGE 3.1: bake the audio envelope before a video export so every
        // frame samples a deterministic table rather than the live analyser.
        // Returns a short status string for the export UI, or null when no audio
        // is loaded (export then renders base animation, as before).
        prepareAudioExport: async () => {
          lastExportTimeRef.current = -1;
          exportPhaseAccumRef.current.clear();
          const buffer = getDecodedAudioBuffer();
          if (!buffer) { clearBakedEnvelope(); return null; }
          await bakeEnvelope(buffer);
          const info = getBakedInfo();
          return info ? `Envelope baked · ${info.analyzedSeconds.toFixed(1)}s analyzed` : null;
        },
        // Clear the baked table + restore live reactivity after export.
        finishAudioExport: () => {
          clearBakedEnvelope();
          lastExportTimeRef.current = -1;
          exportPhaseAccumRef.current.clear();
        },
        getCanvas: () => rendererRef.current?.domElement || null,
        waitForMaskTextures,
        setExportSize,
        restoreSize,
        pauseAnimation,
        resumeAnimation,
        cleanupExportSession,
        getCurrentTime: () => animationMasterTimeRef.current,
        configureExportTimeline: ({ fps, totalFrames, durationMs, loopLockEnabled = false }) => {
          invalidateExportRenderCache(exportRenderCacheRef.current);
          exportRenderCacheRef.current = null;
          const safeFps = Math.max(1, fps);
          exportTimelineRef.current = {
            fps: safeFps,
            totalFrames: Math.max(1, Math.round(totalFrames)),
            durationMs: Math.max(0, durationMs),
            frameDurationSeconds: 1 / safeFps,
            loopLockEnabled,
          };
          lastExportTimeRef.current = -1;
          exportPhaseAccumRef.current.clear();
        },
        clearExportTimeline: () => {
          invalidateExportRenderCache(exportRenderCacheRef.current);
          exportRenderCacheRef.current = null;
          exportTimelineRef.current = null;
          lastExportTimeRef.current = -1;
          exportPhaseAccumRef.current.clear();
        },
        getExportFlashOverlay,
        // Read the current frame from the live RT as raw RGBA pixels.
        // The RT is a GPU-side FBO â€” always readable regardless of preserveDrawingBuffer.
        // This is the ONLY reliable way to capture frames when preserveDrawingBuffer=false.
        // Read the final composited, post-processed frame from captureRT.
        // captureRT holds the screen-accurate output (post-effects, sRGB composite).
        // Using this instead of the scene RT ensures exported PNG/video colors
        // exactly match what the user sees on the canvas.
        readFramePixels: (): { data: Uint8Array; width: number; height: number } | null => {
          const renderer = rendererRef.current;
          const rt = captureRTRef.current || renderTargetRef.current;
          if (!renderer || !rt) return null;
          const w = rt.width;
          const h = rt.height;
          const byteCount = w * h * 4;
          // SPRINT 3 FIX: reuse the staging buffer when dimensions match to eliminate
          // per-frame heap allocations. 33MB/frame at 4K × 300 frames = ~10GB of GC
          // pressure without this. Buffer is reallocated only when export dimensions change.
          // Safe to reuse because drawFrameToStagingCanvas consumes the data synchronously
          // (putImageData → VideoFrame(stagingCanvas)) before the next frame's readback.
          if (!_readbackBufRef.current || _readbackBufByteCount.current !== byteCount) {
            _readbackBufRef.current = new Uint8Array(byteCount);
            _readbackBufByteCount.current = byteCount;
          }
          renderer.readRenderTargetPixels(rt, 0, 0, w, h, _readbackBufRef.current);
          return { data: _readbackBufRef.current, width: w, height: h };
        },
      };
    }
  }, [isInitialized, renderApiRef, renderAtTime, waitForMaskTextures, setExportSize, restoreSize, pauseAnimation, resumeAnimation, cleanupExportSession, getExportFlashOverlay]);

  return (
    <div
      // ── STAGE 2.9.2: TRANSPARENT WORKSPACE WRAPPER ──
      //
      // This element is 100%×100% of the canvas area — a positioning and
      // centering wrapper, NOT the artwork. It carried `bg-black`, so it
      // painted an opaque sheet across the entire workspace and occluded the
      // dotted backdrop grid everywhere except `main`'s 4px padding (the thin
      // band of dots that WAS visible). The black read as "the canvas" but was
      // really just wrapper fill.
      //
      // `bg-black`, `rounded-lg` and `shadow-2xl` have moved DOWN to the
      // aspect-fit container below, which is the element whose box actually
      // equals the artwork. Rounding and shadowing a full-bleed wrapper was
      // never doing what it looked like it was doing — the corners it rounded
      // were the workspace corners, not the canvas corners.
      className="relative overflow-hidden flex items-center justify-center"
      style={{
        width: '100%',
        height: '100%',
        background: 'transparent',
      }}
    >
      {/* SVG Filters */}
      <svg className="absolute w-0 h-0" style={{ position: 'absolute', pointerEvents: 'none' }}>
        <defs>
          {/* Chromatic Aberration Filter */}
          <filter id="chromatic-aberration" x="-50%" y="-50%" width="200%" height="200%">
            {/* Red channel - shift left */}
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="1 0 0 0 0
                      0 0 0 0 0
                      0 0 0 0 0
                      0 0 0 1 0"
              result="red"
            />
            <feOffset in="red" dx={-effects.chromaticAberration * 0.5} dy="0" result="red-offset" />
            
            {/* Green channel - no shift */}
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0 0 0 0 0
                      0 1 0 0 0
                      0 0 0 0 0
                      0 0 0 1 0"
              result="green"
            />
            
            {/* Blue channel - shift right */}
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0 0 0 0 0
                      0 0 0 0 0
                      0 0 1 0 0
                      0 0 0 1 0"
              result="blue"
            />
            <feOffset in="blue" dx={effects.chromaticAberration * 0.5} dy="0" result="blue-offset" />
            
            {/* Blend all channels */}
            <feBlend mode="screen" in="red-offset" in2="green" result="temp" />
            <feBlend mode="screen" in="temp" in2="blue-offset" />
          </filter>

          {/* Film Grain Filter */}
          <filter id="film-grain" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency={0.5 + (effects.filmGrainSize || 1) * 2}
              numOctaves="4"
              result="noise"
            />
            <feColorMatrix
              in="noise"
              type="saturate"
              values="0"
              result="desaturatedNoise"
            />
            <feComponentTransfer in="desaturatedNoise" result="grainMap">
              <feFuncA type="table" tableValues={`0 ${effects.filmGrain || 0}`} />
            </feComponentTransfer>
            <feBlend mode="multiply" in="SourceGraphic" in2="grainMap" result="withGrain" />
            <feBlend mode="screen" in="withGrain" in2="grainMap" />
          </filter>

          {/* Temperature Filter (Cool to Warm) */}
          <filter id="temperature-filter" x="0%" y="0%" width="100%" height="100%">
            <feColorMatrix
              type="matrix"
              values={`
                ${1 + (effects.temperature || 0) * 0.003} 0 0 0 ${(effects.temperature || 0) * 0.001}
                0 1 0 0 0
                0 0 ${1 - (effects.temperature || 0) * 0.003} 0 ${-(effects.temperature || 0) * 0.001}
                0 0 0 1 0
              `}
            />
          </filter>

          {/* Tint Filter (Magenta to Green) */}
          <filter id="tint-filter" x="0%" y="0%" width="100%" height="100%">
            <feColorMatrix
              type="matrix"
              values={`
                ${1 - (effects.tint || 0) * 0.001} 0 0 0 ${-(effects.tint || 0) * 0.001}
                0 1 0 0 ${(effects.tint || 0) * 0.002}
                0 0 ${1 - (effects.tint || 0) * 0.001} 0 ${-(effects.tint || 0) * 0.001}
                0 0 0 1 0
              `}
            />
          </filter>

          {/* Posterize Filter */}
          <filter id="posterize-filter" x="0%" y="0%" width="100%" height="100%">
            <feComponentTransfer>
              <feFuncR type="discrete" tableValues={Array.from({ length: Math.max(2, Math.round(effects.posterize || 2)) }, (_, i) => i / (Math.max(2, Math.round(effects.posterize || 2)) - 1)).join(' ')} />
              <feFuncG type="discrete" tableValues={Array.from({ length: Math.max(2, Math.round(effects.posterize || 2)) }, (_, i) => i / (Math.max(2, Math.round(effects.posterize || 2)) - 1)).join(' ')} />
              <feFuncB type="discrete" tableValues={Array.from({ length: Math.max(2, Math.round(effects.posterize || 2)) }, (_, i) => i / (Math.max(2, Math.round(effects.posterize || 2)) - 1)).join(' ')} />
            </feComponentTransfer>
          </filter>

          {/* Dithering Filter (Proper Ordered Dithering) */}
          <filter id="dithering-filter" x="0%" y="0%" width="100%" height="100%">
            {/* Reduce to just 3 colors per channel for extreme dithering */}
            <feComponentTransfer in="SourceGraphic" result="posterized">
              <feFuncR type="discrete" tableValues="0 0.5 1" />
              <feFuncG type="discrete" tableValues="0 0.5 1" />
              <feFuncB type="discrete" tableValues="0 0.5 1" />
            </feComponentTransfer>
            
            {/* Create very strong ordered pattern */}
            <feTurbulence
              type="turbulence"
              baseFrequency={0.8}
              numOctaves="1"
              seed="123"
              result="ditherNoise"
            />
            
            {/* Convert to monochrome */}
            <feColorMatrix
              in="ditherNoise"
              type="saturate"
              values="0"
              result="monoNoise"
            />
            
            {/* Create extreme black/white threshold */}
            <feComponentTransfer in="monoNoise" result="ditherMask">
              <feFuncR type="discrete" tableValues="0 1" />
              <feFuncG type="discrete" tableValues="0 1" />
              <feFuncB type="discrete" tableValues="0 1" />
            </feComponentTransfer>
            
            {/* Apply dither mask very aggressively */}
            <feComposite 
              in="posterized" 
              in2="ditherMask" 
              operator="arithmetic"
              k1="0.5"
              k2="0.5"
              k3="0"
              k4="-0.25"
              result="dithered"
            />
            
            {/* Apply final extreme posterization */}
            <feComponentTransfer in="dithered" result="final">
              <feFuncR type="discrete" tableValues="0 0.33 0.67 1" />
              <feFuncG type="discrete" tableValues="0 0.33 0.67 1" />
              <feFuncB type="discrete" tableValues="0 0.33 0.67 1" />
            </feComponentTransfer>
            
            {/* Blend with original based on intensity */}
            <feBlend 
              in="final" 
              in2="SourceGraphic" 
              mode="normal"
              result="blended"
            />
            <feComposite 
              in="blended" 
              in2="SourceGraphic" 
              operator="arithmetic"
              k1="0"
              k2={(effects.ditherStrength || 0) * 0.01}
              k3={1 - (effects.ditherStrength || 0) * 0.01}
              k4="0"
            />
          </filter>

          {/* Halftone Filter */}
          <filter id="halftone-filter" x="0%" y="0%" width="100%" height="100%">
            {/* Convert to grayscale and get luminance */}
            <feColorMatrix
              in="SourceGraphic"
              type="luminanceToAlpha"
              result="luminance"
            />
            
            {/* Create dot pattern based on size */}
            <feTurbulence
              type="turbulence"
              baseFrequency={0.8 / Math.max(1, effects.halftone || 1)}
              numOctaves="2"
              seed="5"
              result="dots"
            />
            
            {/* Make it grayscale */}
            <feColorMatrix
              in="dots"
              type="saturate"
              values="0"
              result="grayDots"
            />
            
            {/* Threshold to create dots */}
            <feComponentTransfer in="grayDots" result="hardDots">
              <feFuncR type="discrete" tableValues="0 0 1 1" />
              <feFuncG type="discrete" tableValues="0 0 1 1" />
              <feFuncB type="discrete" tableValues="0 0 1 1" />
            </feComponentTransfer>
            
            {/* Composite with luminance */}
            <feComposite in="hardDots" in2="luminance" operator="in" result="halftoned" />
            
            {/* Blend with original */}
            <feBlend in="SourceGraphic" in2="halftoned" mode="multiply" />
          </filter>

          {/* Pixelate Filter */}
          <filter id="pixelate-filter" x="0%" y="0%" width="100%" height="100%">
            {/* Create pixelation by downscaling and upscaling with morphology */}
            <feMorphology
              in="SourceGraphic"
              operator="dilate"
              radius={effects.pixelate || 1}
              result="pixelated"
            />
            <feGaussianBlur
              in="pixelated"
              stdDeviation={(effects.pixelate || 1) * 0.3}
              result="blurred"
            />
            <feComponentTransfer in="blurred">
              <feFuncR type="discrete" tableValues="0 0.125 0.25 0.375 0.5 0.625 0.75 0.875 1" />
              <feFuncG type="discrete" tableValues="0 0.125 0.25 0.375 0.5 0.625 0.75 0.875 1" />
              <feFuncB type="discrete" tableValues="0 0.125 0.25 0.375 0.5 0.625 0.75 0.875 1" />
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>

      {/* Canvas wrapper with vignette overlay */}
      <div
        ref={canvasWrapperRef}
        className="relative flex items-center justify-center"
        style={{
          width: '100%',
          height: '100%',
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* WebGL Canvas Container */}
        <div
          ref={containerRef}
          // STAGE 2.9.2: the artwork's real frame — its box is exactly the
          // canvas aspect box, so the background, rounded corners and drop
          // shadow belong here. Everything outside it is now workspace, and
          // the dotted grid shows through.
          className="relative flex items-center justify-center bg-black rounded-lg shadow-2xl"
          style={{
            // Contain-fit: let the browser size this element to the largest box
            // that satisfies BOTH maxWidth and maxHeight while maintaining the
            // canvas aspect ratio. width:'100%' was the bug — it fixed the width
            // at 100% regardless of maxHeight, so a square canvas in a landscape
            // viewport appeared as a landscape rectangle.
            width: 'auto',
            maxWidth: '100%',
            aspectRatio: `${canvasSettings.width} / ${canvasSettings.height}`,
            maxHeight: '100%',
            height: 'auto',
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
            flex: '0 1 auto',
            cursor: interactionEnabled
              ? (isPointerDown ? 'grabbing' : 'grab')
              : 'default',
          }}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
          onTouchStart={(e) => {
            // Prevent default touch behaviors (pinch-zoom, double-tap zoom)
            if (e.touches.length > 1) {
              e.preventDefault(); // Prevent multi-touch gestures (pinch zoom)
            }
          }}
          onTouchMove={(e) => {
            // Prevent default touch scroll/zoom
            if (interactionEnabled) {
              e.preventDefault();
            }
          }}
        />
        
        {/* Vignette overlay - positioned over canvas only */}
        {effects.vignette > 0 && (
          <div
            className="absolute rounded-lg pointer-events-none"
            style={{
              inset: 0,
              background: `radial-gradient(ellipse at center, 
                transparent 20%, 
                rgba(0, 0, 0, ${effects.vignette * 0.3}) 50%,
                rgba(0, 0, 0, ${effects.vignette * 0.7}) 80%,
                rgba(0, 0, 0, ${effects.vignette * 0.9}) 100%)`,
            }}
          />
        )}
        
        {/* Flash is now composited inside the WebGL effects shader (Sprint 2).
             uFlashOpacity / uFlashColor / uFlashPosition uniforms are driven
             by the flash RAF loop — no overlay divs needed. */}
        {/* Brush Cursor — positioned via direct DOM ref (no React re-render on mousemove).
             Initially hidden; shown/hidden by handlePointerDown/Leave via ref.style. */}
        {interactionEnabled && activeLayerId && (() => {
          const activeLayer = layers.find(l => l.id === activeLayerId);
          if (!activeLayer?.displacement?.enabled) return null;
          return (
            <div
              ref={brushCursorRef}
              className="fixed pointer-events-none z-50"
              style={{
                display: 'none',
                transform: 'translate(-50%, -50%)',
                width: `${activeLayer.displacement.brushSize * 2}px`,
                height: `${activeLayer.displacement.brushSize * 2}px`,
                border: '2px solid rgba(0, 255, 255, 0.6)',
                borderRadius: '50%',
                boxShadow: '0 0 10px rgba(0, 255, 255, 0.3)',
              }}
            />
          );
        })()}
      </div>
      
      {/* Interactive Controls - Only show when Interactive Mode is ON */}
      {interactionEnabled && activeLayerId && onUpdateLayer && (() => {
        const activeLayer = layers.find(l => l.id === activeLayerId);
        if (!activeLayer) return null;
        
        // Get displacement config, or use defaults (but don't save until warp mode is toggled)
        const displacement = activeLayer.displacement || {
          enabled: false,
          strength: 50, // FIXED: Increased from 25 to 50 for more noticeable warping
          brushSize: 80,
          meshResolution: 64,
          vertexOffsets: [],
        };
        
        return (
          <InteractiveControls
            displacement={displacement}
            onUpdate={(updates) => {
              const newDisplacement = activeLayer.displacement
                ? { ...activeLayer.displacement, ...updates }
                : { ...displacement, ...updates };
              onUpdateLayer(activeLayerId, { displacement: newDisplacement });
            }}
            onClear={() => {
              // Clear the flow map canvas to neutral grey (no displacement)
              const canvas = displacementCanvasRef.current;
              const ctx    = canvas?.getContext('2d');
              if (ctx && canvas) {
                ctx.fillStyle = 'rgb(127,127,127)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                if (displacementTextureRef.current)
                  displacementTextureRef.current.needsUpdate = true;
                invalidate();
              }
            }}
            onResetWarp={() => {
              // Hard reset: fill flow map with neutral grey
              const canvas = displacementCanvasRef.current;
              const ctx    = canvas?.getContext('2d');
              if (ctx && canvas) {
                ctx.fillStyle = 'rgb(127,127,127)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                if (displacementTextureRef.current)
                  displacementTextureRef.current.needsUpdate = true;
                invalidate();
              }
            }}
            onFadeWarp={fadeFlowMap}
            sensitivity={sensRef.current}
            onSensitivityChange={(v) => { sensRef.current = v; }}
          />
        );
      })()}
    </div>
  );
});
