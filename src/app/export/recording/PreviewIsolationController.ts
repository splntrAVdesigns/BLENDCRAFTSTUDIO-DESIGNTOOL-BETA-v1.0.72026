export interface PreviewIsolationInput {
  readonly sourceCanvas: HTMLCanvasElement;
  readonly readFramePixels?: () => { data: Uint8Array; width: number; height: number } | null;
  readonly createCanvas?: () => HTMLCanvasElement;
}

export interface PreviewIsolationHandle {
  readonly overlayCanvas: HTMLCanvasElement;
  dispose(): void;
}

function copyReadbackToCanvas(
  target: HTMLCanvasElement,
  pixels: { data: Uint8Array; width: number; height: number },
): boolean {
  const ctx = target.getContext('2d', { alpha: false, willReadFrequently: false });
  if (!ctx) return false;
  const staging = document.createElement('canvas');
  staging.width = pixels.width;
  staging.height = pixels.height;
  const stagingContext = staging.getContext('2d', { alpha: false, willReadFrequently: false });
  if (!stagingContext) return false;

  const clamped = new Uint8ClampedArray(new ArrayBuffer(pixels.data.byteLength));
  clamped.set(pixels.data);
  stagingContext.putImageData(new ImageData(clamped, pixels.width, pixels.height), 0, 0);
  ctx.save();
  ctx.translate(0, target.height);
  ctx.scale(1, -1);
  ctx.drawImage(staging, 0, 0, target.width, target.height);
  ctx.restore();
  staging.width = 1;
  staging.height = 1;
  return true;
}

export function isolatePreview(input: PreviewIsolationInput): PreviewIsolationHandle {
  const source = input.sourceCanvas;
  const parent = source.parentElement;
  if (!parent) throw new Error('Cannot isolate preview because the renderer canvas has no parent element.');

  const createCanvas = input.createCanvas ?? (() => document.createElement('canvas'));
  const overlay = createCanvas();
  const rect = source.getBoundingClientRect();
  overlay.width = Math.max(1, source.width);
  overlay.height = Math.max(1, source.height);
  overlay.setAttribute('aria-hidden', 'true');
  overlay.dataset.blendcraftPreviewIsolation = 'true';

  const parentComputed = typeof getComputedStyle === 'function' ? getComputedStyle(parent) : null;
  const previousParentPosition = parent.style.position;
  const changedParentPosition = !parentComputed || parentComputed.position === 'static';
  if (changedParentPosition) parent.style.position = 'relative';

  Object.assign(overlay.style, {
    position: 'absolute',
    left: `${source.offsetLeft}px`,
    top: `${source.offsetTop}px`,
    width: `${Math.max(1, rect.width || source.clientWidth)}px`,
    height: `${Math.max(1, rect.height || source.clientHeight)}px`,
    maxWidth: '100%',
    maxHeight: '100%',
    pointerEvents: 'none',
    zIndex: '20',
    background: '#000',
  });

  // PHASE 7.3E FOUNDATION FREEZE — DISPLAY COLOR AUTHORITY:
  // The visible canvas is the display-referred sRGB result and must be copied
  // first. Raw FBO readback can be linear/display-unconverted and previously
  // caused the preview to brighten during PNG export. Keep readback only as a
  // fallback for hosts where the presentation buffer cannot be copied.
  let captured: boolean;
  const context = overlay.getContext('2d', { alpha: false, willReadFrequently: false });
  if (!context) throw new Error('Unable to create preview isolation canvas context.');
  try {
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.globalCompositeOperation = 'copy';
    context.drawImage(source, 0, 0, overlay.width, overlay.height);
    context.globalCompositeOperation = 'source-over';
    captured = true;
  } catch {
    captured = false;
  }
  if (!captured) {
    const readback = input.readFramePixels?.();
    if (readback) captured = copyReadbackToCanvas(overlay, readback);
  }

  parent.appendChild(overlay);
  let disposed = false;
  return {
    overlayCanvas: overlay,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      overlay.remove();
      overlay.width = 1;
      overlay.height = 1;
      if (changedParentPosition) parent.style.position = previousParentPosition;
    },
  };
}
