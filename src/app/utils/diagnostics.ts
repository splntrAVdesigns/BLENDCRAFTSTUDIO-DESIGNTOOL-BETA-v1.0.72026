/**
 * Diagnostic utilities for monitoring app health and performance
 * Used for production monitoring and debugging
 */

export interface PerformanceMetrics {
  fps: number;
  memoryUsage: number; // MB
  renderTime: number; // ms
  layerCount: number;
  historySize: number;
  canvasResolution: string;
}

export interface HealthCheck {
  status: 'healthy' | 'warning' | 'critical';
  issues: string[];
  metrics: PerformanceMetrics;
  timestamp: number;
}

/**
 * Get current memory usage (if available)
 */
export function getMemoryUsage(): number {
  if ('memory' in performance && (performance as any).memory) {
    const memory = (performance as any).memory;
    return Math.round(memory.usedJSHeapSize / 1048576); // Convert to MB
  }
  return 0;
}

/**
 * Calculate current FPS
 */
export class FPSMonitor {
  private frames: number[] = [];
  private lastTime: number = performance.now();

  update(): number {
    const now = performance.now();
    const delta = now - this.lastTime;
    this.lastTime = now;

    // Add frame time
    this.frames.push(delta);

    // Keep only last 60 frames
    if (this.frames.length > 60) {
      this.frames.shift();
    }

    // Calculate average FPS
    if (this.frames.length === 0) return 60;
    const avgFrameTime = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
    return Math.round(1000 / avgFrameTime);
  }

  reset(): void {
    this.frames = [];
    this.lastTime = performance.now();
  }
}

/**
 * Run comprehensive health check
 */
export function runHealthCheck(
  layerCount: number,
  historyLength: number,
  canvasWidth: number,
  canvasHeight: number,
  fps: number
): HealthCheck {
  const issues: string[] = [];
  const memoryUsage = getMemoryUsage();

  // Check memory
  if (memoryUsage > 500) {
    issues.push(`High memory usage: ${memoryUsage}MB (recommend < 500MB)`);
  }

  // Check FPS
  if (fps < 30) {
    issues.push(`Low FPS: ${fps} (recommend > 30fps)`);
  }

  // Check layer count
  if (layerCount > 20) {
    issues.push(`High layer count: ${layerCount} (recommend < 20 layers)`);
  }

  // Check canvas size
  const pixels = canvasWidth * canvasHeight;
  if (pixels > 16777216) { // 4096x4096
    issues.push(`Large canvas: ${canvasWidth}x${canvasHeight} (may impact performance)`);
  }

  // Check history
  if (historyLength > 40) {
    issues.push(`Large history: ${historyLength} states (may use significant memory)`);
  }

  // Determine status
  let status: 'healthy' | 'warning' | 'critical' = 'healthy';
  if (issues.length > 0) {
    status = 'warning';
  }
  if (memoryUsage > 800 || fps < 20) {
    status = 'critical';
  }

  return {
    status,
    issues,
    metrics: {
      fps,
      memoryUsage,
      renderTime: fps > 0 ? 1000 / fps : 0,
      layerCount,
      historySize: historyLength,
      canvasResolution: `${canvasWidth}x${canvasHeight}`,
    },
    timestamp: Date.now(),
  };
}

/**
 * Log performance metrics to console (development only)
 */
export function logPerformanceMetrics(metrics: PerformanceMetrics): void {
  if (process.env.NODE_ENV !== 'development') return;

  console.group('🔍 Performance Metrics');
  console.log(`FPS: ${metrics.fps}`);
  console.log(`Memory: ${metrics.memoryUsage}MB`);
  console.log(`Render Time: ${metrics.renderTime.toFixed(2)}ms`);
  console.log(`Layers: ${metrics.layerCount}`);
  console.log(`History: ${metrics.historySize} states`);
  console.log(`Canvas: ${metrics.canvasResolution}`);
  console.groupEnd();
}

/**
 * Detect potential memory leaks by monitoring growth over time
 */
export class MemoryLeakDetector {
  private samples: number[] = [];
  private sampleInterval: number = 5000; // 5 seconds
  private lastSample: number = 0;

  sample(): void {
    const now = Date.now();
    if (now - this.lastSample < this.sampleInterval) return;

    const memory = getMemoryUsage();
    if (memory > 0) {
      this.samples.push(memory);
      this.lastSample = now;

      // Keep only last 20 samples (100 seconds)
      if (this.samples.length > 20) {
        this.samples.shift();
      }
    }
  }

  detect(): { isLeaking: boolean; growthRate: number; trend: string } {
    if (this.samples.length < 5) {
      return { isLeaking: false, growthRate: 0, trend: 'insufficient-data' };
    }

    // Calculate linear regression to detect trend
    const n = this.samples.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = this.samples.reduce((a, b) => a + b, 0);
    const sumXY = this.samples.reduce((sum, y, x) => sum + x * y, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const growthRate = slope * 60; // MB per minute

    let trend = 'stable';
    let isLeaking = false;

    if (growthRate > 5) {
      trend = 'increasing';
      isLeaking = true; // Growing > 5MB/min suggests leak
    } else if (growthRate < -2) {
      trend = 'decreasing';
    }

    return { isLeaking, growthRate, trend };
  }

  reset(): void {
    this.samples = [];
    this.lastSample = 0;
  }
}

/**
 * Check for WebGL context loss
 */
export function checkWebGLHealth(canvas: HTMLCanvasElement | null): {
  healthy: boolean;
  message: string;
} {
  if (!canvas) {
    return { healthy: false, message: 'Canvas not found' };
  }

  const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
  if (!gl) {
    return { healthy: false, message: 'WebGL context not available' };
  }

  const contextLost = gl.isContextLost();
  if (contextLost) {
    return { healthy: false, message: 'WebGL context lost - try refreshing' };
  }

  return { healthy: true, message: 'WebGL healthy' };
}

/**
 * Export diagnostics report as JSON
 */
export function exportDiagnosticsReport(healthCheck: HealthCheck): void {
  const report = {
    timestamp: new Date(healthCheck.timestamp).toISOString(),
    status: healthCheck.status,
    issues: healthCheck.issues,
    metrics: healthCheck.metrics,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    screenResolution: `${screen.width}x${screen.height}`,
    devicePixelRatio: window.devicePixelRatio,
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gradient-studio-diagnostics-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
