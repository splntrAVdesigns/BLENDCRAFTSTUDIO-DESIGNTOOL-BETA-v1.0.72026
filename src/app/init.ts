/**
 * Initialization script to prevent console flooding from Figma Make inspector props
 * This must be loaded before React to intercept warnings
 */

// VERSION CONTROL: Auto-clear cache when version changes
import { checkVersionAndClearIfNeeded } from './utils/versionManager';
// Diagnostics tool: DEV-only — keeps window.runDiagnostics and boot banner out of production
if (import.meta.env?.DEV) {
  import('./utils/performanceDiagnostics');
}

// Check version FIRST before anything else
if (typeof window !== 'undefined') {
  const versionChanged = checkVersionAndClearIfNeeded();
  if (versionChanged) {
    // Version changed and cache was cleared
    console.log('[Init] Starting with clean state after version change');
  }
}

// Store original console methods
const originalError = console.error;
const originalWarn = console.warn;

// Counter to prevent infinite warning loops
let figmaWarningCount = 0;
const MAX_FIGMA_WARNINGS = 0; // Suppress all Figma warnings completely

/**
 * Filter function to detect Figma Make inspector prop warnings
 */
function isFigmaInspectorWarning(args: any[]): boolean {
  const message = args[0];
  if (typeof message !== 'string') return false;
  
  // Detect React warnings about unknown props
  if (!message.includes('React does not recognize') || !message.includes('prop on a DOM element')) {
    return false;
  }
  
  // Check if any of the arguments contain Figma inspector props
  const allArgs = args.join(' ');
  return allArgs.includes('_fg') || allArgs.includes('_FG');
}

/**
 * Format React warning message by replacing %s placeholders with actual values
 */
function formatReactWarning(args: any[]): string {
  let message = args[0];
  if (typeof message !== 'string') return String(message);
  
  // Replace %s placeholders with subsequent arguments
  let argIndex = 1;
  message = message.replace(/%s/g, () => {
    if (argIndex < args.length) {
      return String(args[argIndex++]);
    }
    return '%s';
  });
  
  return message;
}

/**
 * Patched console.error that filters Figma warnings
 */
console.error = function(...args: any[]) {
  if (isFigmaInspectorWarning(args)) {
    figmaWarningCount++;
    
    if (figmaWarningCount <= MAX_FIGMA_WARNINGS) {
      // Format the warning message properly
      const formattedMessage = formatReactWarning(args);
      
      // Show first few warnings with helpful message
      originalWarn(
        `[Figma Warning ${figmaWarningCount}/${MAX_FIGMA_WARNINGS}] Figma Make inspector props detected (these are harmless and automatically filtered):`
      );
      originalWarn(formattedMessage);
      
      if (figmaWarningCount === MAX_FIGMA_WARNINGS) {
        originalWarn(
          '[Init] Silencing further Figma inspector warnings to prevent console flooding. This is normal in Figma Make environment.'
        );
      }
    }
    // Don't call originalError - suppress the warning
    return;
  }
  
  // Pass through all other errors unchanged
  originalError.apply(console, args);
};

/**
 * Patched console.warn for completeness
 */
console.warn = function(...args: any[]) {
  if (isFigmaInspectorWarning(args)) {
    // Suppress Figma warnings
    return;
  }
  
  // Suppress Three.js multiple instances warning (false positive with Vite dedupe)
  const message = String(args[0] || '');
  if (message.includes('Multiple instances of Three.js being imported')) {
    // This is a false positive - we use proper Vite deduplication and centralized imports
    return;
  }
  
  // Pass through all other warnings unchanged
  originalWarn.apply(console, args);
};

// Log initialization
console.log('[Init] Console filtering initialized to prevent Figma Make inspector prop flooding');

/**
 * Inject viewport meta tag for mobile/tablet optimization
 * Prevents unwanted zoom and ensures proper scaling
 */
if (typeof document !== 'undefined') {
  // Check if viewport meta tag already exists
  let viewportMeta = document.querySelector('meta[name="viewport"]');
  
  if (!viewportMeta) {
    // Create viewport meta tag
    viewportMeta = document.createElement('meta');
    viewportMeta.setAttribute('name', 'viewport');
    document.head.appendChild(viewportMeta);
  }
  
  // Set optimal viewport settings for touch devices
  viewportMeta.setAttribute(
    'content',
    'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
  );
  
  console.log('[Init] Viewport meta tag configured for mobile/tablet optimization');
}

export {}; // Make this a module