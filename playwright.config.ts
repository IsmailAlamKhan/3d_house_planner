import { defineConfig } from '@playwright/test';

export default defineConfig({
  // CI runs once, without retries hiding flaky tests, and keeps the report for failures.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Software GL makes every 3D test CPU-hungry: three at a time keeps the timing-based ones stable.
  workers: process.env.CI ? 2 : 3,
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:4173',
    // Every test starts with the first-run tour already seen; the tour test clears this itself.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:4173',
          localStorage: [
            { name: 'duplex-designer:prefs', value: JSON.stringify({ tourSeen: true }) },
          ],
        },
      ],
    },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // The tests run on the built-in models (same pictures on every machine); the asset pack has its own tests.
    env: { ASSETS_DIR: 'assets/none' },
  },
});
