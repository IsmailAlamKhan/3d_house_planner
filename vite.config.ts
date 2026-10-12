/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
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

export default defineConfig({
  plugins: [react(), aiProxy()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
  },
});
