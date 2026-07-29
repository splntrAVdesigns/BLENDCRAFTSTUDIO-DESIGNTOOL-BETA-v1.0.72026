import test from 'node:test';
import assert from 'node:assert/strict';
import { createExportTimeline } from '../src/app/utils/exportTimeline.ts';

test('5 seconds at 30 fps produces exactly 150 deterministic frame contexts', () => {
  const timeline = createExportTimeline({ fps: 30, totalFrames: 150 });
  assert.equal(timeline.durationMs, 5000);
  assert.equal(timeline.frame(0).relativeTimeSeconds, 0);
  assert.equal(timeline.frame(149).frameIndex, 149);
  assert.equal(timeline.wrapFrame().relativeTimeSeconds, 5);
});

test('7 seconds at 60 fps produces exactly 420 frames and integer microsecond boundaries', () => {
  const timeline = createExportTimeline({ fps: 60, totalFrames: 420 });
  assert.equal(timeline.durationMs, 7000);
  assert.equal(timeline.frame(0).timestampUs, 0);
  assert.equal(timeline.wrapFrame().timestampUs, 7_000_000);
  for (let index = 0; index < timeline.totalFrames; index += 1) {
    const frame = timeline.frame(index);
    assert.ok(Number.isInteger(frame.timestampUs));
    assert.ok(Number.isInteger(frame.durationUs));
    assert.ok(frame.durationUs > 0);
  }
});

test('timeline uses frame index only and does not accumulate floating-point drift', () => {
  const timeline = createExportTimeline({ fps: 59.94, totalFrames: 3600, startTimeSeconds: 12.5 });
  const last = timeline.frame(3599);
  assert.equal(last.relativeTimeSeconds, 3599 / 59.94);
  assert.equal(last.absoluteTimeSeconds, 12.5 + 3599 / 59.94);
  assert.equal(timeline.wrapFrame().timestampUs, Math.round((3600 * 1_000_000) / 59.94));
});
