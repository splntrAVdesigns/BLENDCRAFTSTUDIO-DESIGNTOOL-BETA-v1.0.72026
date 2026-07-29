import test from 'node:test';
import assert from 'node:assert/strict';
import { runRealTimeExportClock } from '../src/app/export/recording/RealTimeExportClock.ts';

test('real-time export clock publishes sequential frame indices', async () => {
  let nowMs = 0;
  let handle = 0;
  const frames: number[] = [];
  const result = await runRealTimeExportClock({
    fps: 30,
    durationMs: 100,
    now: () => nowMs,
    requestAnimationFrameFn: (callback) => {
      const nextHandle = ++handle;
      nowMs += 34;
      setImmediate(() => callback(nowMs));
      return nextHandle;
    },
    cancelAnimationFrameFn: () => undefined,
    onTick: (_seconds, frameIndex) => { frames.push(frameIndex); },
  });
  assert.deepEqual(frames, [0, 1, 2]);
  assert.equal(result.totalFrames, 3);
  assert.equal(result.publishedFrames, 3);
});
