/**
 * useHistory Hook - MEMORY-OPTIMIZED VERSION v2.0
 * 
 * OPTIMIZATIONS:
 * - Deep structural comparison to prevent duplicate states
 * - Early thumbnail removal before size check
 * - Memory usage monitoring with warnings
 * - Configurable history size limits
 * 
 * @version 2.0.0
 */

import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { logger } from '../utils/logger';
import { hashDocumentState, sanitizeLayer } from '../utils/documentState';
import type { Layer, CanvasSettings, EffectsConfig } from '../types/gradient';

export interface HistoryState {
  layers: Layer[];
  canvasSettings: CanvasSettings;
  effects: EffectsConfig;
  activeLayerId: string;
  timestamp: number;
  thumbnail?: string; // Base64 thumbnail (auto-removed if state too large)
}

interface UseHistoryReturn {
  currentState: HistoryState | null;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => HistoryState | null;
  redo: () => HistoryState | null;
  pushState: (state: Omit<HistoryState, 'timestamp'>) => void;
  clearHistory: () => void;
  getHistory: () => HistoryState[];
  goToState: (index: number) => HistoryState | null;
  historyLength: number;
  currentIndex: number;
  totalMemoryUsage: number; // Total memory in bytes
  memoryWarning: boolean; // True if memory usage is high
}

const MAX_HISTORY_SIZE = 50;
const MAX_STATE_SIZE_BYTES = 300000; // ~300KB max per state (reduced from 500KB)
const WARNING_THRESHOLD_BYTES = 10 * 1024 * 1024; // 10MB warning threshold
const DEBOUNCE_MS = 500;

/**
 * Estimate size of a history state in bytes
 */
function estimateStateSize(state: HistoryState): number {
  return JSON.stringify(state).length * 2; // UTF-16 byte estimate
}

/**
 * Deep structural comparison of two states using centralized hash function
 * Returns true if states are essentially identical
 * 
 * This now uses the shared hashDocumentState utility to ensure
 * consistent comparison logic across autosave, history, and dirty-state tracking.
 */
function compareStates(a: Omit<HistoryState, 'timestamp'>, b: HistoryState): boolean {
  try {
    // Use shared hashing utility for consistent comparison
    const hashA = hashDocumentState(a.layers, a.canvasSettings, a.effects, a.activeLayerId);
    const hashB = hashDocumentState(b.layers, b.canvasSettings, b.effects, b.activeLayerId);
    
    return hashA === hashB;
  } catch (error) {
    // If comparison fails, assume they're different
    return false;
  }
}

/**
 * Strip thumbnail from state to save memory
 */
function stripThumbnail(state: HistoryState): HistoryState {
  const { thumbnail, ...rest } = state;
  return rest as HistoryState;
}

export function useHistory(): UseHistoryReturn {
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [totalMemoryUsage, setTotalMemoryUsage] = useState(0);
  const [memoryWarning, setMemoryWarning] = useState(false);
  const lastPushTime = useRef(0);

  // PERF FIX: previously a useEffect re-ran on every `history` reference
  // change and did `JSON.stringify(state)` for EVERY entry (up to 50) to
  // recompute totalMemoryUsage from scratch. Any component that called
  // onCommitHistory() per drag-tick (e.g. a slider without a commit-on-
  // release pattern) paid that cost on every pointer-move — a direct cause
  // of input lag. sizesRef now tracks each entry's byte size incrementally,
  // parallel to `history` by index, so the total is a cheap running sum
  // instead of a full re-serialization.
  const sizesRef = useRef<number[]>([]);

  // Recomputes totalMemoryUsage/memoryWarning from a given sizes array and
  // pushes the result via setState. Called synchronously from INSIDE the
  // setHistory updater below (not after it) — React doesn't guarantee an
  // updater function runs synchronously at call time, so reading sizesRef.current
  // right after calling setHistory() could see stale data. Calling other
  // setters from within a setState updater is safe and avoids that hazard.
  const applySizes = useCallback((sizes: number[]) => {
    const total = sizes.reduce((sum, n) => sum + n, 0);
    setTotalMemoryUsage(total);
    setMemoryWarning(prevWarning => {
      if (total > WARNING_THRESHOLD_BYTES) {
        if (!prevWarning) {
          console.warn(`[History] Memory usage high: ${Math.round(total / 1024 / 1024)}MB`);
        }
        return true;
      }
      return false;
    });
  }, []);

  // Push new state to history
  const pushState = useCallback((state: Omit<HistoryState, 'timestamp'>) => {
    const now = Date.now();
    
    setHistory(prev => {
      // Debounce rapid pushes (e.g., slider dragging)
      if (now - lastPushTime.current < DEBOUNCE_MS) {
        const replacement: HistoryState = { ...state, timestamp: now };
        const replacementSize = estimateStateSize(replacement);

        if (prev.length === 0) {
          lastPushTime.current = now;
          sizesRef.current = [replacementSize];
          applySizes(sizesRef.current);
          return [replacement];
        }
        
        // Replace last state instead of adding new one
        const newHistory = [...prev];
        newHistory[newHistory.length - 1] = replacement;
        lastPushTime.current = now;
        sizesRef.current = [...sizesRef.current];
        sizesRef.current[sizesRef.current.length - 1] = replacementSize;
        applySizes(sizesRef.current);
        return newHistory;
      }

      lastPushTime.current = now;

      // Remove any future states if we're not at the end
      const newHistory = prev.slice(0, currentIndex + 1);
      // Local copy only — NOT committed to sizesRef.current until we know
      // we're actually keeping this push (see compareStates bailout below,
      // where `prev`/sizesRef.current must stay untouched and in sync).
      const newSizes = sizesRef.current.slice(0, currentIndex + 1);
      
      // OPTIMIZATION: Skip if state is identical to last state
      if (newHistory.length > 0) {
        const lastState = newHistory[newHistory.length - 1];
        if (compareStates(state, lastState)) {
          logger.debug('[History] State unchanged, skipping push');
          return prev;
        }
      }
      
      let newState: HistoryState = {
        // Sprint 4: strip large regeneratable mask fields before storing.
        // Each history slot used to hold ~2-4MB of rasterized PNG data URLs
        // per layer (imageUrl + previewImageUrl + svgText for preset shapes).
        // sanitizeLayer removes those; GradientCanvas re-hydrates from svgShapeId.
        ...state,
        layers: state.layers.map(sanitizeLayer),
        timestamp: now,
      };
      
      // OPTIMIZATION: Strip thumbnail FIRST, then check size
      if (newState.thumbnail) {
        const withoutThumbnail = stripThumbnail(newState);
        const sizeWithoutThumbnail = estimateStateSize(withoutThumbnail);

        if (sizeWithoutThumbnail > MAX_STATE_SIZE_BYTES * 0.8) {
          // If still large without thumbnail, remove it
          if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
            console.info(`[History] State large (${Math.round(sizeWithoutThumbnail / 1024)}KB), removing thumbnail for optimization`);
          }
          newState = withoutThumbnail;
        }
      }

      // Final size check
      const estimatedSize = estimateStateSize(newState);
      if (estimatedSize > MAX_STATE_SIZE_BYTES) {
        if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
          console.info(`[History] Optimizing state (${Math.round(estimatedSize / 1024)}KB) by removing thumbnail`);
        }
        newState = stripThumbnail(newState);
      }
      
      // Add new state
      newHistory.push(newState);
      newSizes.push(estimateStateSize(newState));
      
      // Limit history size (remove oldest)
      if (newHistory.length > MAX_HISTORY_SIZE) {
        newHistory.shift();
        newSizes.shift();
        setCurrentIndex(prev => prev - 1);
      }
      
      // Commit the size tracking in lockstep with the history we're returning.
      sizesRef.current = newSizes;
      applySizes(sizesRef.current);
      return newHistory;
    });

    setCurrentIndex(prev => {
      const newIndex = Math.min(prev + 1, MAX_HISTORY_SIZE - 1);
      return newIndex;
    });
  }, [currentIndex, applySizes]);

  // Undo to previous state
  const undo = useCallback((): HistoryState | null => {
    if (currentIndex <= 0) return null;
    
    const newIndex = currentIndex - 1;
    setCurrentIndex(newIndex);
    return history[newIndex];
  }, [currentIndex, history]);

  // Redo to next state
  const redo = useCallback((): HistoryState | null => {
    if (currentIndex >= history.length - 1) return null;
    
    const newIndex = currentIndex + 1;
    setCurrentIndex(newIndex);
    return history[newIndex];
  }, [currentIndex, history]);

  // Clear all history
  const clearHistory = useCallback(() => {
    setHistory([]);
    setCurrentIndex(-1);
    sizesRef.current = [];
    setTotalMemoryUsage(0);
    setMemoryWarning(false);
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      console.log('[History] Cleared all history');
    }
  }, []);

  // Get full history
  const getHistory = useCallback(() => {
    return history;
  }, [history]);

  // Jump to specific state
  const goToState = useCallback((index: number): HistoryState | null => {
    if (index < 0 || index >= history.length) return null;
    
    setCurrentIndex(index);
    return history[index];
  }, [history]);

  return {
    currentState: currentIndex >= 0 ? history[currentIndex] : null,
    canUndo: currentIndex > 0,
    canRedo: currentIndex < history.length - 1,
    undo,
    redo,
    pushState,
    clearHistory,
    getHistory,
    goToState,
    historyLength: history.length,
    currentIndex,
    totalMemoryUsage,
    memoryWarning,
  };
}