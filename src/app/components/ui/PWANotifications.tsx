import { useEffect, useState } from 'react';
import { useServiceWorker } from '../../hooks/useServiceWorker';
import { Button } from './button';
import { X, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useServiceWorker';

/**
 * PWA Update Notification
 * Shows when a new version is available
 */
export function PWAUpdateNotification() {
  const { isUpdateAvailable, update } = useServiceWorker();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isUpdateAvailable) {
      setIsVisible(true);
    }
  }, [isUpdateAvailable]);

  if (!isVisible) return null;

  const handleUpdate = () => {
    update();
    setIsVisible(false);
  };

  const handleDismiss = () => {
    setIsVisible(false);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm">
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg shadow-2xl p-4 border border-indigo-400/30">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <RefreshCw className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-sm mb-1">Update Available</h3>
            <p className="text-xs opacity-90 mb-3">
              A new version of Blendcraft Studio is ready. Update now for the latest features and improvements.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleUpdate}
                className="bg-white text-indigo-600 hover:bg-gray-100 text-xs px-3 py-1"
              >
                Update Now
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDismiss}
                className="text-white hover:bg-white/20 text-xs px-3 py-1"
              >
                Later
              </Button>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 text-white/70 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Online Status Indicator
 * Shows when app goes offline/online
 */
export function OnlineStatusIndicator() {
  const isOnline = useOnlineStatus();
  const [showOffline, setShowOffline] = useState(false);
  const [justCameOnline, setJustCameOnline] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setShowOffline(true);
      setJustCameOnline(false);
    } else if (showOffline) {
      // Was offline, now online
      setShowOffline(false);
      setJustCameOnline(true);
      // Hide "back online" message after 3 seconds
      const timer = setTimeout(() => setJustCameOnline(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, showOffline]);

  if (!showOffline && !justCameOnline) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
      {showOffline ? (
        <div className="bg-red-600 text-white rounded-lg shadow-2xl px-4 py-2 flex items-center gap-2 border border-red-400/30">
          <WifiOff className="w-4 h-4" />
          <span className="text-sm font-medium">You're offline</span>
        </div>
      ) : (
        <div className="bg-green-600 text-white rounded-lg shadow-2xl px-4 py-2 flex items-center gap-2 border border-green-400/30 animate-in slide-in-from-top">
          <Wifi className="w-4 h-4" />
          <span className="text-sm font-medium">Back online</span>
        </div>
      )}
    </div>
  );
}
