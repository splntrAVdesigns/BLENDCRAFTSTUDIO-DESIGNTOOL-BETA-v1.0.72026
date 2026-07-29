import test from 'node:test';
import assert from 'node:assert/strict';
import { exportWithNativeRecorder } from '../src/app/export/GradientExportBridge.ts';
import type { RenderApi } from '../src/app/types/gradient.ts';

class FakeRecorderEngine {
  async record(input: any): Promise<Blob> {
    input.onStarted?.();
    await input.stopWhen;
    return new Blob([new Uint8Array(2048)], { type: 'video/webm' });
  }
}

test('prepares export size and frame zero before starting native recording', async () => {
  const calls: string[] = [];
  let now = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  let id = 0;
  const oldRaf = globalThis.requestAnimationFrame;
  const oldCancel = globalThis.cancelAnimationFrame;
  const oldPerformance = globalThis.performance;
  Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true });
  globalThis.requestAnimationFrame = (cb) => { callbacks.set(++id, cb); return id; };
  globalThis.cancelAnimationFrame = (handle) => { callbacks.delete(handle); };

  const api = {
    renderAtTime: async (time: number) => { calls.push(`render:${time.toFixed(2)}`); },
    getCanvas: () => null,
    setExportSize: (w: number, h: number) => { calls.push(`size:${w}x${h}`); },
    restoreSize: () => undefined,
    waitForMaskTextures: async () => { calls.push('masks'); },
  } as RenderApi;

  try {
    const promise = exportWithNativeRecorder({
      api,
      canvas: { captureStream: () => ({ getTracks: () => [] }) } as unknown as HTMLCanvasElement,
      width: 1920,
      height: 1080,
      fps: 2,
      durationMs: 1000,
      recorderEngine: new FakeRecorderEngine() as any,
    });
    for (const t of [0, 500, 1000, 1000]) {
      now = t;
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((cb) => cb(t));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    const result = await promise;
    assert.equal(result.blob.type, 'video/webm');
    assert.deepEqual(calls.slice(0, 3), ['masks', 'size:1920x1080', 'render:0.00']);
  } finally {
    Object.defineProperty(globalThis, 'performance', { value: oldPerformance, configurable: true });
    globalThis.requestAnimationFrame = oldRaf;
    globalThis.cancelAnimationFrame = oldCancel;
  }
});
