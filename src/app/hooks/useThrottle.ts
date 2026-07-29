import { useRef, useCallback, useEffect } from 'react';

/**
 * Hook for throttling callbacks using requestAnimationFrame
 * Optimal for UI updates like sliders, ensuring smooth 60fps performance
 */
export function useThrottle<T extends (...args: any[]) => any>(
  callback: T,
  deps: React.DependencyList = []
): T {
  const rafRef = useRef<number>();
  const lastCallRef = useRef<any[]>();

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const throttledFn = useCallback(
    (...args: Parameters<T>) => {
      // Store the latest arguments
      lastCallRef.current = args;

      // If we already have a pending frame, don't schedule another
      if (rafRef.current) {
        return;
      }

      // Schedule the update on next animation frame
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = undefined;
        
        if (lastCallRef.current) {
          callback(...lastCallRef.current);
          lastCallRef.current = undefined;
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [callback, ...deps]
  );

  return throttledFn as T;
}

/**
 * Hook for debouncing values with requestAnimationFrame throttling
 * Useful for derived state updates from slider interactions
 */
export function useThrottledValue<T>(value: T, delay: number = 16): T {
  const [throttledValue, setThrottledValue] = React.useState<T>(value);
  const rafRef = useRef<number>();
  const timeoutRef = useRef<number>();

  useEffect(() => {
    // Cancel any pending updates
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Use timeout for debouncing, then RAF for smooth update
    timeoutRef.current = window.setTimeout(() => {
      rafRef.current = requestAnimationFrame(() => {
        setThrottledValue(value);
      });
    }, delay);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, delay]);

  return throttledValue;
}

/**
 * Hook for creating a throttled state setter
 * Combines useState with RAF throttling for optimal performance
 */
export function useThrottledState<T>(
  initialValue: T
): [T, (value: T) => void, T] {
  const [immediateValue, setImmediateValue] = React.useState<T>(initialValue);
  const [throttledValue, setThrottledValue] = React.useState<T>(initialValue);
  const rafRef = useRef<number>();

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const setThrottled = useCallback((value: T) => {
    // Update immediate value right away (for input responsiveness)
    setImmediateValue(value);

    // Cancel pending RAF
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    // Throttle the actual state update
    rafRef.current = requestAnimationFrame(() => {
      setThrottledValue(value);
      rafRef.current = undefined;
    });
  }, []);

  return [immediateValue, setThrottled, throttledValue];
}

// Import React for useState in useThrottledValue and useThrottledState
import * as React from 'react';
