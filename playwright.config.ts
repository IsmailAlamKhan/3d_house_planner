import { defineConfig } from '@playwright/test';

export default defineConfig({
  // CI runs once, without retries hiding flaky tests, and keeps the report for failures.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Software GL makes every 3D test CPU-hungry: two at a time keeps the timing-based ones stable.
  workers: 2,
  // Under software GL (and with a language-model server running next to it) a test can take twice as long as on a quiet machine.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  testDir: './e2e',
  // The two timing- and brightness-sensitive files run alone, one after the other, once everything else is done:
  // a second busy browser slows the software renderer enough to change what they measure.
  projects: [
    { name: 'main', testIgnore: /(lighting|camera).spec.ts/ },
    { name: 'lighting', testMatch: /lighting.spec.ts/, dependencies: ['main'] },
    { name: 'camera', testMatch: /camera.spec.ts/, dependencies: ['lighting'] },
  ],
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
