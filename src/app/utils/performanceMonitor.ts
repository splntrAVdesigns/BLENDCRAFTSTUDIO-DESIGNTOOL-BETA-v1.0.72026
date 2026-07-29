/**
 * Performance monitoring utility for WebGL rendering
 */

export class PerformanceMonitor {
  private frameCount = 0;
  private lastTime = performance.now();
  private fps = 60;
  private readonly fpsHistory: number[] = [];
  private readonly maxHistoryLength = 60;

  getFPS(): number {
    return Math.round(this.fps);
  }

  getAverageFPS(): number {
    if (this.fpsHistory.length === 0) return 60;
    const sum = this.fpsHistory.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.fpsHistory.length);
  }

  update(): void {
    const currentTime = performance.now();
    this.frameCount++;

    if (currentTime >= this.lastTime + 1000) {
      this.fps = Math.round((this.frameCount * 1000) / (currentTime - this.lastTime));
      
      // Store in history
      this.fpsHistory.push(this.fps);
      if (this.fpsHistory.length > this.maxHistoryLength) {
        this.fpsHistory.shift();
      }

      this.frameCount = 0;
      this.lastTime = currentTime;
    }
  }

  reset(): void {
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.fps = 60;
    this.fpsHistory.length = 0;
  }

  isPerformanceGood(): boolean {
    return this.getAverageFPS() >= 30;
  }

  getPerformanceStatus(): 'excellent' | 'good' | 'fair' | 'poor' {
    const avgFPS = this.getAverageFPS();
    if (avgFPS >= 55) return 'excellent';
    if (avgFPS >= 40) return 'good';
    if (avgFPS >= 25) return 'fair';
    return 'poor';
  }
}

// Debounce utility for performance optimization
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}

// Throttle utility for performance optimization
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;

  return function executedFunction(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

// Request animation frame with fallback
export const requestAnimFrame = (() => {
  return (
    window.requestAnimationFrame ||
    function (callback: FrameRequestCallback) {
      return window.setTimeout(callback, 1000 / 60);
    }
  );
})();

// Cancel animation frame with fallback
export const cancelAnimFrame = (() => {
  return (
    window.cancelAnimationFrame ||
    function (id: number) {
      clearTimeout(id);
    }
  );
})();
