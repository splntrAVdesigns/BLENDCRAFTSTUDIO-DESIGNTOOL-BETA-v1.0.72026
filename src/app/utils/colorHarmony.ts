/**
 * Color Harmony Utilities
 * Generates color schemes based on color theory
 */

export interface RGB {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
}

export interface HSL {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

export interface ColorScheme {
  name: string;
  colors: string[]; // hex colors
  description: string;
}

// Convert hex to RGB
export function hexToRgb(hex: string): RGB {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
}

// Convert RGB to hex
export function rgbToHex(rgb: RGB): string {
  const toHex = (n: number) => {
    const hex = Math.round(n).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

// Convert RGB to HSL
export function rgbToHsl(rgb: RGB): HSL {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;
  const sum = max + min;

  let h = 0;
  let s = 0;
  const l = sum / 2;

  if (diff !== 0) {
    s = l > 0.5 ? diff / (2 - sum) : diff / sum;

    switch (max) {
      case r:
        h = ((g - b) / diff + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / diff + 2) / 6;
        break;
      case b:
        h = ((r - g) / diff + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

// Convert HSL to RGB
export function hslToRgb(hsl: HSL): RGB {
  const h = hsl.h / 360;
  const s = hsl.s / 100;
  const l = hsl.l / 100;

  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

// Convert hex to HSL
export function hexToHsl(hex: string): HSL {
  return rgbToHsl(hexToRgb(hex));
}

// Convert HSL to hex
export function hslToHex(hsl: HSL): string {
  return rgbToHex(hslToRgb(hsl));
}

// Rotate hue
export function rotateHue(hex: string, degrees: number): string {
  const hsl = hexToHsl(hex);
  hsl.h = (hsl.h + degrees + 360) % 360;
  return hslToHex(hsl);
}

// Adjust saturation
export function adjustSaturation(hex: string, amount: number): string {
  const hsl = hexToHsl(hex);
  hsl.s = Math.max(0, Math.min(100, hsl.s + amount));
  return hslToHex(hsl);
}

// Adjust lightness
export function adjustLightness(hex: string, amount: number): string {
  const hsl = hexToHsl(hex);
  hsl.l = Math.max(0, Math.min(100, hsl.l + amount));
  return hslToHex(hsl);
}

// Generate complementary colors
export function getComplementary(hex: string): ColorScheme {
  const complement = rotateHue(hex, 180);
  
  return {
    name: 'Complementary',
    colors: [hex, complement],
    description: 'Colors opposite on the color wheel',
  };
}

// Generate analogous colors
export function getAnalogous(hex: string): ColorScheme {
  const color1 = rotateHue(hex, -30);
  const color2 = rotateHue(hex, 30);
  
  return {
    name: 'Analogous',
    colors: [color1, hex, color2],
    description: 'Adjacent colors on the color wheel',
  };
}

// Generate triadic colors
export function getTriadic(hex: string): ColorScheme {
  const color1 = rotateHue(hex, 120);
  const color2 = rotateHue(hex, 240);
  
  return {
    name: 'Triadic',
    colors: [hex, color1, color2],
    description: 'Three evenly spaced colors',
  };
}

// Generate tetradic (square) colors
export function getTetradic(hex: string): ColorScheme {
  const color1 = rotateHue(hex, 90);
  const color2 = rotateHue(hex, 180);
  const color3 = rotateHue(hex, 270);
  
  return {
    name: 'Tetradic',
    colors: [hex, color1, color2, color3],
    description: 'Four evenly spaced colors',
  };
}

// Generate split complementary colors
export function getSplitComplementary(hex: string): ColorScheme {
  const color1 = rotateHue(hex, 150);
  const color2 = rotateHue(hex, 210);
  
  return {
    name: 'Split Complementary',
    colors: [hex, color1, color2],
    description: 'Base color plus two adjacent to complement',
  };
}

// Generate monochromatic scheme
export function getMonochromatic(hex: string): ColorScheme {
  const hsl = hexToHsl(hex);
  const colors = [
    hslToHex({ ...hsl, l: Math.max(10, hsl.l - 30) }),
    hslToHex({ ...hsl, l: Math.max(20, hsl.l - 15) }),
    hex,
    hslToHex({ ...hsl, l: Math.min(90, hsl.l + 15) }),
    hslToHex({ ...hsl, l: Math.min(95, hsl.l + 30) }),
  ];
  
  return {
    name: 'Monochromatic',
    colors,
    description: 'Variations in lightness of one color',
  };
}

// Generate shades (darker versions)
export function getShades(hex: string, count: number = 5): string[] {
  const hsl = hexToHsl(hex);
  const shades: string[] = [];
  
  for (let i = 0; i < count; i++) {
    const l = hsl.l * (1 - (i / count) * 0.8);
    shades.push(hslToHex({ ...hsl, l }));
  }
  
  return shades;
}

// Generate tints (lighter versions)
export function getTints(hex: string, count: number = 5): string[] {
  const hsl = hexToHsl(hex);
  const tints: string[] = [];
  
  for (let i = 0; i < count; i++) {
    const l = hsl.l + (100 - hsl.l) * (i / count);
    tints.push(hslToHex({ ...hsl, l }));
  }
  
  return tints;
}

// Generate tones (desaturated versions)
export function getTones(hex: string, count: number = 5): string[] {
  const hsl = hexToHsl(hex);
  const tones: string[] = [];
  
  for (let i = 0; i < count; i++) {
    const s = hsl.s * (1 - (i / count) * 0.8);
    tones.push(hslToHex({ ...hsl, s }));
  }
  
  return tones;
}

// Get all harmony schemes
export function getAllHarmonies(hex: string): ColorScheme[] {
  return [
    getComplementary(hex),
    getAnalogous(hex),
    getTriadic(hex),
    getTetradic(hex),
    getSplitComplementary(hex),
    getMonochromatic(hex),
  ];
}

// Generate random color
export function randomColor(): string {
  const r = Math.floor(Math.random() * 256);
  const g = Math.floor(Math.random() * 256);
  const b = Math.floor(Math.random() * 256);
  return rgbToHex({ r, g, b });
}

// Generate random vibrant color
export function randomVibrantColor(): string {
  const hsl: HSL = {
    h: Math.floor(Math.random() * 360),
    s: 70 + Math.floor(Math.random() * 30), // 70-100%
    l: 45 + Math.floor(Math.random() * 20), // 45-65%
  };
  return hslToHex(hsl);
}

// Generate random pastel color
export function randomPastelColor(): string {
  const hsl: HSL = {
    h: Math.floor(Math.random() * 360),
    s: 25 + Math.floor(Math.random() * 35), // 25-60%
    l: 70 + Math.floor(Math.random() * 20), // 70-90%
  };
  return hslToHex(hsl);
}

// Generate random dark color
export function randomDarkColor(): string {
  const hsl: HSL = {
    h: Math.floor(Math.random() * 360),
    s: 30 + Math.floor(Math.random() * 40), // 30-70%
    l: 15 + Math.floor(Math.random() * 25), // 15-40%
  };
  return hslToHex(hsl);
}

// Check if color is light or dark
export function isLightColor(hex: string): boolean {
  const rgb = hexToRgb(hex);
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.5;
}

// Get contrasting text color
export function getContrastColor(hex: string): string {
  return isLightColor(hex) ? '#000000' : '#ffffff';
}

// Calculate color distance
export function colorDistance(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  
  const dr = rgb1.r - rgb2.r;
  const dg = rgb1.g - rgb2.g;
  const db = rgb1.b - rgb2.b;
  
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// Blend two colors
export function blendColors(hex1: string, hex2: string, ratio: number = 0.5): string {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  
  const r = Math.round(rgb1.r * (1 - ratio) + rgb2.r * ratio);
  const g = Math.round(rgb1.g * (1 - ratio) + rgb2.g * ratio);
  const b = Math.round(rgb1.b * (1 - ratio) + rgb2.b * ratio);
  
  return rgbToHex({ r, g, b });
}
