/**
 * media/components/MediaUploadPanel.tsx — Stage 2 (2A/2B/2C/2E)
 *
 * Media panel for the Layers tab. Two modes:
 *
 * ADD MODE (active layer has no media): drop zone that creates a NEW
 * dedicated media layer via onAddMediaLayer — media never attaches to an
 * existing gradient layer (2A). The new layer carries a default gradient so
 * the color-stop editor doubles as the LUT ramp and the animation system
 * engages natively.
 *
 * EDIT MODE (active layer is a media layer): source card + fit + transforms
 * (scale/rotation/offset, 2B) + Source Tone + Gradient LUT (2C). Videos play
 * live and follow the master Play button (2E).
 *
 * Styling mirrors MaskControls: zinc palette, #51a2ff accent, section header
 * with activity dot + help tooltip.
 */

import { useCallback, useRef, useState } from 'react';
import { isMediaLayerActive } from '../mediaShader';
import { Label } from '../../components/ui/label';
import { Slider } from '../../components/ui/slider';
import { Switch } from '../../components/ui/switch';
import { Button } from '../../components/ui/button';
import { SelectWrapper } from '../../components/ui/select-wrapper';
import { FilteredButton } from '../../components/ui/filtered-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { Upload, X, HelpCircle, Image as ImageIcon, Film, Contrast, SunMedium, Moon, Move, Palette, RotateCw, FlipHorizontal, FlipVertical, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import type { Layer } from '../../types/gradient';
import type { MediaConfig, MediaFitMode } from '../types';
import { createDefaultMediaConfig, MEDIA_TONE_DEFAULTS, MEDIA_TRANSFORM_DEFAULTS } from '../types';
import { classifyMediaFile, probeVideoFile, releaseVideoProbe } from '../mediaValidation';
import { captureVideoPosterDataUrl } from '../mediaTextureManager';

interface MediaUploadPanelProps {
  layer: Layer | undefined;
  /** 2.7 — current canvas dims, for the aspect-mismatch prompt. */
  canvasWidth?: number;
  canvasHeight?: number;
  /** Edit the active media layer's config. */
  onUpdate: (media: MediaConfig) => void;
  /** 2A: create a NEW dedicated media layer from an upload. */
  onAddMediaLayer: (media: MediaConfig) => void;
  /**
   * 2.7.4: false when the session layer cap is reached. When false and this is
   * a NEW upload (not replacing existing media), we block BEFORE decoding so we
   * don't waste a decode + leak an object URL on a layer that can't be created.
   * Replacing the source on an existing media layer is always allowed (no new
   * layer is created).
   */
  canCreateLayer?: boolean;
  /**
   * 2.7.3 — remove the media LAYER entirely.
   * Media layers are created BY an upload (they exist only to host that media),
   * so clearing the media used to leave behind an orphan: an empty gradient
   * layer still named after the image file. That's confusing and unprofessional.
   * The X button now deletes the layer outright. Returns false if it couldn't
   * (e.g. it's the last remaining layer), so we can fall back to clearing.
   */
  onDeleteMediaLayer?: (layerId: string) => boolean;
}

const ACCEPTED = '.png,.jpg,.jpeg,.webp,.svg,.webm,.mp4,.mov,image/png,image/jpeg,image/webp,image/svg+xml,video/webm,video/mp4,video/quicktime';

function formatBytes(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// OBJECT URL LIFECYCLE: URLs are intentionally not revoked here — layers can
// be duplicated (shared src strings) and this panel persists across layer
// switches. Session-scoped; a refcounting source registry is future work.

export function MediaUploadPanel({ layer, onUpdate, onAddMediaLayer, onDeleteMediaLayer, canvasWidth, canvasHeight, canCreateLayer = true }: MediaUploadPanelProps) {
  const media = layer?.media;
  const isMediaLayer = !!media && (!!media.src || !!media.fileName);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  /** Decode a file into a complete MediaConfig (2E: videos keep their live src). */
  const decodeFile = useCallback(async (file: File): Promise<MediaConfig | null> => {
    const classified = classifyMediaFile(file);
    if (!classified.ok || !classified.kind) {
      toast.error(classified.error ?? 'Unsupported file.');
      return null;
    }

    const base = isMediaLayer && media ? media : createDefaultMediaConfig();

    if (classified.kind === 'video') {
      const probe = await probeVideoFile(file);
      if (!probe.ok || !probe.video || !probe.objectUrl) {
        toast.error(probe.error ?? 'Video could not be decoded.');
        return null;
      }
      // 2E: live playback — the object URL IS the source. A small poster
      // data URL is kept separately for panel/layer-list thumbnails.
      const previewUrl = captureVideoPosterDataUrl(probe.video, 256);
      const result: MediaConfig = {
        ...base,
        enabled: true,
        sourceKind: 'video',
        src: probe.objectUrl,
        // STAGE 2.7.5: keep the actual File (a Blob) on the config. The video
        // manager mints a FRESH object URL from this in its own context at load
        // time — a blob: URL string alone does not reliably survive the Figma
        // Make iframe's document swaps (net::ERR_FILE_NOT_FOUND → black video).
        blob: file,
        previewUrl,
        fileName: file.name,
        fileSize: file.size,
        naturalWidth: probe.width,
        naturalHeight: probe.height,
        durationSec: probe.durationSec,
        posterOnly: undefined,
      };
      // Keep the objectUrl (it's now the layer's src) — release only the probe element.
      releaseVideoProbe({ ...probe, objectUrl: undefined });
      return result;
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });
        img.onerror = () => reject(new Error('Image could not be decoded.'));
        img.src = objectUrl;
      });
      return {
        ...base,
        enabled: true,
        sourceKind: classified.kind,
        src: objectUrl,
        // STAGE 2.8.0: images now carry their Blob exactly like videos do.
        // This is what makes image layers survive a reload: the blob is
        // persisted to IndexedDB (localStorage can't hold it) and rehydrated
        // with a freshly minted URL on the next session. Videos have had this
        // since 2.7.5; images were the known gap.
        blob: file,
        previewUrl: undefined,
        fileName: file.name,
        fileSize: file.size,
        naturalWidth: dims.w || undefined,
        naturalHeight: dims.h || undefined,
        durationSec: undefined,
        posterOnly: undefined,
      };
    } catch (err) {
      URL.revokeObjectURL(objectUrl);
      toast.error(err instanceof Error ? err.message : 'Upload failed.');
      return null;
    }
  }, [isMediaLayer, media]);

  const handleFile = useCallback(async (file: File) => {
    // 2.7.4: block a NEW media layer before decoding when the cap is reached.
    // (Replacing the source on an existing media layer never adds a layer.)
    if (!isMediaLayer && !canCreateLayer) {
      toast.error(`Layer limit reached. Delete a layer before uploading new media.`);
      return;
    }
    setIsProcessing(true);
    try {
      const config = await decodeFile(file);
      if (!config) return;
      if (isMediaLayer) {
        onUpdate(config); // replace source on the existing media layer
        toast.success(`Source replaced: ${file.name}`);
      } else {
        onAddMediaLayer(config); // 2A: new dedicated media layer
        toast.success(`Media layer created: ${file.name}`);
      }
    } finally {
      setIsProcessing(false);
    }
  }, [decodeFile, isMediaLayer, onUpdate, onAddMediaLayer, canCreateLayer]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }, [handleFile]);

  const handleRemove = useCallback(() => {
    // 2.7.3: the X deletes the whole media layer. A media layer exists solely to
    // host its upload — clearing the media previously left an orphan gradient
    // layer still carrying the image's filename, which read as a bug.
    if (layer && onDeleteMediaLayer?.(layer.id)) {
      toast.success('Media layer deleted.');
      return;
    }
    // Fallback: couldn't delete (last remaining layer) — clear the media and
    // rename so the layer no longer masquerades as the image.
    onUpdate({ ...createDefaultMediaConfig(), enabled: false });
    toast.success('Media removed — this was the last layer, so it was kept as a gradient.');
  }, [layer, onDeleteMediaLayer, onUpdate]);

  // 2.7.4: show the re-upload notice whenever a media layer persisted across a
  // reload without its (runtime-only) src. Previously this required fileName to
  // be present too; now any enabled media layer with no usable src qualifies,
  // so the user always gets a clear "re-upload to restore" path instead of a
  // broken thumbnail + a console decode error.
  // STAGE 2.7.7: a blob rehydrated from IndexedDB (or a live upload) IS a
  // usable source even if the src string is absent — so "source lost" is only
  // true when there's neither a src NOR a blob to load from.
  const hasLiveBlob = !!(media as any)?.blob;
  const srcMissing = (!media?.src || media.src.trim().length === 0) && !hasLiveBlob;
  const sourceLostOnReload = isMediaLayer && !!media?.enabled && srcMissing;
  const thumbSrc = media?.sourceKind === 'video' ? media.previewUrl : media?.src;

  const dropZone = (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
      className={`rounded-lg border border-dashed p-5 text-center cursor-pointer transition-colors ${
        isDragOver
          ? 'border-[#51a2ff] bg-[#51a2ff]/10'
          : 'border-zinc-700 bg-[#262626bf] hover:border-zinc-500'
      }`}
    >
      <Upload className={`w-5 h-5 mx-auto mb-2 ${isDragOver ? 'text-[#51a2ff]' : 'text-zinc-500'}`} />
      <p className="text-xs text-zinc-300">
        {isProcessing ? 'Processing…' : 'Drag & drop or click to upload'}
      </p>
      <p className="text-[10px] text-zinc-500 mt-1">PNG · JPEG · WebP · SVG · WebM · MP4 · MOV</p>
      <p className="text-[10px] text-[#51a2ff] mt-1.5">Creates its own layer</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Section header — mirrors Mask Settings header pattern */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-zinc-100">Media Upload</h3>
          <div
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              isMediaLayer && isMediaLayerActive(media)
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
                <strong>Media layers</strong> — uploads create their own layer with blend modes,
                opacity, masks, textures, and every animation type. The layer's Color Stops act as a
                <strong> gradient LUT</strong> for color-grading the media. Videos play live and follow
                the Play button. Formats: PNG, JPEG, WebP, SVG, WebM, MP4, MOV.
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
        {isMediaLayer && (
          <FilteredButton
            onClick={handleRemove}
            className="text-zinc-500 hover:text-red-400 transition-colors"
            title="Remove media from this layer"
          >
            <X className="w-4 h-4" />
          </FilteredButton>
        )}
      </div>

      {sourceLostOnReload && (
        <div className="p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10">
          <p className="text-[10px] text-amber-400">
            Media source “{media?.fileName}” isn’t stored with saves — re-upload to restore it.
          </p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />

      {!isMediaLayer ? (
        dropZone
      ) : (
        <>
          {/* Source info card — also a drop target so dragging a new file over
              an existing media layer REPLACES it (2.7.7d fix: previously only
              the empty-state drop zone accepted drops, so drag-replace did
              nothing once media was loaded). */}
          <div
            className={`flex items-center gap-3 p-2.5 rounded-lg border bg-[#262626bf] transition-colors ${
              isDragOver ? 'border-[#51a2ff]' : 'border-zinc-800'
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
          >
            {/* Inline style is a deliberate belt-and-suspenders guarantee on
                top of the Tailwind classes: inline styles win over any class
                regardless of specificity or build-pipeline quirks, so this
                box can never render wider than 48px no matter what. */}
            <div
              className="w-12 h-12 rounded-md overflow-hidden bg-zinc-900 flex-shrink-0 flex items-center justify-center"
              style={{ width: 48, height: 48, minWidth: 48, maxWidth: 48 }}
            >
              {thumbSrc ? (
                <img src={thumbSrc} alt="" className="w-full h-full object-cover" />
              ) : media?.sourceKind === 'video' ? (
                <Film className="w-4 h-4 text-zinc-500" />
              ) : (
                <ImageIcon className="w-4 h-4 text-zinc-500" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-zinc-200 truncate">{media?.fileName}</p>
              <p className="text-[10px] text-zinc-500">
                {media?.naturalWidth && media?.naturalHeight ? `${media.naturalWidth}×${media.naturalHeight}` : ''}
                {media?.fileSize ? ` · ${formatBytes(media.fileSize)}` : ''}
                {media?.sourceKind === 'video' && media?.durationSec ? ` · ${media.durationSec.toFixed(1)}s` : ''}
              </p>
              {media?.sourceKind === 'video' && (
                <p className="text-[10px] text-[#51a2ff] mt-0.5">
                  {media.posterOnly
                    ? 'Still frame — re-upload for live playback'
                    : sourceLostOnReload
                      ? 'Source not saved — re-upload to restore'
                      : 'Live · follows the Play button'}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-[10px] h-7 px-2"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              Replace
            </Button>
          </div>

          {/* Enable toggle + Fit */}
          <div className="flex items-center justify-between">
            <Label className="text-xs text-zinc-400">Show media on layer</Label>
            <Switch
              checked={media?.enabled ?? false}
              onCheckedChange={(enabled) => media && onUpdate({ ...media, enabled })}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-zinc-400">Fit</Label>
            <SelectWrapper
              value={media?.fit ?? 'cover'}
              onValueChange={(v) => media && onUpdate({ ...media, fit: v as MediaFitMode })}
              options={[
                { value: 'cover', label: 'Cover — fill canvas' },
                { value: 'contain', label: 'Contain — fit inside' },
                { value: 'stretch', label: 'Stretch — fill exactly' },
                { value: 'tile', label: 'Tile — repeat as pattern' },
              ]}
              triggerClassName="border-zinc-700 text-zinc-100"
              contentClassName="bg-zinc-900 border-zinc-700"
            />
          </div>

          {/* ── 2B: TRANSFORM ── */}
          {media && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-1.5">
                <Move className="w-3.5 h-3.5 text-[#51a2ff]" />
                <Label className="text-xs font-medium text-[#51a2ff]">Transform</Label>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Scale</Label>
                  <span className="text-xs text-zinc-400">{media.mediaScale ?? 100}%</span>
                </div>
                <Slider
                  value={[media.mediaScale ?? 100]}
                  onValueChange={([v]) => onUpdate({ ...media, mediaScale: v })}
                  min={10} max={400} step={1}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400 flex items-center gap-1"><RotateCw className="w-3 h-3" /> Rotation</Label>
                  <span className="text-xs text-zinc-400">{media.rotationDeg ?? 0}°</span>
                </div>
                <Slider
                  value={[media.rotationDeg ?? 0]}
                  onValueChange={([v]) => onUpdate({ ...media, rotationDeg: v })}
                  min={-180} max={180} step={1}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Offset X</Label>
                  <span className="text-xs text-zinc-400">{media.offsetX ?? 0}</span>
                </div>
                <Slider
                  value={[media.offsetX ?? 0]}
                  onValueChange={([v]) => onUpdate({ ...media, offsetX: v })}
                  min={-100} max={100} step={1}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Offset Y</Label>
                  <span className="text-xs text-zinc-400">{media.offsetY ?? 0}</span>
                </div>
                <Slider
                  value={[media.offsetY ?? 0]}
                  onValueChange={([v]) => onUpdate({ ...media, offsetY: v })}
                  min={-100} max={100} step={1}
                />
              </div>

              <Button
                variant="outline"
                size="sm"
                className="w-full border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 text-xs"
                onClick={() => onUpdate({ ...media, ...MEDIA_TRANSFORM_DEFAULTS })}
              >
                Reset Transform
              </Button>

              {/* 2.7 — TILE REPEAT (only meaningful in tile fit) */}
              {media.fit === 'tile' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-zinc-400">Tile repeat</Label>
                    <span className="text-xs text-zinc-400">{media.tileRepeat ?? 3}×</span>
                  </div>
                  <Slider
                    value={[media.tileRepeat ?? 3]}
                    onValueChange={([v]) => onUpdate({ ...media, tileRepeat: v })}
                    min={1} max={20} step={1}
                  />
                </div>
              )}

              {/* 2.7 — FLIP */}
              <div className="flex items-center justify-between">
                <Label className="text-xs text-zinc-400 flex items-center gap-1">
                  <FlipHorizontal className="w-3 h-3" /> Flip horizontal
                </Label>
                <Switch
                  checked={media.flipH ?? false}
                  onCheckedChange={(flipH) => onUpdate({ ...media, flipH })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs text-zinc-400 flex items-center gap-1">
                  <FlipVertical className="w-3 h-3" /> Flip vertical
                </Label>
                <Switch
                  checked={media.flipV ?? false}
                  onCheckedChange={(flipV) => onUpdate({ ...media, flipV })}
                />
              </div>
            </div>
          )}

          {/* 2.7.4 — ASPECT MISMATCH PROMPT (direction corrected).
              Cover crops and Stretch distorts when the media aspect doesn't
              match the canvas. Per product direction, the one-tap fix FITS THE
              MEDIA WITHIN THE CURRENT CANVAS (letterboxed) — the canvas keeps
              its own dimensions (e.g. 1920×1080). This is just switching the
              layer's Fit to 'contain'; it is non-destructive and, crucially,
              does NOT resize the canvas — which is what previously triggered the
              cascade of renderer/render-target/mesh rebuilds and the crash. */}
          {media?.naturalWidth && media?.naturalHeight && canvasWidth && canvasHeight && (() => {
            const mediaAR = media.naturalWidth / media.naturalHeight;
            const canvasAR = canvasWidth / canvasHeight;
            const mismatch = Math.abs(mediaAR - canvasAR) / canvasAR > 0.02; // >2%
            // Only worth offering when the current Fit will crop/distort. If the
            // user is already on 'contain' the media is fully visible already.
            if (!mismatch || media.fit === 'contain') return null;
            return (
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-[#51a2ff]/40 bg-[#51a2ff]/10">
                <p className="text-[10px] text-[#51a2ff]">
                  Media aspect ({mediaAR.toFixed(2)}) doesn’t match the canvas ({canvasAR.toFixed(2)}) — “{media.fit}” will crop or distort it.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-[#51a2ff]/50 text-[#51a2ff] hover:bg-[#51a2ff]/20 text-[10px] h-7 px-2 flex-shrink-0"
                  onClick={() => onUpdate({ ...media, fit: 'contain' })}
                  title="Fit the whole image inside the current canvas (letterboxed) — the canvas size is unchanged"
                >
                  Fit to canvas
                </Button>
              </div>
            );
          })()}

          {/* 2.7E — VIDEO PLAYBACK (video sources only) */}
          {media?.sourceKind === 'video' && !media.posterOnly && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5 text-[#51a2ff]" />
                <Label className="text-xs font-medium text-[#51a2ff]">Video Playback</Label>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Speed</Label>
                  <span className="text-xs text-zinc-400">{(media.playbackRate ?? 1).toFixed(2)}×</span>
                </div>
                <Slider
                  value={[(media.playbackRate ?? 1) * 100]}
                  onValueChange={([v]) => onUpdate({ ...media, playbackRate: v / 100 })}
                  min={25} max={200} step={5}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-zinc-400">Loop mode</Label>
                <SelectWrapper
                  value={media.loopMode ?? 'loop'}
                  onValueChange={(v) => onUpdate({ ...media, loopMode: v as 'loop' | 'pingpong' | 'once' })}
                  options={[
                    { value: 'loop', label: 'Loop — repeat forever' },
                    { value: 'pingpong', label: 'Ping-pong — bounce' },
                    { value: 'once', label: 'Once — hold last frame' },
                  ]}
                  triggerClassName="border-zinc-700 text-zinc-100"
                  contentClassName="bg-zinc-900 border-zinc-700"
                />
              </div>

              {/* Trim — only when we know the duration */}
              {!!media.durationSec && (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-zinc-400">Trim start</Label>
                      <span className="text-xs text-zinc-400">{(media.trimStart ?? 0).toFixed(1)}s</span>
                    </div>
                    <Slider
                      value={[media.trimStart ?? 0]}
                      onValueChange={([v]) => onUpdate({ ...media, trimStart: Math.min(v, (media.trimEnd ?? media.durationSec!) - 0.1) })}
                      min={0} max={media.durationSec} step={0.1}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-zinc-400">Trim end</Label>
                      <span className="text-xs text-zinc-400">{(media.trimEnd ?? media.durationSec).toFixed(1)}s</span>
                    </div>
                    <Slider
                      value={[media.trimEnd ?? media.durationSec]}
                      onValueChange={([v]) => onUpdate({ ...media, trimEnd: Math.max(v, (media.trimStart ?? 0) + 0.1) })}
                      min={0} max={media.durationSec} step={0.1}
                    />
                  </div>
                </>
              )}

              <div className="flex items-center justify-between">
                <Label className="text-xs text-zinc-400">Freeze frame</Label>
                <Switch
                  checked={media.freeze ?? false}
                  onCheckedChange={(freeze) => onUpdate({ ...media, freeze })}
                />
              </div>
              {media.freeze && !!media.durationSec && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-zinc-400">Freeze at</Label>
                    <span className="text-xs text-zinc-400">{(media.freezeTime ?? 0).toFixed(1)}s</span>
                  </div>
                  <Slider
                    value={[media.freezeTime ?? 0]}
                    onValueChange={([v]) => onUpdate({ ...media, freezeTime: v })}
                    min={0} max={media.durationSec} step={0.1}
                  />
                </div>
              )}

              {/* Audio — muted by default. This is the Stage 3 hook: a video's
                  own audio track is the most natural audio-reactive source. */}
              <div className="flex items-center justify-between">
                <Label className="text-xs text-zinc-400 flex items-center gap-1">
                  {media.muted === false ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                  Audio
                </Label>
                <Switch
                  checked={media.muted === false}
                  onCheckedChange={(on) => onUpdate({ ...media, muted: !on })}
                />
              </div>
              {media.muted === false && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-zinc-400">Volume</Label>
                    <span className="text-xs text-zinc-400">{Math.round((media.volume ?? 0.8) * 100)}%</span>
                  </div>
                  <Slider
                    value={[(media.volume ?? 0.8) * 100]}
                    onValueChange={([v]) => onUpdate({ ...media, volume: v / 100 })}
                    min={0} max={100} step={1}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── 2C: GRADIENT LUT ── */}
          {media && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-[#51a2ff]" />
                <Label className="text-xs font-medium text-[#51a2ff]">Gradient LUT</Label>
              </div>
              <p className="text-[10px] text-zinc-500">
                Maps media luminance to this layer's Color Stops (Gradient tab) — dark → first stop, bright → last.
              </p>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Intensity</Label>
                  <span className="text-xs text-zinc-400">{media.lutIntensity ?? 0}%</span>
                </div>
                <Slider
                  value={[media.lutIntensity ?? 0]}
                  onValueChange={([v]) => onUpdate({ ...media, lutIntensity: v })}
                  min={0} max={100} step={1}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-xs text-zinc-400">Preserve luminosity</Label>
                <Switch
                  checked={media.lutPreserveLuma ?? false}
                  onCheckedChange={(lutPreserveLuma) => onUpdate({ ...media, lutPreserveLuma })}
                />
              </div>
            </div>
          )}

          {/* ── SOURCE TONE ── */}
          {media && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-1.5">
                <Contrast className="w-3.5 h-3.5 text-[#51a2ff]" />
                <Label className="text-xs font-medium text-[#51a2ff]">Source Tone</Label>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400 flex items-center gap-1"><Moon className="w-3 h-3" /> Shadows</Label>
                  <span className="text-xs text-zinc-400">{media.shadows > 0 ? '+' : ''}{media.shadows}</span>
                </div>
                <Slider
                  value={[media.shadows]}
                  onValueChange={([v]) => onUpdate({ ...media, shadows: v })}
                  min={-50} max={50} step={1}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400 flex items-center gap-1"><Contrast className="w-3 h-3" /> Midtones</Label>
                  <span className="text-xs text-zinc-400">{((media.midtones ?? 100) / 100).toFixed(2)}γ</span>
                </div>
                <Slider
                  value={[media.midtones]}
                  onValueChange={([v]) => onUpdate({ ...media, midtones: v })}
                  min={20} max={300} step={1}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400 flex items-center gap-1"><SunMedium className="w-3 h-3" /> Highlights</Label>
                  <span className="text-xs text-zinc-400">{media.highlights}%</span>
                </div>
                <Slider
                  value={[media.highlights]}
                  onValueChange={([v]) => onUpdate({ ...media, highlights: v })}
                  min={0} max={200} step={1}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-xs text-zinc-400">Invert</Label>
                <Switch
                  checked={media.invert}
                  onCheckedChange={(invert) => onUpdate({ ...media, invert })}
                />
              </div>

              <Button
                variant="outline"
                size="sm"
                className="w-full border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 text-xs"
                onClick={() => onUpdate({ ...media, ...MEDIA_TONE_DEFAULTS })}
              >
                Reset Tone
              </Button>
            </div>
          )}

          {/* Add another media layer from edit mode */}
          <div className="pt-1">
            <Button
              variant="outline"
              size="sm"
              className="w-full border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 text-xs"
              onClick={() => {
                // Route the next upload to a NEW layer: temporarily behave as
                // add-mode by using a fresh input flow.
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = ACCEPTED;
                input.onchange = async () => {
                  const file = input.files?.[0];
                  if (!file) return;
                  setIsProcessing(true);
                  try {
                    const config = await decodeFile(file);
                    if (config) {
                      onAddMediaLayer({ ...createDefaultMediaConfig(), ...config });
                      toast.success(`Media layer created: ${file.name}`);
                    }
                  } finally {
                    setIsProcessing(false);
                  }
                };
                input.click();
              }}
              disabled={isProcessing}
            >
              + New Media Layer
            </Button>
          </div>
        </>
      )}
    </div>
  );
}