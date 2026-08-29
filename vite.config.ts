import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
      // Force all 'three' imports to use our centralized wrapper
      // This prevents multiple instances and ensures consistent imports
      'three': path.resolve(__dirname, './node_modules/three'),
    },
    dedupe: ['three', 'react', 'react-dom'], // Ensure only one instance of critical libraries
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  // Build optimizations
  build: {
    // Code splitting and chunk optimization
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks for better caching
          'vendor-react': ['react', 'react-dom'],
          'vendor-three': ['three'],
          'vendor-ui': [
            '@radix-ui/react-accordion',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-select',
            '@radix-ui/react-slider',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
          ],
          'vendor-utils': [
            'motion',
            'lucide-react',
            'clsx',
            'tailwind-merge',
          ],
          'vendor-export': [
            'file-saver',
            'gif.js',
            'jszip',
          ],
        },
        // Optimize chunk size
        chunkFileNames: (chunkInfo) => {
          const facadeModuleId = chunkInfo.facadeModuleId || '';
          if (facadeModuleId.includes('node_modules')) {
            return 'vendor/[name]-[hash].js';
          }
          return 'chunks/[name]-[hash].js';
        },
      },
    },
    // Target modern browsers for better optimization
    target: 'esnext',
    // Minimize bundle size
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove verbose console logs in production
        // PATCHED HIGH-06: console.warn intentionally kept — silencing it suppresses
        // WebGL context errors, Three.js deprecation notices, and shader compile
        // warnings that are critical for debugging production issues.
        // Only drop the truly verbose logging calls.
        pure_funcs: ['console.debug', 'console.log', 'console.info'],
      },
    },
    // Increase chunk size warning limit for complex app
    chunkSizeWarningLimit: 1000,
    // Enable source maps for debugging
    sourcemap: false, // Set to true for debugging
  },

  // Performance optimizations
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'three',
      'motion',
      'lucide-react',
    ],
    exclude: ['gif.js'], // Large worker-based library
  },

  // Server configuration for development
  server: {
    // Enable HMR
    hmr: true,
    // Open browser on start
    open: false,
    // Add headers to prevent aggressive browser caching during development
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
  },
})