import { describe, expect, it } from 'vitest';
import { getShapeById, getShapesByCategory, isUsableShapePreset } from '../src/app/lib/maskShapes';

describe('mask shape registry safety', () => {
  it('rejects null and undefined registry entries', () => {
    expect(isUsableShapePreset(undefined)).toBe(false);
    expect(isUsableShapePreset(null)).toBe(false);
  });

  it('returns undefined for missing or empty ids without throwing', () => {
    expect(getShapeById(undefined)).toBeUndefined();
    expect(getShapeById(null)).toBeUndefined();
    expect(getShapeById('')).toBeUndefined();
    expect(getShapeById('shape-that-does-not-exist')).toBeUndefined();
  });

  it('returns only usable shapes from category queries', () => {
    const shapes = getShapesByCategory('core');
    expect(shapes.length).toBeGreaterThan(0);
    expect(shapes.every(isUsableShapePreset)).toBe(true);
  });
});
