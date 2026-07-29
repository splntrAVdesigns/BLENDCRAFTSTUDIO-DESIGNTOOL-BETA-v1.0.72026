import { useState, useEffect, useCallback } from 'react';
import { Layer, CanvasSettings } from '../types/gradient';
import { validateUploadFile, validateJsonImportText } from '../utils/uploadValidation';

export interface CustomPreset {
  id: string;
  name: string;
  layers: Layer[];
  canvasSettings: CanvasSettings;
  thumbnail?: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'gradientStudio_customPresets';
const MAX_PRESETS = 50; // Limit to prevent localStorage overflow

export function useCustomPresets() {
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Save to localStorage whenever presets change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(customPresets));
    } catch (error) {
      console.error('Failed to save custom presets:', error);
    }
  }, [customPresets]);

  const savePreset = useCallback(
    (name: string, layers: Layer[], canvasSettings: CanvasSettings, thumbnail?: string) => {
      const newPreset: CustomPreset = {
        id: `preset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name,
        layers: JSON.parse(JSON.stringify(layers)), // Deep clone
        canvasSettings: JSON.parse(JSON.stringify(canvasSettings)),
        thumbnail,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      setCustomPresets((prev) => {
        const updated = [newPreset, ...prev];
        // Keep only the most recent presets
        return updated.slice(0, MAX_PRESETS);
      });

      return newPreset;
    },
    []
  );

  const updatePreset = useCallback(
    (id: string, updates: Partial<Omit<CustomPreset, 'id' | 'createdAt'>>) => {
      setCustomPresets((prev) =>
        prev.map((preset) =>
          preset.id === id
            ? { ...preset, ...updates, updatedAt: Date.now() }
            : preset
        )
      );
    },
    []
  );

  const deletePreset = useCallback((id: string) => {
    setCustomPresets((prev) => prev.filter((preset) => preset.id !== id));
  }, []);

  const clearAllPresets = useCallback(() => {
    if (confirm('Are you sure you want to delete all custom presets?')) {
      setCustomPresets([]);
    }
  }, []);

  const exportPresets = useCallback(() => {
    const dataStr = JSON.stringify(customPresets, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gradient-studio-presets-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [customPresets]);

  const importPresets = useCallback((file: File) => {
    return new Promise<number>((resolve, reject) => {
      const fileValidation = validateUploadFile(file, 'json-import');
      if (!fileValidation.ok) {
        reject(new Error(fileValidation.error || 'Invalid preset import file'));
        return;
      }

      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const rawJson = e.target?.result as string;
          const jsonValidation = validateJsonImportText(rawJson);
          if (!jsonValidation.ok) {
            throw new Error(jsonValidation.error || 'Invalid preset import JSON');
          }

          const imported = JSON.parse(rawJson) as CustomPreset[];
          
          if (!Array.isArray(imported)) {
            throw new Error('Invalid preset file format');
          }

          setCustomPresets((prev) => {
            // Merge with existing, avoiding duplicates by name
            const merged = [...imported, ...prev];
            const unique = merged.filter(
              (preset, index, self) =>
                index === self.findIndex((p) => p.name === preset.name)
            );
            return unique.slice(0, MAX_PRESETS);
          });

          resolve(imported.length);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }, []);

  return {
    customPresets,
    savePreset,
    updatePreset,
    deletePreset,
    clearAllPresets,
    exportPresets,
    importPresets,
  };
}