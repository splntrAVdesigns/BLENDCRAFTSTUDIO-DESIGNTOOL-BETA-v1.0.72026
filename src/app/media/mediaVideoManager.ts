/**
 * media/mediaVideoManager.ts — Stage 2.7.6 (Video Texture Pipeline Rebuild)
 *
 * Owns HTMLVideoElement + GPU-texture lifecycles for video media layers.
 *
 * WHY REBUILT: the prior version wrapped a live <video> in a base THREE.Texture
 * and hand-managed needsUpdate. A base Texture defers GPU allocation
 * (texImage2D) to the first upload; if that races decode (dims 0 / context not
 * ready) the texture is left partially defined and every later texSubImage2D
 * fails — permanently black. Observed as:
 *   GL_INVALID_VALUE:     "Texture dimensions must all be greater than zero"
 *   GL_INVALID_OPERATION: "The destination level of the destination texture
 *                          must be defined"
 *
 * PROFESSIONAL APPROACH:
 *  decode-to-canvas → CanvasTexture. Each decoded frame is drawn into an
 *  offscreen <canvas> and uploaded as a CanvasTexture. GL never receives a raw
 *  <video> as a texture source, so decode/context races cannot corrupt the
 *  texture — this is what eliminated the GL_INVALID_VALUE / GL_INVALID_OPERATION
 *  failures. (THREE.VideoTexture is intentionally NOT used: the ../lib/three
 *  re-export shim does not expose it in the Figma Make bundle, which threw
 *  "THREE.VideoTexture is not a constructor". CanvasTexture is exported and is
 *  the more robust choice regardless.)
 *  LIFECYCLE — explicit state machine mirrored into window.__mediaDebug, which
 *             is ALWAYS defined once the manager is constructed.
 *  BLOB OWNERSHIP — accept the live Blob, mint a fresh object URL in THIS
 *             context (blob: URL strings die on Figma Make iframe doc swaps),
 *             own its revocation.
 *  NO NEW RAF LOOPS — frames set the texture dirty + ping onFrame; the master
 *             RAF consumes it.
 *  EXPORT SEEK PROTOCOL — unchanged: seekAll(t) seeks each video to t%duration
 *             and resolves once decoded.
 */

import * as THREE from '../lib/three';

type VideoState = 'idle' | 'loading' | 'ready' | 'playing' | 'error';
type TexturePath = 'video-texture' | 'canvas-fallback';

interface PlaybackOptions {
  playbackRate?: number;
  loopMode?: 'loop' | 'pingpong' | 'once';
  trimStart?: number;
  trimEnd?: number;
  freeze?: boolean;
  freezeTime?: number;
  muted?: boolean;
  volume?: number;
  /**
   * STAGE 2.7.9 (B) — upload resolution headroom, 1 = no magnification.
   *
   * The preview downscale caps the upload at the render surface's long edge,
   * which is correct ONLY while the media is drawn at 1:1 or smaller. A media
   * layer zoomed to 400% (mediaScale) magnifies the texture 4×, so a
   * display-sized upload would visibly soften — unacceptable in a visual FX
   * tool. GradientCanvas passes the layer's magnification factor here and the
   * cap is multiplied by it, so a zoomed layer keeps the resolution it needs
   * (still never exceeding the source).
   */
  qualityScale?: number;
}

interface ManagedVideo {
  layerId: string;
  video: HTMLVideoElement;
  texture: THREE.Texture;
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
  path: TexturePath;
  src: string;
  mintedUrl: string | null;
  /** STAGE 2.7.8: blob byte-size, for replace detection (see ensure()). */
  blobSize: number;
  /**
   * STAGE 2.7.9 (B) — redundant-upload suppression.
   * The media time (seconds) of the frame currently sitting in `canvas`. If a
   * ping arrives for the same media time at the same canvas size, the pixels
   * are byte-identical: we skip the drawImage AND the GPU upload AND the
   * needs-render ping. Reset to -1 whenever the canvas is resized or the
   * texture is swapped, so the next ping always redraws.
   */
  lastDrawnTime: number;
  /** Retired texture from the previous resize, disposed one swap later (see pingFrame). */
  retiredTexture: THREE.Texture | null;
  /** STAGE 2.7.9 (B): frames skipped by the redundant-upload guard (diagnostics). */
  framesSkipped: number;
  /**
   * STAGE 2.8.1 — measured source frame interval, seconds (0 = unknown yet).
   *
   * Learned from consecutive distinct rvfc mediaTimes during playback, so it is
   * the clip's REAL cadence rather than an assumption. Used to decide whether
   * an export seek target would even land on a different source frame.
   */
  frameInterval: number;
  /** STAGE 2.8.1: export seeks avoided because the source frame wouldn't change. */
  seeksSkipped: number;
  rvfcHandle: number | null;
  usingRvfc: boolean;
  timeupdateHandler: (() => void) | null;
  boundaryHandler: (() => void) | null;
  metadataHandler: (() => void) | null;
  loadedDataHandler: (() => void) | null;
  errorHandler: (() => void) | null;
  options: PlaybackOptions;
  state: VideoState;
  debug: {
    framesDelivered: number;
    lastReadyState: number;
    lastError: string | null;
    firstFrameAt: number | null;
    playCalls: number;
    fallbackReason: string | null;
  };
}

/**
 * STAGE 2.7.9 (B): the real rvfc signature delivers frame metadata whose
 * `mediaTime` is the exact presentation time of the frame just decoded — far
 * more reliable than reading `video.currentTime` (which is sampled on the main
 * thread and can repeat or drift). We use it to detect a genuinely NEW frame.
 */
interface VideoFrameCallbackMeta {
  mediaTime?: number;
  presentedFrames?: number;
}
type SupportsRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: VideoFrameCallbackMeta) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export class MediaVideoManager {
  private entries = new Map<string, ManagedVideo>();
  private playing = false;
  private exporting = false;
  private onFrame: (() => void) | null = null;
  /**
   * STAGE 2.7.9 (B): supplied by GradientCanvas — the long edge (in device
   * pixels) of the surface the video will actually be sampled onto. Read
   * lazily every frame so window/canvas resizes are picked up with no
   * subscription plumbing. Null ⇒ no cap (full source resolution).
   */
  private longEdgeProvider: (() => number) | null = null;

  constructor() {
    // window.__mediaDebug is defined the instant the manager exists. If it's
    // ever undefined at runtime, the bundle isn't running this code.
    this.publishDebug();
  }

  setOnFrame(cb: (() => void) | null): void {
    this.onFrame = cb;
  }

  /**
   * STAGE 2.7.9 (B): register the render-surface size source. See
   * targetSizeFor() for why per-frame upload size is capped to it.
   */
  setDisplayLongEdgeProvider(fn: (() => number) | null): void {
    this.longEdgeProvider = fn;
  }

  /**
   * STAGE 2.7.9 (B): force every entry to re-evaluate its upload size and
   * redraw on the next ping. Called when the cap changes discontinuously —
   * i.e. entering and leaving export — so the first exported frame is already
   * full resolution rather than a preview-grade texture.
   */
  /**
   * STAGE 2.8.1: public re-upload of the CURRENT frame of every video, without
   * moving any playhead. Used by still capture (PNG), which must freeze exactly
   * what is on screen while still getting a full-resolution texture.
   */
  refreshFrames(): void {
    this.invalidateAllFrames();
  }

  private invalidateAllFrames(): void {
    this.entries.forEach((entry) => {
      entry.lastDrawnTime = -1;
      this.pingFrame(entry);
    });
  }

  ensure(layerId: string, src: string, blob?: Blob): THREE.Texture {
    const existing = this.entries.get(layerId);
    // STAGE 2.7.8 (C): a REPLACE can arrive with the same src string (e.g. both
    // empty, or a stale blob: URL) but a DIFFERENT blob. Compare blob identity
    // (size) too, so replacing the source always rebuilds rather than returning
    // the stale texture.
    const sameSrc = existing?.src === src;
    const sameBlob =
      (existing?.blobSize ?? -1) === (blob ? blob.size : -1);
    if (existing && sameSrc && sameBlob) return existing.texture;
    if (existing) this.dispose(layerId);

    let effectiveSrc = src;
    let mintedUrl: string | null = null;
    if (blob) {
      try {
        mintedUrl = URL.createObjectURL(blob);
        effectiveSrc = mintedUrl;
      } catch {
        mintedUrl = null;
        effectiveSrc = src;
      }
    }

    const video = document.createElement('video');
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    video.setAttribute('aria-hidden', 'true');
    video.tabIndex = -1;
    Object.assign(video.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
      zIndex: '-1',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(video);

    // PRIMARY path: decode-to-canvas → CanvasTexture.
    //
    // We deliberately do NOT use THREE.VideoTexture: the project's ../lib/three
    // re-export shim does not reliably expose it in the Figma Make bundle
    // ("TypeError: THREE.VideoTexture is not a constructor"), and — more
    // importantly — drawing each frame into an offscreen <canvas> and uploading
    // a CanvasTexture is the most robust approach anyway: GL never receives a
    // raw <video> as a texture source, so decode/context races can't corrupt
    // the texture (this is what eliminated the GL_INVALID_VALUE /
    // GL_INVALID_OPERATION class). CanvasTexture IS exported by the shim and is
    // already used by the working image path.
    //
    // Start at 1x1 so the texture is allocated at a valid non-zero size
    // immediately; it's resized to the real video dimensions on the first
    // decoded frame (in pingFrame).
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    (texture as THREE.Texture).colorSpace = THREE.SRGBColorSpace;
    (texture.userData as Record<string, unknown>).mediaSrc = src;
    (texture.userData as Record<string, unknown>).mediaKind = 'video';

    const entry: ManagedVideo = {
      layerId,
      video,
      texture,
      canvas,
      ctx,
      path: 'canvas-fallback',
      src,
      mintedUrl,
      blobSize: blob ? blob.size : -1,
      lastDrawnTime: -1,
      retiredTexture: null,
      framesSkipped: 0,
      frameInterval: 0,
      seeksSkipped: 0,
      rvfcHandle: null,
      usingRvfc: typeof (video as SupportsRvfc).requestVideoFrameCallback === 'function',
      timeupdateHandler: null,
      boundaryHandler: null,
      metadataHandler: null,
      loadedDataHandler: null,
      errorHandler: null,
      options: {},
      state: 'loading',
      debug: {
        framesDelivered: 0,
        lastReadyState: 0,
        lastError: null,
        firstFrameAt: null,
        playCalls: 0,
        fallbackReason: null,
      },
    };
    this.entries.set(layerId, entry);
    this.publishDebug();

    const metadataHandler = () => {
      entry.debug.lastReadyState = video.readyState;
      if (entry.state === 'loading' && video.videoWidth > 0) entry.state = 'ready';
      this.publishDebug();
    };
    entry.metadataHandler = metadataHandler;
    video.addEventListener('loadedmetadata', metadataHandler);

    const loadedDataHandler = () => {
      entry.debug.lastReadyState = video.readyState;
      if (entry.state === 'loading') entry.state = 'ready';
      this.pingFrame(entry);
      if (this.playing && !this.exporting) {
        entry.debug.playCalls++;
        void video.play().catch(() => {});
      }
      this.publishDebug();
    };
    entry.loadedDataHandler = loadedDataHandler;
    video.addEventListener('loadeddata', loadedDataHandler);

    const errorHandler = () => {
      const code = video.error?.code;
      const map: Record<number, string> = {
        1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED',
      };
      entry.debug.lastError = code ? (map[code] ?? ('code ' + code)) : 'unknown';
      entry.state = 'error';
      this.publishDebug();
    };
    entry.errorHandler = errorHandler;
    video.addEventListener('error', errorHandler);

    const boundaryHandler = () => this.handleBoundaries(entry);
    entry.boundaryHandler = boundaryHandler;
    video.addEventListener('timeupdate', boundaryHandler);

    this.startFrameGating(entry);

    // If a 2D context couldn't be obtained, we can't draw frames — surface it.
    if (!ctx) {
      entry.state = 'error';
      entry.debug.lastError = 'no-2d-context';
      this.publishDebug();
    }

    video.src = effectiveSrc;
    video.load();
    return texture;
  }

  /**
   * STAGE 2.7.9 (B) — TARGET UPLOAD SIZE.
   *
   * The offscreen canvas used to be sized to the video's FULL source
   * resolution. A 1920×1080 clip therefore pushed ~8.3 MB through
   * drawImage + texImage2D on EVERY decoded frame — 60 fps × 8 MB = ~500 MB/s
   * of bus traffic — while the preview canvas only ever samples it at ~1200px
   * wide. That is the single largest per-frame cost in a stacked-media scene.
   *
   * We now size the upload canvas to the RENDER target's long edge (supplied by
   * GradientCanvas, which knows the live drawing-buffer size), never upscaling
   * past the source. Quality is unaffected: the shader samples a texture that
   * is still >= the pixels it can display.
   *
   * DURING EXPORT the cap is lifted to the source resolution (`exporting`),
   * because the export renderer draws at full output size and must not be
   * fed a preview-grade texture. Export quality is a headline feature — it is
   * never traded for preview performance.
   *
   * Quantised to 128px steps with a shrink hysteresis so that ordinary window
   * resizing does not thrash the (relatively expensive) texture reallocation.
   */
  private targetSizeFor(entry: ManagedVideo, srcW: number, srcH: number): { w: number; h: number } {
    if (this.exporting) return { w: srcW, h: srcH };

    const raw = this.longEdgeProvider?.() ?? 0;
    if (!Number.isFinite(raw) || raw <= 0) return { w: srcW, h: srcH };

    // Magnified layers need proportionally more texels — see qualityScale.
    const quality = Math.max(1, Math.min(4, entry.options.qualityScale ?? 1));
    const cap = Math.max(256, Math.ceil((raw * quality) / 128) * 128);
    const srcLong = Math.max(srcW, srcH);
    if (srcLong <= cap) return { w: srcW, h: srcH };

    const scale = cap / srcLong;
    const w = Math.max(2, Math.round(srcW * scale));
    const h = Math.max(2, Math.round(srcH * scale));

    // Shrink hysteresis: only downsize when the new target is meaningfully
    // smaller than what we already have. Growing always applies immediately
    // (never show a soft/upscaled frame).
    const curW = entry.canvas?.width ?? 0;
    if (curW > 0 && w < curW && w > curW * 0.8) return { w: curW, h: entry.canvas!.height };
    return { w, h };
  }

  private pingFrame(entry: ManagedVideo, mediaTime?: number): boolean {
    const v = entry.video;
    const hasPixels = v.videoWidth > 0 && v.videoHeight > 0;
    const ready = v.readyState >= 2;
    if (!ready || !hasPixels) return false;

    if (entry.path === 'canvas-fallback' && entry.ctx && entry.canvas) {
      const target = this.targetSizeFor(entry, v.videoWidth, v.videoHeight);
      const needResize =
        entry.canvas.width !== target.w || entry.canvas.height !== target.h;

      // ── STAGE 2.7.9 (B): REDUNDANT-UPLOAD GUARD ──
      // rvfc can fire (and setPlaying/applyOptions/seekAll can ping) without the
      // decoder having advanced — e.g. a 24 fps clip on a 60 Hz display repeats
      // the same frame ~2.5× on average, and a paused/frozen video repeats it
      // indefinitely. Re-uploading identical pixels costs a full texture write
      // AND forces a whole-scene re-render via onFrame(). Skipping it is free
      // correctness: same media time + same canvas size ⇒ same pixels.
      const t = mediaTime ?? v.currentTime;
      if (!needResize && entry.lastDrawnTime >= 0 && Math.abs(t - entry.lastDrawnTime) < 1e-6) {
        entry.framesSkipped++;
        return true;
      }

      if (needResize) {
        entry.canvas.width = target.w;
        entry.canvas.height = target.h;
        entry.lastDrawnTime = -1;
        // ── OFFSET-OVERFLOW FIX ──
        // Resizing the <canvas> after its CanvasTexture was allocated does NOT
        // re-run the GPU texImage2D allocation — Three.js still thinks the
        // texture is the old size and issues texSubImage2D for a full frame,
        // overflowing the old (1x1) allocation:
        //   "GL_INVALID_VALUE: Offset overflows texture dimensions."
        // A base texture is allocated once at construction; the only reliable
        // way to force a fresh full-size allocation is a NEW texture object.
        // We swap in a fresh CanvasTexture bound to the same canvas and flag
        // the renderer to rebind this layer's uMediaTexture to it.
        try {
          entry.ctx.drawImage(v, 0, 0, entry.canvas.width, entry.canvas.height);
        } catch {
          return false;
        }
        const fresh = new THREE.CanvasTexture(entry.canvas);
        fresh.minFilter = THREE.LinearFilter;
        fresh.magFilter = THREE.LinearFilter;
        fresh.generateMipmaps = false;
        fresh.wrapS = THREE.ClampToEdgeWrapping;
        fresh.wrapT = THREE.ClampToEdgeWrapping;
        (fresh as THREE.Texture).colorSpace = THREE.SRGBColorSpace;
        (fresh.userData as Record<string, unknown>).mediaSrc = entry.src;
        (fresh.userData as Record<string, unknown>).mediaKind = 'video';
        (fresh.userData as Record<string, unknown>).rebindRequired = true;
        // ── STAGE 2.7.9 (B): DEFERRED DISPOSAL ──
        // The old texture may still be bound to a material's uMediaTexture
        // until the renderer rebinds (which is a frame away, or a React tick
        // away). Disposing it in the same statement is a use-after-free that
        // shows as a black layer or a GL warning. We retire it and dispose it
        // on the NEXT swap, by which time nothing can still reference it.
        // At most one retired texture is held, so this is bounded.
        const retired = entry.retiredTexture;
        entry.retiredTexture = entry.texture;
        entry.texture = fresh;
        retired?.dispose();
        fresh.needsUpdate = true;
        entry.lastDrawnTime = t;

        entry.debug.framesDelivered++;
        entry.debug.lastReadyState = v.readyState;
        if (entry.debug.firstFrameAt === null) entry.debug.firstFrameAt = performance.now();
        if (entry.state === 'ready' && !v.paused) entry.state = 'playing';
        this.onFrame?.();
        return true;
      }
      // Steady state: same size — just redraw + flag sub-image update.
      // NOTE: drawImage's destination width/height perform the downscale on
      // the GPU-accelerated 2D path; there is no separate resample cost.
      try {
        entry.ctx.drawImage(v, 0, 0, entry.canvas.width, entry.canvas.height);
      } catch {
        return false;
      }
      // STAGE 2.8.1: learn the clip's real frame cadence from consecutive
      // distinct presentation times. Median-ish via a slow EMA toward the
      // smallest plausible positive delta — robust against the occasional
      // dropped/duplicated frame without needing a history buffer.
      if (entry.lastDrawnTime >= 0) {
        const delta = t - entry.lastDrawnTime;
        if (delta > 0.001 && delta < 0.5) {
          entry.frameInterval = entry.frameInterval > 0
            ? Math.min(entry.frameInterval, entry.frameInterval * 0.8 + delta * 0.2)
            : delta;
        }
      }
      entry.lastDrawnTime = t;
    }
    entry.texture.needsUpdate = true;

    entry.debug.framesDelivered++;
    entry.debug.lastReadyState = v.readyState;
    if (entry.debug.firstFrameAt === null) entry.debug.firstFrameAt = performance.now();
    if (entry.state === 'ready' && !v.paused) entry.state = 'playing';

    this.onFrame?.();
    return true;
  }

  private startFrameGating(entry: ManagedVideo): void {
    const { video, layerId } = entry;
    if (entry.usingRvfc) {
      const tick = (_now: number, meta?: VideoFrameCallbackMeta) => {
        this.pingFrame(entry, meta?.mediaTime);
        if (this.entries.get(layerId) === entry) {
          entry.rvfcHandle = (video as SupportsRvfc).requestVideoFrameCallback!(tick);
        }
        if (entry.debug.framesDelivered % 30 === 0) this.publishDebug();
      };
      entry.rvfcHandle = (video as SupportsRvfc).requestVideoFrameCallback!(tick);
    } else {
      const handler = () => { this.pingFrame(entry); };
      entry.timeupdateHandler = handler;
      video.addEventListener('timeupdate', handler);
    }
  }

  private publishDebug(): void {
    try {
      const videos = Array.from(this.entries.values()).map((e) => ({
        layerId: e.layerId,
        path: e.path,
        state: e.state,
        rvfc: e.usingRvfc,
        readyState: e.video.readyState,
        networkState: e.video.networkState,
        framesDelivered: e.debug.framesDelivered,
        // STAGE 2.7.9 (B): uploadSize vs source dims shows the downscale in
        // effect; framesSkipped shows the redundant-upload guard working.
        uploadSize: e.canvas ? e.canvas.width + 'x' + e.canvas.height : 'n/a',
        framesSkipped: e.framesSkipped,
        // STAGE 2.8.1: export seek economics.
        frameInterval: e.frameInterval ? +e.frameInterval.toFixed(4) : 0,
        sourceFps: e.frameInterval ? Math.round(1 / e.frameInterval) : 0,
        seeksSkipped: e.seeksSkipped,
        error: e.debug.lastError,
        fallbackReason: e.debug.fallbackReason,
        dims: e.video.videoWidth + 'x' + e.video.videoHeight,
        attached: e.video.isConnected,
        paused: e.video.paused,
        currentTime: +e.video.currentTime.toFixed(2),
        playCalls: e.debug.playCalls,
        firstFrameMs: e.debug.firstFrameAt ? Math.round(e.debug.firstFrameAt) : null,
      }));
      (window as unknown as Record<string, unknown>).__mediaDebug = {
        managerAlive: true,
        playing: this.playing,
        exporting: this.exporting,
        count: this.entries.size,
        videos,
        at: Math.round(performance.now()),
      };
    } catch {
      /* diagnostics must never throw */
    }
  }

  applyOptions(layerId: string, opts: PlaybackOptions): void {
    const entry = this.entries.get(layerId);
    if (!entry) return;
    const { video } = entry;

    entry.options = { ...entry.options, ...opts };

    const rate = Math.max(0.25, Math.min(2, opts.playbackRate ?? 1));
    if (video.playbackRate !== rate) video.playbackRate = rate;

    const loopMode = opts.loopMode ?? 'loop';
    video.loop = loopMode === 'loop' && !entry.options.trimEnd;

    const muted = opts.muted !== false;
    if (video.muted !== muted) video.muted = muted;
    const vol = Math.max(0, Math.min(1, opts.volume ?? 0.8));
    if (video.volume !== vol) video.volume = vol;

    if (opts.freeze) {
      const t = Math.max(0, opts.freezeTime ?? 0);
      video.pause();
      if (Math.abs(video.currentTime - t) > 0.02) video.currentTime = t;
      this.pingFrame(entry);
      return;
    }

    if (this.playing && !this.exporting && video.paused) {
      void video.play().catch(() => {});
    }
  }

  private handleBoundaries(entry: ManagedVideo): void {
    const { video, options } = entry;
    if (options.freeze) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!duration) return;

    const start = Math.max(0, options.trimStart ?? 0);
    const end = Math.min(duration, options.trimEnd ?? duration);
    if (end <= start) return;

    const mode = options.loopMode ?? 'loop';

    if (video.currentTime >= end - 0.02) {
      if (mode === 'pingpong') {
        video.currentTime = start;
      } else if (mode === 'once') {
        video.pause();
        video.currentTime = end;
      } else {
        video.currentTime = start;
      }
      this.pingFrame(entry);
    } else if (video.currentTime < start - 0.02) {
      video.currentTime = start;
    }
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    if (this.exporting) return;
    this.entries.forEach((entry) => {
      const { video } = entry;
      if (playing) {
        entry.debug.playCalls++;
        void video.play().catch(() => {});
      } else {
        video.pause();
        this.pingFrame(entry);
      }
    });
    this.publishDebug();
  }

  hasVideos(): boolean {
    return this.entries.size > 0;
  }

  beginExport(): void {
    this.exporting = true;
    this.entries.forEach(({ video }) => video.pause());
    // STAGE 2.7.9 (B): lift the preview downscale cap and re-upload at FULL
    // source resolution before the first exported frame is rendered. Export
    // quality is never traded for preview performance.
    this.invalidateAllFrames();
    this.publishDebug();
  }

  endExport(): void {
    this.exporting = false;
    // Return to the preview-sized upload path.
    this.invalidateAllFrames();
    if (this.playing) {
      this.entries.forEach(({ video }) => { void video.play().catch(() => {}); });
    }
    this.publishDebug();
  }

  async seekAll(tSec: number): Promise<void> {
    if (this.entries.size === 0) return;
    const seeks: Promise<void>[] = [];
    this.entries.forEach((entry) => {
      const { video } = entry;
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      if (!duration) return;
      const target = tSec % duration;

      // ── STAGE 2.8.1: SOURCE-FRAME-AWARE SEEK SKIP ──
      //
      // Every export frame previously issued a seek and awaited the `seeked`
      // event — 50–500ms of latency each, with a fixed 8ms tolerance that
      // almost never hit. But a seek only matters if it lands on a DIFFERENT
      // decoded frame. Exporting a 24fps clip at 30fps means ~20% of export
      // frames map to a source frame that is already on screen; exporting at
      // 60fps means half of them do. Those seeks are pure latency for zero
      // pixel change.
      //
      // Tolerance is half the MEASURED frame interval (learned from real rvfc
      // presentation times, not assumed), clamped so an unmeasured clip still
      // behaves like the old 8ms floor and a very low-fps clip cannot skip so
      // far that it visibly lags the timeline. Determinism is preserved: the
      // frame we keep is the frame a seek would have produced.
      // The honest test is not "are these times close" but "do they resolve to
      // the SAME decoded frame". Compare source frame indices directly: a 24fps
      // clip exported at 30fps yields index runs 0,1,1,2,3,3,4… — every repeat
      // is a seek we can skip with byte-identical output. Falls back to the old
      // 8ms distance check until the cadence has been measured.
      if (entry.frameInterval > 0) {
        const iv = entry.frameInterval;
        if (Math.floor(video.currentTime / iv + 1e-6) === Math.floor(target / iv + 1e-6)) {
          entry.seeksSkipped++;
          this.pingFrame(entry);
          return;
        }
      } else if (Math.abs(video.currentTime - target) < 0.008) {
        entry.seeksSkipped++;
        this.pingFrame(entry);
        return;
      }
      seeks.push(
        new Promise<void>((resolve) => {
          const timeout = window.setTimeout(() => {
            video.removeEventListener('seeked', onSeeked);
            this.pingFrame(entry);
            resolve();
          }, 1000);
          const onSeeked = () => {
            window.clearTimeout(timeout);
            video.removeEventListener('seeked', onSeeked);
            this.pingFrame(entry);
            resolve();
          };
          video.addEventListener('seeked', onSeeked);
          video.currentTime = target;
        })
      );
    });
    if (seeks.length > 0) await Promise.all(seeks);
  }

  dispose(layerId: string): void {
    const entry = this.entries.get(layerId);
    if (!entry) return;
    this.entries.delete(layerId);

    if (entry.usingRvfc && entry.rvfcHandle !== null) {
      (entry.video as SupportsRvfc).cancelVideoFrameCallback?.(entry.rvfcHandle);
    }
    const v = entry.video;
    if (entry.timeupdateHandler) v.removeEventListener('timeupdate', entry.timeupdateHandler);
    if (entry.boundaryHandler) v.removeEventListener('timeupdate', entry.boundaryHandler);
    if (entry.metadataHandler) v.removeEventListener('loadedmetadata', entry.metadataHandler);
    if (entry.loadedDataHandler) v.removeEventListener('loadeddata', entry.loadedDataHandler);
    if (entry.errorHandler) v.removeEventListener('error', entry.errorHandler);

    v.pause();
    v.removeAttribute('src');
    v.load();
    if (v.parentNode) v.parentNode.removeChild(v);
    if (entry.mintedUrl) URL.revokeObjectURL(entry.mintedUrl);
    entry.retiredTexture?.dispose();   // STAGE 2.7.9 (B): no leak on teardown
    entry.retiredTexture = null;
    entry.texture.dispose();
    this.publishDebug();
  }

  disposeAll(): void {
    Array.from(this.entries.keys()).forEach((id) => this.dispose(id));
    this.onFrame = null;
    this.longEdgeProvider = null;
  }

  layerIds(): string[] {
    return Array.from(this.entries.keys());
  }

  getTexture(layerId: string): THREE.Texture | null {
    return this.entries.get(layerId)?.texture ?? null;
  }
}