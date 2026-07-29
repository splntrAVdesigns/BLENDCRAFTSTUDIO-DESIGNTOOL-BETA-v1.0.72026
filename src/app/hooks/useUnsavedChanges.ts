import { useEffect, useRef, useState } from 'react';

interface UseUnsavedChangesOptions {
  enabled?: boolean;
  message?: string;
}

/**
 * Hook to track unsaved changes and warn users before leaving the page
 */
export function useUnsavedChanges(
  hasUnsavedChanges: boolean,
  options: UseUnsavedChangesOptions = {}
) {
  const {
    enabled = true,
    message = 'You have unsaved changes. Are you sure you want to leave?'
  } = options;

  const hasChangesRef = useRef(hasUnsavedChanges);

  useEffect(() => {
    hasChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!enabled) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasChangesRef.current) {
        // Modern browsers ignore custom messages, but setting returnValue triggers the dialog
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [enabled, message]);

  return { hasUnsavedChanges };
}

/**
 * Hook to track if state has changed from initial state
 */
export function useStateTracker<T>(initialState: T, currentState: T): boolean {
  const [hasChanges, setHasChanges] = useState(false);
  const initialStateRef = useRef(initialState);

  useEffect(() => {
    // Deep comparison (simple JSON stringification)
    const hasChanged = JSON.stringify(currentState) !== JSON.stringify(initialStateRef.current);
    setHasChanges(hasChanged);
  }, [currentState]);

  // Method to reset the "initial" state (e.g., after saving)
  const markAsSaved = () => {
    initialStateRef.current = currentState;
    setHasChanges(false);
  };

  return hasChanges;
}
