/**
 * Device Detection Utility
 * Differentiates between phone, tablet, and desktop devices
 */

export type DeviceType = 'phone' | 'tablet' | 'desktop';

/**
 * Detects the current device type based on screen size and touch capabilities
 * 
 * - Phone: < 768px width
 * - Tablet: 768px - 1366px with touch OR any touch device 768-1366px
 * - Desktop: > 1366px OR no touch support
 */
export function getDeviceType(): DeviceType {
  const width = window.innerWidth;
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  
  // Phone: < 768px width (always block, regardless of touch)
  if (width < 768) {
    return 'phone';
  }
  
  // Tablet: 768px - 1366px (iPad Pro 12.9" is 1366px in landscape)
  // Allow both touch and non-touch devices in this range
  if (width >= 768 && width <= 1366) {
    return 'tablet';
  }
  
  // Desktop: > 1366px
  return 'desktop';
}

/**
 * Check if the current device is a phone
 */
export function isPhone(): boolean {
  return getDeviceType() === 'phone';
}

/**
 * Check if the current device is a tablet
 */
export function isTablet(): boolean {
  return getDeviceType() === 'tablet';
}

/**
 * Check if the current device is a desktop
 */
export function isDesktop(): boolean {
  return getDeviceType() === 'desktop';
}

/**
 * Check if the device supports touch
 */
export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * Get viewport dimensions
 */
export function getViewportDimensions() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    orientation: window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'
  };
}

/**
 * Detect specific device/browser combinations
 */
export function getDeviceInfo() {
  const ua = navigator.userAgent;
  
  return {
    isIOS: /iPad|iPhone|iPod/.test(ua),
    isIPad: /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    isAndroid: /Android/.test(ua),
    isSafari: /Safari/.test(ua) && !/Chrome/.test(ua),
    isChrome: /Chrome/.test(ua),
    isMobile: /iPhone|iPod|Android.*Mobile/.test(ua),
    isTabletUA: /iPad|Android(?!.*Mobile)/.test(ua),
  };
}
