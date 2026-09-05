import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('MP4 CanvasSource follows the Visual Mood Labs codec-and-bitrate contract', () => {
  const engine = read('src/app/export/mediabunnyExport.ts');
  const mp4Source = engine.slice(
    engine.indexOf("? new CanvasSource(stagingCanvas"),
    engine.indexOf(": new CanvasSource(stagingCanvas"),
  );
  assert.match(mp4Source, /codec: 'avc'/);
  assert.match(mp4Source, /bitrate/);
  assert.match(mp4Source, /onEncoderConfig/);
  assert.doesNotMatch(mp4Source, /hardwareAcceleration/);
  assert.doesNotMatch(mp4Source, /latencyMode/);
  assert.doesNotMatch(mp4Source, /keyFrameInterval/);
  assert.doesNotMatch(engine, /prefer-hardware|prefer-software|measured-software-fallback|hardware-first/);
});

test('obsolete v2 encoder history is deleted and cannot select a policy', () => {
  const engine = read('src/app/export/mediabunnyExport.ts');
  assert.match(engine, /OBSOLETE_H264_PERFORMANCE_PREFIX/);
  assert.match(engine, /localStorage\.removeItem\(key\)/);
  assert.doesNotMatch(engine, /localStorage\.setItem/);
  assert.doesNotMatch(engine, /readH264Performance|recordH264Performance|resolveEncoderPolicy/);
});

test('export continues captured preview phase and smoothed speed deterministically', () => {
  const canvas = read('src/app/components/gradient/GradientCanvas.tsx');
  const math = read('src/app/components/gradient/gradientMath.ts');
  assert.match(canvas, /state\.capturedPhase =/);
  assert.match(canvas, /state\.capturedSpeed = state\.smoothedSpeed \?\? targetSpeed/);
  assert.match(canvas, /state\.capturedTargetSpeed = targetSpeed/);
  assert.match(canvas, /advanceExportLayerTimeline\(\{/);
  assert.match(canvas, /renderedDeterministicTime: deterministicTime/);
  assert.match(math, /1 - Math\.pow\(1 - alphaAt60Fps, safeDelta \* 60\)/);
});

test('every CanvasSource submission produces published timeline certification', () => {
  const engine = read('src/app/export/mediabunnyExport.ts');
  const exporter = read('src/app/utils/exportUtils.ts');
  assert.match(engine, /requestedTimestamp: t/);
  assert.match(engine, /renderedDeterministicTime: rendered\?\.renderedDeterministicTime \?\? t/);
  assert.match(engine, /encodedTimestamp: t/);
  assert.match(engine, /encodedDuration: frameDurationSeconds/);
  assert.match(engine, /certifyExportTimeline\(timelineFrames, fps, totalFrames\)/);
  assert.ok((exporter.match(/timelineCertification: result\.timelineCertification/g) ?? []).length >= 2);
  assert.match(exporter, /__blendcraftLastTimelineCertification/);
});

test('color, visible-canvas capture and decoded fidelity gates remain intact', () => {
  for (const path of [
    'src/app/utils/gradientRenderer.ts',
    'src/app/utils/meshGradientRenderer.ts',
    'src/app/utils/effectsRenderer.ts',
    'src/app/media/mediaShader.ts',
  ]) assert.doesNotMatch(read(path), /withOutputColorSpace/);

  const exporter = read('src/app/utils/exportUtils.ts');
  assert.match(exporter, /ctx\.drawImage\(liveCanvas/);
  assert.match(exporter, /verifyExportedFrameFidelity/);
  assert.match(exporter, /verifyExportedArtifactDuration/);
});
