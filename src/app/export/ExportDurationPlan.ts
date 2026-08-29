import type { Layer } from '../types/gradient.ts';
import { estimateCycleTime } from '../animation/estimateAnimationCycle.ts';
import type { ExportTimingContract } from './types.ts';
import { mapLayerAnimationSpeed } from '../components/gradient/gradientMath.ts';

export const EXPORT_DURATION_MIN_MS = 1000;
export const EXPORT_DURATION_MAX_MS = 60000;

/**
 * Immutable, authoritative duration result shared by the active Phase 7.2
 * exporter and the replacement Phase 7.3 engine.
 *
 * Animation speed is never derived from this plan. The plan only selects how
 * long the export runs and how many frames belong to that duration.
 */
export interface ExportDurationPlan extends ExportTimingContract {
  readonly loopAlignmentApplied: boolean;
  readonly referenceCycleMs?: number;
  readonly cycleCount?: number;
  readonly animatedLayerCount: number;
  readonly statusLabel: string;
}

export interface CreateExportDurationPlanInput {
  readonly requestedDurationMs: number;
  readonly effectiveDurationMs?: number;
  readonly fps: number;
  readonly loopLockEnabled: boolean;
  readonly referenceCycleMs?: number;
  readonly cycleCount?: number;
  readonly animatedLayerCount?: number;
  readonly statusLabel?: string;
}

export interface CreateLayerExportDurationPlanInput {
  readonly requestedDurationMs: number;
  readonly fps: number;
  readonly loopLockEnabled: boolean;
  readonly layers: readonly Layer[];
  readonly minDurationMs?: number;
  readonly maxDurationMs?: number;
}

function requireFinitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite value greater than zero.`);
  }
  return value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function defaultStatusLabel(plan: {
  loopLockEnabled: boolean;
  loopAlignmentApplied: boolean;
  animatedLayerCount: number;
  effectiveDurationMs: number;
  referenceCycleMs?: number;
  cycleCount?: number;
}): string {
  if (!plan.loopLockEnabled) {
    return 'Snap export to a clean animation loop boundary';
  }
  if (plan.animatedLayerCount === 0 || !plan.referenceCycleMs || !plan.cycleCount) {
    return 'No animated layers detected — using target duration';
  }
  if (!plan.loopAlignmentApplied) {
    return `Target already matches ${plan.cycleCount} complete animation cycle${plan.cycleCount === 1 ? '' : 's'}`;
  }
  return `Snapping to ${(plan.effectiveDurationMs / 1000).toFixed(2)}s (${plan.cycleCount} cycle${plan.cycleCount === 1 ? '' : 's'} of ${(plan.referenceCycleMs / 1000).toFixed(2)}s)`;
}

/** Creates a stable duration contract from already-resolved timing values. */
export function createExportDurationPlan(
  input: CreateExportDurationPlanInput,
): Readonly<ExportDurationPlan> {
  const requestedDurationMs = requireFinitePositive(
    input.requestedDurationMs,
    'requestedDurationMs',
  );
  const fps = requireFinitePositive(input.fps, 'fps');
  const candidateEffectiveMs = input.loopLockEnabled
    ? input.effectiveDurationMs ?? requestedDurationMs
    : requestedDurationMs;
  const effectiveDurationMs = requireFinitePositive(
    candidateEffectiveMs,
    'effectiveDurationMs',
  );
  const totalFrames = Math.max(1, Math.round((effectiveDurationMs / 1000) * fps));
  const animatedLayerCount = Math.max(0, Math.trunc(input.animatedLayerCount ?? 0));
  const loopAlignmentApplied =
    input.loopLockEnabled && Math.abs(effectiveDurationMs - requestedDurationMs) >= 0.5;

  const draft = {
    requestedDurationMs,
    effectiveDurationMs,
    fps,
    totalFrames,
    loopLockEnabled: input.loopLockEnabled,
    loopAlignmentApplied,
    referenceCycleMs: input.referenceCycleMs,
    cycleCount: input.cycleCount,
    animatedLayerCount,
  };

  return Object.freeze({
    ...draft,
    statusLabel: input.statusLabel ?? defaultStatusLabel(draft),
  });
}

/**
 * Resolves the existing Loop Lock policy from visible, enabled layer
 * animations. The longest declared animation cycle remains authoritative,
 * preserving Phase 7.2 behavior while moving the decision out of ExportPanel.
 */
export function createLayerExportDurationPlan(
  input: CreateLayerExportDurationPlanInput,
): Readonly<ExportDurationPlan> {
  const minimum = requireFinitePositive(
    input.minDurationMs ?? EXPORT_DURATION_MIN_MS,
    'minDurationMs',
  );
  const maximum = requireFinitePositive(
    input.maxDurationMs ?? EXPORT_DURATION_MAX_MS,
    'maxDurationMs',
  );
  if (minimum > maximum) {
    throw new RangeError('minDurationMs cannot be greater than maxDurationMs.');
  }

  const requestedDurationMs = clamp(
    requireFinitePositive(input.requestedDurationMs, 'requestedDurationMs'),
    minimum,
    maximum,
  );
  const animatedLayers = input.layers.filter(
    (layer) => layer.visible !== false && layer.animation?.enabled,
  );

  if (!input.loopLockEnabled || animatedLayers.length === 0) {
    return createExportDurationPlan({
      requestedDurationMs,
      fps: input.fps,
      loopLockEnabled: input.loopLockEnabled,
      animatedLayerCount: animatedLayers.length,
    });
  }

  const cycleTimes = animatedLayers
    .map((layer) => {
      // PHASE 7.3E FOUNDATION FREEZE: duration planning MUST use the same
      // mapped speed consumed by GradientCanvas during deterministic export.
      // Raw slider speed and runtime speed are intentionally not equivalent.
      // Changing this authority reintroduces false Loop Lock durations.
      const runtimeSpeed = mapLayerAnimationSpeed(layer.animation!.speed);
      return estimateCycleTime(layer.animation!.type, runtimeSpeed || 1);
    })
    .filter((cycleMs) => Number.isFinite(cycleMs) && cycleMs > 0);

  if (cycleTimes.length === 0) {
    return createExportDurationPlan({
      requestedDurationMs,
      fps: input.fps,
      loopLockEnabled: true,
      animatedLayerCount: animatedLayers.length,
      statusLabel: 'Using target duration',
    });
  }

  const referenceCycleMs = Math.max(...cycleTimes);
  const cycleCount = Math.max(1, Math.ceil(requestedDurationMs / referenceCycleMs));
  const effectiveDurationMs = clamp(cycleCount * referenceCycleMs, minimum, maximum);

  return createExportDurationPlan({
    requestedDurationMs,
    effectiveDurationMs,
    fps: input.fps,
    loopLockEnabled: true,
    referenceCycleMs,
    cycleCount,
    animatedLayerCount: animatedLayers.length,
  });
}
