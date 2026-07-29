import type { RecordingCleanupDiagnostics } from './types';

export interface RecordingRecoveryStep {
  readonly label: string;
  readonly run: () => void | Promise<void>;
  readonly timeoutMs?: number;
}

export interface RecordingRecoveryResult {
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly warnings: readonly string[];
}

export async function runRecoveryStep(step: RecordingRecoveryStep): Promise<string | null> {
  const timeoutMs = Math.max(50, step.timeoutMs ?? 1_500);
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(step.run),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`${step.label} timed out after ${timeoutMs} ms.`)),
          timeoutMs,
        );
      }),
    ]);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : `${step.label} failed.`;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

export async function runRecordingRecovery(
  steps: readonly RecordingRecoveryStep[],
  now: () => number = () => performance.now(),
): Promise<RecordingRecoveryResult> {
  const startedAt = now();
  const warnings: string[] = [];
  let timedOut = false;
  for (const step of steps) {
    const warning = await runRecoveryStep(step);
    if (!warning) continue;
    warnings.push(warning);
    if (/timed out/i.test(warning)) timedOut = true;
  }
  return {
    durationMs: Math.max(0, now() - startedAt),
    timedOut,
    warnings,
  };
}

export function createCleanupDiagnostics(input: {
  recorderStopped: boolean;
  streamTracksStopped: number;
  recordingCanvasDisposed: boolean;
  compositorDisposed: boolean;
  previewDisposed?: boolean;
  rendererRestored?: boolean;
  cleanupTimedOut?: boolean;
  cleanupDurationMs?: number;
  warnings?: readonly string[];
}): RecordingCleanupDiagnostics {
  return {
    ...input,
    warnings: input.warnings ?? [],
  };
}

let activeRecordingSession = false;

export function acquireRecordingSessionLease(): () => void {
  if (activeRecordingSession) {
    throw new Error('A recording export session is already active.');
  }
  activeRecordingSession = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeRecordingSession = false;
  };
}

export function isRecordingSessionActive(): boolean {
  return activeRecordingSession;
}
