import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acquireRecordingSessionLease,
  isRecordingSessionActive,
  runRecordingRecovery,
  runRecoveryStep,
} from '../src/app/export/recording/RecordingRecovery.ts';
import { RecordingSessionController } from '../src/app/export/recording/RecordingSessionController.ts';

test('recording session may cancel from recording, stopping, and finalizing', () => {
  for (const state of ['recording', 'stopping', 'finalizing'] as const) {
    const controller = new RecordingSessionController();
    controller.transition('preparing');
    controller.transition('recording');
    if (state === 'stopping' || state === 'finalizing') controller.transition('stopping');
    if (state === 'finalizing') controller.transition('finalizing');
    assert.equal(controller.transition('cancelled'), 'cancelled');
    assert.equal(controller.transition('idle'), 'idle');
  }
});

test('session lease blocks overlap and releases for immediate retry', () => {
  const release = acquireRecordingSessionLease();
  assert.equal(isRecordingSessionActive(), true);
  assert.throws(() => acquireRecordingSessionLease(), /already active/);
  release();
  assert.equal(isRecordingSessionActive(), false);
  const releaseAgain = acquireRecordingSessionLease();
  releaseAgain();
  assert.equal(isRecordingSessionActive(), false);
});

test('recovery continues after a failed step', async () => {
  const calls: string[] = [];
  const result = await runRecordingRecovery([
    { label: 'first', run: () => { calls.push('first'); throw new Error('first failed'); } },
    { label: 'second', run: () => { calls.push('second'); } },
  ], (() => { let n = 0; return () => ++n; })());
  assert.deepEqual(calls, ['first', 'second']);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /first failed/);
});

test('bounded cleanup reports timeout rather than hanging', async () => {
  const warning = await runRecoveryStep({
    label: 'hung cleanup',
    timeoutMs: 50,
    run: () => new Promise<void>(() => undefined),
  });
  assert.match(warning ?? '', /timed out/);
});
