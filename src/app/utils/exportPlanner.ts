import type { ExportDurationPlan } from '../export/ExportDurationPlan';
import type { VideoQuality } from './exportUtils';

export type ExportGuardLevel = 'normal' | 'warn' | 'confirm' | 'cap';
export type ExportCodecSafety = 'sharp' | 'balanced' | 'smooth';

export interface WebMExportPlanInput {
  width: number;
  height: number;
  fps: number;
  targetDurationMs: number;
  plannedDurationMs?: number;
  durationPlan?: Readonly<ExportDurationPlan>;
  quality: VideoQuality;
  loopLockEnabled?: boolean;
  hardCapFrames?: number;
}

export interface WebMExportPlan {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  targetDurationMs: number;
  totalFrames: number;
  quality: VideoQuality;
  qualityLabel: string;
  codecSafety: ExportCodecSafety;
  loopLockEnabled: boolean;
  guardLevel: ExportGuardLevel;
  warning?: string;
  requiresConfirm: boolean;
  capped: boolean;
  estimateLabel: string;
}

export const WEBM_FRAME_WARN_LIMIT = 900;
export const WEBM_FRAME_CONFIRM_LIMIT = 1800;

function clampEven(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

export function getVideoQualityLabel(quality: VideoQuality): string {
  switch (quality) {
    case 'standard': return 'Standard / Fast Preview';
    case 'high': return 'High / Balanced';
    case 'ultra':
    case 'max': return 'Max Quality / Final';
    case 'sharpMax': return 'Sharp Max / Master Slow';
    default: return 'High / Balanced';
  }
}

export function getCodecSafetyForQuality(quality: VideoQuality): ExportCodecSafety {
  switch (quality) {
    case 'standard': return 'smooth';
    // High is now sharp by default. The previous "balanced" mode did a tiny
    // self-blit resolve that softened dense gradients before VP9 compression.
    // That made exports look blurry even when the source render was clean.
    case 'high': return 'sharp';
    case 'ultra':
    case 'max':
    case 'sharpMax':
    default: return 'sharp';
  }
}

export function planWebMExport(input: WebMExportPlanInput): WebMExportPlan {
  const fps = Math.max(24, Math.min(60, Math.round(input.fps || 30)));
  const durationPlan = input.durationPlan;
  const targetDurationMs = Math.min(
    Math.max(durationPlan?.requestedDurationMs ?? (input.targetDurationMs || 5000), 1000),
    60000,
  );
  // Phase 7.3B: the extracted duration plan is authoritative when supplied.
  // The legacy plannedDurationMs input remains temporarily supported for
  // non-migrated call sites, but it no longer owns Loop Lock policy in the UI.
  const requestedDurationMs = Math.min(
    Math.max(durationPlan?.effectiveDurationMs
      ?? (input.loopLockEnabled && input.plannedDurationMs != null
        ? input.plannedDurationMs
        : targetDurationMs), 1000),
    60000,
  );
  const requestedFrames = Math.max(1, Math.round((requestedDurationMs / 1000) * fps));
  const hardCapFrames = input.hardCapFrames ?? WEBM_FRAME_CONFIRM_LIMIT;
  const capped = requestedFrames > hardCapFrames;
  const totalFrames = capped ? hardCapFrames : requestedFrames;
  // Frame count and duration must describe the same timeline. If a guard caps
  // frames, derive the final duration from the capped count rather than leaving
  // stale metadata that can produce long/short muxed files.
  const durationMs = (totalFrames / fps) * 1000;

  let guardLevel: ExportGuardLevel = 'normal';
  let warning: string | undefined;
  if (requestedFrames > WEBM_FRAME_CONFIRM_LIMIT) {
    guardLevel = capped ? 'cap' : 'confirm';
    warning = `Large export capped at ${totalFrames} frames. Lower duration, FPS, or resolution for faster output.`;
  } else if (requestedFrames > WEBM_FRAME_WARN_LIMIT) {
    guardLevel = 'warn';
    warning = `Large export: ${requestedFrames} frames. This may take noticeably longer.`;
  }

  return {
    width: clampEven(input.width),
    height: clampEven(input.height),
    fps,
    durationMs,
    targetDurationMs,
    totalFrames,
    quality: input.quality || 'high',
    qualityLabel: getVideoQualityLabel(input.quality || 'high'),
    codecSafety: getCodecSafetyForQuality(input.quality || 'high'),
    loopLockEnabled: durationPlan?.loopLockEnabled ?? !!input.loopLockEnabled,
    guardLevel,
    warning,
    requiresConfirm: requestedFrames > WEBM_FRAME_WARN_LIMIT,
    capped,
    estimateLabel: `${(durationMs / 1000).toFixed(1)}s · ${fps}fps · ${totalFrames} frames · ${clampEven(input.width)}×${clampEven(input.height)}`,
  };
}

export function confirmWebMExportPlan(plan: WebMExportPlan): boolean {
  if (!plan.requiresConfirm) return true;
  const message = [
    `Export plan: ${plan.estimateLabel}`,
    `Quality: ${plan.qualityLabel}`,
    plan.warning || 'This is a large export and may take longer to render.',
    '',
    'Continue?'
  ].join('\n');
  return window.confirm(message);
}