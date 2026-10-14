import { defineConfig } from '@playwright/test';

/**
 * The GPU harness (`npm run test:gpu`): the same app, but Chromium uses the real graphics card (ANGLE → Direct3D 11)
 * instead of the software renderer the normal end-to-end tests use. It measures what only a GPU can tell: frame rate,
 * how the real models and PBR textures look, ray-traced / baked results. Run it on the Windows PC (RTX 4060 Ti).
 * Pictures and numbers are written to `test-results/gpu/`.
 */
export default defineConfig({
  testDir: './e2e-gpu',
  workers: 1,
  timeout: 300_000,
  retries: 0,
  outputDir: 'test-results/gpu-artifacts',
  use: {
    baseURL: 'http://localhost:4175',
    viewport: { width: 1600, height: 900 },
    launchOptions: {
      args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=d3d11', '--enable-unsafe-webgpu'],
    },
    storageState: {
      cookies: [],
      origins: [
        { origin: 'http://localhost:4175', localStorage: [{ name: 'duplex-designer:prefs', value: JSON.stringify({ tourSeen: true }) }] },
      ],
    },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4175 --strictPort',
    url: 'http://localhost:4175',
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
