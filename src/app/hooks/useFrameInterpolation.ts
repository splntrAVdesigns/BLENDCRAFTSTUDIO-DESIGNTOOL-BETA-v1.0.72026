/**
 * Frame Interpolation & Delta Smoothing Hook
 * Provides buttery-smooth 60fps animation with adaptive quality
 */

import { useRef, useEffect, useCallback, useState } from 'react';

interface FrameInterpolationConfig {
  targetFPS: number;
  smoothingFactor: number; // 0-1, higher = more smoothing
  adaptiveQuality: boolean;
  motionBlur: boolean;
  motionBlurStrength: number; // 0-1
}

interface PerformanceMetrics {
  fps: number;
  frameTime: number;
  droppedFrames: number;
  averageFPS: number;
  quality: 'ultra' | 'high' | 'medium' | 'low';
}

const DEFAULT_CONFIG: FrameInterpolationConfig = {
  targetFPS: 60,
  smoothingFactor: 0.3,
  adaptiveQuality: true,
  motionBlur: false,
  motionBlurStrength: 0.3,
};

export function useFrameInterpolation(config: Partial<FrameInterpolationConfig> = {}) {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  
  // Performance tracking
  const lastFrameTimeRef = useRef<number>(0);
  const deltaAccumulatorRef = useRef<number>(0);
  const smoothedDeltaRef = useRef<number>(1/60); // Start at 60fps
  const frameCountRef = useRef<number>(0);
  const fpsHistoryRef = useRef<number[]>([]);
  const droppedFramesRef = useRef<number>(0);
  
  // Adaptive quality state
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics>({
    fps: 60,
    frameTime: 16.67,
    droppedFrames: 0,
    averageFPS: 60,
    quality: 'high',
  });
  
  // Motion blur trail for previous frames
  const previousFramesRef = useRef<ImageData[]>([]);
  
  /**
   * Calculate smoothed delta time with exponential smoothing
   */
  const calculateSmoothedDelta = useCallback((currentTime: number): number => {
    const rawDelta = lastFrameTimeRef.current 
      ? (currentTime - lastFrameTimeRef.current) / 1000 // Convert to seconds
      : 1/60;
    
    lastFrameTimeRef.current = currentTime;
    
    // Clamp delta to prevent huge jumps (max 100ms = 10fps min)
    const clampedDelta = Math.min(rawDelta, 0.1);
    
    // Exponential smoothing: smoothed = (1-α) * smoothed + α * current
    const alpha = fullConfig.smoothingFactor;
    smoothedDeltaRef.current = (1 - alpha) * smoothedDeltaRef.current + alpha * clampedDelta;
    
    return smoothedDeltaRef.current;
  }, [fullConfig.smoothingFactor]);
  
  /**
   * Track performance metrics and adjust quality
   */
  const updatePerformanceMetrics = useCallback((delta: number) => {
    frameCountRef.current++;
    
    // Calculate instantaneous FPS
    const instantFPS = delta > 0 ? 1 / delta : 60;
    
    // Add to FPS history (keep last 60 frames = 1 second at 60fps)
    fpsHistoryRef.current.push(instantFPS);
    if (fpsHistoryRef.current.length > 60) {
      fpsHistoryRef.current.shift();
    }
    
    // Calculate average FPS
    const avgFPS = fpsHistoryRef.current.reduce((a, b) => a + b, 0) / fpsHistoryRef.current.length;
    
    // Detect dropped frames (frame time > 20ms = below 50fps)
    const frameTime = delta * 1000;
    if (frameTime > 20) {
      droppedFramesRef.current++;
    }
    
    // Adaptive quality determination
    let quality: PerformanceMetrics['quality'] = 'high';
    if (fullConfig.adaptiveQuality) {
      if (avgFPS >= 55) quality = 'ultra';
      else if (avgFPS >= 45) quality = 'high';
      else if (avgFPS >= 30) quality = 'medium';
      else quality = 'low';
    }
    
    // Update metrics every 30 frames (~0.5s at 60fps)
    if (frameCountRef.current % 30 === 0) {
      setPerformanceMetrics({
        fps: Math.round(instantFPS),
        frameTime: Math.round(frameTime * 10) / 10,
        droppedFrames: droppedFramesRef.current,
        averageFPS: Math.round(avgFPS),
        quality,
      });
    }
  }, [fullConfig.adaptiveQuality]);
  
  /**
   * Apply motion blur effect (blend previous frames)
   */
  const applyMotionBlur = useCallback((
    ctx: CanvasRenderingContext2D,
    currentFrame: ImageData
  ): ImageData => {
    if (!fullConfig.motionBlur || previousFramesRef.current.length === 0) {
      return currentFrame;
    }
    
    const blurred = new ImageData(
      new Uint8ClampedArray(currentFrame.data),
      currentFrame.width,
      currentFrame.height
    );
    
    // Blend with previous frame
    const previousFrame = previousFramesRef.current[0];
    const blurStrength = fullConfig.motionBlurStrength;
    
    for (let i = 0; i < blurred.data.length; i += 4) {
      blurred.data[i] = blurred.data[i] * (1 - blurStrength) + previousFrame.data[i] * blurStrength;
      blurred.data[i + 1] = blurred.data[i + 1] * (1 - blurStrength) + previousFrame.data[i + 1] * blurStrength;
      blurred.data[i + 2] = blurred.data[i + 2] * (1 - blurStrength) + previousFrame.data[i + 2] * blurStrength;
      // Keep alpha unchanged
    }
    
    // Store current frame for next blur
    previousFramesRef.current[0] = new ImageData(
      new Uint8ClampedArray(currentFrame.data),
      currentFrame.width,
      currentFrame.height
    );
    
    return blurred;
  }, [fullConfig.motionBlur, fullConfig.motionBlurStrength]);
  
  /**
   * Get interpolated time with frame prediction
   */
  const getInterpolatedTime = useCallback((currentTime: number): number => {
    const smoothedDelta = calculateSmoothedDelta(currentTime);
    updatePerformanceMetrics(smoothedDelta);
    
    // Accumulate delta for physics-style fixed timestep
    deltaAccumulatorRef.current += smoothedDelta;
    
    return deltaAccumulatorRef.current;
  }, [calculateSmoothedDelta, updatePerformanceMetrics]);
  
  /**
   * Reset performance counters
   */
  const resetMetrics = useCallback(() => {
    frameCountRef.current = 0;
    droppedFramesRef.current = 0;
    fpsHistoryRef.current = [];
    previousFramesRef.current = [];
  }, []);
  
  /**
   * Get quality multiplier based on adaptive quality
   */
  const getQualityMultiplier = useCallback((): number => {
    switch (performanceMetrics.quality) {
      case 'ultra': return 1.0;
      case 'high': return 0.9;
      case 'medium': return 0.75;
      case 'low': return 0.5;
      default: return 1.0;
    }
  }, [performanceMetrics.quality]);
  
  return {
    getInterpolatedTime,
    applyMotionBlur,
    performanceMetrics,
    resetMetrics,
    getQualityMultiplier,
    smoothedDelta: smoothedDeltaRef.current,
  };
}
