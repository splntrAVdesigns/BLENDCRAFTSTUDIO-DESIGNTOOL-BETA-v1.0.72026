import type { VideoLabBenchmarkResult } from './types';

const STORAGE_KEY = 'blendcraft.videoLab.phase73F1.results';
const MAX_RESULTS = 30;

export function readVideoLabBenchmarks(): VideoLabBenchmarkResult[] {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as VideoLabBenchmarkResult[] : [];
  } catch {
    return [];
  }
}

export function saveVideoLabBenchmark(result: VideoLabBenchmarkResult): void {
  try {
    const next = [result, ...readVideoLabBenchmarks()].slice(0, MAX_RESULTS);
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Benchmark persistence must never fail an otherwise-valid export.
  }
}

export function createVideoLabBenchmarkBlob(results = readVideoLabBenchmarks()): Blob {
  return new Blob([JSON.stringify({ phase: '7.3F.1', results }, null, 2)], {
    type: 'application/json',
  });
}
