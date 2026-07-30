import type { RenderApi } from '../types/gradient';

/**
 * Phase 7.4A — one renderer authority for every video consumer.
 * This adapter never recreates shader state or animation math. It delegates all
 * frame production to GradientCanvas.renderAtTime() and exposes only the live,
 * final composited canvas owned by that renderer.
 */
export interface AuthoritativeExportFrameSource {
  readonly canvas: HTMLCanvasElement;
  renderFrame(timeSeconds: number, seekMedia?: boolean): Promise<void>;
  readPixels(): ReturnType<NonNullable<RenderApi['readFramePixels']>>;
}

export function createAuthoritativeExportFrameSource(api: RenderApi): AuthoritativeExportFrameSource {
  if (!api.renderAtTime) throw new Error('Authoritative renderer is not ready.');
  const canvas = api.getCanvas?.();
  if (!canvas) throw new Error('Authoritative renderer canvas is unavailable.');

  return {
    canvas,
    renderFrame: (timeSeconds, seekMedia = true) =>
      api.renderAtTime!(timeSeconds, undefined, { seekMedia }),
    readPixels: () => api.readFramePixels?.() ?? null,
  };
}
