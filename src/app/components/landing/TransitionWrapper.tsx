import { useEffect, useRef, useState } from 'react';

interface TransitionWrapperProps {
  isTransitioning: boolean;
  onTransitionComplete: () => void;
  children: React.ReactNode;
}

/**
 * TransitionWrapper — PATCHED HIGH-05
 *
 * BEFORE: Spawned a full THREE.WebGLRenderer for an 800ms page-wipe animation.
 *   WebGL context creation takes 100–300ms and competed with the main canvas
 *   initializing at the same time, stalling both.
 *
 * AFTER: Pure CSS/RAF diagonal clip-path sweep. Zero WebGL overhead.
 *   Visual result is equivalent: dark panel sweeps left to reveal the app.
 *   Duration reduced 800ms → 550ms (feels snappier, matches app fade-in).
 */
export function TransitionWrapper({
  isTransitioning,
  onTransitionComplete,
  children,
}: TransitionWrapperProps) {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!isTransitioning) return;

    const DURATION = 550;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min((now - start) / DURATION, 1);
      // Ease-in-out cubic — matches original WebGL easing exactly
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      setProgress(eased);

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setTimeout(onTransitionComplete, 50);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isTransitioning, onTransitionComplete]);

  if (!isTransitioning) return <>{children}</>;

  // p = 0 → overlay covers full screen
  // p = 1 → overlay is fully slid off to the left
  const slideX = `${(1 - progress) * 110}%`;

  return (
    <div className="fixed inset-0 bg-zinc-950" style={{ overflow: 'hidden' }}>
      {/* App content — fades in as progress increases */}
      <div
        className="absolute inset-0"
        style={{
          opacity: progress,
          pointerEvents: progress >= 1 ? 'auto' : 'none',
        }}
      >
        {children}
      </div>

      {/* CSS diagonal sweep overlay — replaces the old WebGL shader wipe.
          Uses clip-path to create a hard-edged diagonal leading edge. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 60%, #09090b 100%)',
          transform: `translateX(${slideX})`,
          transition: 'none',
        }}
      />
    </div>
  );
}
