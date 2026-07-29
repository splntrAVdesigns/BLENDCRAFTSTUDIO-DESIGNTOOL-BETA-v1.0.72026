import type { ExportCleanupReport } from './exportCleanup';
import type { ExportMemoryRecoveryResult } from './exportCertification';

export interface ExportTimingSample {
  totalSec: number;
  renderSec: number;
  encodeWaitSec: number;
  flushSec: number;
  muxSec: number;
  blobSec: number;
  downloadHandoffSec: number;
  frames: number;
  msPerFrame: number;
  breakdown?: string;
}

export interface ExportCertificationSample {
  id: number;
  capturedAt: string;
  timing: ExportTimingSample;
  memoryRecovery?: ExportMemoryRecoveryResult;
  cleanup?: ExportCleanupReport;
  failure?: string;
}

export interface ExportProductionGate {
  passed: boolean;
  sampleCount: number;
  cleanupPassRate: number;
  memoryPassRate: number;
  failureCount: number;
  medianTotalSec: number | null;
  p95TotalSec: number | null;
  bottleneck: 'render' | 'encode-wait' | 'flush' | 'finalization' | 'unknown';
  blockers: string[];
}

export interface ExportStressSession {
  version: 1;
  samples: ExportCertificationSample[];
  gate: ExportProductionGate;
}

const MAX_SAMPLES = 50;
let nextId = 1;
let samples: ExportCertificationSample[] = [];

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function identifyExportBottleneck(timing: ExportTimingSample): ExportProductionGate['bottleneck'] {
  const finalization = timing.muxSec + timing.blobSec + timing.downloadHandoffSec;
  const entries = [
    ['render', timing.renderSec],
    ['encode-wait', timing.encodeWaitSec],
    ['flush', timing.flushSec],
    ['finalization', finalization],
  ] as const;
  const winner = entries.reduce((best, current) => current[1] > best[1] ? current : best, entries[0]);
  return winner[1] > 0 ? winner[0] : 'unknown';
}

export function evaluateExportProductionGate(input: ExportCertificationSample[]): ExportProductionGate {
  const timings = input.filter(sample => !sample.failure).map(sample => sample.timing);
  const cleanupSamples = input.filter(sample => sample.cleanup != null);
  const memorySamples = input.filter(sample => sample.memoryRecovery?.supported);
  const cleanupPassRate = cleanupSamples.length === 0
    ? 1
    : cleanupSamples.filter(sample => sample.cleanup?.completed).length / cleanupSamples.length;
  const memoryPassRate = memorySamples.length === 0
    ? 1
    : memorySamples.filter(sample => sample.memoryRecovery?.withinLimit).length / memorySamples.length;
  const failureCount = input.filter(sample => sample.failure).length;
  const totalSeconds = timings.map(timing => timing.totalSec);
  const aggregate = timings.reduce<ExportTimingSample>((acc, timing) => ({
    totalSec: acc.totalSec + timing.totalSec,
    renderSec: acc.renderSec + timing.renderSec,
    encodeWaitSec: acc.encodeWaitSec + timing.encodeWaitSec,
    flushSec: acc.flushSec + timing.flushSec,
    muxSec: acc.muxSec + timing.muxSec,
    blobSec: acc.blobSec + timing.blobSec,
    downloadHandoffSec: acc.downloadHandoffSec + timing.downloadHandoffSec,
    frames: acc.frames + timing.frames,
    msPerFrame: acc.msPerFrame + timing.msPerFrame,
  }), { totalSec: 0, renderSec: 0, encodeWaitSec: 0, flushSec: 0, muxSec: 0, blobSec: 0, downloadHandoffSec: 0, frames: 0, msPerFrame: 0 });

  const blockers: string[] = [];
  if (timings.length < 3) blockers.push('Run at least three successful exports for a meaningful production gate.');
  if (failureCount > 0) blockers.push(`${failureCount} export failure(s) recorded.`);
  if (cleanupPassRate < 1) blockers.push('One or more exports left cleanup state dirty.');
  if (memoryPassRate < 0.9) blockers.push('Retained heap exceeded the recovery target too often.');

  return {
    passed: timings.length >= 3 && blockers.length === 0,
    sampleCount: timings.length,
    cleanupPassRate: round(cleanupPassRate),
    memoryPassRate: round(memoryPassRate),
    failureCount,
    medianTotalSec: percentile(totalSeconds, 0.5),
    p95TotalSec: percentile(totalSeconds, 0.95),
    bottleneck: timings.length > 0 ? identifyExportBottleneck(aggregate) : 'unknown',
    blockers,
  };
}

function publish(): ExportStressSession {
  const session = { version: 1 as const, samples: [...samples], gate: evaluateExportProductionGate(samples) };
  try { (globalThis as any).__blendcraftExportCertification = session; } catch { /* diagnostics only */ }
  return session;
}

export function recordExportTiming(
  timing: ExportTimingSample,
  memoryRecovery?: ExportMemoryRecoveryResult,
): ExportCertificationSample {
  const sample: ExportCertificationSample = {
    id: nextId++,
    capturedAt: new Date().toISOString(),
    timing: { ...timing },
    memoryRecovery,
  };
  samples = [...samples.slice(-(MAX_SAMPLES - 1)), sample];
  publish();
  return sample;
}

export function attachLatestExportCleanup(cleanup: ExportCleanupReport): ExportStressSession {
  if (samples.length === 0) return publish();
  const latest = samples[samples.length - 1];
  samples = [...samples.slice(0, -1), { ...latest, cleanup }];
  return publish();
}


export function attachLatestExportMemoryRecovery(memoryRecovery: ExportMemoryRecoveryResult): ExportStressSession {
  if (samples.length === 0) return publish();
  const latest = samples[samples.length - 1];
  samples = [...samples.slice(0, -1), { ...latest, memoryRecovery }];
  return publish();
}

export function recordExportFailure(error: unknown): ExportStressSession {
  const message = error instanceof Error ? error.message : String(error);
  const emptyTiming: ExportTimingSample = {
    totalSec: 0, renderSec: 0, encodeWaitSec: 0, flushSec: 0,
    muxSec: 0, blobSec: 0, downloadHandoffSec: 0, frames: 0, msPerFrame: 0,
  };
  samples = [...samples.slice(-(MAX_SAMPLES - 1)), {
    id: nextId++, capturedAt: new Date().toISOString(), timing: emptyTiming, failure: message,
  }];
  return publish();
}

export function getExportStressSession(): ExportStressSession {
  return publish();
}

export function resetExportStressSession(): ExportStressSession {
  samples = [];
  nextId = 1;
  return publish();
}

export function serializeExportCertification(session = getExportStressSession()): string {
  return JSON.stringify(session, null, 2);
}
