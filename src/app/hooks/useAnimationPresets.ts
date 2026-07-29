/**
 * Animation Presets System
 * Save, load, and share animation configurations with built-in presets
 */

import { useState, useCallback, useEffect } from 'react';
import { AnimationConfig } from '../types/gradient';

export interface AnimationPreset {
  id: string;
  name: string;
  description: string;
  category: 'smooth' | 'energetic' | 'chaotic' | 'artistic' | 'minimal' | 'custom';
  animation: AnimationConfig;
  thumbnail?: string; // Base64 encoded preview image
  author?: string;
  createdAt: number;
  isFavorite?: boolean;
  isBuiltIn?: boolean;
}

const STORAGE_KEY = 'blendcraft-animation-presets';
const FAVORITES_KEY = 'blendcraft-animation-favorites';

// ============================================================================
// BUILT-IN PRESETS
// ============================================================================

const BUILT_IN_PRESETS: AnimationPreset[] = [
  {
    id: 'smooth-drift',
    name: 'Smooth Drift',
    description: 'Gentle floating motion with soft easing',
    category: 'smooth',
    animation: {
      enabled: true,
      type: 'drift',
      speed: 0.5,
      intensity: 0.6,
      easing: 'easeInOut',
      direction: 'forward',
      loop: true,
    },
    isBuiltIn: true,
    author: 'Blendcraft Studio',
    createdAt: Date.now(),
  },
  {
    id: 'energetic-pulse',
    name: 'Energetic Pulse',
    description: 'High-energy breathing effect',
    category: 'energetic',
    animation: {
      enabled: true,
      type: 'pulse',
      speed: 2.5,
      intensity: 0.8,
      easing: 'elastic',
      direction: 'forward',
      loop: true,
    },
    isBuiltIn: true,
    author: 'Blendcraft Studio',
    createdAt: Date.now(),
  },
  {
    id: 'hypnotic-vortex',
    name: 'Hypnotic Vortex',
    description: 'Mesmerizing spiral motion',
    category: 'artistic',
    animation: {
      enabled: true,
      type: 'vortex',
      speed: 1.2,
      intensity: 0.9,
      easing: 'easeInOut',
      direction: 'forward',
      loop: true,
    },
    isBuiltIn: true,
    author: 'Blendcraft Studio',
    createdAt: Date.now(),
  },
  {
    id: 'digital-glitch',
    name: 'Digital Glitch',
    description: 'Aggressive corruption effect',
    category: 'chaotic',
    animation: {
      enabled: true,
      type: 'glitch',
      speed: 3.0,
      intensity: 1.0,
      easing: 'linear',
      direction: 'forward',
      loop: true,
    },
    isBuiltIn: true,
    author: 'Blendcraft Studio',
    createdAt: Date.now(),
  },
  {
    id: 'cosmic-shift',
    name: 'Cosmic Shift',
    description: 'Rainbow hue rotation',
    category: 'artistic',
    animation: {
      enabled: true,
      type: 'hueShift',
      speed: 0.8,
      intensity: 1.0,
      easing: 'linear',
      direction: 'forward',
      loop: true,
    },
    isBuiltIn: true,
    author: 'Blendcraft Studio',
    createdAt: Date.now(),
  },
  {
    id: 'ocean-ripple',
    name: 'Ocean Ripple',
    description: 'Erratic water waves',
    category: 'smooth',
    animation: {
      enabled: true,
      type: 'ripple',
      speed: 1.5,
      intensity: 0.7,
      easing: 'easeOut',
      direction: 'forward',
      loop: true,
    },
    isBuiltIn: true,
    author: 'Blendcraft Studio',
    createdAt: Date.now(),
  },
  {
    id: 'sparkle-shimmer',
    name: 'Sparkle Shimmer',
    description: 'Twinkling light effect',
    category: 'energetic',
    animation: {
      enabled: true,
      type: 'shimmer',
      speed: 4.0,
      intensity: 0.6,
      easing: 'linear',
      direction: 'forward',
      loop: true,
    },
    isBuiltIn: true,
    author: 'Blendcraft Studio',
    createdAt: Date.now(),
  },
  {
    id: 'kaleidoscope-dream',
    name: 'Kaleidoscope Dream',
    description: 'Psychedelic symmetry',
    category: 'artistic',
    animation: {
      enabled: true,
      type: 'kaleidoscope',
      speed: 1.0,
      intensity: 0.85,
      easing: 'easeInOut',
      direction: 'forward',
      loop: true,
    },
    isBuiltIn: true,
    author: 'Blendcraft Studio',
    createdAt: Date.now(),
  },
  {
    id: 'fractal-dive',
    name: 'Fractal Dive',
    description: 'Infinite zoom journey',
    category: 'artistic',
    animation: {
      enabled: true,
      type: 'fractalZoom',
      speed: 0.6,
      intensity: 0.9,
      easing: 'easeIn',
      direction: 'forward',
      loop: true,
    },
    isBuiltIn: true,
    author: 'Blendcraft Studio',
    createdAt: Date.now(),
  },
  {
    id: 'chromatic-breathe',
    name: 'Chromatic Breathe',
    description: 'RGB separation pulse',
    category: 'energetic',
    animation: {
      enabled: true,
      type: 'chromaticPulse',
      speed: 1.8,
      intensity: 0.75,
      easing: 'easeInOut',
      direction: 'forward',
      loop: true,
    },
    isBuiltIn: true,
    author: 'Blendcraft Studio',
    createdAt: Date.now(),
  },
  {
    id: 'liquid-flow',
    name: 'Liquid Flow',
    description: 'Organic fluid motion',
    category: 'smooth',
    animation: {
      enabled: true,
      type: 'liquid',
      speed: 1.0,
      intensity: 0.8,
      easing: 'easeOut',
      direction: 'forward',
      loop: true,
    },
    isBuiltIn: true,
    author: 'Blendcraft Studio',
    createdAt: Date.now(),
  },
  {
    id: 'chaotic-turbulence',
    name: 'Chaotic Turbulence',
    description: 'Wild unpredictable movement',
    category: 'chaotic',
    animation: {
      enabled: true,
      type: 'turbulence',
      speed: 2.0,
      intensity: 1.0,
      easing: 'linear',
      direction: 'forward',
      loop: true,
    },
    isBuiltIn: true,
    author: 'Blendcraft Studio',
    createdAt: Date.now(),
  },
  {
    id: 'minimal-rotation',
    name: 'Minimal Rotation',
    description: 'Simple steady spin',
    category: 'minimal',
    animation: {
      enabled: true,
      type: 'rotation',
      speed: 0.3,
      intensity: 1.0,
      easing: 'linear',
      direction: 'forward',
      loop: true,
    },
    isBuiltIn: true,
    author: 'Blendcraft Studio',
    createdAt: Date.now(),
  },
  {
    id: 'wave-motion',
    name: 'Wave Motion',
    description: 'Flowing undulation',
    category: 'smooth',
    animation: {
      enabled: true,
      type: 'wave',
      speed: 1.0,
      intensity: 0.7,
      easing: 'easeInOut',
      direction: 'forward',
      loop: true,
    },
    isBuiltIn: true,
    author: 'Blendcraft Studio',
    createdAt: Date.now(),
  },
  {
    id: 'morph-blend',
    name: 'Morph Blend',
    description: 'Complex color blending',
    category: 'artistic',
    animation: {
      enabled: true,
      type: 'morph',
      speed: 0.8,
      intensity: 0.85,
      easing: 'easeInOut',
      direction: 'forward',
      loop: true,
    },
    isBuiltIn: true,
    author: 'Blendcraft Studio',
    createdAt: Date.now(),
  },
];

export function useAnimationPresets() {
  const [customPresets, setCustomPresets] = useState<AnimationPreset[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  // Load custom presets and favorites from localStorage
  useEffect(() => {
    try {
      const savedPresets = localStorage.getItem(STORAGE_KEY);
      if (savedPresets) {
        setCustomPresets(JSON.parse(savedPresets));
      }

      const savedFavorites = localStorage.getItem(FAVORITES_KEY);
      if (savedFavorites) {
        setFavorites(new Set(JSON.parse(savedFavorites)));
      }
    } catch (error) {
      console.error('Failed to load animation presets:', error);
    }
  }, []);

  // Save custom presets to localStorage
  const saveCustomPresets = useCallback((presets: AnimationPreset[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
      setCustomPresets(presets);
    } catch (error) {
      console.error('Failed to save animation presets:', error);
    }
  }, []);

  // Save favorites to localStorage
  const saveFavorites = useCallback((favs: Set<string>) => {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favs)));
      setFavorites(favs);
    } catch (error) {
      console.error('Failed to save favorites:', error);
    }
  }, []);

  // Get all presets (built-in + custom)
  const getAllPresets = useCallback((): AnimationPreset[] => {
    return [
      ...BUILT_IN_PRESETS.map(p => ({ ...p, isFavorite: favorites.has(p.id) })),
      ...customPresets.map(p => ({ ...p, isFavorite: favorites.has(p.id) })),
    ];
  }, [customPresets, favorites]);

  // Get presets by category
  const getPresetsByCategory = useCallback((category: AnimationPreset['category']): AnimationPreset[] => {
    return getAllPresets().filter(p => p.category === category);
  }, [getAllPresets]);

  // Get favorite presets
  const getFavoritePresets = useCallback((): AnimationPreset[] => {
    return getAllPresets().filter(p => favorites.has(p.id));
  }, [getAllPresets, favorites]);

  // Save new preset
  const savePreset = useCallback((
    name: string,
    description: string,
    animation: AnimationConfig,
    category: AnimationPreset['category'] = 'custom',
    thumbnail?: string
  ) => {
    const newPreset: AnimationPreset = {
      id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      description,
      category,
      animation,
      thumbnail,
      author: 'You',
      createdAt: Date.now(),
      isBuiltIn: false,
    };

    saveCustomPresets([...customPresets, newPreset]);
    return newPreset;
  }, [customPresets, saveCustomPresets]);

  // Delete preset
  const deletePreset = useCallback((presetId: string) => {
    const preset = getAllPresets().find(p => p.id === presetId);
    if (preset?.isBuiltIn) {
      throw new Error('Cannot delete built-in presets');
    }

    saveCustomPresets(customPresets.filter(p => p.id !== presetId));

    // Remove from favorites if present
    if (favorites.has(presetId)) {
      const newFavorites = new Set(favorites);
      newFavorites.delete(presetId);
      saveFavorites(newFavorites);
    }
  }, [customPresets, favorites, saveCustomPresets, saveFavorites, getAllPresets]);

  // Toggle favorite
  const toggleFavorite = useCallback((presetId: string) => {
    const newFavorites = new Set(favorites);
    if (newFavorites.has(presetId)) {
      newFavorites.delete(presetId);
    } else {
      newFavorites.add(presetId);
    }
    saveFavorites(newFavorites);
  }, [favorites, saveFavorites]);

  // Export presets as JSON
  const exportPresets = useCallback((presetIds: string[]): string => {
    const presetsToExport = getAllPresets().filter(p => presetIds.includes(p.id));
    return JSON.stringify(presetsToExport, null, 2);
  }, [getAllPresets]);

  // Import presets from JSON
  const importPresets = useCallback((jsonString: string): number => {
    try {
      const importedPresets = JSON.parse(jsonString) as AnimationPreset[];
      
      // Validate structure
      if (!Array.isArray(importedPresets)) {
        throw new Error('Invalid preset format');
      }

      // Filter out duplicates and mark as custom
      const newPresets = importedPresets.map(p => ({
        ...p,
        id: `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        isBuiltIn: false,
        createdAt: Date.now(),
      }));

      saveCustomPresets([...customPresets, ...newPresets]);
      return newPresets.length;
    } catch (error) {
      console.error('Failed to import presets:', error);
      throw new Error('Failed to import presets. Please check the file format.');
    }
  }, [customPresets, saveCustomPresets]);

  // Update preset
  const updatePreset = useCallback((presetId: string, updates: Partial<AnimationPreset>) => {
    const preset = getAllPresets().find(p => p.id === presetId);
    if (preset?.isBuiltIn) {
      throw new Error('Cannot modify built-in presets');
    }

    saveCustomPresets(
      customPresets.map(p => p.id === presetId ? { ...p, ...updates } : p)
    );
  }, [customPresets, saveCustomPresets, getAllPresets]);

  return {
    // Data
    allPresets: getAllPresets(),
    builtInPresets: BUILT_IN_PRESETS,
    customPresets,
    favoritePresets: getFavoritePresets(),
    
    // Methods
    getPresetsByCategory,
    savePreset,
    deletePreset,
    updatePreset,
    toggleFavorite,
    exportPresets,
    importPresets,
    
    // State
    favorites,
  };
}
