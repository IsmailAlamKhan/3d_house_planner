import { expect, test, type Page } from '@playwright/test';

// Studio render (Blender) as the browser sees it. The Blender side is pretended with route mocks; the real thing is
// exercised on the GPU PC by e2e-gpu/studioRender.gpu.spec.ts and by server/studio/studio.test.ts.
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
      // no app server behind the preview: the page only needs the studio part
    }
    await route.fulfill({ json: { ...body, studio } });
  });
}

async function openStudio(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await page.getByTestId('present-button').click();
  await page.getByTestId('present-cutaway-top').click();
  await page.getByTestId('present-studio').click();
}

test('without Blender the app works and the studio dialog says how to turn it on', async ({
  page,
}) => {
  await health(page, { configured: false, ready: false });
  await openStudio(page);
  const note = page.getByTestId('studio-unavailable');
  await expect(note).toContainText('Studio render is not set up');
  await expect(note).toContainText('docker compose --profile render up -d');
  await expect(note).toContainText('BLENDER_PATH');
  await expect(page.getByTestId('studio-render')).toBeDisabled();
  await expect(page.getByTestId('studio-reference')).toBeDisabled();
});

test('Blender without a GPU: the reason is shown', async ({ page }) => {
  await health(page, {
    configured: true,
    ready: false,
    problem: 'Blender found no NVIDIA GPU for Cycles.',
  });
  await openStudio(page);
  await expect(page.getByTestId('studio-unavailable')).toContainText('no NVIDIA GPU');
});

test('a studio render shows progress with samples and ETA, can be cancelled, and finished pictures show in the gallery', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await health(page, {
    configured: true,
    ready: true,
    device: 'OPTIX: Test GPU',
    version: '4.2.23',
  });
  let cancelled = false;
  let bundleBytes = 0;
  await page.route('**/api/studio/render?**', async (route) => {
    bundleBytes = route.request().postDataBuffer()?.length ?? 0;
    await route.fulfill({ status: 202, json: { id: 'aaaaaaaaaaaaaaaa' } });
  });
  await page.route('**/api/studio/jobs/aaaaaaaaaaaaaaaa', async (route) => {
    if (route.request().method() === 'DELETE') {
      cancelled = true;
      return route.fulfill({
        json: {
          id: 'aaaaaaaaaaaaaaaa',
          status: 'cancelled',
          ahead: 0,
          gpuBusyWith: null,
          progress: null,
        },
      });
    }
    await route.fulfill({
      json: {
        id: 'aaaaaaaaaaaaaaaa',
        status: 'running',
        ahead: 0,
        gpuBusyWith: 'render',
        progress: { sample: 10, total: 256, etaSeconds: 42 },
      },
    });
  });
  await page.route('**/api/studio/results?**', (route) => route.fulfill({ json: [] }));
  await openStudio(page);
  await expect(page.getByTestId('studio-device')).toContainText('OPTIX: Test GPU');
  await page.getByTestId('studio-quality').selectOption('preview');
  await page.getByTestId('studio-render').click();
  await expect(page.getByTestId('studio-status')).toContainText('10 / 256 samples', {
    timeout: 120_000,
  });
  await expect(page.getByTestId('studio-status')).toContainText('about 42 s left');
  expect(bundleBytes).toBeGreaterThan(1000); // the glb and the sidecar went to the server
  await page.getByTestId('studio-cancel').click();
  await expect(page.getByTestId('studio-status')).toBeHidden();
  expect(cancelled).toBe(true);

  // a finished result appears in the gallery with its numbers
  await page.route('**/api/studio/results?**', (route) =>
    route.fulfill({
      json: [
        {
          id: 'bbbbbbbbbbbbbbbb',
          kind: 'studio',
          projectId: 'x',
          projectName: 'Test',
          look: 'reference',
          quality: 'standard',
          createdAt: '2026-01-01T00:00:00Z',
          width: 1,
          height: 1,
          samples: 256,
          seconds: 41,
          device: 'OPTIX: Test GPU',
          viewProjection: [],
          hasMask: true,
          hasDepth: true,
        },
      ],
    }),
  );
  await page.route('**/api/studio/results/bbbbbbbbbbbbbbbb', (route) =>
    route.fulfill({ body: PNG, contentType: 'image/png' }),
  );
  await page.getByRole('button', { name: 'Close' }).first().click();
  await page.getByTestId('present-studio').click();
  await expect(page.getByTestId('studio-picture')).toBeVisible();
  await expect(page.getByText('256 samples · 41 s')).toBeVisible();
});
