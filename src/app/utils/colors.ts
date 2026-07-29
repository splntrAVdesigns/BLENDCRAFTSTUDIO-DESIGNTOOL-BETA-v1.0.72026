import { ColorStop } from '../types/gradient';

// Popular gradient color palettes
export const COLOR_PALETTES = {
  // Vibrant (8 palettes)
  sunset: ['#FF6B6B', '#FFA500', '#FFD93D', '#FF1744'],
  ocean: ['#0083B0', '#00B4DB', '#4DD0E1', '#80DEEA'],
  forest: ['#134E13', '#2D7A2D', '#56AB2F', '#A8E063'],
  purple: ['#667EEA', '#764BA2', '#A770EF', '#CF8BF3'],
  fire: ['#FF0000', '#FF4500', '#FF6347', '#FF7F50'],
  crimson: ['#8B0000', '#DC143C', '#FF1493', '#FF69B4'],
  neon: ['#FF006E', '#00F5FF', '#FFBE0B', '#8338EC'],
  tropical: ['#00D4BD', '#7FFFD4', '#FFD700', '#FF6B35'],
  
  // Pastels (8 palettes - added bolder/vibrant pastels)
  cotton: ['#FFE5E5', '#FFD1DC', '#FFC1E3', '#FFB3E6'],
  mint: ['#B2F7EF', '#A3F7BF', '#E0F9B5', '#FEFDCA'],
  lavender: ['#E8D5F2', '#D5BCFF', '#C5A3FF', '#B88BFF'],
  peach: ['#FFCBA4', '#FFB4A2', '#E5989B', '#FFD6BA'],
  sky: ['#B8E6F7', '#A7D8DE', '#AED9E0', '#DAEAF6'],
  rose: ['#FFE5EC', '#FFC2D1', '#FFB3C6', '#FF8FAB'],
  sunrise: ['#FFD93D', '#FFB347', '#FF6B9D', '#FF8E9E'],
  coral: ['#FF7F50', '#FFB6B9', '#FEC8D8', '#FFDFD3'],
  
  // Bold (8 palettes - hue-focused combinations)
  cyberpunk: ['#FF00FF', '#00FFFF', '#FFFF00', '#FF0099'],
  electric: ['#00F0FF', '#5200FF', '#FF00E4', '#00FFAA'],
  voltage: ['#FFFF00', '#FF00FF', '#00FFFF', '#FF4500'],
  cosmic: ['#8E2DE2', '#4A00E0', '#DA22FF', '#9733EE'],
  aurora: ['#00C9FF', '#92FE9D', '#FDBB2D', '#22C1C3'],
  spectrum: ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#4B0082', '#9400D3'],
  prism: ['#FF1493', '#00CED1', '#FFD700', '#7B68EE'],
  kaleidoscope: ['#FF6B9D', '#C44569', '#FFA07A', '#98D8C8', '#6C5CE7'],
  
  // Nature (8 palettes - diverse nature colors)
  galaxy: ['#0F2027', '#203A43', '#2C5364', '#4CA1AF'],
  bronze: ['#CD7F32', '#B87333', '#8C7853', '#A67C52'],
  copper: ['#B87333', '#CB6D51', '#DA8A67', '#E8A798'],
  mudBrown: ['#1A0F0A', '#3E2723', '#4E3B31', '#6D4C41', '#8D6E63'],
  canopyShade: ['#0D1B0D', '#1C3A1A', '#2F5A2F', '#4A7C4A', '#6B9F6B'],
  autumn: ['#8B4513', '#D2691E', '#CD853F', '#DEB887', '#F4A460'],
  moss: ['#4A5D23', '#697D33', '#8B9A46', '#A8B96E'],
  driftwood: ['#8B7355', '#A0826D', '#BFA084', '#D4C5B9'],
  
  // Professional (8 palettes - modern trending professional)
  corporate: ['#2C3E50', '#34495E', '#3498DB', '#5DADE2'],
  elegant: ['#2D2D2D', '#4A4A4A', '#6A6A6A', '#8A8A8A'],
  minimal: ['#000000', '#333333', '#666666', '#999999', '#CCCCCC'],
  slate: ['#1E293B', '#334155', '#475569', '#64748B', '#94A3B8'],
  navy: ['#0F172A', '#1E293B', '#334155', '#475569'],
  charcoal: ['#1C1C1C', '#2E2E2E', '#404040', '#525252', '#6E6E6E'],
  azure: ['#0066CC', '#0080FF', '#3399FF', '#66B2FF'],
  teal: ['#006064', '#00838F', '#00ACC1', '#00BCD4', '#26C6DA'],
  
  // Metallic (8 palettes - chrome/shimmer/heatmap)
  gold: ['#D4AF37', '#FFD700', '#FFC125', '#FFB90F'],
  silver: ['#C0C0C0', '#D3D3D3', '#E8E8E8', '#F5F5F5'],
  chrome: ['#E8E8E8', '#FFFFFF', '#C0C0C0', '#B0B0B0', '#A0A0A0'],
  platinum: ['#E5E4E2', '#F0F0F0', '#D8D8D8', '#C8C8C8'],
  titanium: ['#6B7A8F', '#7A8BA0', '#8A9DB3', '#9BAEC7', '#ACC0DA'],
  steel: ['#71797E', '#848482', '#B0BEC5', '#CFD8DC'],
  iridescent: ['#FF00FF', '#00FFFF', '#FFFF00', '#FF1493', '#7FFFD4'],
  holographic: ['#FF69B4', '#00CED1', '#FFD700', '#9370DB', '#00FA9A'],
  
  // Monochrome
  grays: ['#1A1A1A', '#4A4A4A', '#7A7A7A', '#ABABAB', '#E0E0E0'],
  blues: ['#0A192F', '#112240', '#1D3557', '#457B9D', '#A8DADC'],
  reds: ['#3D0000', '#7D1E1E', '#B22222', '#DC143C', '#FF6B6B'],
  greens: ['#0B3D0B', '#1A5D1A', '#2E7D32', '#4CAF50', '#81C784'],
  
  // Duotone
  inkBlue: ['#0A2342', '#2CA58D', '#84BC9C', '#CBA328'],
  warmCool: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4'],
  
  // JUNGLE - Nature/Earth/Organic themed (blacks, browns, greens)
  deepJungle: ['#0A0E0A', '#1C3A1C', '#2D5016', '#4A7C2F', '#6B8E23'],
  forestFloor: ['#2C1810', '#3E2723', '#4E342E', '#5D4037', '#6D4C41'],
  mossyRock: ['#1A1A1A', '#2E4A2E', '#4A6741', '#6B8B5C', '#8FBC8F'],
  earthyVine: ['#1C1008', '#332211', '#4A3C2A', '#6B5A3C', '#8C7853'],
  tropicalGreen: ['#0F3D0F', '#1A5E1A', '#2D7D32', '#4CAF50', '#66BB6A'],
  jaguar: ['#000000', '#1A1A0D', '#2D3319', '#4A5429', '#6B7B3D'],
  wetFoliage: ['#0A1A0A', '#1A3A1A', '#2D5A2F', '#417A41', '#5A9A5A'],
  anaconda: ['#0D1A0D', '#1C2F1C', '#2D4A2D', '#3E6A3E', '#4F8A4F'],
  
  // TECHNO - Neon/Electric/Saturated themed  
  neonRave: ['#FF0090', '#FF00FF', '#9D00FF', '#4D00FF', '#0000FF'],
  cyberGrid: ['#00FFFF', '#00FF00', '#FFFF00', '#FF00FF', '#FF0000'],
  laserShow: ['#FF1493', '#00FFFF', '#7FFF00', '#FF4500', '#9400D3'],
  synthWave: ['#FF006E', '#FB5607', '#FFBE0B', '#8338EC', '#3A86FF'],
  technoBlue: ['#0000FF', '#00BFFF', '#00FFFF', '#00FF7F', '#00FF00'],
  acidHouse: ['#ADFF2F', '#7FFF00', '#00FF00', '#00FF7F', '#00FFFF'],
  ultraviolet: ['#8B00FF', '#9D00FF', '#BF00FF', '#FF00FF', '#FF1493'],
  electricPink: ['#FF007F', '#FF00BF', '#FF00FF', '#BF00FF', '#7F00FF'],
  neonOrange: ['#FF4500', '#FF6347', '#FF7F50', '#FFA500', '#FFD700'],
  rave: ['#00FF00', '#00FFFF', '#FF00FF', '#FFFF00', '#FF0000'],
  strobeLight: ['#FFFFFF', '#00FFFF', '#FF00FF', '#FFFF00', '#FFFFFF'],
  glowStick: ['#39FF14', '#FF10F0', '#FFFF00', '#00FFFF', '#FF1493'],
  
  // FUTURE - Cyber/Holographic/2055 themed
  hologram: ['#00D9FF', '#7B2FFF', '#FF2EF0', '#00FFF7', '#B4FF39'],
  cybernetic: ['#0A2E4A', '#1E5A7A', '#3A8CAF', '#5ABFDF', '#7ADFFF'],
  quantumBlue: ['#001F3F', '#004D7A', '#007BA7', '#00A8E8', '#00D4FF'],
  neuralNet: ['#1A0033', '#330066', '#4D0099', '#6600CC', '#8000FF'],
  biotech: ['#00FF41', '#00FFFF', '#00D4FF', '#0080FF', '#0040FF'],
  plasmaCore: ['#FF0080', '#FF00FF', '#8000FF', '#0080FF', '#00FFFF'],
  darkMatter: ['#000033', '#1A0066', '#330099', '#4D00CC', '#6600FF'],
  warpDrive: ['#001A33', '#003D66', '#006699', '#0099CC', '#00CCFF'],
  xenon: ['#9B59B6', '#8E44AD', '#7D3C98', '#6C3483', '#5B2C6F'],
  android: ['#00BCD4', '#00E5FF', '#18FFFF', '#76FF03', '#C6FF00'],
  spaceDust: ['#1C1C3D', '#2A2A5A', '#3D3D7A', '#5656A8', '#7070D0'],
  
  // COLOR THEORY - Triadic Harmonies (6 palettes)
  primaryTriad: ['#FF0000', '#FFFF00', '#0000FF', '#FF0000'],
  secondaryTriad: ['#FF8C00', '#9370DB', '#00CED1', '#FF8C00'],
  tertiaryTriad: ['#FF1493', '#32CD32', '#1E90FF', '#FF1493'],
  warmTriad: ['#FF4500', '#FFD700', '#FF69B4', '#FF4500'],
  coolTriad: ['#00CED1', '#9370DB', '#00FA9A', '#00CED1'],
  earthTriad: ['#8B4513', '#556B2F', '#CD853F', '#8B4513'],
  
  // COLOR THEORY - Analogous Harmonies (6 palettes)
  coolAnalogous: ['#0066CC', '#0099FF', '#00CCCC', '#00FF99', '#00FF66'],
  warmAnalogous: ['#FF0000', '#FF4500', '#FF8C00', '#FFD700', '#FFFF00'],
  purpleAnalogous: ['#4B0082', '#8B00FF', '#9400D3', '#BA55D3', '#DA70D6'],
  greenAnalogous: ['#006400', '#228B22', '#32CD32', '#7FFF00', '#ADFF2F'],
  blueAnalogous: ['#000080', '#0000CD', '#0000FF', '#4169E1', '#1E90FF'],
  redAnalogous: ['#8B0000', '#B22222', '#DC143C', '#FF0000', '#FF6347'],
  
  // COLOR THEORY - Split-Complementary (4 palettes)
  blueSplitComp: ['#0066FF', '#FF6600', '#FFFF00', '#0066FF'],
  redSplitComp: ['#FF0000', '#00FFCC', '#66FF00', '#FF0000'],
  greenSplitComp: ['#00FF00', '#FF0099', '#9900FF', '#00FF00'],
  yellowSplitComp: ['#FFFF00', '#0066FF', '#FF0066', '#FFFF00'],
  
  // GLASSMORPHISM & NEUMORPHISM (5 palettes)
  frostedGlass: ['#E8F4F8', '#D1E7F0', '#B8DCE8', '#A0D2E0', '#8BC8D8'],
  softNeumorphic: ['#E0E5EC', '#C8CED9', '#B0B8C6', '#98A2B3', '#808CA0'],
  translucentLayers: ['#F5F7FA', '#DFE3E8', '#C9CFD6', '#B3BBC4', '#9DA7B2'],
  blurredDepth: ['#ECF0F3', '#D5DBE0', '#BEC6CD', '#A7B1BA', '#909CA7'],
  glassMorph: ['#FFFFFF', '#F0F4F8', '#E1E8ED', '#D2DCE2', '#C3D0D7'],
  
  // AI/ML/DATA VISUALIZATION (6 palettes)
  dataHeatmap: ['#0D47A1', '#1976D2', '#FFC107', '#FF9800', '#F44336'],
  mlConfidence: ['#1B5E20', '#388E3C', '#4CAF50', '#8BC34A', '#CDDC39'],
  analyticsDash: ['#1A237E', '#283593', '#3F51B5', '#5C6BC0', '#7986CB'],
  neuralNetwork: ['#004D40', '#00695C', '#00897B', '#26A69A', '#4DB6AC'],
  predictionCurve: ['#311B92', '#4527A0', '#5E35B1', '#7E57C2', '#9575CD'],
  dataFlow: ['#01579B', '#0277BD', '#0288D1', '#039BE5', '#03A9F4'],
  
  // WEB3/CRYPTO/BLOCKCHAIN (5 palettes)
  bitcoinGold: ['#1A1A1A', '#332200', '#665500', '#F7931A', '#FFB84D'],
  ethereumGrad: ['#0D1E3E', '#1A3A5C', '#2B5A7A', '#3C7A98', '#627EEA'],
  defiBlue: ['#001F3F', '#003D7A', '#005FB5', '#0081F0', '#00A3FF'],
  nftPrismatic: ['#FF1493', '#FF00FF', '#8B00FF', '#4169E1', '#00CED1', '#FFD700'],
  blockchainNet: ['#0A0E27', '#141B3D', '#1E2853', '#2D3F7C', '#3D56A5'],
  
  // WELLNESS & MINDFULNESS (6 palettes)
  meditationCalm: ['#E8F5E9', '#C8E6C9', '#A5D6A7', '#81C784', '#66BB6A'],
  therapyGreen: ['#F1F8E9', '#DCEDC8', '#C5E1A5', '#AED581', '#9CCC65'],
  spaTranquil: ['#E0F7FA', '#B2EBF2', '#80DEEA', '#4DD0E1', '#26C6DA'],
  yogaBalance: ['#F3E5F5', '#E1BEE7', '#CE93D8', '#BA68C8', '#AB47BC'],
  mindfulnessBlue: ['#E3F2FD', '#BBDEFB', '#90CAF9', '#64B5F6', '#42A5F5'],
  zenGarden: ['#EFEBE9', '#D7CCC8', '#BCAAA4', '#A1887F', '#8D6E63'],
  
  // DARK MODE OPTIMIZED (4 palettes)
  darkVibrant: ['#FF0080', '#FF00FF', '#8000FF', '#0080FF', '#00FFFF'],
  darkProfessional: ['#0D1117', '#161B22', '#21262D', '#30363D', '#484F58'],
  darkPastel: ['#FFB5E8', '#B28DFF', '#85E3FF', '#C4FAF8', '#ACE7EF'],
  oledSafe: ['#00FF88', '#00FFFF', '#FF00FF', '#FFFF00', '#FF1493'],
  
  // Y2K REVIVAL (4 palettes)
  y2kChrome: ['#E8E8E8', '#FFFFFF', '#00FFFF', '#FF00FF', '#FFFF00'],
  bubblegumPop: ['#FF69B4', '#FFB6C1', '#FF1493', '#FFC0CB', '#FF91AF'],
  earlyInternet: ['#0000FF', '#00FFFF', '#00FF00', '#FFFF00', '#FF00FF'],
  flashEra: ['#FF0099', '#FFFF00', '#00FFFF', '#FF6600', '#9933FF'],

  // PSYCHEDELIC ACID (8 palettes - HDR-style vibrant acid colors)
  electricDreams: ['#FF00FF', '#00FFFF', '#FF1493', '#00FF00'],
  acidRain: ['#7B2FFF', '#00D4FF'],
  neonMelt: ['#FF0080', '#FFD700', '#00FF9F', '#8A2BE2'],
  cyberFlux: ['#FF006E', '#3A86FF'],
  trippySunset: ['#FF006E', '#FFBE0B', '#00F5FF', '#8338EC'],
  laserBeam: ['#39FF14', '#FF10F0'],
  holographicShift: ['#FF0099', '#00FFFF', '#FFFF00', '#9D00FF'],
  raveLights: ['#FF1744', '#00E5FF', '#C6FF00', '#D500F9'],
};

// Convert hex to RGB
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255,
      }
    : { r: 0, g: 0, b: 0 };
}

// Convert RGB to hex
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const hex = Math.round(n * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Create color stops from palette
export function paletteToColorStops(colors: string[]): ColorStop[] {
  return colors.map((color, index) => ({
    color,
    position: index / (colors.length - 1),
  }));
}

// Interpolate between two colors
export function interpolateColor(color1: string, color2: string, t: number): string {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);
  
  const r = rgb1.r + (rgb2.r - rgb1.r) * t;
  const g = rgb1.g + (rgb2.g - rgb1.g) * t;
  const b = rgb1.b + (rgb2.b - rgb1.b) * t;
  
  return rgbToHex(r, g, b);
}