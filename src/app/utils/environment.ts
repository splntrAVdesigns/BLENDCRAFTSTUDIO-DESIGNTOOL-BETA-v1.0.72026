/**
 * Check if we're running in development mode
 */
export function isDevMode(): boolean {
  return typeof import.meta !== 'undefined' && import.meta.env?.DEV === true;
}

/**
 * Check if we're running in production mode
 */
export function isProdMode(): boolean {
  return typeof import.meta !== 'undefined' && import.meta.env?.PROD === true;
}

/**
 * Check if we're running in an iframe environment
 */
export function isIframeEnvironment(): boolean {
  try {
    return window.self !== window.top;
  } catch (e) {
    // If we can't access window.top due to cross-origin restrictions,
    // we're definitely in an iframe
    return true;
  }
}