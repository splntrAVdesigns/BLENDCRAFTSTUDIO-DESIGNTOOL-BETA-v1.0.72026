import { GradientPreset, Layer } from '../types/gradient';
import { paletteToColorStops, COLOR_PALETTES } from './colors';

// Default presets for quick start
export const DEFAULT_PRESETS: GradientPreset[] = [
  {
    id: 'preset-electric',
    name: 'Electric',
    tags: ['vibrant', 'modern', 'bold', 'popular'],
    canvasSettings: { width: 1920, height: 1080, backgroundColor: '#000000' },
    layers: [
      {
        id: 'layer-1',
        name: 'Electric Gradient',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        locked: false,
        gradient: {
          type: 'linear',
          colors: paletteToColorStops(COLOR_PALETTES.electric),
          angle: 135,
          scale: 1,
          intensity: 1,
        },
        animation: {
          enabled: false,
          type: 'rotation',
          speed: 1,
          intensity: 1,
          loop: true,
          easing: 'linear',
          direction: 'forward',
        },
      },
    ],
  },
  {
    id: 'preset-sunset',
    name: 'Sunset Dreams',
    tags: ['vibrant', 'warm', 'popular'],
    canvasSettings: { width: 1920, height: 1080, backgroundColor: '#000000' },
    layers: [
      {
        id: 'layer-1',
        name: 'Background',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        locked: false,
        gradient: {
          type: 'linear',
          colors: paletteToColorStops(COLOR_PALETTES.sunset),
          angle: 135,
          scale: 1,
          intensity: 1,
        },
        animation: {
          enabled: false,
          type: 'rotation',
          speed: 1,
          intensity: 1,
          loop: true,
          easing: 'linear',
          direction: 'forward',
        },
      },
    ],
  },
  {
    id: 'preset-ocean',
    name: 'Ocean Wave',
    tags: ['cool', 'calm', 'nature'],
    canvasSettings: { width: 1920, height: 1080, backgroundColor: '#001220' },
    layers: [
      {
        id: 'layer-1',
        name: 'Ocean Base',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        locked: false,
        gradient: {
          type: 'radial',
          colors: paletteToColorStops(COLOR_PALETTES.ocean),
          centerX: 0.5,
          centerY: 0.5,
          scale: 1.5,
          intensity: 1,
        },
      },
      {
        id: 'layer-2',
        name: 'Wave Noise',
        visible: true,
        opacity: 0.3,
        blendMode: 'overlay',
        locked: false,
        texture: {
          type: 'noise',
          opacity: 0.3,
          scale: 2,
          intensity: 0.5,
          blendMode: 'overlay',
        },
      },
    ],
  },
  {
    id: 'preset-neon',
    name: 'Neon Nights',
    tags: ['vibrant', 'modern', 'bold'],
    canvasSettings: { width: 1920, height: 1080, backgroundColor: '#0A0A0A' },
    layers: [
      {
        id: 'layer-1',
        name: 'Neon Blob',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        locked: false,
        gradient: {
          type: 'blob',
          colors: paletteToColorStops(COLOR_PALETTES.neon),
          blobCount: 3,
          scale: 1.2,
          intensity: 1,
        },
        animation: {
          enabled: false,
          type: 'drift',
          speed: 2,
          intensity: 0.5,
          loop: true,
          easing: 'easeInOut',
          direction: 'forward',
        },
      },
    ],
  },
  {
    id: 'preset-aurora',
    name: 'Aurora Borealis',
    tags: ['nature', 'ethereal', 'animated'],
    canvasSettings: { width: 1920, height: 1080, backgroundColor: '#0D1B2A' },
    layers: [
      {
        id: 'layer-1',
        name: 'Aurora Wave',
        visible: true,
        opacity: 0.8,
        blendMode: 'screen',
        locked: false,
        gradient: {
          type: 'wave',
          colors: paletteToColorStops(COLOR_PALETTES.aurora),
          stripeCount: 5,
          waveAmplitude: 0.3,
          angle: 90,
          scale: 1,
          intensity: 1,
        },
        animation: {
          enabled: false,
          type: 'wave',
          speed: 1.5,
          intensity: 0.6,
          loop: true,
          easing: 'easeInOut',
          direction: 'forward',
        },
      },
    ],
  },
  {
    id: 'preset-mesh',
    name: 'Mesh Gradient',
    tags: ['modern', 'smooth', 'popular'],
    canvasSettings: { width: 1920, height: 1080, backgroundColor: '#1A1A1A' },
    layers: [
      {
        id: 'layer-1',
        name: 'Mesh',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        locked: false,
        gradient: {
          type: 'mesh',
          colors: paletteToColorStops(COLOR_PALETTES.purple),
          meshPoints: [
            { x: 0.2, y: 0.2, color: '#667EEA' },
            { x: 0.8, y: 0.2, color: '#764BA2' },
            { x: 0.2, y: 0.8, color: '#A770EF' },
            { x: 0.8, y: 0.8, color: '#CF8BF3' },
            { x: 0.5, y: 0.5, color: '#8B5FBF' },
          ],
          scale: 1,
          segments: 6, // Kaleidoscope mirror segments
          frequency: 2.0, // Detail level within segments
          intensity: 1,
        },
        animation: {
          enabled: false,
          type: 'rotation',
          speed: 1,
          intensity: 1,
          loop: true,
          easing: 'linear',
          direction: 'forward',
        },
      },
    ],
  },
  {
    id: 'preset-noise',
    name: 'Organic Noise',
    tags: ['texture', 'abstract', 'unique'],
    canvasSettings: { width: 1920, height: 1080, backgroundColor: '#0F0F0F' },
    layers: [
      {
        id: 'layer-1',
        name: 'Noise Base',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        locked: false,
        gradient: {
          type: 'noise',
          colors: paletteToColorStops(COLOR_PALETTES.cosmic),
          octaves: 6,
          frequency: 2,
          scale: 1,
          intensity: 0.8,
        },
        animation: {
          enabled: false,
          type: 'rotation',
          speed: 1,
          intensity: 1,
          loop: true,
          easing: 'linear',
          direction: 'forward',
        },
      },
    ],
  },
  {
    id: 'preset-grid',
    name: 'Grid Mosaic',
    tags: ['geometric', 'colorful', 'unique'],
    canvasSettings: { width: 1920, height: 1080, backgroundColor: '#0A0A0A' },
    layers: [
      {
        id: 'layer-1',
        name: 'Grid',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        locked: false,
        gradient: {
          type: 'grid',
          colors: [],
          gridRows: 2,
          gridCols: 2,
          gridGradients: [
            [
              { type: 'linear', colors: paletteToColorStops(COLOR_PALETTES.sunset), angle: 45, scale: 1, intensity: 1 },
              { type: 'radial', colors: paletteToColorStops(COLOR_PALETTES.ocean), centerX: 0.5, centerY: 0.5, scale: 1, intensity: 1 },
            ],
            [
              { type: 'conic', colors: paletteToColorStops(COLOR_PALETTES.neon), centerX: 0.5, centerY: 0.5, scale: 1, intensity: 1 },
              { type: 'linear', colors: paletteToColorStops(COLOR_PALETTES.purple), angle: 135, scale: 1, intensity: 1 },
            ],
          ],
          scale: 1,
          intensity: 1,
        },
        animation: {
          enabled: false,
          type: 'rotation',
          speed: 1,
          intensity: 1,
          loop: true,
          easing: 'linear',
          direction: 'forward',
        },
      },
    ],
  },
  {
    id: 'preset-fractal',
    name: 'Fractal Dream',
    tags: ['abstract', 'complex', 'psychedelic'],
    canvasSettings: { width: 1920, height: 1080, backgroundColor: '#000000' },
    layers: [
      {
        id: 'layer-1',
        name: 'Fractal',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        locked: false,
        gradient: {
          type: 'fractal',
          colors: paletteToColorStops(COLOR_PALETTES.galaxy),
          octaves: 8,
          frequency: 3,
          scale: 2.5,
          intensity: 1,
        },
        animation: {
          enabled: false,
          type: 'rotation',
          speed: 0.5,
          intensity: 0.3,
          loop: true,
          easing: 'linear',
          direction: 'forward',
        },
      },
    ],
  },
];

// Load presets from localStorage
export function loadCustomPresets(): GradientPreset[] {
  try {
    const stored = localStorage.getItem('custom-gradient-presets');
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to load custom presets:', error);
    return [];
  }
}

// Save preset to localStorage
export function saveCustomPreset(preset: GradientPreset): void {
  try {
    const existing = loadCustomPresets();
    const updated = [...existing, preset];
    localStorage.setItem('custom-gradient-presets', JSON.stringify(updated));
  } catch (error) {
    console.error('Failed to save preset:', error);
  }
}

// Delete custom preset
export function deleteCustomPreset(presetId: string): void {
  try {
    const existing = loadCustomPresets();
    const updated = existing.filter(p => p.id !== presetId);
    localStorage.setItem('custom-gradient-presets', JSON.stringify(updated));
  } catch (error) {
    console.error('Failed to delete preset:', error);
  }
}

// Get all presets (default + custom)
export function getAllPresets(): GradientPreset[] {
  return [...DEFAULT_PRESETS, ...loadCustomPresets()];
}