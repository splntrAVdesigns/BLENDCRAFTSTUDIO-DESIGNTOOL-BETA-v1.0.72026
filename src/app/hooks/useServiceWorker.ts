import { useEffect, useState } from 'react';

interface ServiceWorkerState {
  isSupported: boolean;
  isRegistered: boolean;
  isUpdateAvailable: boolean;
  registration: ServiceWorkerRegistration | null;
}

/**
 * Hook for managing service worker registration and updates
 * Enables PWA functionality and offline support
 */
export function useServiceWorker() {
  const [state, setState] = useState<ServiceWorkerState>({
    isSupported: 'serviceWorker' in navigator,
    isRegistered: false,
    isUpdateAvailable: false,
    registration: null,
  });

  useEffect(() => {
    // TEMPORARY: Completely disable Service Worker to prevent caching issues during development
    console.log('[SW] Service worker disabled during development to prevent caching');
    return;

    if (!state.isSupported) {
      if (import.meta.env?.DEV) {
        console.log('[SW] Service workers not supported');
      }
      return;
    }

    // Skip service worker registration in certain environments
    const shouldSkipRegistration =
      // Skip in Figma iframe preview
      window.location.hostname.includes('figma') ||
      // Skip in localhost during development (optional - remove if you want SW in dev)
      window.location.hostname === 'localhost' ||
      // Skip if running in iframe (unless explicitly allowed)
      window.self !== window.top;

    if (shouldSkipRegistration) {
      if (import.meta.env?.DEV) {
        console.log('[SW] Service worker registration skipped in current environment');
      }
      return;
    }

    let updateInterval: number | undefined;
    
    // Register service worker
    const registerServiceWorker = async () => {
      try {
        // First check if sw.js exists by fetching it
        const swResponse = await fetch('/sw.js', { method: 'HEAD' });
        if (!swResponse.ok || !swResponse.headers.get('content-type')?.includes('javascript')) {
          if (import.meta.env?.DEV) {
            console.log('[SW] Service worker file not available or wrong MIME type, skipping registration');
          }
          return;
        }

        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });

        if (import.meta.env?.DEV) {
          console.log('[SW] Service worker registered:', registration);
        }

        setState((prev) => ({
          ...prev,
          isRegistered: true,
          registration,
        }));

        // Check for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New service worker available
              if (import.meta.env?.DEV) {
                console.log('[SW] New version available');
              }
              setState((prev) => ({
                ...prev,
                isUpdateAvailable: true,
              }));
            }
          });
        });

        // Check for updates periodically (every hour)
        updateInterval = window.setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000);

      } catch (error) {
        console.error('[SW] Registration failed:', error);
      }
    };

    registerServiceWorker();

    // Listen for service worker controller changes
    const handleControllerChange = () => {
      if (import.meta.env?.DEV) {
        console.log('[SW] Controller changed, reloading page');
      }
      window.location.reload();
    };
    
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    // CLEANUP: Clear interval and remove event listener on unmount
    return () => {
      if (updateInterval) {
        clearInterval(updateInterval);
      }
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };

  }, [state.isSupported]);

  // Update to new service worker
  const update = () => {
    if (state.registration?.waiting) {
      state.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  };

  // Unregister service worker
  const unregister = async () => {
    if (state.registration) {
      const success = await state.registration.unregister();
      if (success) {
        setState((prev) => ({
          ...prev,
          isRegistered: false,
          registration: null,
        }));
      }
      return success;
    }
    return false;
  };

  // Clear all caches
  const clearCache = async () => {
    if (state.registration?.active) {
      state.registration.active.postMessage({ type: 'CLEAR_CACHE' });
      // Also clear caches directly
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    }
  };

  return {
    ...state,
    update,
    unregister,
    clearCache,
  };
}

/**
 * Hook to detect online/offline status
 * Useful for showing connection status in PWA
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}