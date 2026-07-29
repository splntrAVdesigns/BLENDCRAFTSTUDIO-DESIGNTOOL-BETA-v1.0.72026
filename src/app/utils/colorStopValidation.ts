/**
 * Color Stop Validation and Fixing Utilities
 * 
 * Ensures color stops are properly formatted for WebGL shader rendering:
 * - Sorted by position (monotonically increasing)
 * - No duplicate positions (prevents division by zero)
 * - Minimum spacing between adjacent stops
 */

import { ColorStop } from '../types/gradient';

export const MIN_POSITION_SPACING = 0.01; // 1% minimum gap between stops

/**
 * Sort color stops by position (ascending order)
 * Required for proper shader interpolation
 */
export function sortColorStops(stops: ColorStop[]): ColorStop[] {
  return [...stops].sort((a, b) => a.position - b.position);
}

/**
 * Enforce minimum spacing between adjacent color stops
 * Prevents division by zero in shader interpolation
 */
export function enforceMinimumSpacing(stops: ColorStop[]): ColorStop[] {
  const sorted = sortColorStops(stops);
  const fixed: ColorStop[] = [];
  
  for (let i = 0; i < sorted.length; i++) {
    let position = sorted[i].position;
    
    // Ensure minimum spacing from previous stop
    if (i > 0) {
      const minAllowed = fixed[i - 1].position + MIN_POSITION_SPACING;
      if (position < minAllowed) {
        position = minAllowed;
      }
    }
    
    // Ensure position doesn't exceed 1.0
    position = Math.min(position, 1.0);
    
    // If we've run out of space, compress from the end
    if (position > 1.0) {
      // Redistribute remaining stops
      const remaining = sorted.length - i;
      const availableSpace = 1.0 - fixed[i - 1].position;
      const spacing = availableSpace / (remaining + 1);
      position = fixed[i - 1].position + spacing;
    }
    
    fixed.push({
      ...sorted[i],
      position: Math.max(0, Math.min(1, position)),
    });
  }
  
  return fixed;
}

/**
 * Validate color stops and return issues
 */
export function validateColorStops(stops: ColorStop[]): {
  valid: boolean;
  issues: string[];
  fixed: ColorStop[];
} {
  const issues: string[] = [];
  
  if (stops.length < 2) {
    issues.push('At least 2 color stops required');
    return { valid: false, issues, fixed: stops };
  }
  
  // Check for duplicates
  const positions = stops.map(s => s.position);
  const hasDuplicates = positions.some((p, i) => positions.indexOf(p) !== i);
  if (hasDuplicates) {
    issues.push('Duplicate positions detected (causes rendering artifacts)');
  }
  
  // Check sorting
  const sorted = sortColorStops(stops);
  const isSorted = JSON.stringify(stops.map(s => s.position)) === 
                   JSON.stringify(sorted.map(s => s.position));
  if (!isSorted) {
    issues.push('Color stops not sorted by position');
  }
  
  // Check minimum spacing
  for (let i = 0; i < sorted.length - 1; i++) {
    const spacing = sorted[i + 1].position - sorted[i].position;
    if (spacing < MIN_POSITION_SPACING) {
      issues.push(`Stops ${i} and ${i + 1} too close (${(spacing * 100).toFixed(1)}% apart, min ${MIN_POSITION_SPACING * 100}%)`);
    }
  }
  
  // Check bounds
  if (sorted[0].position < 0) {
    issues.push('First stop position below 0%');
  }
  if (sorted[sorted.length - 1].position > 1) {
    issues.push('Last stop position above 100%');
  }
  
  // Create fixed version
  const fixed = enforceMinimumSpacing(sorted);
  
  return {
    valid: issues.length === 0,
    issues,
    fixed,
  };
}

/**
 * Distribute color stops evenly across 0-100% range
 */
export function distributeEvenly(stops: ColorStop[]): ColorStop[] {
  if (stops.length < 2) return stops;
  
  return stops.map((stop, index) => ({
    ...stop,
    position: index / (stops.length - 1),
  }));
}

/**
 * Clamp a new position value to valid range considering neighbors
 */
export function clampPosition(
  newPosition: number,
  index: number,
  allStops: ColorStop[]
): number {
  // Sort to find actual neighbors
  const sorted = [...allStops].map((c, i) => ({ ...c, originalIndex: i }))
    .sort((a, b) => a.position - b.position);
  
  const currentIndex = sorted.findIndex(s => s.originalIndex === index);
  const prev = sorted[currentIndex - 1];
  const next = sorted[currentIndex + 1];
  
  let clamped = newPosition;
  
  // Respect minimum spacing from neighbors
  if (prev) {
    clamped = Math.max(clamped, prev.position + MIN_POSITION_SPACING);
  }
  if (next) {
    clamped = Math.min(clamped, next.position - MIN_POSITION_SPACING);
  }
  
  // Clamp to 0-1 range
  clamped = Math.max(0, Math.min(1, clamped));
  
  return clamped;
}
