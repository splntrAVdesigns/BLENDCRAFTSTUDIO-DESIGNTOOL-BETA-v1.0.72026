import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const shader = readFileSync(new URL('../src/app/shaders/maskShaderWrapper.ts', import.meta.url), 'utf8');
const controls = readFileSync(new URL('../src/app/components/controls/MaskControls.tsx', import.meta.url), 'utf8');

test('edge detector uses bounds-aware samples and valid shaping thresholds', () => {
  assert.doesNotMatch(shader, /sampleThreshBoundsAware\(/);
  assert.match(shader, /sampleExpandThresh\(uv, vec2\(/);
  assert.match(shader, /smoothstep\(0\.04, 0\.35, rawEdge\)/);
  assert.doesNotMatch(shader, /smoothstep\(0\.9, 0\.6, center\)/);
  assert.doesNotMatch(shader, /rawEdge \* boundaryProximity/);
});

test('shape library remains open after selection and exposes persistent selected state', () => {
  const selectHandler = controls.slice(
    controls.indexOf('const handleShapeSelect'),
    controls.indexOf('const handleStrokeWidthChange'),
  );
  assert.doesNotMatch(selectHandler, /setShowShapePicker\(false\)/);
  assert.match(controls, /selectedLibraryShape/);
  assert.match(controls, /aria-pressed=\{isSelected\}/);
  assert.match(controls, /Selected mask/);
});
