import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Builds the read-only snapshot viewer as ONE self-contained script (and one stylesheet) into `public/viewer/`.
 * "Share read-only snapshot" inlines both into a single .html file together with the project JSON.
 */
export default defineConfig({
  plugins: [react()],
  // The output folder lives inside `public/`, so it must not be copied from there into itself.
  publicDir: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'public/viewer',
    emptyOutDir: true,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
    lib: {
      entry: 'src/viewer/main.tsx',
      name: 'DuplexViewer',
      formats: ['iife'],
      fileName: () => 'viewer.js',
      cssFileName: 'viewer',
    },
  },
});
