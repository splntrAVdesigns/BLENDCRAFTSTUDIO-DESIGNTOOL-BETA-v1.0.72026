import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildCanvasSourceConfig } from '../src/app/export/mediabunnyEncodeShared.ts';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('production and compatibility worker entries share one encoder authority', () => {
  const production = read('src/app/export/videoEncoder.worker.ts');
  const compatibility = read('src/app/export/mediabunnyEncodeWorker.ts');
  assert.match(production, /buildCanvasSourceConfig/);
  assert.match(compatibility, /import '\.\/videoEncoder\.worker'/);
  assert.doesNotMatch(compatibility, /new VideoSampleSource/);
});

test('shared encoder config gives MP4 and WebM the declared GOP', () => {
  const callbacks = { onEncodedPacket: () => {}, onEncoderConfig: () => {} };
  const mp4 = buildCanvasSourceConfig({ container: 'mp4', bitrate: 24_000_000, keyFrameIntervalSeconds: 1, ...callbacks });
  const webm = buildCanvasSourceConfig({ container: 'webm', bitrate: 24_000_000, keyFrameIntervalSeconds: 1, latencyMode: 'quality', ...callbacks });
  assert.equal(mp4.keyFrameInterval, 1);
  assert.equal(webm.keyFrameInterval, 1);
  assert.equal(webm.latencyMode, 'quality');
  assert.equal('latencyMode' in mp4, false);
});

test('video fidelity path is 1:1 and validates detail plus BT.709', () => {
  const exporter = read('src/app/utils/exportUtils.ts');
  const fidelity = read('src/app/export/exportFrameFidelity.ts');
  assert.match(exporter, /function getWebMSourceScale[\s\S]*return 1;/);
  assert.match(exporter, /webmLatencyMode: 'realtime'/);
  assert.match(fidelity, /edgeRetentionRatio/);
  assert.match(fidelity, /chromaMeanAbsoluteError/);
  assert.match(fidelity, /colorSpace\?\.primaries === 'bt709'/);
  assert.match(fidelity, /colorSpace\?\.matrix === 'bt709'/);
  assert.match(fidelity, /colorContractPassed/);
});

test('dense 1080p delivery tiers receive production fidelity headroom', () => {
  const exporter = read('src/app/utils/exportUtils.ts');
  assert.match(exporter, /return 36_000_000; \/\/ 1080p dense gradients/);
  assert.match(exporter, /return 40_000_000;\s+\/\/ 1080p dense animated gradients/);
  assert.match(exporter, /return 120_000_000;\s*\n\s*},\s*\n\s*},\s*\n};/);
});

test('spatial compositor uses high precision replacement passes', () => {
  const canvas = read('src/app/components/gradient/GradientCanvas.tsx');
  const compositor = read('src/app/postfx/pingPongCompositor.ts');
  assert.match(canvas, /renderer\.extensions\.has\('EXT_color_buffer_float'\)/);
  assert.match(canvas, /THREE\.HalfFloatType/);
  assert.match(compositor, /type: THREE\.TextureDataType/);
  for (const name of ['blur','chromaticAberration','filmGrain','fresnel','graphicSlice','halftone','noiseDisplace','pixelate','posterize','quadMirror','shapeOverlay','vignette']) {
    const stage = read(`src/app/postfx/stages/${name}Stage.ts`);
    assert.match(stage, /precision highp float/);
    assert.match(stage, /blending: THREE\.NoBlending/);
    assert.match(stage, /transparent: false/);
  }
});

test('canvas resize restarts RAF ownership and synchronizes all render targets', () => {
  const canvas = read('src/app/components/gradient/GradientCanvas.tsx');
  const panel = read('src/app/components/controls/ExportPanel.tsx');
  assert.match(canvas, /rendererGeneration/);
  assert.match(canvas, /resizeSpatialChainCompositor\(spatialCompositorRef\.current, newW, newH\)/);
  assert.match(panel, /videoResolutionFollowsCanvas/);
  assert.match(panel, /resolveVideoOutputDimensions/);
});
