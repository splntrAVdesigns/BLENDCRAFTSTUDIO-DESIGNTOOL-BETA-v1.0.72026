import type { RenderApi } from '../types/gradient';
import { ExportFrameTimingDiagnostics, type ExportFrameTimingSample, type ExportFrameTimingSummary } from './ExportFrameTimingDiagnostics';

export interface AuthoritativeExportFrameSourceOptions {
  readonly onFrameTiming?: (sample: ExportFrameTimingSample) => void;
}

/**
 * Phase 7.4B — one renderer, one canvas, one transform authority.
 * Preview and every export consumer delegate to GradientCanvas.renderAtTime().
 */
export interface AuthoritativeExportFrameSource {
  readonly canvas: HTMLCanvasElement;
  renderFrame(timeSeconds: number, seekMedia?: boolean): Promise<void>;
  readPixels(): ReturnType<NonNullable<RenderApi['readFramePixels']>>;
  resetTiming(): void;
  getTimingSummary(): ExportFrameTimingSummary;
}

export function createAuthoritativeExportFrameSource(
  api: RenderApi,
  options: AuthoritativeExportFrameSourceOptions = {},
): AuthoritativeExportFrameSource {
  if (!api.renderAtTime) throw new Error('Authoritative renderer is not ready.');
  const canvas = api.getCanvas?.();
  if (!canvas) throw new Error('Authoritative renderer canvas is unavailable.');

  const diagnostics = new ExportFrameTimingDiagnostics();
  let frameIndex = 0;

  return {
    canvas,
    renderFrame: async (timeSeconds, seekMedia = true) => {
      const sample = await diagnostics.measure(frameIndex, timeSeconds, () =>
        api.renderAtTime!(timeSeconds, undefined, { seekMedia }),
      );
      frameIndex += 1;
      options.onFrameTiming?.(sample);
    },
    readPixels: () => api.readFramePixels?.() ?? null,
    resetTiming: () => { frameIndex = 0; diagnostics.reset(); },
    getTimingSummary: () => diagnostics.summarize(),
  };
}
