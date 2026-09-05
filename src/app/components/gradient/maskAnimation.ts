import type { Layer } from '../../types/gradient';
import type { IUniform } from '../../lib/three';
import { calculateAnimationOffset } from '../../hooks/useLayerAnimations';
import { mapMaskAnimationSpeed } from './gradientMath';

/** Single mask evaluator for visible preview and deterministic export. Angles are radians. */
export function applyMaskAnimation(
  material: { uniforms: Record<string, IUniform> },
  mask: Layer['mask'],
  animationTime: number,
): void {
  if (!mask?.animation?.enabled) {
    // Animation disabled: restore ALL mask uniforms to their base/slider values.
    // This ensures disabling animation (or resetting) snaps the mask back cleanly.
    const baseOpacity = mask?.opacity ?? 1.0;
    const baseScale   = Math.min(3.0, Math.max(0.1, mask?.maskScale ?? 1.0));
    const baseRot     = ((mask?.rotation ?? 0) * Math.PI) / 180.0;
    if (material.uniforms.uMaskOpacity)            material.uniforms.uMaskOpacity.value = baseOpacity;
    if (material.uniforms.uMaskScale)              material.uniforms.uMaskScale.value   = baseScale;
    if (material.uniforms.uMaskRotation)           material.uniforms.uMaskRotation.value = baseRot;
    if (material.uniforms.uMaskOffset?.value?.set) material.uniforms.uMaskOffset.value.set(mask?.positionX ?? 0, mask?.positionY ?? 0);
    return;
  }

  // Reset ALL mask uniforms to base values each frame BEFORE applying animation.
  // Without this, switching types (e.g. fadeâ†’rotate) leaves uMaskOpacity at the last
  // fade value, and the new animation type doesn't write to it â†’ stuck/broken state.
  {
    const mat = material;
    const baseOpacity = mask.opacity ?? 1.0;
    const baseScale   = Math.min(3.0, Math.max(0.1, mask.maskScale ?? 1.0));
    const baseRot     = ((mask.rotation ?? 0) * Math.PI) / 180.0;
    const baseX       = mask.positionX ?? 0;
    const baseY       = mask.positionY ?? 0;
    if (mat.uniforms.uMaskOpacity)             mat.uniforms.uMaskOpacity.value = baseOpacity;
    if (mat.uniforms.uMaskScale)               mat.uniforms.uMaskScale.value   = baseScale;
    if (mat.uniforms.uMaskRotation)            mat.uniforms.uMaskRotation.value = baseRot;
    if (mat.uniforms.uMaskOffset?.value?.set)  mat.uniforms.uMaskOffset.value.set(baseX, baseY);
  }

  const maskTypeMap: Record<string, string> = {
    'rotate': 'rotation',
    'scale':  'scale',
    'pulse':  'pulse',
    'drift':  'drift',
    'swing':  'morph',
    'fade':   'pulse',
    'bounce': 'pulse',
    'spin':   'rotation',
    'wobble': 'ripple',
    'zoom':   'scale',
    'breathe': 'pulse',
    'scanReveal': 'drift',
    'radialExpand': 'scale',
    'sliceWipe': 'drift',
    'glitchMask': 'glitch',
    'orbitDrift': 'drift',
  };
  const mappedMaskType = (maskTypeMap[mask.animation.type] || mask.animation.type) as import('../../types/gradient').AnimationType;

  // v2.2.6: shared speed curve for live/export mask motion.
  const normalizedMaskSpeed = mapMaskAnimationSpeed(mask.animation.speed);

  // Normalize intensity (0-100 slider) â†’ 0-1.
  // Without this, intensity=5 causes pulse to produce negative opacity â†’ black canvas.
  const normalizedMaskIntensity = (mask.animation.intensity ?? 50) / 100;

  const offset = calculateAnimationOffset(
    mappedMaskType, animationTime,
    normalizedMaskSpeed, normalizedMaskIntensity,
    (mask.animation.easing || 'linear') as import('../../types/gradient').EasingType,
    mask.animation.direction || 'forward',
    mask.animation.loop !== false
  );

  // Apply animation to mask uniforms
  if ((mask.animation.type === 'rotate' || mask.animation.type === 'spin') && material.uniforms.uMaskRotation) {
    const baseRotation = ((mask.rotation ?? 0) * Math.PI) / 180.0;
    // offset.angleOffset is in degrees — convert to radians (matches gradient rotation logic).
    // The original code omitted this conversion, making the mask spin ~5 rev/s (looked frozen).
    material.uniforms.uMaskRotation.value = baseRotation + (offset.angleOffset * Math.PI / 180.0);
  } else if (mask.animation.type === 'breathe') {
    const t = offset.signedTime * Math.PI * 2;
    const breath = (1 + Math.sin(t)) * 0.5;
    const baseScale = Math.min(3.0, Math.max(0.1, mask.maskScale ?? 1.0));
    if (material.uniforms.uMaskScale) material.uniforms.uMaskScale.value = Math.max(0.05, baseScale * (1 + (breath - 0.5) * 0.34 * normalizedMaskIntensity));
    if (material.uniforms.uMaskOpacity) material.uniforms.uMaskOpacity.value = Math.max(0.04, (mask.opacity ?? 1.0) * (0.9 + breath * 0.18 * normalizedMaskIntensity));
  } else if (mask.animation.type === 'radialExpand') {
    const p = offset.phase01;
    const expand = Math.pow(p, 0.72);
    const baseScale = Math.min(3.0, Math.max(0.1, mask.maskScale ?? 1.0));
    if (material.uniforms.uMaskScale) material.uniforms.uMaskScale.value = Math.max(0.05, baseScale * (0.32 + expand * (0.68 + 0.42 * normalizedMaskIntensity)));
    if (material.uniforms.uMaskOpacity) material.uniforms.uMaskOpacity.value = Math.max(0.04, (mask.opacity ?? 1.0) * (0.35 + expand * 0.65));
  } else if (mask.animation.type === 'scanReveal' && material.uniforms.uMaskOffset?.value?.set) {
    const baseX = mask.positionX ?? 0;
    const baseY = mask.positionY ?? 0;
    const sweep = (offset.phase01 - 0.5) * 1.35 * normalizedMaskIntensity;
    material.uniforms.uMaskOffset.value.set(baseX + sweep, baseY);
    if (material.uniforms.uMaskOpacity) material.uniforms.uMaskOpacity.value = Math.max(0.08, (mask.opacity ?? 1.0) * (0.65 + 0.35 * Math.sin(offset.phase01 * Math.PI)));
  } else if (mask.animation.type === 'sliceWipe' && material.uniforms.uMaskOffset?.value?.set) {
    const baseX = mask.positionX ?? 0;
    const baseY = mask.positionY ?? 0;
    const dir = mask.animation.direction === 'reverse' ? -1 : 1;
    const sweep = (offset.phase01 - 0.5) * 1.7 * normalizedMaskIntensity * dir;
    material.uniforms.uMaskOffset.value.set(baseX + sweep, baseY + Math.sin(offset.phase01 * Math.PI * 2) * 0.015 * normalizedMaskIntensity);
  } else if (mask.animation.type === 'glitchMask') {
    const t = offset.signedTime;
    const step = Math.floor(t * 18);
    const jx = Math.sin(step * 12.9898) * 43758.5453;
    const jy = Math.sin(step * 78.233) * 24634.6345;
    const rx = (jx - Math.floor(jx) - 0.5) * 0.12 * normalizedMaskIntensity;
    const ry = (jy - Math.floor(jy) - 0.5) * 0.08 * normalizedMaskIntensity;
    if (material.uniforms.uMaskOffset?.value?.set) material.uniforms.uMaskOffset.value.set((mask.positionX ?? 0) + rx, (mask.positionY ?? 0) + ry);
    if (material.uniforms.uMaskRotation) material.uniforms.uMaskRotation.value = ((mask.rotation ?? 0) * Math.PI) / 180.0 + rx * 0.65;
  } else if (mask.animation.type === 'orbitDrift') {
    const t = offset.signedTime * Math.PI * 2;
    if (material.uniforms.uMaskOffset?.value?.set) material.uniforms.uMaskOffset.value.set(
      (mask.positionX ?? 0) + Math.cos(t) * 0.09 * normalizedMaskIntensity,
      (mask.positionY ?? 0) + Math.sin(t) * 0.09 * normalizedMaskIntensity
    );
    if (material.uniforms.uMaskRotation) material.uniforms.uMaskRotation.value = ((mask.rotation ?? 0) * Math.PI) / 180.0 + Math.sin(t * 0.5) * 0.55 * normalizedMaskIntensity;
  } else if ((mask.animation.type === 'scale' || mask.animation.type === 'zoom') && material.uniforms.uMaskScale) {
    const baseScale = Math.min(3.0, Math.max(0.1, mask.maskScale ?? 1.0));
    material.uniforms.uMaskScale.value = Math.max(0.05, baseScale * (1 + offset.scaleOffset));
  } else if (mask.animation.type === 'pulse' && material.uniforms.uMaskOpacity) {
    material.uniforms.uMaskOpacity.value = (mask.opacity ?? 1.0) * offset.intensityMultiplier;
  } else if ((mask.animation.type === 'drift' || mask.animation.type === 'swing' || mask.animation.type === 'wobble') && material.uniforms.uMaskOffset?.value?.set) {
    const baseX = mask.positionX ?? 0;
    const baseY = mask.positionY ?? 0;
    material.uniforms.uMaskOffset.value.set(
      baseX + offset.xOffset,
      baseY + offset.yOffset
    );
  } else if (mask.animation.type === 'bounce' && material.uniforms.uMaskOffset?.value?.set) {
    // Bounce: vertical sinusoidal offset using intensityMultiplier as bounce amplitude
    const baseX = mask.positionX ?? 0;
    const baseY = mask.positionY ?? 0;
    const bounceY = Math.sin(offset.signedTime * Math.PI * 2) * normalizedMaskIntensity * 0.15;
    material.uniforms.uMaskOffset.value.set(baseX, baseY + bounceY);
  } else if (mask.animation.type === 'fade' && material.uniforms.uMaskOpacity) {
    // Fade: smooth opacity oscillation.
    // Clamp minimum to 0.02 â€” the mask shader skips the clip block when opacity < 0.01,
    // which exposes the full unmasked canvas. At 0.02 the shape is ~98% transparent
    // (alpha * 0.02 â‰ˆ invisible) while keeping the clip active.
    const fadeVal = (1 + Math.sin(offset.signedTime * Math.PI * 2)) / 2; // 0-1
    const baseOpacity = mask.opacity ?? 1.0;
    material.uniforms.uMaskOpacity.value = Math.max(0.02, fadeVal * baseOpacity);
  }
}
