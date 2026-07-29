import test from 'node:test';
import assert from 'node:assert/strict';
import { runExportCleanup } from '../src/app/utils/exportCleanup.ts';

test('runs cleanup tasks in deterministic order', async () => {
  const order: string[] = [];
  const report = await runExportCleanup([
    { step: 'renderer', run: () => { order.push('renderer'); } },
    { step: 'timeline', run: async () => { order.push('timeline'); } },
    { step: 'memory-pool', run: () => { order.push('memory-pool'); } },
  ]);
  assert.deepEqual(order, ['renderer', 'timeline', 'memory-pool']);
  assert.equal(report.completed, true);
});

test('continues cleanup after a failed step', async () => {
  let finalRan = false;
  const report = await runExportCleanup([
    { step: 'renderer', run: () => { throw new Error('fail'); } },
    { step: 'memory-pool', run: () => { finalRan = true; } },
  ]);
  assert.equal(finalRan, true);
  assert.equal(report.completed, false);
  assert.equal(report.failures[0]?.step, 'renderer');
});
