/**
 * Development logging utility
 * All non-critical logs are gated behind DEV mode for production cleanliness
 */

const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV !== false;

export const logger = {
  // Always show errors
  error: (...args: any[]) => {
    console.error(...args);
  },

  // Always show warnings
  warn: (...args: any[]) => {
    console.warn(...args);
  },

  // Only show logs in development
  log: (...args: any[]) => {
    if (isDev) {
      console.log(...args);
    }
  },

  // Only show info in development
  info: (...args: any[]) => {
    if (isDev) {
      console.info(...args);
    }
  },

  // Only show debug in development
  debug: (...args: any[]) => {
    if (isDev) {
      console.debug(...args);
    }
  },

  // Grouped logs (development only)
  group: (label: string) => {
    if (isDev) {
      console.group(label);
    }
  },

  groupEnd: () => {
    if (isDev) {
      console.groupEnd();
    }
  },
};