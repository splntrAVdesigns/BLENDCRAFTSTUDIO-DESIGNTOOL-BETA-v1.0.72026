// Debug flag configuration for development
// Set to true to enable specific debug logging categories

export const DEBUG = {
  CANVAS: import.meta.env.DEV && false,
  TEXTURES: import.meta.env.DEV && false,
  ANIMATIONS: import.meta.env.DEV && false,
  GRADIENTS: import.meta.env.DEV && false,
  RENDERER: import.meta.env.DEV && false,
};

// Helper for conditional logging
export const debugLog = (category: keyof typeof DEBUG, ...args: unknown[]) => {
  if (DEBUG[category]) {
    console.log(`[${category}]`, ...args);
  }
};
