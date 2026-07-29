import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachLatestExportCleanup,
  attachLatestExportMemoryRecovery,
  evaluateExportProductionGate,
  getExportStressSession,
  identifyExportBottleneck,
  recordExportFailure,
  recordExportTiming,
  resetExportStressSession,
  serializeExportCertification,
} from '../src/app/utils/exportStressCertification.ts';

const timing = (overrides = {}) => ({
  totalSec: 10,
  renderSec: 2,
  encodeWaitSec: 6,
  flushSec: 1,
  muxSec: 0.2,
  blobSec: 0.1,
  downloadHandoffSec: 0.1,
  frames: 90,
  msPerFrame: 111,
  ...overrides,
});

test('identifies the dominant export bottleneck', () => {
  assert.equal(identifyExportBottleneck(timing()), 'encode-wait');
  assert.equal(identifyExportBottleneck(timing({ renderSec: 9, encodeWaitSec: 1 })), 'render');
});

test('production gate requires at least three clean samples', () => {
  const samples = [1, 2, 3].map(id => ({
    id,
    capturedAt: new Date(0).toISOString(),
    timing: timing(),
    cleanup: { completed: true, steps: [], failures: [], durationMs: 1 },
  }));
  const gate = evaluateExportProductionGate(samples);
  assert.equal(gate.passed, true);
  assert.equal(gate.sampleCount, 3);
  assert.equal(gate.bottleneck, 'encode-wait');
});

test('cleanup or memory regressions block certification', () => {
  const gate = evaluateExportProductionGate([1, 2, 3].map((id) => ({
    id,
    capturedAt: new Date(0).toISOString(),
    timing: timing(),
    cleanup: { completed: id !== 2, steps: [], failures: id === 2 ? [{ step: 'renderer' as const, error: 'dirty' }] : [], durationMs: 1 },
    memoryRecovery: { supported: true, baselineBytes: 100, recoveredBytes: id === 3 ? 140 : 100, growthPercent: id === 3 ? 40 : 0, withinLimit: id !== 3 },
  })));
  assert.equal(gate.passed, false);
  assert.ok(gate.blockers.some(blocker => blocker.includes('cleanup')));
  assert.ok(gate.blockers.some(blocker => blocker.includes('heap')));
});

test('runtime session stores timing and attaches cleanup to the latest export', () => {
  resetExportStressSession();
  recordExportTiming(timing());
  attachLatestExportCleanup({ completed: true, steps: ['renderer'], failures: [], durationMs: 2 });
  attachLatestExportMemoryRecovery({ supported: true, baselineBytes: 100, recoveredBytes: 100, growthPercent: 0, withinLimit: true });
  const session = getExportStressSession();
  assert.equal(session.samples.length, 1);
  assert.equal(session.samples[0].cleanup?.completed, true);
  assert.equal(session.samples[0].memoryRecovery?.withinLimit, true);
  assert.match(serializeExportCertification(session), /"bottleneck"/);
});

test('recorded failures are retained and block the gate', () => {
  resetExportStressSession();
  recordExportFailure(new Error('encoder failed'));
  const session = getExportStressSession();
  assert.equal(session.samples[0].failure, 'encoder failed');
  assert.equal(session.gate.failureCount, 1);
  assert.equal(session.gate.passed, false);
});
