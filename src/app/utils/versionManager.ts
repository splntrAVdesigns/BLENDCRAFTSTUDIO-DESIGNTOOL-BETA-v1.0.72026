/**
 * Version Manager - Automatically clears cached data when app version changes
 * 
 * This prevents old localStorage/sessionStorage from contaminating restored versions.
 */

// UPDATE THIS EVERY TIME YOU MAKE A SIGNIFICANT CHANGE
export const APP_VERSION = 'ultra-perf-540p-24fps-hooks-fixed';

const VERSION_KEY = 'blendcraft_app_version';

/**
 * Check if app version has changed and clear all cached data if so
 */
export function checkVersionAndClearIfNeeded() {
  const savedVersion = localStorage.getItem(VERSION_KEY);
  
  if (savedVersion !== APP_VERSION) {
    console.warn(`
    ╔════════════════════════════════════════════════════════╗
    ║  🔄 APP VERSION CHANGED                                 ║
    ║                                                         ║
    ║  Previous: ${savedVersion || 'none'}                    ║
    ║  Current:  ${APP_VERSION}                               ║
    ║                                                         ║
    ║  Clearing all cached data for clean slate...           ║
    ╚════════════════════════════════════════════════════════╝
    `);
    
    // Clear ALL storage
    const keysToPreserve: string[] = []; // Add any keys you want to keep
    
    // Save keys we want to preserve
    const preserved: Record<string, string> = {};
    keysToPreserve.forEach(key => {
      const value = localStorage.getItem(key);
      if (value) preserved[key] = value;
    });
    
    // Clear everything
    localStorage.clear();
    sessionStorage.clear();
    
    // Restore preserved keys
    Object.entries(preserved).forEach(([key, value]) => {
      localStorage.setItem(key, value);
    });
    
    // Set new version
    localStorage.setItem(VERSION_KEY, APP_VERSION);
    
    // Set flag for UI indicator (will be cleared after 10 seconds)
    sessionStorage.setItem('cache_just_cleared', 'true');
    
    console.log('✅ Cache cleared. App is now running on clean state.');
    
    return true; // Version changed
  }
  
  return false; // Same version
}

/**
 * Force clear all cached data (for debugging)
 */
export function forceClearAllCache() {
  console.warn('🧹 FORCE CLEARING ALL CACHED DATA...');
  
  // Clear storage
  localStorage.clear();
  sessionStorage.clear();
  
  // Clear IndexedDB if it exists
  if (window.indexedDB) {
    window.indexedDB.databases?.().then(databases => {
      databases.forEach(db => {
        if (db.name) {
          window.indexedDB.deleteDatabase(db.name);
          console.log(`🗑️ Deleted IndexedDB: ${db.name}`);
        }
      });
    });
  }
  
  // Clear cache storage
  if ('caches' in window) {
    caches.keys().then(names => {
      names.forEach(name => {
        caches.delete(name);
        console.log(`🗑️ Deleted cache: ${name}`);
      });
    });
  }
  
  console.log('✅ All caches cleared. Reload the page for fresh start.');
}

// Make it available in browser console for debugging
if (typeof window !== 'undefined') {
  (window as any).forceClearAllCache = forceClearAllCache;
  (window as any).checkAppVersion = () => {
    console.log('Current version:', APP_VERSION);
    console.log('Saved version:', localStorage.getItem(VERSION_KEY));
  };
}