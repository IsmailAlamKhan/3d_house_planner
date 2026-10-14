import { expect, test, type Page } from '@playwright/test';

// Baked lighting as the browser sees it. Blender is pretended with route mocks; the real bake runs on the GPU PC
// (e2e-gpu/bake.gpu.spec.ts) and in server/bake/bake.test.ts.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function health(page: Page, studio: Record<string, unknown>): Promise<void> {
  await page.route('**/api/health', async (route) => {
    let body: Record<string, unknown> = {};
    try {
      body = (await (await route.fetch()).json()) as Record<string, unknown>;
    } catch {
      // no app server behind the preview
    }
    await route.fulfill({ json: { ...body, studio } });
  });
}

async function openPanel(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Light & quality' }).click();
}

test('without Blender the panel says baking needs it, and the real-time lighting stays', async ({
  page,
}) => {
  await health(page, { configured: false, ready: false });
  await openPanel(page);
  await expect(page.getByTestId('bake-section')).toBeVisible();
  await expect(page.getByTestId('bake-info')).toContainText('No bake for this look yet');
  await expect(page.getByTestId('bake-section')).toContainText('Baking needs the Blender service');
  await expect(page.getByTestId('bake-start')).toBeDisabled();
  await expect(page.getByTestId('bake-stale')).toHaveCount(0);
});

test('a bake that no longer matches the design is marked out of date, and a rebake can be started and cancelled', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await health(page, {
    configured: true,
    ready: true,
    device: 'OPTIX: Test GPU',
    version: '4.2.23',
  });
  let started = false;
  let cancelled = false;
  const meta = {
    projectId: 'IGNORED',
    preset: 'day',
    quality: 'medium',
    key: '0000000000000000', // never the key of the real design
    createdAt: '2026-01-01T00:00:00Z',
    atlas: { width: 2, height: 2 },
    scale: 1,
    seconds: 41,
    samples: 256,
    device: 'OPTIX: Test GPU',
    parts: [],
  };
  await page.route('**/api/bake/results?**', async (route) => {
    const project = new URL(route.request().url()).searchParams.get('project');
    await route.fulfill({ json: [{ ...meta, projectId: project }] });
  });
  await page.route('**/api/bake/*/day/lightmap**', (route) =>
    route.fulfill({ body: PNG, contentType: 'image/png' }),
  );
  await page.route('**/api/bake/*/day/uv', (route) =>
    route.fulfill({ body: Buffer.alloc(0), contentType: 'application/octet-stream' }),
  );
  await page.route('**/api/bake?**', async (route) => {
    started = true;
    await route.fulfill({ status: 202, json: { id: 'cccccccccccccccc' } });
  });
  await page.route('**/api/bake/jobs/cccccccccccccccc', async (route) => {
    if (route.request().method() === 'DELETE') {
      cancelled = true;
      return route.fulfill({
        json: {
          id: 'cccccccccccccccc',
          status: 'cancelled',
          ahead: 0,
          gpuBusyWith: null,
          progress: null,
        },
      });
    }
    await route.fulfill({
      json: {
        id: 'cccccccccccccccc',
        status: 'running',
        ahead: 0,
        gpuBusyWith: 'render',
        progress: { sample: 30, total: 256, etaSeconds: 20 },
      },
    });
  });
  await openPanel(page);
  await expect(page.getByTestId('bake-info')).toContainText('Baked for Day: 41 s, OPTIX: Test GPU');
  await expect(page.getByTestId('bake-stale')).toHaveText('Lighting out of date — Rebake');
  // the app keeps working: the scene is still there
  await expect(page.getByTestId('scene-canvas')).toBeVisible();

  await page.getByTestId('bake-quality').selectOption('low');
  await page.getByTestId('bake-start').click();
  await expect(page.getByTestId('bake-status')).toContainText('30 / 256 samples', {
    timeout: 60_000,
  });
  expect(started).toBe(true);
  await page.getByTestId('bake-cancel').click();
  await expect(page.getByTestId('bake-status')).toBeHidden();
  expect(cancelled).toBe(true);
});

test('the bake switches and the auto-rebake option are remembered', async ({ page }) => {
  await health(page, { configured: false, ready: false });
  await openPanel(page);
  await page.getByTestId('bake-auto').check();
  await page.getByTestId('bake-use').uncheck();
  await page.reload();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Light & quality' }).click();
  await expect(page.getByTestId('bake-auto')).toBeChecked();
  await expect(page.getByTestId('bake-use')).not.toBeChecked();
});
