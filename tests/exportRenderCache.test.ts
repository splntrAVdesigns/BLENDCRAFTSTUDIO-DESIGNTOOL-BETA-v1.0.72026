import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createExportRenderCache,
  invalidateExportRenderCache,
  resizeExportRenderCache,
} from '../src/app/utils/exportRenderCache.ts';

test('builds one persistent export-session cache', () => {
  const entries = [{ id: 'layer-a' }, { id: 'layer-b' }];
  const cache = createExportRenderCache({ entries, width: 1920, height: 1080 });
  assert.equal(cache.entries, entries);
  assert.equal(cache.buildCount, 1);
  assert.equal(cache.aspect, 1920 / 1080);
});

test('keeps static resources valid when dimensions do not change', () => {
  const cache = createExportRenderCache({ entries: [], width: 1920, height: 1080 });
  cache.staticUniformsApplied = true;
  assert.equal(resizeExportRenderCache(cache, 1920, 1080), false);
  assert.equal(cache.staticUniformsApplied, true);
});

test('invalidates only dimension-dependent state on resize', () => {
  const cache = createExportRenderCache({ entries: [1], width: 1920, height: 1080 });
  cache.staticUniformsApplied = true;
  cache.shaderWarmupComplete = true;
  assert.equal(resizeExportRenderCache(cache, 3840, 2160), true);
  assert.equal(cache.entries.length, 1);
  assert.equal(cache.staticUniformsApplied, false);
  assert.equal(cache.shaderWarmupComplete, true);
});

test('releases cached references at export end', () => {
  const cache = createExportRenderCache({ entries: [1, 2], width: 1280, height: 720 });
  cache.staticUniformsApplied = true;
  cache.shaderWarmupComplete = true;
  invalidateExportRenderCache(cache);
  assert.equal(cache.entries.length, 0);
  assert.equal(cache.staticUniformsApplied, false);
  assert.equal(cache.shaderWarmupComplete, false);
});
