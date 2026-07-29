export type ExportCleanupStep =
  | 'renderer'
  | 'clock'
  | 'play-state'
  | 'timeline'
  | 'camera'
  | 'animation-phase'
  | 'viewport'
  | 'canvas-size'
  | 'texture-bindings'
  | 'temporary-buffers'
  | 'encoder'
  | 'memory-pool';

export interface ExportCleanupReport {
  completed: boolean;
  steps: ExportCleanupStep[];
  failures: Array<{ step: ExportCleanupStep; error: string }>;
  durationMs: number;
}

export async function runExportCleanup(
  tasks: Array<{ step: ExportCleanupStep; run: () => void | Promise<void> }>,
): Promise<ExportCleanupReport> {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const steps: ExportCleanupStep[] = [];
  const failures: ExportCleanupReport['failures'] = [];

  for (const task of tasks) {
    try {
      await task.run();
      steps.push(task.step);
    } catch (error) {
      failures.push({ step: task.step, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { completed: failures.length === 0, steps, failures, durationMs: endedAt - startedAt };
}
