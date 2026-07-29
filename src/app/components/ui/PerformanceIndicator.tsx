import { useState, useEffect, useRef } from 'react';
import { Activity, AlertTriangle, Download } from 'lucide-react';
import { FPSMonitor, getMemoryUsage, runHealthCheck, exportDiagnosticsReport, MemoryLeakDetector } from '../../utils/diagnostics';

interface PerformanceIndicatorProps {
  show?: boolean;
  layerCount?: number;
  historyLength?: number;
  canvasWidth?: number;
  canvasHeight?: number;
}

export function PerformanceIndicator({ 
  show = false,
  layerCount = 0,
  historyLength = 0,
  canvasWidth = 1920,
  canvasHeight = 1080,
}: PerformanceIndicatorProps) {
  const [fps, setFps] = useState(60);
  const [memory, setMemory] = useState(0);
  const [visible, setVisible] = useState(show);
  const [showDetails, setShowDetails] = useState(false);
  const fpsMonitorRef = useRef(new FPSMonitor());
  const memoryDetectorRef = useRef(new MemoryLeakDetector());
  const rafRef = useRef<number>();

  useEffect(() => {
    // Toggle visibility with Shift+P
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.code === 'KeyP') {
        e.preventDefault();
        setVisible((v) => !v);
      }
      // Toggle details with Shift+D
      if (e.shiftKey && e.code === 'KeyD') {
        e.preventDefault();
        setShowDetails((v) => !v);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!visible) return;

    const updateMetrics = () => {
      // Update FPS
      const currentFps = fpsMonitorRef.current.update();
      setFps(currentFps);

      // Update memory
      const currentMemory = getMemoryUsage();
      setMemory(currentMemory);

      // Sample for leak detection
      memoryDetectorRef.current.sample();

      rafRef.current = requestAnimationFrame(updateMetrics);
    };

    rafRef.current = requestAnimationFrame(updateMetrics);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [visible]);

  if (!visible) return null;

  const getColor = () => {
    if (fps >= 55) return 'text-green-400';
    if (fps >= 40) return 'text-yellow-400';
    if (fps >= 25) return 'text-orange-400';
    return 'text-red-400';
  };

  const getLabel = () => {
    if (fps >= 55) return 'Excellent';
    if (fps >= 40) return 'Good';
    if (fps >= 25) return 'Fair';
    return 'Poor';
  };

  const handleExportDiagnostics = () => {
    const healthCheck = runHealthCheck(layerCount, historyLength, canvasWidth, canvasHeight, fps);
    exportDiagnosticsReport(healthCheck);
  };

  const leakDetection = memoryDetectorRef.current.detect();
  const healthCheck = runHealthCheck(layerCount, historyLength, canvasWidth, canvasHeight, fps);

  return (
    <div className="fixed bottom-6 right-6 z-50 px-3 py-2 rounded-lg bg-zinc-900/95 backdrop-blur-sm border border-zinc-800 shadow-lg">
      <div className="flex items-center gap-2">
        <Activity className={`w-4 h-4 ${getColor()}`} />
        <div className="text-xs space-y-0.5">
          <div className="flex items-baseline gap-2">
            <span className={`font-mono font-bold ${getColor()}`}>{fps}</span>
            <span className="text-zinc-500">FPS</span>
          </div>
          <div className={`text-[10px] ${getColor()}`}>{getLabel()}</div>
        </div>
        {healthCheck.status !== 'healthy' && (
          <AlertTriangle className="w-4 h-4 text-yellow-400 animate-pulse" />
        )}
      </div>

      {showDetails && (
        <div className="mt-2 pt-2 border-t border-zinc-800 space-y-1 text-[10px]">
          <div className="flex justify-between text-zinc-400">
            <span>Memory:</span>
            <span className={`font-mono ${memory > 500 ? 'text-red-400' : 'text-zinc-300'}`}>
              {memory}MB
            </span>
          </div>
          <div className="flex justify-between text-zinc-400">
            <span>Layers:</span>
            <span className="font-mono text-zinc-300">{layerCount}</span>
          </div>
          <div className="flex justify-between text-zinc-400">
            <span>History:</span>
            <span className="font-mono text-zinc-300">{historyLength}</span>
          </div>
          <div className="flex justify-between text-zinc-400">
            <span>Canvas:</span>
            <span className="font-mono text-zinc-300">{canvasWidth}×{canvasHeight}</span>
          </div>
          {leakDetection.isLeaking && (
            <div className="text-red-400 flex items-center gap-1 animate-pulse">
              <AlertTriangle className="w-3 h-3" />
              <span>Memory leak detected!</span>
            </div>
          )}
          {healthCheck.issues.length > 0 && (
            <div className="mt-2 pt-2 border-t border-zinc-800">
              <div className="text-yellow-400 font-medium mb-1">Warnings:</div>
              {healthCheck.issues.map((issue, i) => (
                <div key={i} className="text-zinc-400">{issue}</div>
              ))}
            </div>
          )}
          <button
            onClick={handleExportDiagnostics}
            className="mt-2 w-full flex items-center justify-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
          >
            <Download className="w-3 h-3" />
            <span>Export Report</span>
          </button>
        </div>
      )}

      <div className="text-[9px] text-zinc-600 mt-1 border-t border-zinc-800 pt-1">
        Shift+P: hide • Shift+D: {showDetails ? 'hide' : 'show'} details
      </div>
    </div>
  );
}