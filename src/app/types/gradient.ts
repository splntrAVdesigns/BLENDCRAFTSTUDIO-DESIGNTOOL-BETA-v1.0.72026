// Core gradient types and interfaces

export type GradientType = 
  | 'linear' 
  | 'radial' 
  | 'conic' 
  | 'kaleidoscope'
  | 'mesh' // DEPRECATED: Use 'kaleidoscope' instead. Kept for backward compatibility.
  | 'blob'
  | 'stripe'
  | 'wave'
  | 'noise-spiral'
  | 'fractal'
  | 'turbulence'
  | 'grid'
  | 'spiral'
  | 'burst'
  | 'camo'
  | 'voronoi'  // NEW: Voronoi/cellular pattern
  | 'abstract' // NEW: Abstract flowing pattern (formerly diamond)
  | 'diamond'  // NEW: Diamond textile pattern
  | 'plasma'   // Plasma interference patterns
  | 'marble'   // NEW: Organic stone texture with flowing veins
  | 'concentric' // NEW: Circular ripple patterns
  | 'radial-waves' // NEW: Expanding circular waves with interference
  | 'mandala' // NEW: Symmetrical radial patterns with sacred geometry
  | 'starburst'; // NEW: Radial star/sunburst rays from center

export type BlendMode = 
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export type MaskType = 
  | 'none'
  | 'alpha'      // Use alpha channel as mask
  | 'luminance'  // Use brightness as mask
  | 'layer'      // Use another layer as mask
  | 'image';     // Uploaded source mask (bitmap now, SVG-capable foundation)

export type MaskSourceType = 'image' | 'svg' | 'alpha' | 'luminance';

export interface MaskConfig {
  type: MaskType;
  sourceType?: MaskSourceType; // Foundation for SVG/image/self-mask routing
  sourceLayerId?: string; // ID of layer to use as mask (for 'layer' type)
  imageUrl?: string;      // Data URL or Object URL for uploaded mask image/SVG raster source
  previewImageUrl?: string; // Static preview image for UI thumbnail (doesn't update with stroke width)
  imageFit?: 'contain';   // How to fit the uploaded mask image (always 'contain')
  svgText?: string;       // Raw SVG markup for future vector-native processing
  svgViewBox?: { x: number; y: number; width: number; height: number };
  svgShapeId?: string;    // ID of selected shape preset
  svgRenderMode?: 'fill' | 'wireframe'; // How SVG shape is rendered
  svgStrokeWidth?: number; // Stroke width for wireframe shapes (1-20)
  maskScale?: number;     // Scale multiplier for mask image (0.1 to 3.0, default 1.0)
  positionX?: number;     // Normalized X offset (-1 to 1)
  positionY?: number;     // Normalized Y offset (-1 to 1)
  rotation?: number;      // Rotation in degrees
  expand?: number;        // Edge expand/contract (-100 to 100)
  bitmapSourceMode?: 'alpha' | 'luminance'; // How bitmap masks derive coverage
  bitmapThreshold?: number; // Coverage threshold for bitmap masks (0-1)
  invert: boolean;        // Invert the mask
  feather: number;        // Blur/feather the mask edges (0-100)
  opacity: number;        // Mask opacity/strength (0-1)
  mode: 'clip' | 'add' | 'subtract' | 'intersect'; // Compatibility: foundation remains clip-first
  visible?: boolean;      // Show/hide mask (defaults to true)

  // NEW: Advanced mask parameters
  tileMode?: 'single' | 'repeat' | 'mirror'; // Tiling mode for small shapes (default: 'single')
  tileScale?: number;     // Scale for tiled shapes (0.1-5.0, default: 1.0)
  edgeDetect?: boolean;   // Extract edges/outline only (default: false)
  edgeThickness?: number; // Edge stroke thickness in pixels (1-10, default: 2)
  blurQuality?: 'none' | 'fast' | 'medium' | 'high'; // Blur/feather quality (default: 'none')

  // NEW: Mask animation system
  animation?: {
    enabled: boolean;
    type: 'rotate' | 'scale' | 'pulse' | 'drift' | 'swing'
        | 'fade' | 'bounce' | 'spin' | 'wobble' | 'zoom'
        | 'breathe' | 'scanReveal' | 'radialExpand' | 'sliceWipe' | 'glitchMask' | 'orbitDrift';
    speed: number;        // 0-100, animation speed (uses same curve as texture animations)
    intensity: number;    // 0-100, effect strength — controls depth/amplitude of motion
    easing?: EasingType;  // Easing curve via anime.js engine (same as gradient animations)
    loop: boolean;        // Loop animation (default: true)
    direction?: 'forward' | 'reverse' | 'pingPong'; // Animation direction
  };
}

export type AnimationType = 
  | 'rotation'
  | 'pulse'
  | 'wave'
  | 'morph'
  | 'drift'
  | 'scale'
  | 'turbulence'
  | 'glitch'
  | 'hueShift'
  | 'ripple'
  | 'shimmer'       // deprecated alias → kept for saved-project back-compat; maps to dualShifter
  | 'dualShifter'   // Frame shift with vortex intensity
  | 'vortex'
  | 'kaleidoscope'  // Spinning gem: continuous rotation + facet-flash intensity pops
  | 'fractalZoom'   // Infinite zoom-in: growing scale + focal drift
  | 'chromaticPulse' // Frequency visualizer: fast rhythmic brightness + hue pulse
  | 'liquid';       // Viscous heavy flow: slow multi-frequency drift

export type EasingType =
  | 'linear'
  | 'ease'        // CSS-style ease — smooth inOutSine (used by chromaticPulse LFO Oscillate mode)
  | 'easeIn'      // Cubic in (legacy)
  | 'easeOut'     // Cubic out (legacy)
  | 'easeInOut'   // Cubic in-out (legacy)
  | 'bounce'      // Bounce (legacy)
  | 'elastic'     // Elastic (legacy)
  // Anime.js enhanced easings (smoother interpolation)
  | 'easeInQuad' | 'easeOutQuad' | 'easeInOutQuad'
  | 'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic'
  | 'easeInQuart' | 'easeOutQuart' | 'easeInOutQuart'
  | 'easeInQuint' | 'easeOutQuint' | 'easeInOutQuint'
  | 'easeInSine' | 'easeOutSine' | 'easeInOutSine'
  | 'easeInExpo' | 'easeOutExpo' | 'easeInOutExpo'
  | 'easeInCirc' | 'easeOutCirc' | 'easeInOutCirc'
  | 'easeInBack' | 'easeOutBack' | 'easeInOutBack'
  | 'easeInElastic' | 'easeOutElastic' | 'easeInOutElastic'
  | 'easeInBounce' | 'easeOutBounce' | 'easeInOutBounce';

export type AnimationDirection = 
  | 'forward'
  | 'reverse'
  | 'pingPong';

export type ExportFormat = 'png' | 'svg' | 'css' | 'webm' | 'gif';

export interface ColorStop {
  color: string;
  position: number; // 0-1
}

export interface GradientConfig {
  type: GradientType;
  colors: ColorStop[];
  angle?: number; // for linear/angular
  centerX?: number; // for radial/conic (0-1)
  centerY?: number; // for radial/conic (0-1)
  scale?: number;
  scaleBoost?: number; // Additional scale multiplier (Advanced Properties slider, 0.5–2.5x)
  twist?: number; // Radial twist in turns, typically -2 to 2 for spiral effects
  turbulence?: number; // noise-based distortion (0-10)
  intensity?: number;
  octaves?: number; // for noise/fractal
  frequency?: number;
  segments?: number; // for kaleidoscope - number of mirror segments (3-16)
  stripeCount?: number; // for stripe/wave
  waveAmplitude?: number;
  blobCount?: number; // for blob
  meshPoints?: { x: number; y: number; color: string }[]; // for mesh
  gridRows?: number; // for grid
  gridCols?: number;
  gridGradients?: GradientConfig[][]; // 2D array of gradients for grid cells
}

export interface TextureConfig {
  type: 'grain' | 'noise' | 'dots' | 'lines' | 'organic' | 'camoShadows' | 'linearGlass' | 'frostedGlass' | 'blockGlass' | 'fractalGlass' | 'heatMelt' | 'waveSignal' | 'topography' | 'plasma' | 'shape-pattern' | 'spackle' | 'grunge';
  opacity: number;
  scale: number;
  intensity: number;
  blendMode: BlendMode;
  // Shape pattern specific properties
  shapePatternId?: string; // References MASK_SHAPE_PRESETS by ID
  /** @deprecated Grid is now fixed 4x4 internally; density controlled by shader scale */
  patternColumns?: number;
  /** @deprecated Grid is now fixed 4x4 internally; density controlled by shader scale */
  patternRows?: number;
  patternSpacing?: number; // 0-100, gap between shapes
  patternOffsetX?: number; // -50 to 50, horizontal stagger
  patternOffsetY?: number; // -50 to 50, vertical stagger
  patternRotation?: number; // 0-360, base rotation for each tile
  patternFillMode?: 'fill' | 'wireframe'; // Filled shapes or stroke outlines
  patternDensity?: number; // 0-100, shader-side tile density multiplier
  patternRandomRotation?: number; // 0-100, deterministic per-tile random rotation amount
  /** @deprecated Removed from UI; retained only for old autosave compatibility. Forced to none at render time. */
  patternAlternateFlip?: 'none' | 'horizontal' | 'vertical' | 'checker';
  patternStaggerRows?: number; // 0-100, row stagger amount (50 = half-tile offset)
  patternScaleVariance?: number; // 0-100, deterministic per-tile random scale variance
  patternOutlineThickness?: number; // 1-20, wireframe stroke thickness for shape-pattern raster
  patternOpacityCurve?: number; // 0-100, radial pattern opacity falloff strength
  patternOpacityCurveMode?: 'flat' | 'center' | 'edge'; // flat, center-weighted, or edge-weighted opacity
  // Glass-specific properties
  blur?: number; // 0-20, gaussian blur amount
  distortion?: number; // 0-100, distortion strength percentage
  angle?: number; // 0-360, for linear glass direction
  // Enhanced glass properties (bevel, highlights, effects)
  bevelDepth?: number; // 0-10, inner bevel depth in pixels
  bevelSoftness?: number; // 0-100, bevel smoothness percentage
  highlightIntensity?: number; // 0-100, edge highlight brightness
  highlightThickness?: number; // 1-3, highlight stroke width in pixels
  shadowDepth?: number; // 0-100, complementary shadow darkness
  lightDirection?: number; // 0-360, where light hits the glass
  grainAmount?: number; // 0-100, film grain/noise overlay
  // Animation properties
  animateTexture?: boolean; // Enable/disable texture animation
  textureAnimationType?: 'spin' | 'warp' | 'pingPong' | 'scale' | 'drift' | 'tectonic' | 'breathing' | 'seismic' | 'shear' | 'vortex' | 'fluid'; // Texture animation style
  animationSpeed?: number; // 0-30, animation speed slider value (exponential curve: 0=paused, 15=1x, 30=2x)
  // Linear glass specific
  ridgeCount?: number; // 5-50, number of ridges for linear glass
  ridgeIrregularity?: number; // 0-100, organic variation in ridges
  // Block glass specific
  gridSize?: number; // 2-50, cells for block glass
  blockIrregularity?: number; // 0-100, size variation percentage
  // Fractal glass specific
  complexity?: number; // 1-8, octaves for fractal
  chromaticShift?: number; // 0-20, chromatic aberration amount (RGB split)
  // Topography specific properties
  elevationShift?: number; // -100 to 100, pushes contours up/down to change density
  lineThickness?: number; // 0-100, thickness of contour lines (overrides intensity for topo)
  // Plasma specific properties
  turbulence?: number; // 0-100, chaos/smoothness of plasma
  waveCount?: number; // 1-10, number of overlapping waves
  colorIntensity?: number; // 0-100, gradient color sampling strength
  // Spackle / Grunge specific properties
  invertTexture?: boolean; // Invert the texture pattern (spackle: dark dots on light background)
}

export interface AnimationConfig {
  enabled: boolean;
  type: AnimationType;
  speed: number; // 0-10
  intensity: number; // 0-1
  loop: boolean;
  easing: EasingType;
  direction: AnimationDirection;
  resetCounter?: number; // Increments to trigger animation reset to t=0
}

// Animation evaluation result - extended with phase data for shader-driven animations
export interface AnimationEval {
  angleOffset: number;
  scaleOffset: number;
  xOffset: number;
  yOffset: number;
  intensityMultiplier: number;
  hueShiftOffset: number;
  
  // NEW: Shared animation phase language
  phase01: number;        // Normalized loop phase (0-1)
  eased01: number;        // Eased loop phase (0-1)
  theta: number;          // Angle in radians (0-2π)
  signedTime: number;     // Unbounded time with direction
  cycleSeconds: number;   // Cycle duration
}

// Cumulative Transform State - maintains current position across play/pause cycles
export interface LayerTransformState {
  currentAngle: number;      // Current rotation angle in degrees
  currentCenterX: number;    // Current center X position (0-1)
  currentCenterY: number;    // Current center Y position (0-1)
  currentScale: number;      // Current scale multiplier
  currentIntensity: number;  // Current animation intensity
  animationTime: number;     // Accumulated animation time in seconds
  baseAngle: number;         // Base angle set by user/interactive mode
  baseCenterX: number;       // Base center X set by user/interactive mode
  baseCenterY: number;       // Base center Y set by user/interactive mode
  baseScale: number;         // Base scale set by user
  // Speed-smoothing fields — patched to eliminate chaotic jumps when speed slider changes
  signedPhase: number;       // Accumulated phase: += clockDelta * smoothedSpeed each frame
  smoothedSpeed: number;     // EMA-smoothed speed (target = layer.animation.speed)
  // Export phase snapshot — set by pauseAnimation() so renderAtTime() continues
  // from the exact phase the live canvas was at (prevents ping-pong snap on frame 0)
  capturedPhase?: number;
  capturedSpeed?: number; // Export speed snapshot so deterministic renders match live smoothed speed
}

// Interactive Warp/Displacement configuration
export interface DisplacementConfig {
  enabled: boolean;           // Whether displacement is active
  strength: number;           // 0-100, warp intensity
  brushSize: number;          // 10-200, brush size in pixels (now used as influence radius)
  displacementData?: ImageData; // Stored displacement map data (legacy texture-based)
  meshResolution?: number;    // Mesh subdivision (32 or 64), default 64 for smoother warping
  vertexOffsets?: number[];   // Stored vertex position offsets [x, y, z, x, y, z, ...]
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  gradient?: GradientConfig;
  texture?: TextureConfig;
  animation?: AnimationConfig;
  locked: boolean;
  mask?: MaskConfig;
  transformState?: LayerTransformState; // Cumulative animation state
  displacement?: DisplacementConfig;    // Interactive warp displacement
  media?: MediaLayerConfig;             // Uploaded image/SVG/video source (Media Layer System, Stage 1)
}

// Media Layer System (Stage 1) — structural type kept here to avoid a circular
// import with src/app/media/types.ts (which owns the canonical MediaConfig +
// helpers). The two must stay field-identical; media/types.ts re-exports the
// richer API.
export interface MediaLayerConfig {
  enabled: boolean;
  sourceKind: 'image' | 'svg' | 'video';
  src?: string;            // Object/data URL — runtime-only, stripped on save
  /**
   * STAGE 2.7.5 — live Blob reference for video (runtime-only, never persisted).
   *
   * WHY: a blob: URL string is just a pointer into a document-scoped registry.
   * In the Figma Make preview iframe, that registry can be invalidated when the
   * iframe buffer manager promotes/swaps the active document — after which the
   * video element's `src` fetch fails with net::ERR_FILE_NOT_FOUND and the
   * video never decodes (black canvas). Images were unaffected because they
   * decode synchronously at upload, before any swap. Holding the actual Blob
   * object keeps the data alive in memory; the video manager mints a FRESH
   * object URL from it at load time, in its own context, so there is no stale
   * cross-context URL to go missing.
   */
  blob?: Blob;
  fileName?: string;
  fileSize?: number;
  naturalWidth?: number;
  naturalHeight?: number;
  durationSec?: number;
  posterOnly?: boolean;    // Stage 1: video renders as static poster frame
  fit: 'cover' | 'contain' | 'stretch' | 'tile';   // 2.7: 'tile' unlocks pattern workflows
  // ── 2.7: flip (shader-side, free) ──
  flipH?: boolean;
  flipV?: boolean;
  /** Tile repeat count when fit === 'tile'. 1–20. */
  tileRepeat?: number;
  // ── 2.7E: video playback controls (video sources only) ──
  /** Playback rate multiplier. 0.25–2. Default 1. */
  playbackRate?: number;
  /** loop | pingpong | once (hold last frame). Default 'loop'. */
  loopMode?: 'loop' | 'pingpong' | 'once';
  /** Trim in-point, seconds. Default 0. */
  trimStart?: number;
  /** Trim out-point, seconds. Defaults to duration. */
  trimEnd?: number;
  /** Freeze on a still frame instead of playing. */
  freeze?: boolean;
  /** Freeze target time in seconds (used when freeze is true). */
  freezeTime?: number;
  /**
   * Mute the video's own audio track. Default true.
   * NOTE: this is the groundwork hook for Stage 3 — a video's embedded audio
   * track is the most natural audio-reactive source in the whole app.
   */
  muted?: boolean;
  /** Volume 0–1 when unmuted. */
  volume?: number;
  shadows: number;         // -50..50  → lift
  midtones: number;        // 20..300  → gamma (100 = neutral)
  highlights: number;      // 0..200   → gain  (100 = neutral)
  invert: boolean;
  // ── Stage 2B: media transforms (shader-side UV, uniform-only) ──
  mediaScale?: number;     // 10..400 (%), default 100
  rotationDeg?: number;    // -180..180, default 0
  offsetX?: number;        // -100..100 (%), default 0
  offsetY?: number;        // -100..100 (%), default 0
  // ── Stage 2C: gradient-as-LUT (color grade via the layer's color stops) ──
  lutIntensity?: number;   // 0..100, default 0 (off)
  lutPreserveLuma?: boolean; // keep original luminance, take ramp hue/sat
  // ── Stage 2E: video ──
  /** Small poster data URL for panel/layer-list thumbnails. Runtime-only. */
  previewUrl?: string;
}

/**
 * STAGE 2.8.5: global (document-level) effects.
 *
 * `EffectsConfig` was imported from this module by useHistory, useGradientState
 * and now the session serializer, but the real definition lives in
 * components/controls/EffectsControls. Those imports were resolving to `any`
 * through an unresolved-member error — which is how a document field ends up
 * silently unvalidated. Re-exporting the ONE real definition fixes every
 * importer at once; defining a second shape here would have created exactly the
 * kind of drift that cost us a lost RenderApi method earlier this cycle.
 */
export type { EffectsConfig } from '../components/controls/EffectsControls';

export interface CanvasSettings {
  width: number;
  height: number;
  backgroundColor: string;
}

export interface Resolution {
  name: string;
  width: number;
  height: number;
  category: 'standard' | 'social' | 'print' | 'custom';
}

export interface GradientPreset {
  id: string;
  name: string;
  thumbnail?: string;
  layers: Layer[];
  canvasSettings: CanvasSettings;
  tags?: string[];
}

export interface InteractionState {
  mouseX: number; // -1 to 1
  mouseY: number; // -1 to 1
  intensity: number; // 0 to 1
  shiftKey?: boolean; // SHIFT modifier for advanced controls
  altKey?: boolean; // ALT modifier for precision mode
  currentParameter?: string; // Name of parameter being controlled (for UI feedback)
} 

// ─────────────────────────────────────────────────────────────────────────────
// RenderApi — single source of truth for the interface exposed by GradientCanvas
// to every export consumer (App.tsx, ExportPanel, AdvancedExportPanel, RightSidebar).
//
// Previously, four divergent inline type definitions lived in those files.
// Any new method added to GradientCanvas must be added here — not duplicated
// per-file. Consumers import `RenderApi` and use it as the ref generic.
// ─────────────────────────────────────────────────────────────────────────────
export interface RenderApi {
  /**
   * Render the scene at a specific time offset in seconds.
   *
   * @param opts.seekMedia  Default TRUE — seek video layers to `time % duration`
   *   for a deterministic timeline (video export). Pass FALSE for a STILL
   *   CAPTURE (PNG/SVG): render the current on-screen frame without moving any
   *   video playhead. See GradientCanvas.renderAtTime for the full rationale —
   *   seeking on a still capture exported a frame the user never selected.
   */
  renderAtTime: (
    time: number,
    exportRenderer?: any,
    opts?: { seekMedia?: boolean },
  ) => Promise<void>;
  /** Return the live WebGL canvas element for pixel capture and canvas sizing. */
  getCanvas: () => HTMLCanvasElement | null;
  /** Return the current animation master clock time in seconds. */
  getCurrentTime?: () => number;
  /** Configure the single deterministic frame timeline used by all export animation systems. */
  configureExportTimeline?: (config: { fps: number; totalFrames: number; durationMs: number; loopLockEnabled?: boolean }) => void;
  /** Clear export timeline configuration after export completion or cancellation. */
  clearExportTimeline?: () => void;
  /**
   * STAGE 3.1: bake the loaded audio into a deterministic envelope table before
   * a video export, so every frame's audio reactivity is reproducible. Resolves
   * to a status string (e.g. "Envelope baked · 12.3s analyzed") or null when no
   * audio is loaded. Must be called before the export frame loop.
   */
  prepareAudioExport?: () => Promise<string | null>;
  /** STAGE 3.1: clear the baked envelope and restore live reactivity. Call in
   *  the export finally block. */
  finishAudioExport?: () => void;
  /**
   * Read the last rendered frame as raw RGBA pixels from the capture render target.
   * Returns a reusable buffer — consume the data before the next call.
   */
  readFramePixels?: () => { data: Uint8Array; width: number; height: number } | null;
  /**
   * Return flash overlay parameters (opacity, color, position) for a given export
   * time. Used by the export pipeline to composite flash FX over export frames.
   */
  getExportFlashOverlay?: (time: number) => { opacity: number; color: string; position: string } | null;
  /** Wait for all mask textures to upload to GPU before starting export. */
  waitForMaskTextures?: (timeoutMs?: number) => Promise<void>;
  /**
   * Resize the renderer and all render targets to export dimensions.
   * Must be called before the export frame loop and matched with restoreSize().
   * Also updates the effects resolution uniform (Sprint 1 fix) so film grain,
   * dither, halftone, and chromatic aberration compute at export pixel density.
   */
  setExportSize?: (width: number, height: number) => void;
  /**
   * Restore the renderer to live preview dimensions after an export session.
   * Also restores the effects resolution uniform to preview size.
   */
  restoreSize?: () => void;
  /**
   * Pause the animation clock and snapshot current layer/animation state for
   * deterministic export. Must be paired with resumeAnimation().
   */
  pauseAnimation?: (options?: { resetExportPhase?: boolean }) => void;
  /** Resume the live animation clock after export completes or is aborted. */
  resumeAnimation?: () => void;
  /** Authoritative, idempotent Phase 6 cleanup for every export-owned resource/state. */
  cleanupExportSession?: () => Promise<void>;
}