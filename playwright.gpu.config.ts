import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Blender for the studio render tests: BLENDER_PATH, or the portable copy in tools/ (git-ignored).
const PORTABLE = 'tools/blender-4.2.23-windows-x64/blender.exe';
const blender = process.env.BLENDER_PATH ?? (existsSync(PORTABLE) ? PORTABLE : '');

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
      args: [
        '--enable-gpu',
        '--ignore-gpu-blocklist',
        '--use-gl=angle',
        '--use-angle=d3d11',
        '--enable-unsafe-webgpu',
      ],
    },
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:4175',
          localStorage: [
            { name: 'duplex-designer:prefs', value: JSON.stringify({ tourSeen: true }) },
          ],
        },
      ],
    },
  },
  webServer: {
    // the real app server (static files, /pack, /api/studio), not the preview server: the studio render needs its API
    command: 'npm run build && npm run server',
    url: 'http://localhost:4175',
    reuseExistingServer: true,
    timeout: 300_000,
    env: {
      PORT: '4175',
      HOST: '127.0.0.1',
      DATA_DIR: 'test-results/gpu-data',
      ASSETS_DIR: 'assets',
      BLENDER_PATH: blender,
      // the image service: the ComfyUI on this PC (start it first: E:/ComfyUI/ComfyUI/start-comfy.bat), or COMFYUI_URL
      COMFYUI_URL: process.env.COMFYUI_URL ?? 'http://127.0.0.1:8188',
    },
  },
});
