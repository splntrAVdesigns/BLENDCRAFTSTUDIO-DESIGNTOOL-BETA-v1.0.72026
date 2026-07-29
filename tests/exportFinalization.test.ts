import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_FINALIZATION_PROGRESS,
  createExportFinalizationTimings,
  getExportFinalizationProgress,
} from '../src/app/utils/exportFinalization.ts';

test('finalization progress is monotonic and reserves 98% for browser download handoff', () => {
  const stages = ['encoding', 'finalizing', 'preparing-file', 'exporting-file', 'cleanup', 'complete'] as const;
  const values = stages.map((stage) => getExportFinalizationProgress(stage).progress);
  assert.deepEqual(values, [90, 95, 97, 98, 99, 100]);
  assert.equal(EXPORT_FINALIZATION_PROGRESS['exporting-file'].message, 'Exporting file...');
});

test('finalization timings start at zero for each export', () => {
  assert.deepEqual(createExportFinalizationTimings(), {
    muxMs: 0,
    blobMs: 0,
    downloadHandoffMs: 0,
    cleanupMs: 0,
  });
});
