import { useEffect, useRef, useState } from 'react';
import BlendcraftIcon from 'figma:asset/987cf5f33064a7023b59cef30c3e7f415b485d24.png';

interface LoadingPageProps {
  onComplete: () => void;
}

export function LoadingPage({ onComplete }: LoadingPageProps) {
  const [progress, setProgress] = useState(0);
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Smooth, consistent 3-second loading animation
    const duration = 3000; // 3 seconds
    const startTime = Date.now();
    const frameDuration = 16; // ~60fps
    let cancelled = false;

    const animate = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min((elapsed / duration) * 100, 100);
      
      setProgress(newProgress);

      if (newProgress < 100) {
        progressTimerRef.current = setTimeout(animate, frameDuration);
      } else {
        // Loading complete
        completeTimerRef.current = setTimeout(() => {
          if (!cancelled) onComplete();
        }, 300);
      }
    };

    animate();

    return () => {
      cancelled = true;
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
      if (completeTimerRef.current) clearTimeout(completeTimerRef.current);
    };
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-8">
        {/* Logo with pulse animation */}
        <div className="relative">
          <img 
            src={BlendcraftIcon} 
            alt="Blendcraft Studio" 
            className="h-48 w-48"
            style={{
              animation: 'pulse 2s ease-in-out infinite'
            }}
          />
          {/* Glow effect */}
          <div 
            className="absolute inset-0 h-48 w-48 bg-blue-500/20 rounded-full blur-xl"
            style={{
              animation: 'pulse 2s ease-in-out infinite'
            }}
          />
        </div>

        {/* Loading bar */}
        <div className="w-80 space-y-3">
          {/* Progress bar container */}
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden shadow-inner">
            <div 
              className="h-full bg-gradient-to-r from-blue-600 via-blue-500 to-blue-400 rounded-full transition-all duration-300 ease-out shadow-lg shadow-blue-500/50"
              style={{ 
                width: `${progress}%`,
                transition: 'width 0.3s ease-out'
              }}
            />
          </div>

          {/* Progress percentage */}
          <div className="text-center text-sm text-zinc-400 font-medium">
            {Math.round(progress)}%
          </div>
        </div>

        {/* Loading text */}
        <div className="text-zinc-500 text-sm">
          {progress < 20 && 'Initializing...'}
          {progress >= 20 && progress < 40 && 'Loading WebGL...'}
          {progress >= 40 && progress < 60 && 'Compiling shaders...'}
          {progress >= 60 && progress < 80 && 'Preparing interface...'}
          {progress >= 80 && progress < 100 && 'Almost ready...'}
          {progress >= 100 && 'Ready!'}
        </div>
      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.8;
            transform: scale(1.05);
          }
        }
      `}</style>
    </div>
  );
}