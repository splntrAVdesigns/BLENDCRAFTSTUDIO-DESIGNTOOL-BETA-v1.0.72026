import { useState, useEffect, useRef, useMemo } from 'react';
import { saveAs } from 'file-saver';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { SelectWrapper } from '../ui/select-wrapper';
import { Progress } from '../ui/progress';
import { Switch } from '../ui/switch';
import { 
  Download, 
  FileImage, 
  FileCode, 
  Video, 
  Copy,
  Loader2,
  Code,
  AlertTriangle,
  Sparkles,
  Image,
  Link2,
  Link2Off,
} from 'lucide-react';
import { toast } from 'sonner';
import { Layer, CanvasSettings, type RenderApi } from '../../types/gradient';
import { 
  exportMP4FromCanvas,
  exportWebMFromCanvas,
  verifyMP4EncodeSupport,
  exportPNGAtSize,
  exportAsSVG,
  generateCSSCode,
  pickBestVideoMimeType,
  PNG_PRESETS,
  WEBM_PRESETS,
  VIDEO_QUALITY_PRESETS,
  MP4_QUALITY_PRESETS,
  type VideoQuality,
  type ExportPreset,
} from '../../utils/exportUtils';
import { confirmWebMExportPlan, planWebMExport, WEBM_FRAME_WARN_LIMIT, WEBM_FRAME_CONFIRM_LIMIT } from '../../utils/exportPlanner';
import { getMediaSourceMaxResolution } from '../../media';
import type { LoopVerificationResult } from '../../utils/loopVerification';
import {
  beginExportStatus,
  endExportStatus,
  updateExportStatus,
  requestExportCancellation,
  type ExportKind,
} from '../../state/exportStatus';
import { createLayerExportDurationPlan } from '../../export/ExportDurationPlan';
import { resolveVideoOutputDimensions } from '../../export/VideoOutputPlan';
import { isolatePreview } from '../../export/recording/PreviewIsolationController';

interface ExportPanelProps {
  layers: Layer[];
  canvasSettings: CanvasSettings;
  canvasRef: React.RefObject<HTMLDivElement>;
  renderApiRef?: React.MutableRefObject<RenderApi | null>;
}

// Social media presets — no emoji icons per design spec
const SOCIAL_PRESETS = [
  { label: 'Instagram Post',   width: 1080, height: 1080 },
  { label: 'Instagram Story',  width: 1080, height: 1920 },
  { label: 'Twitter/X Banner', width: 1500, height: 500  },
  { label: 'YouTube Thumbnail',width: 1280, height: 720  },
  { label: 'Facebook Cover',   width: 820,  height: 312  },
  { label: 'LinkedIn Banner',  width: 1584, height: 396  },
  { label: 'TikTok Video',     width: 1080, height: 1920 },
  { label: 'Pinterest Pin',    width: 1000, height: 1500 },
] as const;

export function ExportPanel({ 
  layers, 
  canvasSettings, 
  canvasRef,
  renderApiRef
}: ExportPanelProps) {
  const [isExporting, setIsExportingState] = useState(false);
  /**
   * STAGE 2.7.9 (C): mirror export state into the app-wide export store so
   * the canvas overlay and the header Play button can reflect it. Wrapping
   * the setter keeps every existing call site untouched — the only change is
   * that video exports pass their kind, which is what gates the canvas
   * render-state overlay (image exports are too fast to warrant a scrim).
   */
  const setIsExporting = (next: boolean, kind: ExportKind = 'image', onCancel?: () => void) => {
    setIsExportingState(next);
    if (next) beginExportStatus(kind, onCancel);
    else endExportStatus();
  };
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMessage, setExportMessage] = useState('');
  const [activeTab, setActiveTab] = useState('png');
  const isMountedRef = useRef(true);
  const exportAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      exportAbortControllerRef.current?.abort();
      exportAbortControllerRef.current = null;
      // STAGE 2.7.9 (C): the export finally-blocks are guarded by
      // isMountedRef, so an unmount mid-export would otherwise strand the
      // canvas overlay on screen forever. Clearing here is always safe —
      // endExportStatus() is a no-op when nothing is active.
      endExportStatus();
    };
  }, []);

  const safeSetExportState = (progress: number, message?: string) => {
    if (!isMountedRef.current) return;
    setExportProgress(progress);
    if (message !== undefined) setExportMessage(message);
    // STAGE 2.7.9 (C): single funnel — every export path already routes its
    // progress through here, so publishing here covers PNG, WebM, MP4 and GIF
    // without touching ProgressCallback's signature across exportUtils.
    updateExportStatus(progress, message);
  };
  
  // PNG settings
  const [pngPreset, setPngPreset] = useState<string>('1080p');
  const [pngCustomWidth, setPngCustomWidth] = useState(1920);
  const [pngCustomHeight, setPngCustomHeight] = useState(1080);
  
  // WebM settings
  // SPRINT (export-quality-sync): default export resolution now starts as
  // "Custom" matching the live canvas's own working resolution, instead of
  // a hardcoded 1920x1080 divorced from whatever the user actually set up
  // in Canvas Settings. Previously webmCustomWidth/Height always
  // initialized to 1920x1080 regardless of canvasSettings, so a 4K or
  // vertical/social canvas would silently export at 1080p unless the user
  // happened to re-enter the resolution here too.
  const [webmPreset, setWebmPreset] = useState<string>('Custom');
  const [webmFps, setWebmFps] = useState(30);
  const [webmQuality, setWebmQuality] = useState<VideoQuality>('high');
  // STAGE 3.2: render scale — the highest-leverage speed control. Every
  // per-frame cost (GPU fill, readback, flip, encode) scales with pixel count,
  // so 0.75× ≈ 1.8× faster and 0.5× ≈ 4× faster. 1.0 is unchanged behaviour.
  const [webmRenderScale, setWebmRenderScale] = useState(1);
  const [webmDuration, setWebmDuration] = useState(5);
  // STAGE 2.7.8 (A): the duration <input> is a CONTROLLED number field. The old
  // onChange did `parseInt(value) || 5`, so the instant the field was emptied to
  // type a new number, parseInt('') → NaN → NaN || 5 → 5 snapped back and the
  // user could never clear the default. Fix: keep a separate string "draft" the
  // user can freely edit (including empty / partial), push valid numbers through
  // to webmDuration live, and only CLAMP on blur. webmDuration stays a number
  // for all downstream consumers.
  const [webmDurationDraft, setWebmDurationDraft] = useState('5');
  const [loopPerfect, setLoopPerfect] = useState(false);
  // Phase 7.3D validation gate. Default OFF keeps the certified legacy engine
  // public while allowing direct renderer/MediaRecorder parity testing before
  // the Phase 7.3E cutover. This temporary control is removed at cutover.
  // Video container format. MP4 (H.264) is the primary, default export
  // format — universal playback, matches what every other pro export tool
  // treats as the standard deliverable. WebM (VP9) remains selectable as
  // the explicit fallback format (smaller files, no H.264 involved).
  // MP4 gracefully auto-falls-back to WebM when the browser/GPU can't
  // encode H.264 at all (handled inside exportMP4FromCanvas via a
  // Mediabunny capability probe, before any frames are rendered).
  const [videoFormat, setVideoFormat] = useState<'webm' | 'mp4'>('mp4');
  // MP4 v3: async REAL capability probe. The old sync check only verified
  // the WebCodecs classes exist — true even in environments (Figma desktop /
  // Electron builds, post-GPU-crash sessions) that reject every actual
  // H.264 config, which produced doomed export attempts. null = probing.
  const [mp4Supported, setMp4Supported] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    verifyMP4EncodeSupport().then((ok) => {
      if (!alive) return;
      setMp4Supported(ok);
      if (!ok) setVideoFormat((f: 'webm' | 'mp4') => (f === 'mp4' ? 'webm' : f));
    });
    return () => { alive = false; };
  }, []);
  // Custom resolution state — synced from preset dropdown, editable when preset = 'Custom'.
  // Lazy-initialized from canvasSettings (not hardcoded) so export resolution
  // matches the live canvas by default. See webmPreset comment above.
  const [webmCustomWidth, setWebmCustomWidth] = useState(() => canvasSettings.width || 1920);
  const [webmCustomHeight, setWebmCustomHeight] = useState(() => canvasSettings.height || 1080);
  const [webmAspectLocked, setWebmAspectLocked] = useState(true);
  const [videoResolutionFollowsCanvas, setVideoResolutionFollowsCanvas] = useState(true);
  // Derive the canvas-following values during render. Avoiding a synchronization
  // effect prevents an intermediate stale resolution and an extra render when
  // Canvas Settings changes dimensions.
  const followedWebmWidth = Math.max(2, Math.min(7680, Math.round(canvasSettings.width / 2) * 2));
  const followedWebmHeight = Math.max(2, Math.min(4320, Math.round(canvasSettings.height / 2) * 2));

  // One-tap resync if the user changes Canvas Settings after opening the
  // Export panel, or wants to snap back after picking a named preset —
  // mirrors the existing "Match source" affordance for uploaded media below.
  const handleMatchCanvasResolution = () => {
    const w = Math.max(2, Math.min(7680, Math.round(canvasSettings.width / 2) * 2));
    const h = Math.max(2, Math.min(4320, Math.round(canvasSettings.height / 2) * 2));
    setWebmCustomWidth(w);
    setWebmCustomHeight(h);
    setWebmPreset('Custom');
    setVideoResolutionFollowsCanvas(true);
    toast.success(`Export resolution matched to canvas: ${w}×${h}`);
  };

  
  // Code settings
  const [codeType, setCodeType] = useState<'css' | 'glsl'>('css');
  const [codeContent, setCodeContent] = useState('');
  const codeTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Update code content when switching tabs or code type
  useEffect(() => {
    if (activeTab === 'code') {
      if (codeType === 'css') {
        const result = generateCSSCode(layers);
        setCodeContent(result.code);
      } else {
        const visibleLayer = layers.find(l => l.visible) || layers[0];
        if (visibleLayer) {
          const g = visibleLayer.gradient;
          const anim = visibleLayer.animation;
          const tex = visibleLayer.texture;

          if (!g) {
            setCodeContent('// Shader export requires a gradient layer. The selected layer is media-based.');
            return;
          }

          const colorDefs = g.colors.map((c, i) => {
            const hex = c.color.replace('#', '');
            const r = (parseInt(hex.substring(0, 2), 16) / 255).toFixed(3);
            const gv = (parseInt(hex.substring(2, 4), 16) / 255).toFixed(3);
            const b2 = (parseInt(hex.substring(4, 6), 16) / 255).toFixed(3);
            return `  vec3 color${i} = vec3(${r}, ${gv}, ${b2}); // ${c.color} @ ${(c.position * 100).toFixed(0)}%`;
          }).join('\n');
          const colorPositions = g.colors.map((c, i) =>
            `  float pos${i} = ${c.position.toFixed(4)};`
          ).join('\n');

          let colorInterp = '  vec3 finalColor = color0;';
          if (g.colors.length > 1) {
            colorInterp = g.colors.slice(1).map((c, i) => {
              const prev = i;
              const curr = i + 1;
              return `  finalColor = mix(color${prev}, color${curr}, smoothstep(pos${prev}, pos${curr}, t));`;
            }).join('\n');
            colorInterp = '  vec3 finalColor = color0;\n' + colorInterp;
          }

          // Animation block
          const animBlock = anim?.enabled
            ? `// === ANIMATION SETTINGS ===
// Type:      ${anim.type}
// Speed:     ${anim.speed}x
// Intensity: ${anim.intensity}
// Direction: ${anim.direction || 'forward'}
// Easing:    ${anim.easing || 'linear'}
//
// In Shadertoy use iTime to drive animation:
//   float animTime = iTime * ${anim.speed.toFixed(2)};`
            : '// No layer animation active';

          // Texture block
          const texBlock = tex
            ? `// === TEXTURE OVERLAY ===
// Type:           ${tex.type}
// Opacity:        ${tex.opacity.toFixed(2)}
// Scale:          ${tex.scale.toFixed(2)}
// Intensity:      ${tex.intensity.toFixed(2)}
// Blend Mode:     ${tex.blendMode}
// Animate:        ${tex.animateTexture ? 'YES' : 'NO'}${tex.animateTexture ? `
// Anim Type:      ${tex.textureAnimationType || 'drift'}
// Anim Speed:     ${tex.animationSpeed || 15}` : ''}${tex.angle !== undefined ? `
// Angle:          ${tex.angle}°` : ''}${tex.blur !== undefined ? `
// Blur:           ${(tex.blur * 100).toFixed(0)}%` : ''}${tex.distortion !== undefined ? `
// Distortion:     ${(tex.distortion * 100).toFixed(0)}%` : ''}
//
// NOTE: Texture GLSL logic depends on texture type.
// See Blendcraft Studio texture shaders for full implementation.
// uniform float textureTime;  // driven by iTime * animSpeed
// uniform float textureScale; // = ${tex.scale.toFixed(2)}
// uniform float textureAngle; // = ${tex.angle ?? 90}.0 (degrees)`
            : '// No texture active';

          // Sort stops by position for correct rendering
          const sortedStops = [...g.colors].sort((a, b) => a.position - b.position);
          const scaleBoost = g.scaleBoost ?? 1;
          const effectiveScale = (g.scale ?? 1) * scaleBoost;

          // Expanded color defs from sorted stops
          const colorDefsExpanded = sortedStops.map((c, i) => {
            const hex = c.color.replace('#', '');
            const r = (parseInt(hex.substring(0, 2), 16) / 255).toFixed(3);
            const gv = (parseInt(hex.substring(2, 4), 16) / 255).toFixed(3);
            const b2 = (parseInt(hex.substring(4, 6), 16) / 255).toFixed(3);
            return `  vec3 color${i} = vec3(${r}, ${gv}, ${b2}); // ${c.color} @ ${(c.position * 100).toFixed(0)}%`;
          }).join('\n');
          const colorPositionsExpanded = sortedStops.map((c, i) =>
            `  float pos${i} = ${c.position.toFixed(4)};`
          ).join('\n');
          let colorInterpExpanded = `  vec3 finalColor = color0;`;
          if (sortedStops.length > 1) {
            colorInterpExpanded += '\n' + sortedStops.slice(1).map((c, i) =>
              `  finalColor = mix(color${i}, color${i+1}, smoothstep(pos${i}, pos${i+1}, t));`
            ).join('\n');
          }

          setCodeContent(`// ================================================
// Blendcraft Studio — GLSL Shader Export
// ================================================
// Gradient Type:   ${g.type}
// Canvas:          ${canvasSettings.width} × ${canvasSettings.height}
// Color Stops:     ${sortedStops.length} stops
// Rotation:        ${(g.angle ?? 0).toFixed(1)}°
// Scale:           ${(g.scale ?? 1).toFixed(3)}x${scaleBoost !== 1 ? ` (boost: ${scaleBoost.toFixed(3)}x → effective: ${effectiveScale.toFixed(3)}x)` : ''}
// Center:          ${(g.centerX ?? 0.5).toFixed(3)}, ${(g.centerY ?? 0.5).toFixed(3)}
// Twist:           ${(g.twist ?? 0).toFixed(3)}
// Intensity:       ${(g.intensity ?? 1).toFixed(2)}
// Animation:       ${anim?.enabled ? `${anim.type} @ ${anim.speed}x speed, ${anim.direction ?? 'forward'} direction, ${anim.easing ?? 'linear'} easing` : 'none'}
// Texture:         ${tex ? `${tex.type} · opacity ${tex.opacity?.toFixed(2) ?? '1.00'} · scale ${tex.scale?.toFixed(2) ?? '1.00'} · intensity ${tex.intensity?.toFixed(2) ?? '1.00'}${tex.animateTexture ? ` · animated (${tex.textureAnimationType ?? 'drift'} @ ${tex.animationSpeed ?? 15})` : ''}` : 'none'}
// Blend Mode:      ${(visibleLayer as any).blendMode ?? 'normal'}
// Shadertoy-compatible — paste into fragment shader
// ================================================

precision highp float;

${animBlock}

${texBlock}

// === GRADIENT COLORS ===
// Colors defined as RGB (0.0 – 1.0)

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 center = vec2(${(g.centerX ?? 0.5).toFixed(3)}, ${(g.centerY ?? 0.5).toFixed(3)});
  float angle = ${((g.angle ?? 0) * Math.PI / 180).toFixed(4)}; // ${(g.angle ?? 0).toFixed(1)} degrees
  float scale = ${(g.scale ?? 1).toFixed(3)};
  float time  = iTime;${anim?.enabled ? `
  float animTime = time * ${anim.speed.toFixed(2)}; // scaled by animation speed` : ''}

  // === COLOR STOPS (sorted by position, hex → linear RGB 0.0–1.0) ===
${colorDefsExpanded}

  // === STOP POSITIONS ===
${colorPositionsExpanded}

  // === GRADIENT CALCULATION (${g.type}) ===
  float t = 0.0;

${g.type === 'linear' ? `  // Linear gradient along angle direction
  vec2 dir = vec2(cos(angle), sin(angle));
  t = dot(uv - 0.5, dir) + 0.5;` :
g.type === 'radial' ? `  // Radial gradient from center point
  t = length((uv - center) / scale) * 1.414;` :
g.type === 'conic' ? `  // Conic (sweep) gradient from center
  vec2 d = uv - center;
  t = fract(atan(d.y, d.x) / (2.0 * 3.14159265) + 0.5);` :
`  // ${g.type} gradient
  t = length(uv - center) / scale;`}

  t = clamp(t, 0.0, 1.0);

  // === COLOR INTERPOLATION (smoothstep blend between sorted stops) ===
${colorInterpExpanded}

  // === FINAL OUTPUT ===
  fragColor = vec4(finalColor, 1.0);
}

// ================================================
// Usage notes:
//   • Paste into Shadertoy as a new shader
//   • Replace mainImage/iTime with main/gl_FragCoord for plain WebGL
//   • iResolution.xy → resolution uniform (vec2)
//   • For animated textures add: uniform float textureTime;
//     and drive it with: textureTime = iTime * animSpeed;
// ================================================`);
        }
      }
    }
  }, [activeTab, codeType, layers]);

  const getCanvas = (): HTMLCanvasElement | null => {
    return renderApiRef?.current?.getCanvas() || null;
  };

  const getPngResolution = (): { width: number; height: number } => {
    if (pngPreset === 'Custom') {
      return { width: pngCustomWidth, height: pngCustomHeight };
    }
    const preset = PNG_PRESETS.find(p => p.label === pngPreset);
    return preset ? { width: preset.width, height: preset.height } : { width: 1920, height: 1080 };
  };

  const getWebmResolution = (): { width: number; height: number } => {
    if (videoResolutionFollowsCanvas) {
      return { width: followedWebmWidth, height: followedWebmHeight };
    }
    if (webmPreset === 'Custom') {
      // clamp to even dimensions — VP9 encoder requires even width/height
      return {
        width:  Math.max(2, Math.round(webmCustomWidth  / 2) * 2),
        height: Math.max(2, Math.round(webmCustomHeight / 2) * 2),
      };
    }
    const preset = WEBM_PRESETS.find(p => p.label === webmPreset);
    return preset ? { width: preset.width, height: preset.height } : { width: 1920, height: 1080 };
  };

  // When a named preset is selected, sync the custom W/H fields so
  // switching to Custom afterwards starts from the preset's dimensions.
  const handleWebmPresetChange = (preset: string) => {
    setVideoResolutionFollowsCanvas(false);
    setWebmPreset(preset);
    if (preset !== 'Custom') {
      const found = WEBM_PRESETS.find(p => p.label === preset);
      if (found) {
        setWebmCustomWidth(found.width);
        setWebmCustomHeight(found.height);
      }
    }
  };

  const handleWebmWidthChange = (raw: number) => {
    setVideoResolutionFollowsCanvas(false);
    const w = Math.max(2, Math.min(7680, Math.round((raw || 1920) / 2) * 2));
    setWebmCustomWidth(w);
    if (webmAspectLocked && webmCustomHeight > 0) {
      const ratio = webmCustomWidth / webmCustomHeight;
      setWebmCustomHeight(Math.max(2, Math.round((w / ratio) / 2) * 2));
    }
    setWebmPreset('Custom');
  };

  const handleWebmHeightChange = (raw: number) => {
    setVideoResolutionFollowsCanvas(false);
    const h = Math.max(2, Math.min(4320, Math.round((raw || 1080) / 2) * 2));
    setWebmCustomHeight(h);
    if (webmAspectLocked && webmCustomWidth > 0) {
      const ratio = webmCustomWidth / webmCustomHeight;
      setWebmCustomWidth(Math.max(2, Math.round((h * ratio) / 2) * 2));
    }
    setWebmPreset('Custom');
  };

  // Phase 7.3B: one authoritative duration decision for preview, summary,
  // export planning, frame count, and Loop Lock status. This module only
  // decides duration; renderer-owned animation speed and phase remain intact.
  const durationPlan = useMemo(
    () => createLayerExportDurationPlan({
      requestedDurationMs: webmDuration * 1000,
      fps: webmFps,
      loopLockEnabled: loopPerfect,
      layers,
    }),
    [loopPerfect, webmDuration, webmFps, layers],
  );
  const effectiveDurationSec = durationPlan.effectiveDurationMs / 1000;
  const loopLockStatusLine = durationPlan.statusLabel;

  // Inline export metrics for the summary row
  const summaryBase = getWebmResolution();
  const summaryOutput = resolveVideoOutputDimensions(summaryBase.width, summaryBase.height, webmRenderScale);
  const { width: summaryW, height: summaryH } = summaryOutput;
  const summaryFrames  = Math.round(effectiveDurationSec * webmFps);
  const summaryWarnLevel: 'ok' | 'warn' | 'cap' =
    summaryFrames >= WEBM_FRAME_CONFIRM_LIMIT ? 'cap' :
    summaryFrames >= WEBM_FRAME_WARN_LIMIT    ? 'warn' : 'ok';
  // Format-aware bitrate: MP4 uses H.264-tuned presets (higher bitrates —
  // gradient content needs headroom to avoid banding on smooth ramps).
  const summaryBitrateBps = (videoFormat === 'mp4' ? MP4_QUALITY_PRESETS : VIDEO_QUALITY_PRESETS)[webmQuality].bitrate(summaryW, summaryH);
  const summaryFileMB     = (summaryBitrateBps * effectiveDurationSec / 8) / (1024 * 1024);

  // Source-aware quality floor (Stage 1): if an uploaded media source is
  // higher-resolution than the export target, nudge toward preserving it.
  const mediaSourceMax = useMemo(() => getMediaSourceMaxResolution(layers), [layers]);
  const mediaExceedsExport =
    !!mediaSourceMax &&
    (mediaSourceMax.width > summaryW || mediaSourceMax.height > summaryH);
  const summaryFileSzLabel = summaryFileMB < 1000
    ? `~${Math.round(summaryFileMB)} MB`
    : `~${(summaryFileMB / 1024).toFixed(1)} GB`;

  // Shared PNG export logic - used by both the PNG tab and social presets
  const exportPNG = async (width: number, height: number, label?: string) => {
    const api = renderApiRef?.current;
    if (!api?.renderAtTime) {
      toast.error('Render system not ready. Please try again.');
      return;
    }

    setIsExporting(true);
    setExportProgress(0);
    setExportMessage(`Exporting PNG at ${width}×${height}...`);

    let pngPreviewIsolation: ReturnType<typeof isolatePreview> | null = null;
    try {
      // Freeze the exact visible preview above the live WebGL canvas before any
      // export-resolution work. The live drawing buffer may be supersampled for
      // fidelity, but the user never sees that internal resize.
      const sourceCanvas = api.getCanvas();
      if (sourceCanvas) {
        pngPreviewIsolation = isolatePreview({
          sourceCanvas,
          readFramePixels: api.readFramePixels,
        });
      }
      api.pauseAnimation?.();

      // ── STAGE 2.8.2: THE PNG CANVAS JUMP, FOR REAL THIS TIME ──
      //
      // renderAtTime computes:  exportMasterTime = snapshot.masterTime + time
      // where snapshot.masterTime is captured by pauseAnimation() — i.e. the
      // clock is ALREADY anchored to the paused frame. `time` is a DELTA from
      // that anchor, which is why the video loop correctly passes i/fps from 0.
      //
      // Passing getCurrentTime() here passed the anchor a SECOND time, so the
      // still rendered at 2 × masterTime — the animation leapt forward by the
      // whole elapsed session. That is the jump: not layout (2.8.0b), not the
      // media seek (2.8.1, a real but separate bug), just double-counted time.
      //
      // 0 = "the exact frame pauseAnimation froze", which is what a still
      // capture means.
      const currentTime = 0;

      const filename = label
        ? `gradient-${label.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${width}x${height}.png`
        : `gradient-${width}x${height}.png`;

      // exportPNGAtSize now calls setExportSize internally (before render) and
      // restoreSize immediately after pixel capture (before toBlob) — FIX 4 canvas jump.
      await exportPNGAtSize(
        async (t) => { await api.renderAtTime(t, undefined, { seekMedia: false }); },
        width,
        height,
        filename,
        (pct, msg) => safeSetExportState(pct, msg),
        currentTime,
        () => api.readFramePixels?.() ?? null,
        () => api.getCanvas(),           // getLiveCanvas — fast GPU blit path
        (w, h) => api.setExportSize?.(w, h),  // resize to export dims before render
        () => api.restoreSize?.()        // restore preview size immediately after capture
      );

      safeSetExportState(100, 'PNG export complete');
      if (isMountedRef.current) toast.success(`✓ ${label ? `${label} ` : ''}PNG exported at ${width}×${height}`);
    } catch (error) {
      if (isMountedRef.current) {
        console.error('PNG export error:', error);
        toast.error(`PNG export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } finally {
      // MUST call resumeAnimation() after export — it resets isExportingRef=false
      // which unblocks the RAF loop. Without this, pressing Play does nothing because
      // the loop is permanently gated by isExportingRef=true from pauseAnimation().
      // The animation stays visually paused (isPlaying=false) but the loop can run.
      try { pngPreviewIsolation?.dispose(); } catch {}
      api.resumeAnimation?.();
      if (isMountedRef.current) {
        setIsExporting(false);
        setExportProgress(0);
        setExportMessage('');
      }
    }
  };

  // ============================================================
  // PNG EXPORT
  // ============================================================
  const handlePngExport = async () => {
    const { width, height } = getPngResolution();
    await exportPNG(width, height);
  };

  // ============================================================
  // SOCIAL MEDIA QUICK EXPORT
  // ============================================================
  const handleSocialExport = async (preset: typeof SOCIAL_PRESETS[number]) => {
    await exportPNG(preset.width, preset.height, preset.label);
  };

  // ============================================================
  // VIDEO EXPORT — WebM VP9 or MP4 H.264 (Stage 1 export fix)
  // ============================================================
  const handleWebmExport = async () => {
    const api = renderApiRef?.current;
    if (!api?.renderAtTime) {
      toast.error('Render system not ready. Please try again.');
      return;
    }
    const canvas = getCanvas();
    if (!canvas) {
      toast.error('Canvas not available. Please try again.');
      return;
    }
    const wantsMP4 = videoFormat === 'mp4';
    if (!wantsMP4 && !pickBestVideoMimeType()) {
      toast.error('WebM video not supported in this browser. Try Chrome or Firefox.');
      return;
    }
    if (wantsMP4 && mp4Supported !== true) {
      toast.error('MP4 export not available in this environment — use WebM instead.');
      return;
    }

    const base = getWebmResolution();
    // STAGE 3.2: apply render scale, keeping even dimensions (VP9 requires even).
    const outputDimensions = resolveVideoOutputDimensions(base.width, base.height, webmRenderScale);
    const { width, height } = outputDimensions;
    const plan = planWebMExport({
      width,
      height,
      fps: webmFps,
      targetDurationMs: webmDuration * 1000,
      // Phase 7.3B: duration and Loop Lock are resolved once by the shared
      // authority used by both the UI preview and the active export path.
      durationPlan,
      quality: webmQuality,
      loopLockEnabled: durationPlan.loopLockEnabled,
    });
    if (!confirmWebMExportPlan(plan)) return;
    const durationMs = plan.durationMs;

    const exportAbortController = new AbortController();
    exportAbortControllerRef.current = exportAbortController;

    setIsExporting(true, 'video', () => {
      safeSetExportState(Math.max(1, exportProgress), 'Cancelling export…');
      exportAbortController.abort('Export cancelled by user.');
    });
    setExportProgress(0);
    setExportMessage(`Preparing ${plan.estimateLabel}...`);

    try {
      // Phase 7.3E.6 production cutover: MP4 retains its established encoder
      // setup. WebM is now exclusively owned by the production recording bridge,
      // including preview isolation, export timing, and renderer restoration.
      if (wantsMP4) {
        api.configureExportTimeline?.({
          fps: plan.fps,
          totalFrames: plan.totalFrames,
          durationMs: plan.durationMs,
          loopLockEnabled: durationPlan.loopLockEnabled,
        });
        if (durationPlan.loopLockEnabled) {
          safeSetExportState(0, 'Resetting animation loop start...');
        }
        api.pauseAnimation?.({ resetExportPhase: durationPlan.loopLockEnabled });
        await new Promise(r => setTimeout(r, 30));
        if (exportAbortController.signal.aborted || !isMountedRef.current) return;

        const bakeStatus = await api.prepareAudioExport?.();
        if (bakeStatus) safeSetExportState(0, bakeStatus);
        if (exportAbortController.signal.aborted || !isMountedRef.current) {
          api.finishAudioExport?.();
          return;
        }
      }

      const sharedExportOptions = {
        canvas,
        renderFrameAtTime: (t: number) => api.renderAtTime(t, undefined),
        fps: plan.fps,
        durationMs,
        quality: plan.quality,
        width: plan.width,
        height: plan.height,
        getLiveCanvas: () => api.getCanvas(),
        getReadFramePixels: () => api.readFramePixels?.() ?? null,
        getFlashOverlayFrame: (t: number) => api.getExportFlashOverlay?.(t) ?? null,
        // ── STAGE 2.8.4: LOOP VERIFICATION ──
        // Only meaningful when loop lock is on — that's the setting that
        // CLAIMS the export loops, so it's the claim we measure. Costs one
        // extra rendered frame; reports a number instead of an assurance.
        verifyLoop: loopPerfect,
        onLoopVerified: (result: LoopVerificationResult) => {
          if (!isMountedRef.current) return;
          if (result.error) return; // check unavailable — say nothing rather than alarm
          if (result.seamless) {
            toast.success(`Loop verified — seamless wrap (${result.matchLabel} match)`);
          } else {
            // Honest, actionable, and not alarmist: the file is fine, the loop
            // point just isn't clean, and the usual cause is a subsystem whose
            // cycle doesn't divide into the locked duration.
            toast.warning(
              `Loop is not seamless (${result.matchLabel} match at the wrap). ` +
              `The export is fine — but an animated layer, texture, or video ` +
              `doesn't complete a whole cycle in ${(durationMs / 1000).toFixed(2)}s.`,
            );
          }
        },
        setExportSize: (w: number, h: number) => api.setExportSize?.(w, h),
        restoreSize: () => api.restoreSize?.(),
        codecSafety: plan.codecSafety,
        signal: exportAbortController.signal,
        onProgress: (progress: number, message?: string) => safeSetExportState(progress, message || ''),
      };

      if (wantsMP4) {
        // Repaired MP4/H.264 path: WebCodecs encode → vendored muxer (stco
        // offset fix). Falls back to VP9/WebM internally when the hardware
        // H.264 encoder is unavailable — surface that to the user.
        const mp4Options = {
          ...sharedExportOptions,
          filename: `gradient-${plan.width}x${plan.height}-${plan.fps}fps.mp4`,
        };
        await exportMP4FromCanvas(mp4Options);
        if (isMountedRef.current && !exportAbortController.signal.aborted) {
          if ((mp4Options as any).__fellBackToWebM) {
            toast.warning(`H.264 encoder unavailable — exported as WebM instead: ${plan.estimateLabel}`);
          } else {
            toast.success(`MP4 exported: ${plan.estimateLabel}`);
          }
        }
      } else {
        // Phase 7.3E.8 production cutover: WebM is rendered offline and encoded
        // with explicit per-frame timestamps. Render time can exceed playback
        // duration without stretching or duplicating the exported timeline.
        const previewIsolation = isolatePreview({
          sourceCanvas: canvas,
          readFramePixels: api.readFramePixels,
        });
        try {
          api.configureExportTimeline?.({
            fps: plan.fps,
            totalFrames: plan.totalFrames,
            durationMs: plan.durationMs,
            loopLockEnabled: durationPlan.loopLockEnabled,
          });
          if (durationPlan.loopLockEnabled) {
            safeSetExportState(0, 'Resetting animation loop start…');
          }
          api.pauseAnimation?.({ resetExportPhase: durationPlan.loopLockEnabled });
          const bakeStatus = await api.prepareAudioExport?.();
          if (bakeStatus) safeSetExportState(1, bakeStatus);

          await exportWebMFromCanvas({
            ...sharedExportOptions,
            filename: `gradient-${plan.width}x${plan.height}-${plan.fps}fps.webm`,
          });
          safeSetExportState(100, 'Export complete');
          if (isMountedRef.current && !exportAbortController.signal.aborted) {
            toast.success(`Frame-accurate WebM exported: ${plan.estimateLabel}`);
          }
        } finally {
          try { previewIsolation.dispose(); } catch {}
        }
      }
    } catch (error) {
      if (isMountedRef.current && !exportAbortController.signal.aborted) {
        console.error('Video export error:', error);
        toast.error(`Video export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } finally {
      if (exportAbortControllerRef.current === exportAbortController) {
        exportAbortControllerRef.current = null;
      }
      {
        api.finishAudioExport?.();
        if (api.cleanupExportSession) {
          await api.cleanupExportSession();
        } else {
          api.clearExportTimeline?.();
          api.resumeAnimation?.();
          api.restoreSize?.();
        }
      }
      // STAGE 2.8.3: hold the completed overlay briefly. The bar previously
      // vanished mid-count, so a long render ended with the panel simply
      // blanking and a file appearing — no confirmation that anything
      // succeeded. A short beat on "Export complete" closes the loop.
      // Skipped on abort (nothing completed) and when unmounted.
      if (isMountedRef.current && !exportAbortController.signal.aborted) {
        await new Promise((r) => setTimeout(r, 700));
      }
      if (isMountedRef.current) {
        setIsExporting(false);
        setExportProgress(0);
        setExportMessage('');
      }
    }
  };


  // ============================================================
  // SVG EXPORT
  // ============================================================
  const handleSvgExport = async () => {
    const api = renderApiRef?.current;
    const canvas = getCanvas();
    if (!canvas || !api) {
      toast.error('Canvas not available.');
      return;
    }

    setIsExporting(true);

    try {
      // STAGE 2.8.2: 0 = the frame pauseAnimation froze (see PNG path for why
      // passing the master clock double-counts it). seekMedia:false keeps the
      // video playhead where the user left it.
      await api.renderAtTime(0, undefined, { seekMedia: false });
      await exportAsSVG(canvas, layers, 'gradient-raster.svg');
      toast.success('SVG (PNG raster embedded) exported successfully!');
    } catch (error) {
      console.error('SVG export error:', error);
      toast.error('SVG export failed: ' + (error instanceof Error ? error.message : 'Unknown'));
    } finally {
      setIsExporting(false);
    }
  };

  // Copy code to clipboard
  const handleCopyCode = async () => {
    if (!codeContent) {
      toast.error('No code to copy');
      return;
    }
    try {
      await navigator.clipboard.writeText(codeContent);
      toast.success(`${codeType.toUpperCase()} code copied to clipboard!`);
    } catch (error) {
      toast.error('Failed to copy code');
    }
  };

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4 bg-transparent border-b border-zinc-800 rounded-none pb-0 h-auto">
          <TabsTrigger value="png" className="text-xs text-zinc-500 hover:text-zinc-300 data-[state=active]:text-[#51a2ff] data-[state=active]:bg-transparent border-none rounded-none pb-2 px-1">
            <FileImage className="w-3 h-3 mr-1" />
            PNG
          </TabsTrigger>
          <TabsTrigger value="video" className="text-xs text-zinc-500 hover:text-zinc-300 data-[state=active]:text-[#51a2ff] data-[state=active]:bg-transparent border-none rounded-none pb-2 px-1">
            <Video className="w-3 h-3 mr-1" />
            Video
          </TabsTrigger>
          <TabsTrigger value="social" className="text-xs text-zinc-500 hover:text-zinc-300 data-[state=active]:text-[#51a2ff] data-[state=active]:bg-transparent border-none rounded-none pb-2 px-1">
            <Sparkles className="w-3 h-3 mr-1" />
            Quick
          </TabsTrigger>
          <TabsTrigger value="code" className="text-xs text-zinc-500 hover:text-zinc-300 data-[state=active]:text-[#51a2ff] data-[state=active]:bg-transparent border-none rounded-none pb-2 px-1">
            <Code className="w-3 h-3 mr-1" />
            Code
          </TabsTrigger>
        </TabsList>

        {/* PNG Tab */}
        <TabsContent value="png" className="space-y-4 mt-4">
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Resolution Preset</Label>
              <SelectWrapper
                value={pngPreset}
                onValueChange={setPngPreset}
                options={PNG_PRESETS.map(p => ({ value: p.label, label: p.label }))}
                triggerClassName="border-zinc-700 text-zinc-100"
                contentClassName="bg-zinc-900 border-zinc-700"
              />
            </div>

            {pngPreset === 'Custom' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label className="text-xs">Width</Label>
                  <Input
                    type="number"
                    value={pngCustomWidth}
                    onChange={(e) => setPngCustomWidth(parseInt(e.target.value) || 1920)}
                    className="border-zinc-700 bg-zinc-900"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Height</Label>
                  <Input
                    type="number"
                    value={pngCustomHeight}
                    onChange={(e) => setPngCustomHeight(parseInt(e.target.value) || 1080)}
                    className="border-zinc-700 bg-zinc-900"
                  />
                </div>
              </div>
            )}

            <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
              <Label className="text-[10px] text-zinc-500 mb-1 block">Export Size</Label>
              <p className="text-sm font-medium text-zinc-100">
                {getPngResolution().width} × {getPngResolution().height}
              </p>
            </div>

            <Button
              onClick={handlePngExport}
              disabled={isExporting}
              className="w-full bg-gradient-to-r from-[#0066FF] via-[#0099FF] to-[#00CCFF] hover:from-[#0052CC] hover:via-[#0080DD] hover:to-[#00B8E6] text-white"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Exporting PNG...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Export PNG
                </>
              )}
            </Button>

            {isExporting && exportProgress > 0 && (
              <div className="space-y-1">
                <Progress value={exportProgress} className="h-2" />
                {exportMessage && (
                  <p className="text-xs text-zinc-500 text-center">{exportMessage}</p>
                )}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Video Tab */}
        <TabsContent value="video" className="space-y-4 mt-4">
          <div className="space-y-3">

            {/* Container format — Stage 1 export fix */}
            <div className="space-y-2">
              <Label>Format</Label>
              <SelectWrapper
                value={videoFormat}
                onValueChange={(v) => {
                  if (v === 'mp4' && mp4Supported !== true) {
                    toast.error(
                      mp4Supported === null
                        ? 'Still checking H.264 support — one moment.'
                        : 'This environment cannot encode H.264 (common in embedded previews and Electron hosts). Use WebM here, or test MP4 in a standalone Chrome/Edge tab.'
                    );
                    return;
                  }
                  setVideoFormat(v as 'webm' | 'mp4');
                }}
                options={[
                  {
                    value: 'mp4',
                    label: mp4Supported === true
                      ? 'MP4 (H.264) — universal playback (default)'
                      : mp4Supported === null
                        ? 'MP4 (H.264) — checking support…'
                        : 'MP4 (H.264) — unavailable in this environment',
                  },
                  { value: 'webm', label: 'WebM (VP9) — fallback format, smaller files' },
                ]}
                triggerClassName="border-zinc-700 text-zinc-100"
                contentClassName="bg-zinc-900 border-zinc-700"
              />
              {videoFormat === 'mp4' && (
                <p className="text-[10px] text-zinc-500">
                  Encoded with H.264. If this environment can't encode H.264, export falls back to WebM automatically before any frames are rendered.
                </p>
              )}
            </div>

            {/* Resolution preset */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Resolution</Label>
                <button
                  onClick={handleMatchCanvasResolution}
                  className="text-[10px] text-[#51a2ff] hover:text-[#7cb8ff] transition-colors"
                  title={`Match export resolution to canvas (${canvasSettings.width}×${canvasSettings.height})`}
                >
                  Match canvas ({canvasSettings.width}×{canvasSettings.height})
                </button>
              </div>
              <SelectWrapper
                value={webmPreset}
                onValueChange={handleWebmPresetChange}
                options={[
                  ...WEBM_PRESETS.map(p => ({ value: p.label, label: p.label })),
                  { value: 'Custom', label: 'Custom' },
                ]}
                triggerClassName="border-zinc-700 text-zinc-100"
                contentClassName="bg-zinc-900 border-zinc-700"
              />
            </div>

            {/* Custom resolution inputs — visible only when Custom is selected */}
            {webmPreset === 'Custom' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Custom dimensions</Label>
                  <button
                    onClick={() => setWebmAspectLocked(l => !l)}
                    className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                    title={webmAspectLocked ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
                  >
                    {webmAspectLocked
                      ? <><Link2 className="w-3 h-3" /> Locked</>
                      : <><Link2Off className="w-3 h-3" /> Unlocked</>
                    }
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-zinc-500">Width (px)</Label>
                    <Input
                      type="number"
                      min={64} max={7680} step={2}
                      value={videoResolutionFollowsCanvas ? followedWebmWidth : webmCustomWidth}
                      onChange={(e) => handleWebmWidthChange(parseInt(e.target.value) || 1920)}
                      className="border-zinc-700 bg-zinc-900 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-zinc-500">Height (px)</Label>
                    <Input
                      type="number"
                      min={64} max={4320} step={2}
                      value={videoResolutionFollowsCanvas ? followedWebmHeight : webmCustomHeight}
                      onChange={(e) => handleWebmHeightChange(parseInt(e.target.value) || 1080)}
                      className="border-zinc-700 bg-zinc-900 text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Quality */}
            <div className="space-y-2">
              <Label>Quality</Label>
              <SelectWrapper
                value={webmQuality}
                onValueChange={(v) => setWebmQuality(v as VideoQuality)}
                options={[
                  { value: 'standard', label: 'Standard — fast preview' },
                  { value: 'high',     label: 'High — balanced' },
                  { value: 'ultra',    label: 'Ultra — max quality' },
                  { value: 'sharpMax', label: 'Sharp Max — master / slow' },
                ]}
                triggerClassName="border-zinc-700 text-zinc-100"
                contentClassName="bg-zinc-900 border-zinc-700"
              />

            </div>

            {/* STAGE 3.2: Render scale — the biggest speed lever. */}
            <div className="space-y-2">
              <Label>Render scale <span className="font-normal text-zinc-500">— speed vs. resolution</span></Label>
              <SelectWrapper
                value={String(webmRenderScale)}
                onValueChange={(v) => setWebmRenderScale(Number(v))}
                options={[
                  { value: '1',    label: 'Full (1.0×) — best quality' },
                  { value: '0.75', label: '¾ (0.75×) — ~1.8× faster' },
                  { value: '0.5',  label: 'Half (0.5×) — ~4× faster' },
                ]}
                triggerClassName="border-zinc-700 text-zinc-100"
                contentClassName="bg-zinc-900 border-zinc-700"
              />
              {webmRenderScale < 1 && (
                <p className="text-[11px] leading-snug text-zinc-500">
                  Renders and encodes at {Math.round(webmRenderScale * 100)}% resolution — much faster, softer detail. Great for previews.
                </p>
              )}
            </div>

            {/* Frame rate + Duration */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label className="text-xs">Frame rate</Label>
                <SelectWrapper
                  value={String(webmFps)}
                  onValueChange={(v) => setWebmFps(Number(v))}
                  options={[
                    { value: '24', label: '24 fps' },
                    { value: '30', label: '30 fps' },
                    { value: '60', label: '60 fps' },
                  ]}
                  triggerClassName="border-zinc-700 text-zinc-100"
                  contentClassName="bg-zinc-900 border-zinc-700"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Duration (sec)</Label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={webmDurationDraft}
                  onChange={(e) => {
                    // Allow any intermediate value (including empty) so the
                    // field can be cleared and retyped. Only push a VALID number
                    // through to the export duration; don't clamp yet.
                    const raw = e.target.value;
                    setWebmDurationDraft(raw);
                    const n = parseInt(raw, 10);
                    if (!Number.isNaN(n)) {
                      setWebmDuration(Math.max(1, Math.min(60, n)));
                    }
                  }}
                  onBlur={() => {
                    // Commit: clamp to [1,60], defaulting to 5 only if the field
                    // was left empty/invalid, and re-sync the draft to the
                    // committed value.
                    const n = parseInt(webmDurationDraft, 10);
                    const committed = Number.isNaN(n)
                      ? 5
                      : Math.max(1, Math.min(60, n));
                    setWebmDuration(committed);
                    setWebmDurationDraft(String(committed));
                  }}
                  className="border-zinc-700 bg-zinc-900"
                />
              </div>
            </div>

            {/* Loop lock */}
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
              <div>
                <p className="text-xs font-medium text-zinc-200">Loop lock</p>
                <p className="text-[10px] text-zinc-500">{loopLockStatusLine}</p>
              </div>
              <Switch checked={loopPerfect} onCheckedChange={setLoopPerfect} />
            </div>

            {/* Export summary — live metrics */}
            <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1.5">
              <Label className="text-[10px] text-zinc-500 block">Export summary</Label>
              <p className="text-sm font-medium text-zinc-100">
                {summaryW} × {summaryH} · {webmFps} fps · {effectiveDurationSec.toFixed(effectiveDurationSec % 1 === 0 ? 0 : 2)}s · {videoFormat === 'mp4' ? 'MP4 H.264' : 'Production WebM'}
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                {/* Frame count with cap warning */}
                <span className={`text-[10px] font-medium ${
                  summaryWarnLevel === 'cap'  ? 'text-red-400' :
                  summaryWarnLevel === 'warn' ? 'text-amber-400' :
                  'text-zinc-500'
                }`}>
                  {summaryFrames.toLocaleString()} frames
                  {summaryWarnLevel === 'cap'  && ' · at hard cap'}
                  {summaryWarnLevel === 'warn' && ' · large export'}
                </span>
                {/* Estimated file size */}
                <span className="text-[10px] text-zinc-500">{summaryFileSzLabel}</span>
                {/* Bitrate */}
                <span className="text-[10px] text-zinc-600">
                  {(summaryBitrateBps / 1_000_000).toFixed(0)} Mbps
                </span>
              </div>
              {summaryWarnLevel !== 'ok' && (
                <p className="text-[10px] text-amber-500">
                  {summaryWarnLevel === 'cap'
                    ? `Hard cap: ${WEBM_FRAME_CONFIRM_LIMIT} frames max. Reduce duration, fps, or use loop lock.`
                    : `Large export — this may take a while to render.`}
                </p>
              )}
            </div>

            {/* Source-aware quality floor (Stage 1): uploaded media is higher
                resolution than the export target — offer a one-tap match so
                high-quality uploads export at high quality. */}
            {mediaExceedsExport && mediaSourceMax && (
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-[#51a2ff]/40 bg-[#51a2ff]/10">
                <p className="text-[10px] text-[#51a2ff]">
                  Uploaded media is {mediaSourceMax.width}×{mediaSourceMax.height} — export target is smaller and will downscale it.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-[#51a2ff]/50 text-[#51a2ff] hover:bg-[#51a2ff]/20 text-[10px] h-7 px-2 flex-shrink-0"
                  onClick={() => {
                    // Match source, clamped to encoder-safe even dims / 4K ceiling.
                    const w = Math.max(2, Math.min(7680, Math.round(mediaSourceMax.width / 2) * 2));
                    const h = Math.max(2, Math.min(4320, Math.round(mediaSourceMax.height / 2) * 2));
                    setWebmCustomWidth(w);
                    setWebmCustomHeight(h);
                    setWebmPreset('Custom');
                    setVideoResolutionFollowsCanvas(false);
                    toast.success(`Export resolution matched to source: ${w}×${h}`);
                  }}
                >
                  Match source
                </Button>
              </div>
            )}

            {/* Export button */}
            <Button
              onClick={handleWebmExport}
              disabled={isExporting}
              className="w-full bg-gradient-to-r from-[#0066FF] via-[#0099FF] to-[#00CCFF] hover:from-[#0052CC] hover:via-[#0080DD] hover:to-[#00B8E6] text-white"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Rendering video...
                </>
              ) : (
                <>
                  <Video className="w-4 h-4 mr-2" />
                  Export {videoFormat === 'mp4' ? 'MP4' : 'WebM'}
                </>
              )}
            </Button>

            {/* Cancel button — visible only during active export */}
            {isExporting && (
              <Button
                variant="outline"
                size="sm"
                onClick={requestExportCancellation}
                className="w-full border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"
              >
                Cancel Export
              </Button>
            )}

            {/* Progress */}
            {isExporting && exportProgress > 0 && (
              <div className="space-y-1">
                <Progress value={exportProgress} className="h-2" />
                {exportMessage && (
                  <p className="text-xs text-zinc-500 text-center">{exportMessage}</p>
                )}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="social" className="space-y-4 mt-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Social Media Quick Export</Label>
              <span className="text-xs text-zinc-500">PNG format</span>
            </div>
            <p className="text-xs text-zinc-500">
              One-click export at exact platform dimensions.
            </p>

            <div className="grid grid-cols-1 gap-2 mt-3">
              {SOCIAL_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handleSocialExport(preset)}
                  disabled={isExporting}
                  className="flex items-center justify-between p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-3">
                    <div className="text-left">
                      <p className="text-xs font-medium text-zinc-200 group-hover:text-white transition-colors">
                        {preset.label}
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        {preset.width} × {preset.height}
                      </p>
                    </div>
                  </div>
                  <Download className="w-3.5 h-3.5 text-zinc-500 group-hover:text-blue-400 transition-colors" />
                </button>
              ))}
            </div>

            {/* SVG Quick Export */}
            <div className="pt-2 border-t border-zinc-800">
              <Label className="text-xs text-zinc-500 mb-2 block">Other Formats</Label>
              <button
                onClick={handleSvgExport}
                disabled={isExporting}
                className="flex items-center justify-between w-full p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg leading-none">🖼️</span>
                  <div className="text-left">
                    <p className="text-xs font-medium text-zinc-200 group-hover:text-white transition-colors">
                      SVG (Raster Embed)
                    </p>
                    <p className="text-[10px] text-zinc-500">
                      PNG embedded in SVG · {canvasSettings.width} × {canvasSettings.height}
                    </p>
                  </div>
                </div>
                <Download className="w-3.5 h-3.5 text-zinc-500 group-hover:text-blue-400 transition-colors" />
              </button>
            </div>

            {isExporting && exportProgress > 0 && (
              <div className="space-y-1">
                <Progress value={exportProgress} className="h-2" />
                {exportMessage && (
                  <p className="text-xs text-zinc-500 text-center">{exportMessage}</p>
                )}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Code Tab */}
        <TabsContent value="code" className="space-y-4 mt-4">
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button
                variant={codeType === 'css' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCodeType('css')}
                className="flex-1"
              >
                CSS Gradient
              </Button>
              <Button
                variant={codeType === 'glsl' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCodeType('glsl')}
                className="flex-1"
              >
                GLSL Shader
              </Button>
            </div>

            <div className="relative">
              <textarea
                ref={codeTextareaRef}
                value={codeContent}
                readOnly
                className="w-full h-64 p-3 text-xs font-mono bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                spellCheck={false}
              />
            </div>

            {/* FIX: Notice moved BELOW the code textarea so users see the code first.
                Previously the notice appeared above the textarea — users read it as
                "this doesn't work" and never scrolled down to see the actual code. */}
            {codeType === 'css' && (
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
                <p className="text-xs text-blue-400">
                  ℹ️ CSS export is gradient-spec only — does not include textures, effects, masks, or animation. For full fidelity, export PNG, WebM, or MP4.
                </p>
              </div>
            )}

            {codeType === 'glsl' && (
              <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
                <p className="text-xs text-purple-400">
                  ✨ Shadertoy-compatible GLSL — paste into shadertoy.com or any WebGL fragment shader.
                </p>
              </div>
            )}

            <Button
              onClick={handleCopyCode}
              className="w-full bg-gradient-to-r from-[#0066FF] via-[#0099FF] to-[#00CCFF] hover:from-[#0052CC] hover:via-[#0080DD] hover:to-[#00B8E6] text-white"
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy {codeType.toUpperCase()} to Clipboard
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
