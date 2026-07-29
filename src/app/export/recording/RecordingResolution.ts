export interface RecordingResolution {
  readonly width: number;
  readonly height: number;
}

export function normalizeRecordingResolution(width: number, height: number): RecordingResolution {
  const normalize = (value: number): number => {
    const rounded = Math.max(2, Math.round(value));
    return rounded % 2 === 0 ? rounded : rounded - 1;
  };
  return { width: normalize(width), height: normalize(height) };
}

export function assertExactRecordingResolution(
  expected: RecordingResolution,
  actual: RecordingResolution,
  label = 'recording frame',
): void {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error(
      `${label} resolution mismatch: expected ${expected.width}×${expected.height}, `
      + `received ${actual.width}×${actual.height}.`,
    );
  }
}
