import { Label } from '../ui/label';
import { SelectWrapper } from '../ui/select-wrapper';
import { Slider } from '../ui/slider';
import { Switch } from '../ui/switch';
import { Eye, EyeOff, Upload, X, HelpCircle, Move, RotateCw, ScanSearch, Shapes, Check } from 'lucide-react';
import { Button } from '../ui/button';
import { FilteredButton } from '../ui/filtered-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import type { Layer, MaskConfig, MaskType } from '../../types/gradient';
import { isMediaLayerActive } from '../../media/mediaShader';
import { useRef, useState, useCallback, useEffect } from 'react';
import {
  MASK_SHAPE_CATEGORY_DESCRIPTIONS,
  MASK_SHAPE_CATEGORY_LABELS,
  MASK_SHAPE_CATEGORY_ORDER,
  getShapesByCategory,
  getShapeById,
  loadRasterMasks,
  type ShapePreset,
} from '../../lib/maskShapes';
import { rasterizeSVG, getRecommendedResolution } from '../../utils/svgRasterizer';
import { validateSVG, sanitizeSVG, checkSVGSize } from '../../utils/svgValidator';
import { validateUploadFile, validateBitmapDimensions } from '../../utils/uploadValidation';
import { MaskAnimationControls } from './MaskAnimationControls';

interface MaskControlsProps {
  layer: Layer;
  layers: Layer[];
  onUpdate: (mask: MaskConfig) => void;
  isPlaying?: boolean;
  onPlayToggle?: () => void;
}

const DEFAULT_MASK: MaskConfig = {
  type: 'none',
  sourceType: 'image',
  imageFit: 'contain',
  maskScale: 1,
  positionX: 0,
  positionY: 0,
  rotation: 0,
  expand: 0,
  bitmapSourceMode: 'alpha',
  bitmapThreshold: 0.5,
  invert: false,
  feather: 0,
  opacity: 1,
  mode: 'clip',
  visible: true,
  // Advanced — always explicit so uniform writes never fall through to wrong defaults
  blurQuality: 'none',
  tileMode: 'single',
  tileScale: 1,
  edgeDetect: false,
  edgeThickness: 2,
};


function encodeSvgForPreview(svgText: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
}

function isRenderableShapePreset(shape: ShapePreset | undefined): shape is ShapePreset {
  return Boolean(
    shape &&
    typeof shape.id === 'string' &&
    typeof shape.name === 'string' &&
    typeof shape.svgPath === 'string' &&
    shape.svgPath.trim().length > 0
  );
}

function ShapePreview({ shape }: { shape?: ShapePreset }) {
  if (!isRenderableShapePreset(shape)) {
    return (
      <div
        className="w-full h-full rounded bg-zinc-800/70"
        aria-hidden="true"
      />
    );
  }

  const source = shape.svgPath.trim();

  // Shape Pack v1 entries can store a full SVG document instead of only a
  // path `d` string. A full SVG cannot be placed inside <path d="...">,
  // which caused blank library preview cards even though the same asset
  // rasterized correctly on the canvas. Render full SVG docs as images and
  // keep original built-in path presets on the lightweight inline <svg> path.
  if (source.includes('<svg')) {
    return (
      <img
        src={encodeSvgForPreview(source)}
        alt=""
        className="w-full h-full object-contain pointer-events-none"
        draggable={false}
      />
    );
  }

  const viewBox = shape.viewBox &&
    Number.isFinite(shape.viewBox.x) &&
    Number.isFinite(shape.viewBox.y) &&
    Number.isFinite(shape.viewBox.w) &&
    Number.isFinite(shape.viewBox.h)
      ? shape.viewBox
      : { x: 0, y: 0, w: 100, h: 100 };

  return (
    <svg
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      className="w-full h-full pointer-events-none"
    >
      <path
        d={shape.svgPath}
        fill={shape.renderMode === 'wireframe' ? 'none' : 'white'}
        stroke={shape.renderMode === 'wireframe' ? 'white' : 'none'}
        strokeWidth={shape.renderMode === 'wireframe' ? (shape.defaultStrokeWidth || 3) : 0}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function clampScale(v?: number) {
  return Math.min(3, Math.max(0.1, v ?? 1));
}

export function MaskControls({ layer, layers, onUpdate, isPlaying, onPlayToggle }: MaskControlsProps) {
  const currentMask: MaskConfig = {
    ...DEFAULT_MASK,
    ...(layer.mask || {}),
    maskScale: clampScale(layer.mask?.maskScale),
  };

  const [uploading, setUploading] = useState(false);
  const [showShapePicker, setShowShapePicker] = useState(false);
  const [rasterizing, setRasterizing] = useState(false);
  // Sprint B: raster shapes are lazy-loaded (separate Vite chunk) to keep initial bundle lean
  const [rasterShapesLoaded, setRasterShapesLoaded] = useState(false);

  // Load the heavy raster mask shapes once on first mount (not at app start)
  useEffect(() => {
    if (rasterShapesLoaded) return;
    loadRasterMasks().then(() => setRasterShapesLoaded(true)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Incremented when Reset is clicked — remounts MaskAnimationControls to guarantee
  // slider internal state flushes and shows the reset values (speed=5, intensity=50).
  const [animResetKey, setAnimResetKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Local slider states — thumb moves instantly (fast UI), canvas updates on commit only.
  // This matches GradientControls pattern and eliminates per-pixel-of-drag re-renders.
  const [localPositionX,   setLocalPositionX]   = useState((layer.mask?.positionX   ?? 0) * 100);
  const [localPositionY,   setLocalPositionY]   = useState((layer.mask?.positionY   ?? 0) * 100);
  const [localMaskScale,   setLocalMaskScale]   = useState(clampScale(layer.mask?.maskScale));
  const [localRotation,    setLocalRotation]    = useState(layer.mask?.rotation    ?? 0);
  const [localStrokeWidth, setLocalStrokeWidth] = useState(layer.mask?.svgStrokeWidth ?? 3);
  const [localThreshold,   setLocalThreshold]   = useState((layer.mask?.bitmapThreshold ?? 0.5) * 100);
  const [localOpacity,     setLocalOpacity]     = useState((layer.mask?.opacity     ?? 1)    * 100);
  const [localExpand,      setLocalExpand]      = useState(layer.mask?.expand       ?? 0);
  const [localFeather,     setLocalFeather]     = useState(layer.mask?.feather      ?? 0);

  // Keep the latest mask/onUpdate in refs so RAF-driven slider previews never
  // write from a stale render. The previous zero-dependency RAF callback could
  // merge slider changes into an old DEFAULT_MASK snapshot, which stripped the
  // active imageUrl/svgText and made the canvas fall back to the raw gradient.
  const currentMaskRef = useRef(currentMask);
  const onUpdateRef = useRef(onUpdate);

  useEffect(() => {
    currentMaskRef.current = currentMask;
    onUpdateRef.current = onUpdate;
  }, [currentMask, onUpdate]);

  const handleMaskChange = useCallback((updates: Partial<MaskConfig>) => {
    const baseMask = currentMaskRef.current;
    const newMask: MaskConfig = {
      ...baseMask,
      ...updates,
    };

    if (updates.type === 'image' && !newMask.sourceType) {
      newMask.sourceType = newMask.svgText ? 'svg' : 'image';
    }

    newMask.imageFit = 'contain';
    newMask.maskScale = clampScale(newMask.maskScale);
    newMask.positionX = newMask.positionX ?? 0;
    newMask.positionY = newMask.positionY ?? 0;
    newMask.rotation = newMask.rotation ?? 0;
    newMask.expand = newMask.expand ?? 0;
    newMask.visible = newMask.visible ?? true;

    // Store immediately so multiple same-frame slider updates are merged into
    // the newest mask source instead of the previous React render snapshot.
    currentMaskRef.current = newMask;
    onUpdateRef.current(newMask);
  }, []);

  // ── RAF-throttled live canvas preview for drag operations ─────────────────
  const rafLiveRef = useRef<number>(0);
  const pendingLiveRef = useRef<Partial<MaskConfig> | null>(null);

  const scheduleLiveUpdate = useCallback((updates: Partial<MaskConfig>) => {
    pendingLiveRef.current = { ...(pendingLiveRef.current || {}), ...updates };
    if (!rafLiveRef.current) {
      rafLiveRef.current = requestAnimationFrame(() => {
        const pending = pendingLiveRef.current;
        pendingLiveRef.current = null;
        rafLiveRef.current = 0;
        if (pending) handleMaskChange(pending);
      });
    }
  }, [handleMaskChange]);

  const cancelLiveUpdate = useCallback(() => {
    if (rafLiveRef.current) {
      cancelAnimationFrame(rafLiveRef.current);
      rafLiveRef.current = 0;
    }
    pendingLiveRef.current = null;
  }, []);

  // Cancel any pending RAF on unmount
  useEffect(() => () => { cancelLiveUpdate(); }, [cancelLiveUpdate]);

  const syncLocalMaskControls = useCallback((mask: Partial<MaskConfig>) => {
    if (mask.positionX !== undefined) setLocalPositionX((mask.positionX ?? 0) * 100);
    if (mask.positionY !== undefined) setLocalPositionY((mask.positionY ?? 0) * 100);
    if (mask.maskScale !== undefined) setLocalMaskScale(clampScale(mask.maskScale));
    if (mask.rotation !== undefined) setLocalRotation(mask.rotation ?? 0);
    if (mask.svgStrokeWidth !== undefined) setLocalStrokeWidth(mask.svgStrokeWidth ?? 3);
    if (mask.bitmapThreshold !== undefined) setLocalThreshold((mask.bitmapThreshold ?? 0.5) * 100);
    if (mask.opacity !== undefined) setLocalOpacity((mask.opacity ?? 1) * 100);
    if (mask.expand !== undefined) setLocalExpand(mask.expand ?? 0);
    if (mask.feather !== undefined) setLocalFeather(mask.feather ?? 0);
  }, []);

  const resetMaskTransformControls = useCallback(() => {
    cancelLiveUpdate();
    const defaultStroke = currentMask.svgShapeId ? (getShapeById(currentMask.svgShapeId)?.defaultStrokeWidth || 3) : 3;
    const reset: Partial<MaskConfig> = {
      positionX: 0,
      positionY: 0,
      maskScale: 1,
      rotation: 0,
      svgStrokeWidth: defaultStroke,
      blurQuality: 'none',
      tileMode: 'single',
      tileScale: 1,
      edgeDetect: false,
      edgeThickness: 2,
    };
    handleMaskChange(reset);
    syncLocalMaskControls(reset);
  }, [cancelLiveUpdate, currentMask.svgShapeId, handleMaskChange, syncLocalMaskControls]);

  const resetMaskOpacityControls = useCallback(() => {
    cancelLiveUpdate();
    const reset: Partial<MaskConfig> = {
      opacity: 1,
      expand: 0,
      feather: 0,
      mode: 'clip',
      invert: false,
      bitmapThreshold: 0.5,
    };
    handleMaskChange(reset);
    syncLocalMaskControls(reset);
  }, [cancelLiveUpdate, handleMaskChange, syncLocalMaskControls]);

  const resetMaskAnimationControls = useCallback(() => {
    cancelLiveUpdate();
    const reset: Partial<MaskConfig> = {
      positionX: 0,
      positionY: 0,
      animation: {
        enabled: currentMask.animation?.enabled ?? false,
        type: currentMask.animation?.type ?? 'rotate',
        easing: currentMask.animation?.easing ?? 'linear',
        loop: currentMask.animation?.loop ?? true,
        direction: currentMask.animation?.direction ?? 'forward',
        speed: 5,
        intensity: 50,
      },
    };
    handleMaskChange(reset);
    syncLocalMaskControls(reset);
    setAnimResetKey(k => k + 1);
  }, [cancelLiveUpdate, currentMask.animation, handleMaskChange, syncLocalMaskControls]);

  const maskTypes: { value: MaskType; label: string }[] = [
    { value: 'none', label: 'No Mask' },
    { value: 'alpha', label: 'Alpha Mask' },
    { value: 'luminance', label: 'Luminance Mask' },
    { value: 'image', label: 'Source Mask (Image / SVG)' },
    // 2.7 — MEDIA AS MASK SOURCE: use another layer's uploaded image/video as
    // this layer's mask. Reuses the existing image-mask shader path entirely;
    // the media texture is already decoded and cached.
    { value: 'layer', label: 'Media Layer Mask' },
  ];

  // Media layers eligible to act as a mask source (exclude this layer itself —
  // a layer masking itself is a no-op that just multiplies by its own alpha).
  const mediaLayerOptions = layers
    .filter(l => l.id !== layer.id && isMediaLayerActive(l.media))
    .map(l => ({ value: l.id, label: l.name || 'Media layer' }));

  const maskModes: Array<{ value: 'clip' | 'add' | 'subtract' | 'intersect'; label: string }> = [
    { value: 'clip', label: 'Clip' },
    { value: 'add', label: 'Add' },
    { value: 'subtract', label: 'Subtract' },
    { value: 'intersect', label: 'Intersect' },
  ];

  const parseSvgViewBox = (svgText: string) => {
    const match = svgText.match(/viewBox\s*=\s*["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/i);
    if (!match) return undefined;
    return {
      x: parseFloat(match[1]),
      y: parseFloat(match[2]),
      width: parseFloat(match[3]),
      height: parseFloat(match[4]),
    };
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');

    try {
      const fileValidation = validateUploadFile(file, 'mask-image');
      if (!fileValidation.ok) {
        alert(fileValidation.error || 'Invalid mask file');
        return;
      }

      const dimensionValidation = await validateBitmapDimensions(file);
      if (!dimensionValidation.ok) {
        alert(dimensionValidation.error || 'Invalid image dimensions');
        return;
      }

      let svgText: string | undefined;
      let svgViewBox: MaskConfig['svgViewBox'];
      if (isSvg) {
        const rawSvgText = await file.text();

        // Check file size before parsing/rasterizing.
        if (!checkSVGSize(rawSvgText, 500)) {
          alert('SVG file is too large (max 500KB)');
          return;
        }

        // Validate raw SVG first, then sanitize and validate again to prevent unsafe markup.
        const rawValidation = validateSVG(rawSvgText);
        if (!rawValidation.isValid) {
          alert(`SVG validation failed: ${rawValidation.error}`);
          return;
        }

        svgText = sanitizeSVG(rawSvgText);
        const sanitizedValidation = validateSVG(svgText);
        if (!sanitizedValidation.isValid) {
          alert(`SVG validation failed after sanitization: ${sanitizedValidation.error}`);
          return;
        }

        // Use extracted viewBox from sanitized validation or parse it
        svgViewBox = sanitizedValidation.viewBox || parseSvgViewBox(svgText);
      }

      const base64String = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

      // Reset mask controls to clean defaults whenever a new source is uploaded.
      // This prevents previous-image settings from carrying over into the new source.
      handleMaskChange({
        type: 'image',
        sourceType: isSvg ? 'svg' : 'image',
        imageUrl: base64String,
        previewImageUrl: base64String, // Static preview for thumbnail
        svgText,
        svgViewBox,
        imageFit: 'contain',
        mode: 'clip',
        opacity: 1,
        feather: 0,
        expand: 0,
        maskScale: 1,
        positionX: 0,
        positionY: 0,
        rotation: 0,
        bitmapSourceMode: 'alpha',
        bitmapThreshold: 0.5,
        invert: false,
        visible: true,
        // Reset advanced controls — prevents blur/tile/edge from carrying over to new source
        blurQuality: 'none',
        tileMode: 'single',
        tileScale: 1,
        edgeDetect: false,
        edgeThickness: 2,
      });
    } finally {
      setUploading(false);
      if (event.target) event.target.value = '';
    }
  };

  const handleShapeSelect = async (shape: ShapePreset) => {
    // Sprint 4: No client-side rasterization — GradientCanvas rasterizes via
    // createSvgMaskTexture when the mask loading effect fires. Previously this
    // called rasterizeSVG() and stored the result as imageUrl + previewImageUrl
    // (~2MB PNG data URL each), which ballooned every autosave to ~4MB and filled
    // 50 undo history slots with the same rasterized PNG (4.9MB total heap waste).
    //
    // previewImageUrl: use a lightweight inline SVG data URL for the sidebar thumbnail.
    // imageUrl: not set for SVG sources — GradientCanvas needs svgText, not a bitmap URL.
    handleMaskChange({
      type: 'image',
      sourceType: 'svg',
      previewImageUrl: encodeSvgForPreview(shape.svgPath), // Lightweight SVG preview
      svgText: shape.svgPath,
      svgViewBox: {
        x: shape.viewBox.x,
        y: shape.viewBox.y,
        width: shape.viewBox.w,
        height: shape.viewBox.h
      },
      svgShapeId: shape.id,
      svgRenderMode: shape.renderMode,
      svgStrokeWidth: shape.defaultStrokeWidth || 3,
      imageFit: 'contain',
      mode: 'clip',
      opacity: 1,
      feather: 0,
      expand: 0,
      maskScale: 1,
      positionX: 0,
      positionY: 0,
      rotation: 0,
      bitmapSourceMode: 'alpha',
      bitmapThreshold: 0.5,
      invert: false,
      visible: true,
      blurQuality: 'none',
      tileMode: 'single',
      tileScale: 1,
      edgeDetect: false,
      edgeThickness: 2,
    });

    // Keep the library open so users can audition shapes quickly. The existing
    // Hide Shape Library button remains the explicit collapse control.
  };

  const handleStrokeWidthChange = (newStrokeWidth: number) => {
    // Update svgStrokeWidth state only. GradientCanvas's mask-texture loading
    // effect sees maskPropertiesKey change (svgStrokeWidth is tracked there) and
    // re-rasterizes via createSvgMaskTexture, which now injects a <style> stroke
    // override for full SVG documents. No pre-rasterization needed here.
    handleMaskChange({ svgStrokeWidth: newStrokeWidth });
  };

  const sourceLabel = currentMask.sourceType === 'svg' ? 'SVG Vector Source' : 'Bitmap Source';
  // Re-computed whenever raster shapes finish loading (rasterShapesLoaded causes re-render).
  // getShapesByCategory reads from MASK_SHAPES (static) + _rasterCache (populated by loadRasterMasks).
  const shapePickerCategories = MASK_SHAPE_CATEGORY_ORDER
    .map(category => ({ category, shapes: getShapesByCategory(category, rasterShapesLoaded) }))
    .filter(({ shapes }) => shapes.length > 0);
  const selectedLibraryShapeCandidate = currentMask.svgShapeId
    ? getShapeById(currentMask.svgShapeId)
    : undefined;
  const selectedLibraryShape = isRenderableShapePreset(selectedLibraryShapeCandidate)
    ? selectedLibraryShapeCandidate
    : undefined;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-zinc-100">Mask Settings</h3>
          <div
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              currentMask.type !== 'none'
                ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]'
                : 'bg-zinc-600'
            }`}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <FilteredButton className="text-zinc-500 hover:text-zinc-300 transition-colors">
                <HelpCircle className="w-4 h-4" />
              </FilteredButton>
            </TooltipTrigger>
            <TooltipContent side="right" className="bg-zinc-800 border-zinc-700 text-zinc-100 max-w-xs">
              <p className="text-xs">
                <strong>Mask v2 foundation</strong> adds source-aware mask controls for Image and SVG uploads, plus transform controls and stabilized image-mask rendering. SVG upload is stored and previewed now; true vector-native rendering and full Expand processing land in the next phase.
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
        {currentMask.type !== 'none' && (
          <div className="flex items-center gap-3">
            {uploading && <span className="text-xs text-yellow-400 animate-pulse">Processing...</span>}
            <Tooltip>
              <TooltipTrigger asChild>
                <FilteredButton
                  onClick={() => handleMaskChange({ visible: !(currentMask.visible ?? true) })}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
                >
                  {(currentMask.visible ?? true) ? (
                    <Eye className="w-4 h-4 text-blue-400" />
                  ) : (
                    <EyeOff className="w-4 h-4 text-zinc-600" />
                  )}
                  <Label className="text-xs text-zinc-400 cursor-pointer">
                    {(currentMask.visible ?? true) ? 'Visible' : 'Hidden'}
                  </Label>
                </FilteredButton>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="bg-zinc-800 border-zinc-700 text-zinc-100">
                <p className="text-xs">Toggle mask visibility without removing the source.</p>
              </TooltipContent>
            </Tooltip>

            <div className="flex items-center gap-2">
              <Label className="text-xs text-zinc-400">Invert</Label>
              <Switch
                checked={currentMask.invert}
                onCheckedChange={(checked) => handleMaskChange({ invert: checked })}
              />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-zinc-800 pt-3">
        <div className="space-y-2">
          <Label className="text-xs text-zinc-400">Mask Type</Label>
          <SelectWrapper
            value={currentMask.type}
            onValueChange={(value) => {
              const nextType = value as MaskType;
              handleMaskChange({
                type: nextType,
                sourceType:
                  nextType === 'alpha'
                    ? 'alpha'
                    : nextType === 'luminance'
                      ? 'luminance'
                      : currentMask.sourceType || 'image',
              });
            }}
            options={maskTypes}
            triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
            contentClassName="bg-zinc-900 border-zinc-700"
          />
        </div>

        {/* 2.7 — MEDIA LAYER MASK: pick which media layer drives this mask, and
            whether its LUMINANCE (bright = visible) or ALPHA drives it.
            Luminance is the default — it's what makes photographic media
            useful as a mask at all. */}
        {currentMask.type === 'layer' && (
          <div className="space-y-3">
            {mediaLayerOptions.length === 0 ? (
              <div className="p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10">
                <p className="text-[10px] text-amber-400">
                  No other media layers available. Upload an image or video to another layer to use it as a mask source.
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label className="text-xs text-zinc-400">Mask source layer</Label>
                  <SelectWrapper
                    value={currentMask.sourceLayerId || ''}
                    onValueChange={(value) => handleMaskChange({ sourceLayerId: value })}
                    options={mediaLayerOptions}
                    placeholder="Select a media layer"
                    triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
                    contentClassName="bg-zinc-900 border-zinc-700"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-zinc-400">Driven by</Label>
                  <SelectWrapper
                    value={currentMask.bitmapSourceMode || 'luminance'}
                    onValueChange={(value) => handleMaskChange({ bitmapSourceMode: value as 'luminance' | 'alpha' })}
                    options={[
                      { value: 'luminance', label: 'Luminance — bright areas show' },
                      { value: 'alpha', label: 'Alpha — transparency shows' },
                    ]}
                    triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
                    contentClassName="bg-zinc-900 border-zinc-700"
                  />
                </div>
              </>
            )}
          </div>
        )}

        {/* 2.7 — MEDIA LAYER MASK: pick which media layer drives this mask. */}
        {currentMask.type === 'layer' && (
          <div className="space-y-2">
            <Label className="text-xs text-zinc-400">Media source layer</Label>
            {mediaLayerOptions.length === 0 ? (
              <p className="text-[10px] text-amber-400">
                No other media layers available — upload an image or video on another layer first.
              </p>
            ) : (
              <>
                <SelectWrapper
                  value={currentMask.sourceLayerId ?? ''}
                  onValueChange={(value) => handleMaskChange({ sourceLayerId: value })}
                  options={mediaLayerOptions}
                  triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
                  contentClassName="bg-zinc-900 border-zinc-700"
                />
                <div className="space-y-2 pt-1">
                  <Label className="text-xs text-zinc-400">Read from</Label>
                  <SelectWrapper
                    value={currentMask.bitmapSourceMode ?? 'luminance'}
                    onValueChange={(value) => handleMaskChange({ bitmapSourceMode: value as 'luminance' | 'alpha' })}
                    options={[
                      { value: 'luminance', label: 'Luminance — bright areas show' },
                      { value: 'alpha', label: 'Alpha — transparency' },
                    ]}
                    triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
                    contentClassName="bg-zinc-900 border-zinc-700"
                  />
                </div>
                <p className="text-[10px] text-zinc-500">
                  Uses that layer’s media as this layer’s mask. Invert, feather, and mask mode all apply.
                </p>
              </>
            )}
          </div>
        )}

        {currentMask.type === 'image' && (
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml,.svg"
              onChange={handleFileUpload}
              className="hidden"
            />

            {/* Shape Library Button */}
            {!currentMask.imageUrl && (
              <Button
                onClick={() => setShowShapePicker(!showShapePicker)}
                variant="outline"
                className="w-full border-zinc-700 hover:bg-zinc-800 text-zinc-100"
              >
                <Shapes className="w-4 h-4 mr-2" />
                {showShapePicker ? 'Hide' : 'Show'} Shape Library
              </Button>
            )}

            {/* Shape Picker Grid */}
            {showShapePicker && !currentMask.imageUrl && (
              <div className="space-y-3 p-3 border border-zinc-700 rounded-lg bg-zinc-900/50 max-h-[400px] overflow-y-auto">
                <div className="space-y-0.5 border-b border-zinc-800 pb-2">
                  <Label className="text-xs font-semibold text-zinc-200">Mask Shape Library</Label>
                  <p className="text-[10px] text-zinc-500">
                    Premium glyph categories are shared with Shape Pattern textures for consistent mask + texture workflows.
                  </p>
                </div>

                {selectedLibraryShape && (
                  <div className="sticky top-0 z-10 flex items-center gap-3 rounded-md border border-cyan-500/70 bg-zinc-950/95 p-2 backdrop-blur-sm">
                    <div className="h-12 w-12 shrink-0 rounded-md border border-cyan-500/50 bg-zinc-800 p-1.5">
                      <ShapePreview shape={selectedLibraryShape} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-cyan-400" />
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-cyan-300">Selected mask</span>
                      </div>
                      <p className="truncate text-xs font-medium text-zinc-100">{selectedLibraryShape.name}</p>
                      <p className="truncate text-[10px] text-zinc-500">
                        {MASK_SHAPE_CATEGORY_LABELS[selectedLibraryShape.category]} · {selectedLibraryShape.renderMode === 'wireframe' ? 'Wireframe' : 'Filled'}
                      </p>
                    </div>
                  </div>
                )}

                {shapePickerCategories.map(({ category, shapes }) => (
                  <div key={category} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-xs text-zinc-300">{MASK_SHAPE_CATEGORY_LABELS[category]}</Label>
                        <p className="text-[10px] text-zinc-500 leading-tight">{MASK_SHAPE_CATEGORY_DESCRIPTIONS[category]}</p>
                      </div>
                      <span className="text-[10px] text-zinc-500">{shapes.length}</span>
                    </div>

                    <div className="grid grid-cols-6 gap-1.5">
                      {shapes.map(shape => {
                        const isSelected = currentMask.svgShapeId === shape.id;
                        return (
                        <Tooltip key={shape.id}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => handleShapeSelect(shape)}
                              disabled={rasterizing}
                              className={`aspect-square rounded-md border transition-all p-1.5 disabled:opacity-50 relative ${
                                isSelected
                                  ? 'border-cyan-400 bg-cyan-950/50 ring-1 ring-cyan-400 hover:bg-cyan-950/70'
                                  : category === 'custom'
                                    ? 'border-cyan-700 bg-zinc-800 hover:border-cyan-500 hover:bg-zinc-700'
                                    : 'border-zinc-700 bg-zinc-800 hover:border-blue-500 hover:bg-zinc-700'
                              }`}
                              aria-label={`${isSelected ? 'Selected: ' : 'Select '}${shape.name} mask shape`}
                              aria-pressed={isSelected}
                            >
                              <ShapePreview shape={shape} />
                              {isSelected && (
                                <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-cyan-400 text-zinc-950">
                                  <Check className="h-3 w-3" />
                                </span>
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="bg-zinc-800 border-zinc-700 text-zinc-100">
                            <div className="text-xs max-w-48">
                              <p className="font-semibold">{shape.name}</p>
                              <p className="text-[10px] text-zinc-500">{MASK_SHAPE_CATEGORY_LABELS[shape.category]}</p>
                              {shape.description && <p className="text-zinc-400 text-[10px] mt-0.5">{shape.description}</p>}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {rasterizing && (
                  <div className="text-center sticky bottom-0 bg-zinc-900/95 py-2">
                    <span className="text-xs text-yellow-400 animate-pulse">Rasterizing shape...</span>
                  </div>
                )}
              </div>
            )}

            {!currentMask.imageUrl && !showShapePicker && (
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                variant="outline"
                className="w-full border-zinc-700 hover:bg-zinc-800 text-zinc-100"
              >
                <Upload className="w-4 h-4 mr-2" />
                {uploading ? 'Uploading...' : 'Upload Custom Image or SVG'}
              </Button>
            )}

            {currentMask.imageUrl && (
              <div className="relative space-y-2">
                <div className="h-40 rounded-lg border border-zinc-700 bg-zinc-900 overflow-hidden relative">
                  <img src={currentMask.previewImageUrl || currentMask.imageUrl} alt="Mask preview" className="w-full h-full object-contain" />
                  {currentMask.svgShapeId && (() => {
                    const shape = getShapeById(currentMask.svgShapeId);
                    return shape ? (
                      <span className="absolute bottom-1 right-1 text-[10px] text-white/70 bg-black/40 px-1.5 py-0.5 rounded backdrop-blur-sm">
                        {shape.name}
                      </span>
                    ) : null;
                  })()}
                </div>

                <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    {currentMask.sourceType === 'svg' ? (
                      <ScanSearch className="w-3.5 h-3.5 text-cyan-400" />
                    ) : (
                      <Upload className="w-3.5 h-3.5 text-zinc-400" />
                    )}
                    <span className="text-[11px] font-medium text-zinc-200 truncate">{sourceLabel}</span>
                  </div>
                  <Button
                    onClick={() => {
                      // Clear the mask source but keep type='image' to stay on mask page
                      handleMaskChange({
                        imageUrl: undefined,
                        svgText: undefined,
                        // Reset advanced controls when shape is removed
                        blurQuality: 'none',
                        tileMode: 'single',
                        tileScale: 1,
                        edgeDetect: false,
                        edgeThickness: 2,
                        svgViewBox: undefined,
                        svgShapeId: undefined,
                        svgRenderMode: undefined,
                        svgStrokeWidth: undefined,
                      });
                    }}
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 bg-red-950/80 hover:bg-red-900 text-red-400"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    size="sm"
                    variant="outline"
                    className="border-zinc-700 hover:bg-zinc-800 text-zinc-100 text-xs"
                  >
                    Change Source
                  </Button>
                  <Button
                    onClick={resetMaskTransformControls}
                    size="sm"
                    variant="outline"
                    className="border-zinc-700 hover:bg-zinc-800 text-blue-400 hover:text-blue-300 text-xs"
                  >
                    Reset Sliders
                  </Button>
                </div>
              </div>
            )}

            {currentMask.imageUrl && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-zinc-400 flex items-center gap-1"><Move className="w-3 h-3" /> X</Label>
                      <span className="text-xs text-zinc-400">{(localPositionX / 100).toFixed(2)}</span>
                    </div>
                    <Slider
                      value={[localPositionX]}
                      onValueChange={([value]) => {
                        setLocalPositionX(value);
                        scheduleLiveUpdate({ positionX: value / 100 });
                      }}
                      onValueCommit={([value]) => {
                        cancelLiveUpdate();
                        handleMaskChange({ positionX: value / 100 });
                      }}
                      min={-100}
                      max={100}
                      step={1}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-zinc-400 flex items-center gap-1"><Move className="w-3 h-3" /> Y</Label>
                      <span className="text-xs text-zinc-400">{(localPositionY / 100).toFixed(2)}</span>
                    </div>
                    <Slider
                      value={[localPositionY]}
                      onValueChange={([value]) => {
                        setLocalPositionY(value);
                        scheduleLiveUpdate({ positionY: value / 100 });
                      }}
                      onValueCommit={([value]) => {
                        cancelLiveUpdate();
                        handleMaskChange({ positionY: value / 100 });
                      }}
                      min={-100}
                      max={100}
                      step={1}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-zinc-400">Mask Scale</Label>
                    <span className="text-xs text-zinc-400">{(localMaskScale).toFixed(2)}x</span>
                  </div>
                  <Slider
                    value={[localMaskScale * 100]}
                    onValueChange={([value]) => {
                      setLocalMaskScale(value / 100);
                      scheduleLiveUpdate({ maskScale: value / 100 });
                    }}
                    onValueCommit={([value]) => {
                      cancelLiveUpdate();
                      handleMaskChange({ maskScale: value / 100 });
                    }}
                    min={10}
                    max={300}
                    step={1}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-zinc-400 flex items-center gap-1"><RotateCw className="w-3 h-3" /> Rotation</Label>
                    <span className="text-xs text-zinc-400">{Math.round(localRotation)}°</span>
                  </div>
                  <Slider
                    value={[localRotation]}
                    onValueChange={([value]) => {
                      setLocalRotation(value);
                      scheduleLiveUpdate({ rotation: value });
                    }}
                    onValueCommit={([value]) => {
                      cancelLiveUpdate();
                      handleMaskChange({ rotation: value });
                    }}
                    min={-180}
                    max={180}
                    step={1}
                  />
                </div>

                {/* Stroke Width - For SVG shape sources */}
                {currentMask.sourceType === 'svg' && currentMask.svgText && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-zinc-400">Stroke Width</Label>
                      <span className="text-xs text-zinc-400">{Math.round(localStrokeWidth)}px</span>
                    </div>
                    <Slider
                      value={[localStrokeWidth]}
                      onValueChange={([value]) => setLocalStrokeWidth(value)}
                      onValueCommit={([value]) => handleStrokeWidthChange(value)}
                      min={1}
                      max={48}
                      step={0.5}
                      disabled={rasterizing}
                    />
                  </div>
                )}

                {currentMask.sourceType !== 'svg' && (
                  <>
                    <div className="space-y-2">
                      <Label className="text-xs text-zinc-400 flex items-center gap-1"><ScanSearch className="w-3 h-3" /> Bitmap Source Mode</Label>
                      <SelectWrapper
                        value={currentMask.bitmapSourceMode ?? 'alpha'}
                        onValueChange={(value) => handleMaskChange({ bitmapSourceMode: value as 'alpha' | 'luminance' })}
                        options={[
                          { value: 'alpha', label: 'Alpha — use transparency channel' },
                          { value: 'luminance', label: 'Luminance — use brightness (bright=visible)' },
                        ]}
                        triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
                        contentClassName="bg-zinc-900 border-zinc-700"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-zinc-400">Bitmap Threshold</Label>
                        <span className="text-xs text-zinc-400">{Math.round(localThreshold)}%</span>
                      </div>
                      <Slider
                        value={[localThreshold]}
                        onValueChange={([value]) => setLocalThreshold(value)}
                        onValueCommit={([value]) => handleMaskChange({ bitmapThreshold: value / 100 })}
                        min={0}
                        max={100}
                        step={1}
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {currentMask.type !== 'none' && (
          <>
            <div className="space-y-3 pt-3 border-t border-zinc-800">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-zinc-300 font-semibold">Mask Mode & Opacity</Label>
                <FilteredButton
                  onClick={resetMaskOpacityControls}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Reset
                </FilteredButton>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-zinc-400">Mask Mode</Label>
                <SelectWrapper
                  value={currentMask.mode}
                  onValueChange={(value) => handleMaskChange({ mode: value as MaskConfig['mode'] })}
                  options={maskModes}
                  triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
                  contentClassName="bg-zinc-900 border-zinc-700"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Mask Opacity</Label>
                  <span className="text-xs text-zinc-400">{Math.round(localOpacity)}%</span>
                </div>
                <Slider
                  value={[localOpacity]}
                  onValueChange={([value]) => setLocalOpacity(value)}
                  onValueCommit={([value]) => handleMaskChange({ opacity: value / 100 })}
                  min={0}
                  max={100}
                  step={1}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Expand</Label>
                  <span className="text-xs text-zinc-400">{Math.round(localExpand)}</span>
                </div>
                <Slider
                  value={[localExpand]}
                  onValueChange={([value]) => setLocalExpand(value)}
                  onValueCommit={([value]) => handleMaskChange({ expand: value })}
                  min={-100}
                  max={100}
                  step={1}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Feather</Label>
                  <span className="text-xs text-zinc-400">{Math.round(localFeather)}</span>
                </div>
                <Slider
                  value={[localFeather]}
                  onValueChange={([value]) => setLocalFeather(value)}
                  onValueCommit={([value]) => handleMaskChange({ feather: value })}
                  min={0}
                  max={100}
                  step={1}
                />
              </div>
            </div>

            {/* Advanced Parameters Section */}
            <div className="space-y-3 pt-3 border-t border-zinc-800">
              <Label className="text-xs text-zinc-300 font-semibold">Advanced</Label>

              {/* Blur Quality */}
              <div className="space-y-2">
                <Label className="text-xs text-zinc-400">Blur Quality</Label>
                <SelectWrapper
                  value={currentMask.blurQuality ?? 'none'}
                  onValueChange={(value) => handleMaskChange({ blurQuality: value as 'none' | 'fast' | 'medium' | 'high' })}
                  options={[
                    { value: 'none',   label: 'No Blur' },
                    { value: 'fast',   label: 'Fast — single pass' },
                    { value: 'medium', label: 'Medium — balanced' },
                    { value: 'high', label: 'High — multi-pass smooth' },
                  ]}
                  triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
                  contentClassName="bg-zinc-900 border-zinc-700"
                />
              </div>

              {/* Tile Mode */}
              <div className="space-y-2">
                <Label className="text-xs text-zinc-400">Tile Mode</Label>
                <SelectWrapper
                  value={currentMask.tileMode ?? 'single'}
                  onValueChange={(value) => handleMaskChange({ tileMode: value as 'single' | 'repeat' | 'mirror' })}
                  options={[
                    { value: 'single', label: 'Single — no tiling' },
                    { value: 'repeat', label: 'Repeat — tile pattern' },
                    { value: 'mirror', label: 'Mirror — kaleidoscope' },
                  ]}
                  triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
                  contentClassName="bg-zinc-900 border-zinc-700"
                />
              </div>

              {/* Tile Scale - Only show when tiling is enabled */}
              {(currentMask.tileMode === 'repeat' || currentMask.tileMode === 'mirror') && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-zinc-400">Tile Scale</Label>
                    <span className="text-xs text-zinc-400">{((currentMask.tileScale ?? 1) * 100).toFixed(0)}%</span>
                  </div>
                  <Slider
                    value={[(currentMask.tileScale ?? 1) * 100]}
                    onValueChange={([value]) => handleMaskChange({ tileScale: value / 100 })}
                    min={10}
                    max={500}
                    step={5}
                  />
                </div>
              )}

              {/* Edge Detect */}
              <div className="flex items-center justify-between">
                <Label className="text-xs text-zinc-400">Edge Detect</Label>
                <Switch
                  checked={currentMask.edgeDetect ?? false}
                  onCheckedChange={(checked) => handleMaskChange({ edgeDetect: checked })}
                />
              </div>

              {/* Edge Thickness - Only show when edge detect is enabled */}
              {currentMask.edgeDetect && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-zinc-400">Edge Thickness</Label>
                    <span className="text-xs text-zinc-400">{Math.round(currentMask.edgeThickness ?? 2)}px</span>
                  </div>
                  <Slider
                    value={[currentMask.edgeThickness ?? 2]}
                    onValueChange={([value]) => handleMaskChange({ edgeThickness: value })}
                    min={1}
                    max={10}
                    step={0.5}
                  />
                </div>
              )}
            </div>

            {/* Mask Animation Controls */}
            <MaskAnimationControls
              key={animResetKey}
              maskConfig={currentMask}
              onUpdate={handleMaskChange}
              isPlaying={isPlaying}
              onPlayToggle={onPlayToggle}
              onResetPosition={resetMaskAnimationControls}
            />

            <div className="p-2 rounded-md bg-zinc-900 border border-zinc-800">
              <p className="text-xs text-zinc-500">
                {currentMask.type === 'alpha' && "Self alpha mask uses this layer's own transparency as the reveal source."}
                {currentMask.type === 'luminance' && "Self luminance mask uses this layer's perceived brightness as the reveal source."}
                {currentMask.type === 'image' && (currentMask.sourceType === 'svg'
                  ? 'SVG source: rasterised at high quality. Expand grows/contracts in UV space (~96 px max at 1920). Feather widens the edge zone (0=crisp, 100=~67 px soft).'
                  : `Bitmap source. Alpha = transparency channel. Luminance = RGB brightness (bright reveals, dark hides — distinct on coloured images). Threshold ${Math.round((currentMask.bitmapThreshold ?? 0.5) * 100)}%: low=generous inclusion, high=opaque-only. Expand & Feather use UV-space offsets.`)}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
