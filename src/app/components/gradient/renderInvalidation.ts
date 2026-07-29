/**
 * Render invalidation helpers extracted from GradientCanvas Phase 1.
 * Uses the same next-frame behavior that was previously inline.
 */
export function markRenderNeededNextFrame(needsRenderRef: { current: boolean }): number {
  return requestAnimationFrame(() => {
    needsRenderRef.current = true;
  });
}

export function cancelFrame(ref: { current: number | undefined }): void {
  if (ref.current !== undefined) {
    cancelAnimationFrame(ref.current);
  }
}