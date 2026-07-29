/**
 * Version Indicator - Shows current app version and cache status
 * Only visible in development or when cache was just cleared
 */

import { useState, useEffect } from 'react';
import { APP_VERSION } from '../../utils/versionManager';

export function VersionIndicator() {
  const [showIndicator, setShowIndicator] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);

  useEffect(() => {
    // Check if cache was just cleared (will be set in sessionStorage by version manager)
    const wasCleared = sessionStorage.getItem('cache_just_cleared') === 'true';
    setCacheCleared(wasCleared);
    
    // Show indicator if cache was just cleared or in development
    const isDev = import.meta.env.DEV;
    setShowIndicator(wasCleared || isDev);
    
    // Auto-hide after 10 seconds if cache was cleared
    if (wasCleared) {
      const timer = setTimeout(() => {
        setShowIndicator(false);
        sessionStorage.removeItem('cache_just_cleared');
      }, 10000);
      
      return () => clearTimeout(timer);
    }
  }, []);

  if (!showIndicator) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] pointer-events-none">
      <div className="bg-black/90 backdrop-blur-md border border-white/20 rounded-lg px-3 py-2 shadow-xl">
        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${cacheCleared ? 'bg-green-500' : 'bg-blue-500'} animate-pulse`} />
            <span className="text-white/70">v{APP_VERSION}</span>
          </div>
          
          {cacheCleared && (
            <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-white/20">
              <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-green-400 font-medium">Cache Cleared</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
