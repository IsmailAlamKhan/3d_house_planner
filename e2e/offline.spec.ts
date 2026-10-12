import { expect, test } from '@playwright/test';

test('the app installs a service worker and keeps working with no network', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Help' })).toBeVisible();
  // Wait until the service worker has taken control and filled its cache.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(async () => page.evaluate(async () => (await caches.keys()).length), { timeout: 30_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => page.evaluate(async () => !!navigator.serviceWorker.controller), {
      timeout: 15_000,
    })
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Help' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
  // A lazily loaded screen (not needed for the first paint) also comes from the cache.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Export & share' })).toBeVisible();
  // So does the snapshot viewer that "Share read-only snapshot" inlines.
  await page.getByRole('tab', { name: 'Share' }).click();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /read-only snapshot/ }).click(),
  ]);
  expect((await dl.suggestedFilename()).endsWith('.html')).toBe(true);
  await context.setOffline(false);
});

test('the web manifest makes the app installable', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const res = await request.get(new URL(href!, page.url()).toString());
  const m = (await res.json()) as {
    name: string;
    display: string;
    icons: { sizes: string; purpose?: string; src: string }[];
  };
  expect(m.name).toBe('Duplex Designer');
  expect(m.display).toBe('standalone');
  expect(m.icons.some((i) => i.sizes === '192x192')).toBe(true);
  expect(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
  for (const icon of m.icons) {
    const r = await request.get(new URL(icon.src, page.url()).toString());
    expect(r.ok()).toBe(true);
  }
});
