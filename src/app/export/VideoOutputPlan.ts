export interface VideoOutputDimensions {
  baseWidth: number;
  baseHeight: number;
  width: number;
  height: number;
  renderScale: number;
  aspectRatio: number;
}

const even = (value: number, fallback: number) =>
  Math.max(2, Math.round((Number.isFinite(value) ? value : fallback) / 2) * 2);

/** Single dimension authority shared by the export summary and production call. */
export function resolveVideoOutputDimensions(
  baseWidth: number,
  baseHeight: number,
  renderScale = 1,
): VideoOutputDimensions {
  const safeScale = Number.isFinite(renderScale) ? Math.max(0.25, Math.min(1, renderScale)) : 1;
  const resolvedBaseWidth = even(baseWidth, 1920);
  const resolvedBaseHeight = even(baseHeight, 1080);
  const width = even(resolvedBaseWidth * safeScale, resolvedBaseWidth);
  const height = even(resolvedBaseHeight * safeScale, resolvedBaseHeight);
  return {
    baseWidth: resolvedBaseWidth,
    baseHeight: resolvedBaseHeight,
    width,
    height,
    renderScale: safeScale,
    aspectRatio: width / height,
  };
}
