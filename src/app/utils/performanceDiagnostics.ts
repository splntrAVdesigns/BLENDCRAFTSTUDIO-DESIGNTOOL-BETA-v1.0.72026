/**
 * Performance Diagnostics Tool
 * 
 * Run in browser console: window.runDiagnostics()
 */

export function runPerformanceDiagnostics() {
  console.clear();
  
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║  🔍 BLENDCRAFT STUDIO - PERFORMANCE DIAGNOSTICS                ║
╚════════════════════════════════════════════════════════════════╝
  `);

  // 1. WebGL Support
  console.group('1️⃣  WebGL Support');
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  
  if (!gl) {
    console.error('❌ WebGL is NOT supported or disabled!');
    console.log('This will cause SEVERE performance issues.');
    console.log('Solution: Enable hardware acceleration in browser settings');
  } else {
    console.log('✅ WebGL is supported');
    console.log('GPU Renderer:', gl.getParameter(gl.RENDERER));
    console.log('GPU Vendor:', gl.getParameter(gl.VENDOR));
    console.log('WebGL Version:', gl.getParameter(gl.VERSION));
    console.log('Max Texture Size:', gl.getParameter(gl.MAX_TEXTURE_SIZE));
    console.log('Max Viewport Dims:', gl.getParameter(gl.MAX_VIEWPORT_DIMS));
    
    const renderer = gl.getParameter(gl.RENDERER).toLowerCase();
    if (renderer.includes('swiftshader') || renderer.includes('llvmpipe') || renderer.includes('software')) {
      console.warn('⚠️  WARNING: Using SOFTWARE rendering (CPU) instead of GPU!');
      console.log('This will cause SEVERE performance issues.');
      console.log('Solution: Update GPU drivers or enable hardware acceleration');
    }
  }
  console.groupEnd();

  // 2. Browser Info
  console.group('2️⃣  Browser & System');
  console.log('User Agent:', navigator.userAgent);
  console.log('Device Pixel Ratio:', window.devicePixelRatio);
  console.log('Screen Size:', `${window.screen.width}x${window.screen.height}`);
  console.log('Viewport Size:', `${window.innerWidth}x${window.innerHeight}`);
  console.log('Hardware Concurrency:', navigator.hardwareConcurrency || 'unknown');
  
  if ('deviceMemory' in navigator) {
    console.log('Device Memory:', (navigator as any).deviceMemory, 'GB');
  }
  console.groupEnd();

  // 3. localStorage Size
  console.group('3️⃣  Cached Data');
  let totalSize = 0;
  const items: Array<{key: string, size: number}> = [];
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      const value = localStorage.getItem(key) || '';
      const size = new Blob([value]).size;
      totalSize += size;
      items.push({ key, size });
    }
  }
  
  console.log('Total localStorage Size:', (totalSize / 1024).toFixed(2), 'KB');
  console.log('Items:', localStorage.length);
  
  if (totalSize > 1024 * 1024) {
    console.warn('⚠️  localStorage is over 1MB! This may slow down app initialization.');
  }
  
  // Show largest items
  items.sort((a, b) => b.size - a.size);
  console.log('\nLargest items:');
  items.slice(0, 5).forEach(item => {
    console.log(`  - ${item.key}: ${(item.size / 1024).toFixed(2)} KB`);
  });
  console.groupEnd();

  // 4. Current Canvas Settings
  console.group('4️⃣  Canvas Settings');
  const canvasEl = document.querySelector('canvas');
  if (canvasEl) {
    console.log('Canvas Element Size:', `${canvasEl.width}x${canvasEl.height}`);
    console.log('Canvas Display Size:', `${canvasEl.clientWidth}x${canvasEl.clientHeight}`);
    console.log('Total Pixels:', (canvasEl.width * canvasEl.height).toLocaleString());
    
    const pixels = canvasEl.width * canvasEl.height;
    if (pixels > 2073600) { // 1920x1080
      console.warn('⚠️  Canvas resolution is very high! This may cause performance issues.');
      console.log('Recommended: 1280x720 or lower for good performance');
    }
  } else {
    console.log('No canvas element found (app may not be loaded yet)');
  }
  console.groupEnd();

  // 5. Memory Usage (if available)
  console.group('5️⃣  Memory Usage');
  if ('memory' in performance) {
    const memory = (performance as any).memory;
    console.log('JS Heap Size Limit:', (memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2), 'MB');
    console.log('Total JS Heap Size:', (memory.totalJSHeapSize / 1024 / 1024).toFixed(2), 'MB');
    console.log('Used JS Heap Size:', (memory.usedJSHeapSize / 1024 / 1024).toFixed(2), 'MB');
    
    const usage = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;
    console.log('Memory Usage:', usage.toFixed(2), '%');
    
    if (usage > 80) {
      console.warn('⚠️  Memory usage is very high! May cause garbage collection pauses.');
    }
  } else {
    console.log('Memory API not available (Chrome only)');
  }
  console.groupEnd();

  // 6. Active Animations
  console.group('6️⃣  Performance Metrics');
  
  // FPS Counter
  let frameCount = 0;
  let lastTime = performance.now();
  
  const measureFPS = () => {
    frameCount++;
    const now = performance.now();
    const delta = now - lastTime;
    
    if (delta >= 1000) {
      const fps = Math.round((frameCount * 1000) / delta);
      console.log('📊 Current FPS:', fps);
      
      if (fps < 20) {
        console.error('❌ FPS is critically low!');
      } else if (fps < 40) {
        console.warn('⚠️  FPS is below optimal');
      } else {
        console.log('✅ FPS is good');
      }
      
      frameCount = 0;
      lastTime = now;
      return true; // Stop measuring
    }
    
    requestAnimationFrame(measureFPS);
    return false;
  };
  
  console.log('Measuring FPS for 1 second...');
  requestAnimationFrame(measureFPS);
  
  console.groupEnd();

  // 7. Browser Extensions
  console.group('7️⃣  Browser Environment');
  
  // Check for common performance-killing extensions
  const extensionIndicators = [
    'react-devtools',
    'redux-devtools',
    '__REACT_DEVTOOLS_GLOBAL_HOOK__',
    '__REDUX_DEVTOOLS_EXTENSION__'
  ];
  
  const detectedExtensions: string[] = [];
  extensionIndicators.forEach(indicator => {
    if ((window as any)[indicator]) {
      detectedExtensions.push(indicator);
    }
  });
  
  if (detectedExtensions.length > 0) {
    console.warn('⚠️  Development extensions detected:', detectedExtensions);
    console.log('These can significantly impact performance. Test in Incognito mode.');
  } else {
    console.log('✅ No major performance-impacting extensions detected');
  }
  
  console.groupEnd();

  // Summary
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║  📋 DIAGNOSIS SUMMARY                                          ║
╚════════════════════════════════════════════════════════════════╝
  `);
  
  console.log('To test in clean environment:');
  console.log('  1. Open Incognito/Private window');
  console.log('  2. Run: localStorage.clear(); location.reload();');
  console.log('  3. Disable all browser extensions');
  console.log('');
  console.log('To force clear all cached data:');
  console.log('  Run: window.forceClearAllCache()');
  console.log('');
  console.log('To check app version:');
  console.log('  Run: window.checkAppVersion()');
}

// Make available globally
if (typeof window !== 'undefined') {
  (window as any).runDiagnostics = runPerformanceDiagnostics;
  
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║  🔧 Performance Diagnostics Tool Available                     ║
║                                                                 ║
║  Run in console:                                                ║
║    window.runDiagnostics()                                      ║
╚════════════════════════════════════════════════════════════════╝
  `);
}
