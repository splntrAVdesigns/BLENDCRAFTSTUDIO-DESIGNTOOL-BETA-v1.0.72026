/**
 * useAutoSave Hook - OPTIMIZED VERSION v3.0
 * Automatically saves gradient state to browser storage
 * 
 * PERFORMANCE OPTIMIZATIONS:
 * - Hash-based change detection (only save if state actually changed)
 * - Single unified save path (no duplicate interval + debounce)
 * - Async localStorage wrapper using requestIdleCallback
 * - Memory-efficient serialization checks
 * 
 * @version 3.0.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Layer, CanvasSettings } from '../types/gradient';
import { logger } from '../utils/logger';
import { hashDocumentState, sanitizeLayer } from '../utils/documentState';

const AUTO_SAVE_KEY = 'blendcraft-autosave-v2';

/**
 * STAGE 2.8.0 — layer ids referenced by the PENDING autosave snapshot.
 *
 * WHY: the orphan-blob prune sweep runs ~8s after mount and deletes any
 * IndexedDB blob whose layer id isn't in the CURRENT document. But the
 * autosave restore dialog can still be pending at that point (it shows for
 * 15s), and its snapshot may reference layers that aren't in the current
 * document yet. Pruning by current-doc ids alone could delete exactly the
 * blobs a subsequent Restore click needs. The sweep must treat snapshot ids
 * as live until the dialog is resolved.
 *
 * Module-level (not part of the hook) so App can call it without threading
 * state; reads localStorage directly and fails soft to [] on any problem.
 */
export function getAutoSavedLayerIds(): string[] {
  try {
    const raw = localStorage.getItem(AUTO_SAVE_KEY);
    if (!raw) return [];
    const state = JSON.parse(raw);
    if (!state || !Array.isArray(state.layers)) return [];
    return state.layers
      .map((l: any) => (typeof l?.id === 'string' ? l.id : null))
      .filter(Boolean) as string[];
  } catch {
    return [];
  }
}
const AUTO_SAVE_DISMISSED_KEY = 'blendcraft-autosave-dismissed';
const AUTO_SAVE_DEBOUNCE = 2000; // 2 seconds debounce for changes
const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const CURRENT_VERSION = 2; // Autosave format version

interface AutoSaveState {
  version: number;
  layers: Layer[];
  canvasSettings: CanvasSettings;
  timestamp: number;
}

/**
 * Emergency clear function - callable from browser console
 * window.clearBlendcraftAutosave()
 */
if (typeof window !== 'undefined') {
  (window as any).clearBlendcraftAutosave = () => {
    localStorage.removeItem(AUTO_SAVE_KEY);
    sessionStorage.removeItem(AUTO_SAVE_DISMISSED_KEY);
    logger.log('✅ Blendcraft autosave cleared! Refreshing...');
    window.location.reload();
  };
}

/**
 * Estimate size of a history state in bytes
 */
function estimateStateSize(state: AutoSaveState): number {
  return JSON.stringify(state).length * 2; // UTF-16 byte estimate
}

/**
 * Async localStorage write using requestIdleCallback
 * Prevents blocking the main thread during save
 */
function asyncLocalStorageSet(key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const callback = () => {
      try {
        localStorage.setItem(key, value);
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    // Use requestIdleCallback if available, otherwise setTimeout
    if ('requestIdleCallback' in window) {
      requestIdleCallback(callback, { timeout: 1000 });
    } else {
      setTimeout(callback, 0);
    }
  });
}

/**
 * Validate autosave state before restoring
 */
function validateAutoSaveState(state: any): state is AutoSaveState {
  try {
    if (!state || typeof state !== 'object') {
      logger.warn('[AutoSave] Invalid state: not an object');
      return false;
    }
    
    if (!state.version || typeof state.version !== 'number') {
      logger.warn('[AutoSave] Missing or invalid version');
      return false;
    }
    
    if (state.version > CURRENT_VERSION) {
      logger.warn(`[AutoSave] Incompatible version: ${state.version} > ${CURRENT_VERSION}`);
      return false;
    }
    
    if (!Array.isArray(state.layers)) {
      logger.warn('[AutoSave] Invalid layers: not an array');
      return false;
    }
    
    for (const layer of state.layers) {
      if (!layer.id || typeof layer.id !== 'string') {
        logger.warn('[AutoSave] Invalid layer: missing or invalid id');
        return false;
      }
    }
    
    if (!state.canvasSettings || typeof state.canvasSettings !== 'object') {
      logger.warn('[AutoSave] Invalid canvasSettings');
      return false;
    }
    
    if (!state.timestamp || typeof state.timestamp !== 'number') {
      logger.warn('[AutoSave] Invalid timestamp');
      return false;
    }
    
    logger.debug('✅ [AutoSave] Validation passed');
    return true;
  } catch (error) {
    logger.error('[AutoSave] Validation error:', error);
    return false;
  }
}

/**
 * Safely parse JSON with error handling
 */
function safeJSONParse(jsonString: string): any {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('[AutoSave] JSON parse error:', error);
    return null;
  }
}

export function useAutoSave(
  layers: Layer[],
  canvasSettings: CanvasSettings,
  onRestore?: (state: Omit<AutoSaveState, 'timestamp' | 'version'>) => void
) {
  const [hasAutoSave, setHasAutoSave] = useState(false);
  const [autoSaveTimestamp, setAutoSaveTimestamp] = useState<number | null>(null);
  const [isCorrupted, setIsCorrupted] = useState(false);
  
  // Track last saved hash to avoid redundant saves
  const lastSavedHashRef = useRef<number>(0);
  const saveTimeoutRef = useRef<number>();

  // Check for existing autosave on mount
  useEffect(() => {
    try {
      const dismissed = sessionStorage.getItem(AUTO_SAVE_DISMISSED_KEY);
      if (dismissed) {
        return;
      }

      const saved = localStorage.getItem(AUTO_SAVE_KEY);
      if (saved) {
        const state = safeJSONParse(saved);
        
        if (!state) {
          logger.warn('[AutoSave] Failed to parse saved state, clearing...');
          localStorage.removeItem(AUTO_SAVE_KEY);
          setIsCorrupted(true);
          return;
        }
        
        if (!validateAutoSaveState(state)) {
          logger.warn('[AutoSave] Invalid saved state, clearing...');
          localStorage.removeItem(AUTO_SAVE_KEY);
          setIsCorrupted(true);
          return;
        }
        
        const age = Date.now() - state.timestamp;
        
        if (age < MAX_AGE) {
          logger.log(`✅ [AutoSave] Found valid save from ${Math.round(age / 1000 / 60)} minutes ago`);
          setHasAutoSave(true);
          setAutoSaveTimestamp(state.timestamp);
          setIsCorrupted(false);
        } else {
          logger.log('[AutoSave] Save too old, clearing...');
          localStorage.removeItem(AUTO_SAVE_KEY);
        }
      }
    } catch (error) {
      console.error('[AutoSave] Failed to load autosave:', error);
      localStorage.removeItem(AUTO_SAVE_KEY);
      setIsCorrupted(true);
    }
  }, []);

  // UNIFIED AUTO-SAVE: Hash-based with debouncing
  useEffect(() => {
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce the save operation
    saveTimeoutRef.current = window.setTimeout(async () => {
      try {
        // Calculate hash of current state
        const currentHash = hashDocumentState(layers, canvasSettings);
        
        // Skip if state hasn't changed
        if (currentHash === lastSavedHashRef.current) {
          logger.debug('[AutoSave] State unchanged, skipping save');
          return;
        }
        
        // Sanitize layers to remove runtime state
        const sanitizedLayers = layers.map(sanitizeLayer);
        
        const state: AutoSaveState = {
          version: CURRENT_VERSION,
          layers: sanitizedLayers,
          canvasSettings,
          timestamp: Date.now(),
        };
        
        const jsonString = JSON.stringify(state);
        
        // Check size before saving
        if (estimateStateSize(state) > MAX_SIZE_BYTES) {
          logger.warn(`[AutoSave] Save data too large (${Math.round(jsonString.length / 1024)}KB), skipping...`);
          return;
        }
        
        // Async save to prevent main thread blocking
        await asyncLocalStorageSet(AUTO_SAVE_KEY, jsonString);
        
        // Update hash after successful save
        lastSavedHashRef.current = currentHash;
        
        logger.log(`[AutoSave] Saved successfully (${Math.round(jsonString.length / 1024)}KB)`);
      } catch (error) {
        logger.error('[AutoSave] Auto-save failed:', error);
        
        // Handle quota exceeded
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
          logger.warn('[AutoSave] Storage quota exceeded, clearing old save...');
          localStorage.removeItem(AUTO_SAVE_KEY);
        }
      }
    }, AUTO_SAVE_DEBOUNCE);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [layers, canvasSettings]);

  // Restore autosave
  const restoreAutoSave = useCallback(() => {
    try {
      const saved = localStorage.getItem(AUTO_SAVE_KEY);
      if (!saved) {
        logger.warn('[AutoSave] No save data found');
        return;
      }
      
      const state = safeJSONParse(saved);
      if (!state) {
        console.error('[AutoSave] Failed to parse save data');
        localStorage.removeItem(AUTO_SAVE_KEY);
        setIsCorrupted(true);
        return;
      }
      
      if (!validateAutoSaveState(state)) {
        console.error('[AutoSave] Invalid save data, cannot restore');
        localStorage.removeItem(AUTO_SAVE_KEY);
        setIsCorrupted(true);
        return;
      }
      
      if (onRestore) {
        // Disable animations on restore for safety
        const safeLayersWithDisabledAnimations = state.layers.map((layer: Layer) => ({
          ...layer,
          animation: layer.animation ? {
            ...layer.animation,
            enabled: false,
          } : undefined,
        }));
        
        logger.log('✅ [AutoSave] Restoring state (animations disabled for safety)');
        
        onRestore({
          layers: safeLayersWithDisabledAnimations,
          canvasSettings: state.canvasSettings,
        });
        
        setHasAutoSave(false);
        setIsCorrupted(false);
        
        localStorage.removeItem(AUTO_SAVE_KEY);
      }
    } catch (error) {
      console.error('[AutoSave] Failed to restore autosave:', error);
      localStorage.removeItem(AUTO_SAVE_KEY);
      setIsCorrupted(true);
    }
  }, [onRestore]);

  // Dismiss autosave
  const dismissAutoSave = useCallback(() => {
    logger.log('[AutoSave] User dismissed - clearing ALL saved data and reloading...');
    
    localStorage.removeItem(AUTO_SAVE_KEY);
    localStorage.removeItem('blendcraft-layers');
    localStorage.removeItem('blendcraft-canvas-settings');
    localStorage.removeItem('blendcraft-active-layer');
    
    sessionStorage.setItem(AUTO_SAVE_DISMISSED_KEY, 'true');
    
    setHasAutoSave(false);
    setAutoSaveTimestamp(null);
    setIsCorrupted(false);
    
    logger.log('[AutoSave] Reloading with fresh defaults...');
    window.location.reload();
  }, []);
  
  // Clear and reset (emergency option)
  const clearAndReset = useCallback(() => {
    localStorage.removeItem(AUTO_SAVE_KEY);
    sessionStorage.removeItem(AUTO_SAVE_DISMISSED_KEY);
    setHasAutoSave(false);
    setAutoSaveTimestamp(null);
    setIsCorrupted(false);
    logger.log('[AutoSave] Cleared and reset');
    window.location.reload();
  }, []);

  const isDismissed = typeof window !== 'undefined' && sessionStorage.getItem(AUTO_SAVE_DISMISSED_KEY) !== null;

  return {
    hasAutoSave: hasAutoSave && !isDismissed,
    autoSaveTimestamp,
    isCorrupted,
    restoreAutoSave,
    dismissAutoSave,
    clearAndReset,
  };
}