/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { createAiProxy } from './server/aiProxy';

/** Mounts the local-LLM proxy (`POST /api/ai`) on the dev and preview servers. */
function aiProxy(): Plugin {
  const handler = createAiProxy();
  return {
    name: 'duplex-ai-proxy',
    configureServer(server) {
      server.middlewares.use('/api/ai', (req, res) => void handler(req, res));
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/ai', (req, res) => void handler(req, res));
    },
  };
}

/** Served from a sub-path (GitHub Pages: /repo-name/)? Set BASE_PATH=/repo-name/ when building. */
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    aiProxy(),
    VitePWA({
      // The user decides when to switch to a new version (nothing reloads under their feet mid-edit).
      registerType: 'prompt',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/icon.svg'],
      manifest: {
        name: 'Duplex Designer',
        short_name: 'Duplex',
        description: 'Design a two-level home in 2D and 3D — free, private, and it works offline.',
        theme_color: '#0369a1',
        background_color: '#f1f5f9',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The app shell, every lazy chunk, fonts, icons and the snapshot viewer (needed to export a share file offline).
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}', 'viewer/*.{js,css}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        // Local AI calls go to the user's own machine: never cached, never answered from the cache.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // The very first visit is already covered, so the app works offline right after it has loaded once.
        clientsClaim: true,
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/model/**', 'src/geometry/**', 'src/ai/**'],
      exclude: ['**/*.test.*', 'src/**/*.d.ts', 'src/ai/*.tsx'],
      reporter: ['text-summary', 'text'],
      // Prompt 12: the logic layers stay above 80 % lines.
      thresholds: { lines: 80 },
    },
    alias: {
      'virtual:pwa-register': fileURLToPath(new URL('./src/pwa/registerStub.ts', import.meta.url)),
    },
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
  },
});
