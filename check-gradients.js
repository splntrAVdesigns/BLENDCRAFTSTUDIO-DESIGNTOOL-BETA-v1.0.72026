// Quick diagnostic script
console.log('[Diagnostic] Checking gradient configuration...');

// Check localStorage for saved state
try {
  const layers = localStorage.getItem('gradientStudio_layers');
  if (layers) {
    const parsed = JSON.parse(layers);
    console.log('[Diagnostic] Found saved layers:', parsed.length);
    parsed.forEach((layer, idx) => {
      console.log(`  Layer ${idx}:`, {
        type: layer.gradient?.type,
        colors: layer.gradient?.colors?.length,
        visible: layer.visible,
        opacity: layer.opacity
      });
    });
  }
} catch (e) {
  console.error('[Diagnostic] Error reading localStorage:', e);
}
