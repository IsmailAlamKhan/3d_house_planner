import { expect, test, type Page } from '@playwright/test';

// The image service (ComfyUI) needs a GPU, so these tests mock the app server's /api/render routes.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const ID = 'a1b2c3d4e5f60718';

async function openEnhance(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByTestId('present-button').click();
  await page.getByTestId('present-cutaway-top').click();
  await page.getByTestId('present-enhance').click();
  await expect(page.getByRole('dialog', { name: 'Enhance render (AI)' })).toBeVisible();
}

test('enhance: without the render profile the button is disabled and says how to enable it', async ({
  page,
}) => {
  await page.route('**/api/health', (r) =>
    r.fulfill({ json: { app: 'ok', render: { configured: false, reachable: false } } }),
  );
  await openEnhance(page);
  await expect(page.getByTestId('enhance-run')).toBeDisabled();
  const note = page.getByTestId('enhance-unavailable');
  await expect(note).toContainText('docker compose --profile render up -d');
  // The presentation render itself still works.
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('present-export')).toBeEnabled();
});

test('enhance: sends the unlabeled render, depth and edge passes, shows queue and progress, then a before/after result', async ({
  page,
}) => {
  test.setTimeout(180_000);
  type Req = {
    projectId: string;
    params: { prompt: string; creativity: number; steps: number; seed: number };
    images: Record<'color' | 'depth' | 'edge', string>;
    view: { viewProjection: number[]; width: number; height: number };
    labels: { title: string }[];
  };
  let request: Req | null = null;
  let polls = 0;
  let done = false;
  await page.route('**/api/health', (r) =>
    r.fulfill({ json: { app: 'ok', render: { configured: true, reachable: true } } }),
  );
  await page.route('**/api/render/enhance', (r) => {
    request = r.request().postDataJSON() as Req;
    return r.fulfill({ status: 202, json: { id: ID } });
  });
  await page.route(`**/api/render/jobs/${ID}`, (r) => {
    polls++;
    const body =
      polls === 1
        ? { id: ID, status: 'queued', ahead: 1, gpuBusyWith: 'design', progress: null }
        : polls === 2
          ? {
              id: ID,
              status: 'running',
              ahead: 0,
              gpuBusyWith: 'render',
              progress: { step: 3, max: 10 },
            }
          : {
              id: ID,
              status: 'done',
              ahead: 0,
              gpuBusyWith: null,
              progress: { step: 10, max: 10 },
            };
    if (polls >= 3) done = true;
    return r.fulfill({ json: body });
  });
  await page.route('**/api/render/results?*', (r) => {
    const meta = () => ({
      id: ID,
      projectId: request?.projectId ?? 'p',
      projectName: 'Sample duplex',
      createdAt: new Date().toISOString(),
      params: request?.params ?? { seed: 1, creativity: 0.35, steps: 28, prompt: 'x' },
      width: 1024,
      height: 768,
      hasEdge: true,
      view: request?.view ?? { viewProjection: new Array(16).fill(0), width: 1024, height: 768 },
      labels: request?.labels ?? [],
      workflow: 1,
    });
    return r.fulfill({ json: done ? [meta()] : [] });
  });
  await page.route(`**/api/render/results/${ID}`, (r) =>
    r.fulfill({ body: TINY_PNG, contentType: 'image/png' }),
  );
  await page.route(`**/api/render/results/${ID}/before`, (r) =>
    r.fulfill({ body: TINY_PNG, contentType: 'image/png' }),
  );

  await openEnhance(page);
  await expect(page.getByTestId('enhance-prompt')).toHaveValue(/top-down architectural cutaway/);
  await expect(page.getByTestId('enhance-prompt')).toHaveValue(/luxury modern interior/);
  await page.getByTestId('enhance-run').click();
  await expect(page.getByTestId('enhance-status')).toContainText(
    '1 job(s) ahead (an AI design is running)',
    {
      timeout: 60_000,
    },
  );
  await expect(page.getByTestId('enhance-status')).toContainText('step 3 / 10');
  await expect(page.getByTestId('before-after')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('before-after-slider')).toBeVisible();
  await expect(page.getByTestId('enhance-rerun')).toBeVisible();

  const req = request!;
  expect(req.params).toMatchObject({ creativity: 0.35, steps: 28 });
  expect(req.params.prompt.length).toBeGreaterThan(20);
  for (const k of ['color', 'depth', 'edge'] as const) {
    expect(req.images[k]).toMatch(/^data:image\/png;base64,/);
    const bytes = Buffer.from(req.images[k].split(',')[1], 'base64');
    expect(bytes.readUInt32BE(16)).toBeGreaterThan(0);
  }
  const width = Buffer.from(req.images.color.split(',')[1], 'base64').readUInt32BE(16);
  const height = Buffer.from(req.images.color.split(',')[1], 'base64').readUInt32BE(20);
  expect(Math.max(width, height)).toBeGreaterThanOrEqual(1000); // about 1024 on the long side
  expect(req.view.viewProjection).toHaveLength(16);
  // Labels are sent as data for re-application, never baked into the picture.
  expect(req.labels.length).toBeGreaterThan(0);
  expect(req.labels[0]).toMatchObject({ title: expect.any(String) });
});
