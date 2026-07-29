/**
 * Utility to filter out Figma Make inspector props
 * These props (_fgT, _fgt, _fgS, _fgs, _fgB, _fgb, etc.) are injected by Figma Make
 * for debugging and inspection purposes but should not be passed to DOM elements
 */

export function filterFigmaProps<T extends Record<string, any>>(props: T): Partial<T> {
  const filtered: any = {};
  
  for (const key in props) {
    // Filter out all props that start with _fg or _FG
    if (!key.startsWith('_fg') && !key.startsWith('_FG')) {
      filtered[key] = props[key];
    }
  }
  
  return filtered;
}