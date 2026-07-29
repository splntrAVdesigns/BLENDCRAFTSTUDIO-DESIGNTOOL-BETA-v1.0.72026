import test from 'node:test';
import assert from 'node:assert/strict';
import { runExportRenderScheduler } from '../src/app/export/ExportRenderScheduler.ts';

test('samples elapsed export time without duration normalization', async () => {
  let now = 0;
  let id = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const samples: number[] = [];
  const promise = runExportRenderScheduler({
    durationMs: 1000,
    fps: 4,
    renderAtTime: (seconds) => { samples.push(seconds); },
    now: () => now,
    requestFrame: (callback) => { const handle = ++id; callbacks.set(handle, callback); return handle; },
    cancelFrame: (handle) => { callbacks.delete(handle); },
  });
  for (const time of [0, 250, 500, 750, 1000, 1000]) {
    now = time;
    const pending = [...callbacks.entries()];
    callbacks.clear();
    pending.forEach(([, callback]) => callback(now));
    await Promise.resolve();
    await Promise.resolve();
  }
  await promise;
  assert.deepEqual(samples, [0, 0.25, 0.5, 0.75]);
});

test('aborts safely', async () => {
  const controller = new AbortController();
  let callback: FrameRequestCallback | undefined;
  const promise = runExportRenderScheduler({
    durationMs: 1000,
    fps: 30,
    signal: controller.signal,
    renderAtTime: () => undefined,
    now: () => 0,
    requestFrame: (next) => { callback = next; return 1; },
    cancelFrame: () => undefined,
  });
  controller.abort('cancelled');
  callback?.(0);
  await assert.rejects(promise, { name: 'AbortError' });
});

test('latest catch-up strategy skips stale samples instead of extending wall-clock timing', async () => {
  let now = 0;
  let id = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const samples: number[] = [];
  const promise = runExportRenderScheduler({
    durationMs: 1000,
    fps: 10,
    catchUpStrategy: 'latest',
    renderAtTime: (seconds) => { samples.push(seconds); },
    now: () => now,
    requestFrame: (callback) => { const handle = ++id; callbacks.set(handle, callback); return handle; },
    cancelFrame: (handle) => { callbacks.delete(handle); },
  });
  for (const time of [0, 500, 1000, 1000]) {
    now = time;
    const pending = [...callbacks.values()];
    callbacks.clear();
    pending.forEach((callback) => callback(now));
    await Promise.resolve();
    await Promise.resolve();
  }
  const result = await promise;
  assert.deepEqual(samples, [0, 0.5, 0.9]);
  assert.equal(result.skippedSamples, 7);
  assert.equal(result.renderedSamples, 3);
});
