/**
 * Gradient Randomizer
 * Intelligent gradient generation with various styles and moods
 */

import type { GradientConfig, GradientType } from '../types/gradient';
import {
  randomVibrantColor,
  randomPastelColor,
  randomDarkColor,
  getComplementary,
  getAnalogous,
  getTriadic,
  rotateHue,
  adjustLightness,
  hexToHsl,
  hslToHex,
} from './colorHarmony';

export type GradientStyle = 
  | 'vibrant'
  | 'pastel'
  | 'dark'
  | 'neon'
  | 'earth'
  | 'ocean'
  | 'sunset'
  | 'aurora'
  | 'monochrome'
  | 'random';

export type GradientMood =
  | 'energetic'
  | 'calm'
  | 'mysterious'
  | 'warm'
  | 'cool'
  | 'natural'
  | 'futuristic'
  | 'romantic';

export interface RandomGradientOptions {
  style?: GradientStyle;
  mood?: GradientMood;
  colorCount?: number;
  gradientType?: GradientType;
  useHarmony?: boolean;
}

// Predefined color palettes for different styles
const STYLE_PALETTES: Record<GradientStyle, () => string[]> = {
  vibrant: () => {
    const base = randomVibrantColor();
    return getTriadic(base).colors;
  },
  
  pastel: () => {
    const base = randomPastelColor();
    return getAnalogous(base).colors;
  },
  
  dark: () => {
    const base = randomDarkColor();
    const hsl = hexToHsl(base);
    return [
      base,
      hslToHex({ ...hsl, h: (hsl.h + 30) % 360 }),
      hslToHex({ ...hsl, h: (hsl.h + 60) % 360, l: Math.min(50, hsl.l + 10) }),
    ];
  },
  
  neon: () => {
    const hue = Math.random() * 360;
    return [
      hslToHex({ h: hue, s: 100, l: 50 }),
      hslToHex({ h: (hue + 60) % 360, s: 100, l: 50 }),
      hslToHex({ h: (hue + 120) % 360, s: 100, l: 50 }),
    ];
  },
  
  earth: () => {
    const browns = [
      '#8B4513', '#A0522D', '#D2691E', '#CD853F', '#DEB887',
      '#F4A460', '#D2B48C', '#BC8F8F', '#FFE4B5',
    ];
    return pickRandom(browns, 3);
  },
  
  ocean: () => {
    const blues = [
      '#001f3f', '#0074D9', '#7FDBFF', '#39CCCC', '#3D9970',
      '#2ECC40', '#01FF70', '#00CED1', '#4682B4',
    ];
    return pickRandom(blues, 3);
  },
  
  sunset: () => {
    const sunsets = [
      '#FF6B6B', '#FF8E53', '#FFA07A', '#FFB6C1', '#FF69B4',
      '#FFA500', '#FF4500', '#FF6347', '#FFD700',
    ];
    return pickRandom(sunsets, 3);
  },
  
  aurora: () => {
    return [
      '#00ff87', '#60efff', '#ff6bc7', '#a78bfa', '#06b6d4',
    ].slice(0, 3);
  },
  
  monochrome: () => {
    const hue = Math.random() * 360;
    return [
      hslToHex({ h: hue, s: 0, l: 20 }),
      hslToHex({ h: hue, s: 0, l: 50 }),
      hslToHex({ h: hue, s: 0, l: 80 }),
    ];
  },
  
  random: () => {
    return Array.from({ length: 3 }, () => randomVibrantColor());
  },
};

// Helper: Pick random items from array
function pickRandom<T>(array: T[], count: number): T[] {
  const shuffled = [...array].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// Helper: Generate positions for colors
function generatePositions(count: number): number[] {
  if (count === 2) return [0, 1];
  if (count === 3) return [0, 0.5, 1];
  
  const positions: number[] = [0];
  const step = 1 / (count - 1);
  
  for (let i = 1; i < count - 1; i++) {
    positions.push(i * step);
  }
  
  positions.push(1);
  return positions;
}

// Main randomizer function
export function generateRandomGradient(options: RandomGradientOptions = {}): GradientConfig {
  const {
    style = 'random',
    colorCount = 3,
    gradientType,
    useHarmony = false,
  } = options;

  // Get colors based on style
  let colors: string[];
  
  if (useHarmony) {
    const base = randomVibrantColor();
    const harmony = Math.random() > 0.5 
      ? getAnalogous(base) 
      : getComplementary(base);
    colors = harmony.colors;
  } else {
    const palette = STYLE_PALETTES[style] || STYLE_PALETTES.random;
    colors = palette();
  }

  // Adjust color count
  if (colors.length < colorCount) {
    // Add more colors by interpolating
    while (colors.length < colorCount) {
      const idx = Math.floor(Math.random() * (colors.length - 1));
      const newColor = rotateHue(colors[idx], 20 + Math.random() * 40);
      colors.splice(idx + 1, 0, newColor);
    }
  } else if (colors.length > colorCount) {
    colors = colors.slice(0, colorCount);
  }

  // Generate positions
  const positions = generatePositions(colors.length);

  // Determine gradient type
  const type = gradientType || pickRandom<GradientType>(
    ['linear', 'radial', 'conic', 'diamond'],
    1
  )[0];

  // Generate angle for linear/conic
  const angle = Math.floor(Math.random() * 360);

  // Generate center position for radial
  const centerX = 0.3 + Math.random() * 0.4; // 0.3-0.7
  const centerY = 0.3 + Math.random() * 0.4;

  return {
    type,
    colors: colors.map((color, index) => ({
      color,
      position: positions[index],
    })),
    angle,
    centerX,
    centerY,
  };
}

// Generate variation of existing gradient
export function generateVariation(gradient: GradientConfig, variationType: 'color' | 'structure' | 'both' = 'color'): GradientConfig {
  const variation: GradientConfig = JSON.parse(JSON.stringify(gradient));

  if (variationType === 'color' || variationType === 'both') {
    // Vary colors slightly
    variation.colors = gradient.colors.map(c => ({
      ...c,
      color: rotateHue(c.color, -20 + Math.random() * 40),
    }));
  }

  if (variationType === 'structure' || variationType === 'both') {
    // Vary angle
    if (gradient.type === 'linear' || gradient.type === 'conic') {
      variation.angle = ((gradient.angle ?? 0) + (Math.random() > 0.5 ? 45 : -45)) % 360;
    }

    // Vary center position
    if (gradient.type === 'radial') {
      variation.centerX = Math.max(0.2, Math.min(0.8, (gradient.centerX ?? 0.5) + (Math.random() - 0.5) * 0.3));
      variation.centerY = Math.max(0.2, Math.min(0.8, (gradient.centerY ?? 0.5) + (Math.random() - 0.5) * 0.3));
    }
  }

  return variation;
}

// Generate multiple variations
export function generateVariations(gradient: GradientConfig, count: number = 5): GradientConfig[] {
  const variations: GradientConfig[] = [];
  
  for (let i = 0; i < count; i++) {
    const type = i % 3 === 0 ? 'color' : i % 3 === 1 ? 'structure' : 'both';
    variations.push(generateVariation(gradient, type));
  }
  
  return variations;
}

// Smart Refine: Generate subtle, high-quality variations (20% variation strength)
export function generateSmartRefine(gradient: GradientConfig, count: number = 6): GradientConfig[] {
  const variations: GradientConfig[] = [];
  
  for (let i = 0; i < count; i++) {
    const variation: GradientConfig = JSON.parse(JSON.stringify(gradient));
    
    // Subtle color variations (±10-15 degrees hue shift)
    variation.colors = gradient.colors.map(c => {
      const hsl = hexToHsl(c.color);
      
      // Small hue shift (±15 degrees max)
      const hueShift = -15 + Math.random() * 30;
      // Small saturation shift (±10%)
      const satShift = -0.1 + Math.random() * 0.2;
      // Small lightness shift (±8%)
      const lightShift = -0.08 + Math.random() * 0.16;
      
      const newHsl = {
        h: (hsl.h + hueShift + 360) % 360,
        s: Math.max(0, Math.min(1, hsl.s + satShift)),
        l: Math.max(0, Math.min(1, hsl.l + lightShift)),
      };
      
      return {
        ...c,
        color: hslToHex(newHsl),
      };
    });
    
    // Subtle angle variation (±15 degrees max)
    if (gradient.type === 'linear' || gradient.type === 'conic') {
      variation.angle = ((gradient.angle ?? 0) + (-15 + Math.random() * 30) + 360) % 360;
    }
    
    // Subtle center position variation (±10% max)
    if (gradient.type === 'radial') {
      variation.centerX = Math.max(0.3, Math.min(0.7, (gradient.centerX ?? 0.5) + (Math.random() - 0.5) * 0.2));
      variation.centerY = Math.max(0.3, Math.min(0.7, (gradient.centerY ?? 0.5) + (Math.random() - 0.5) * 0.2));
    }
    
    variations.push(variation);
  }
  
  return variations;
}

// Generate gradient from mood
export function generateFromMood(mood: GradientMood): GradientConfig {
  const moodStyles: Record<GradientMood, GradientStyle> = {
    energetic: 'vibrant',
    calm: 'pastel',
    mysterious: 'dark',
    warm: 'sunset',
    cool: 'ocean',
    natural: 'earth',
    futuristic: 'neon',
    romantic: 'pastel',
  };

  const style = moodStyles[mood];
  return generateRandomGradient({ style, colorCount: 3 });
}

// Generate complementary gradient pair
export function generateComplementaryPair(): [GradientConfig, GradientConfig] {
  const base = randomVibrantColor();
  const complement = getComplementary(base);

  const gradient1 = generateRandomGradient({
    colorCount: 3,
    style: 'vibrant',
  });

  const gradient2: GradientConfig = {
    ...gradient1,
    colors: complement.colors.map((color, index) => ({
      color,
      position: gradient1.colors[index]?.position || index / (complement.colors.length - 1),
    })),
  };

  return [gradient1, gradient2];
}

// Smart gradient generator - analyzes current gradients and generates complementary ones
export function generateSmartGradient(existingColors: string[]): GradientConfig {
  if (existingColors.length === 0) {
    return generateRandomGradient();
  }

  // Analyze existing colors
  const avgHue = existingColors.reduce((sum, color) => {
    const hsl = hexToHsl(color);
    return sum + hsl.h;
  }, 0) / existingColors.length;

  // Generate complementary hue range
  const newHue = (avgHue + 150 + Math.random() * 60) % 360;

  // Generate colors in new hue range
  const colors = [
    hslToHex({ h: newHue, s: 70, l: 50 }),
    hslToHex({ h: (newHue + 30) % 360, s: 80, l: 60 }),
    hslToHex({ h: (newHue + 60) % 360, s: 75, l: 55 }),
  ];

  return generateRandomGradient({
    colorCount: 3,
    gradientType: pickRandom<GradientType>(['linear', 'radial', 'conic'], 1)[0],
  });
}

// Generate gradient presets for quick selection
export function generateGradientPresets(count: number = 10): GradientConfig[] {
  const styles: GradientStyle[] = [
    'vibrant', 'pastel', 'dark', 'neon', 
    'earth', 'ocean', 'sunset', 'aurora'
  ];
  
  return Array.from({ length: count }, (_, i) => {
    const style = styles[i % styles.length];
    return generateRandomGradient({ style, colorCount: 3 });
  });
}

// Get style description
export function getStyleDescription(style: GradientStyle): string {
  const descriptions: Record<GradientStyle, string> = {
    vibrant: 'Bold, saturated colors with high energy',
    pastel: 'Soft, muted colors with gentle transitions',
    dark: 'Deep, moody tones with subtle variations',
    neon: 'Electric, glowing colors at maximum saturation',
    earth: 'Natural browns, greens, and warm tones',
    ocean: 'Blues, teals, and aquatic hues',
    sunset: 'Warm oranges, pinks, and golden tones',
    aurora: 'Magical blues, greens, and purples',
    monochrome: 'Shades of a single color from dark to light',
    random: 'Completely random color combinations',
  };
  
  return descriptions[style];
}

// Get mood description
export function getMoodDescription(mood: GradientMood): string {
  const descriptions: Record<GradientMood, string> = {
    energetic: 'High-energy, dynamic gradients',
    calm: 'Peaceful, relaxing color transitions',
    mysterious: 'Dark, intriguing color schemes',
    warm: 'Cozy, inviting warm tones',
    cool: 'Refreshing, cool color palettes',
    natural: 'Earthy, organic color combinations',
    futuristic: 'Modern, tech-inspired gradients',
    romantic: 'Soft, dreamy color blends',
  };
  
  return descriptions[mood];
}
