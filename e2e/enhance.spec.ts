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
  await expect(note).toContainText('docker compose up -d');
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
  await page.getByTestId('enhance-preset-classic').click(); // the first pipeline: the live view's own render, depth and edges
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

// ── Enhance v2 ──
const STUDIO_ID = 'bbbbbbbbbbbbbbbb';
const studioMeta = {
  id: STUDIO_ID,
  kind: 'studio',
  projectId: 'x',
  projectName: 'Sample duplex',
  look: 'reference',
  quality: 'standard',
  createdAt: '2026-01-01T00:00:00Z',
  width: 1450,
  height: 1920,
  samples: 256,
  seconds: 90,
  device: 'OPTIX: Test GPU',
  viewProjection: [0.1, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 1],
  hasMask: true,
  hasDepth: true,
};
const caps = {
  checkpoints: ['sd_xl_base_1.0.safetensors', 'realvisxl.safetensors'],
  styleReference: true,
  tiledUpscale: true,
};

test('enhance v2: the Reference villa look sends the latest studio render by name with the style picture and the tuned settings', async ({
  page,
}) => {
  test.setTimeout(120_000);
  let request: Record<string, unknown> | null = null;
  await page.route('**/api/health', (r) =>
    r.fulfill({
      json: { app: 'ok', render: { configured: true, reachable: true, capabilities: caps } },
    }),
  );
  await page.route('**/api/studio/results?*', (r) => r.fulfill({ json: [studioMeta] }));
  await page.route('**/api/render/results?*', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/render/enhance', (r) => {
    request = r.request().postDataJSON() as Record<string, unknown>;
    return r.fulfill({ status: 202, json: { id: ID } });
  });
  await page.route(`**/api/render/jobs/${ID}`, (r) =>
    r.fulfill({
      json: {
        id: ID,
        status: 'running',
        ahead: 0,
        gpuBusyWith: 'render',
        progress: { step: 4, max: 26 },
      },
    }),
  );
  await page.route('**/reference/villa-reference.png', (r) =>
    r.fulfill({ body: TINY_PNG, contentType: 'image/png' }),
  );
  await openEnhance(page);
  await expect(page.getByTestId('enhance-preset-reference')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('enhance-source')).toHaveValue('studio');
  await expect(page.getByTestId('enhance-regions')).toBeChecked();
  // the presets change the settings
  await page.getByTestId('enhance-preset-subtle').click();
  await expect(page.getByTestId('enhance-regions')).not.toBeChecked();
  await page.getByTestId('enhance-preset-reference').click();
  await page.getByTestId('enhance-style-ref').selectOption('reference');
  await page.getByTestId('enhance-run').click();
  await expect(page.getByTestId('enhance-status')).toContainText('step 4 / 26', {
    timeout: 60_000,
  });
  const req = request as unknown as {
    source: { kind: string; id: string };
    style: string;
    images?: unknown;
    params: Record<string, unknown>;
  };
  expect(req.source).toEqual({ kind: 'studio', id: STUDIO_ID });
  expect(req.images).toBeUndefined(); // nothing big is sent: the studio render stays on the server
  expect(req.style).toMatch(/^data:image\/png;base64,/);
  expect(req.params).toMatchObject({
    pipeline: 'v2',
    preset: 'reference',
    creativity: 0.38,
    controlStrength: 0.8,
    edgeStrength: 0.45,
    ipWeight: 0.75,
    regions: true,
    layoutCheck: true,
  });
});

test('enhance v2: without a studio render the live view is used and the user is told', async ({
  page,
}) => {
  test.setTimeout(120_000);
  let request: { images?: Record<string, string>; source?: unknown } | null = null;
  await page.route('**/api/health', (r) =>
    r.fulfill({
      json: { app: 'ok', render: { configured: true, reachable: true, capabilities: caps } },
    }),
  );
  await page.route('**/api/studio/results?*', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/render/results?*', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/render/enhance', (r) => {
    request = r.request().postDataJSON() as typeof request;
    return r.fulfill({ status: 202, json: { id: ID } });
  });
  await page.route(`**/api/render/jobs/${ID}`, (r) =>
    r.fulfill({
      json: {
        id: ID,
        status: 'running',
        ahead: 0,
        gpuBusyWith: 'render',
        progress: { step: 1, max: 26 },
      },
    }),
  );
  await openEnhance(page);
  await page.getByTestId('enhance-preset-subtle').click();
  await page.getByTestId('enhance-run').click();
  await expect(page.getByTestId('enhance-no-studio')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => request?.images?.color ?? '').toMatch(/^data:image\/png/);
  const sent = request as { images?: Record<string, string>; source?: unknown } | null;
  expect(sent?.source).toBeUndefined();
  expect(sent?.images?.depth).toMatch(/^data:image\/png/);
});

test('enhance v2: the result shows how much of the layout was kept, a retry, a drift warning and the style reference', async ({
  page,
}) => {
  const meta = (layout: number, retries: number) => ({
    id: ID,
    projectId: 'p',
    projectName: 'Sample duplex',
    createdAt: new Date().toISOString(),
    params: { seed: 1, creativity: 0.27, steps: 26, prompt: 'x', ipWeight: 0.75, pipeline: 'v2' },
    width: 1024,
    height: 768,
    hasEdge: false,
    view: { viewProjection: new Array(16).fill(0), width: 1024, height: 768 },
    labels: [],
    workflow: 2,
    pipeline: 'v2',
    layoutScore: layout,
    retries,
  });
  let current = meta(0.97, 1);
  await page.route('**/api/health', (r) =>
    r.fulfill({
      json: { app: 'ok', render: { configured: true, reachable: true, capabilities: caps } },
    }),
  );
  await page.route('**/api/render/results?*', (r) => r.fulfill({ json: [current] }));
  for (const sub of ['', '/before', '/style'])
    await page.route(`**/api/render/results/${ID}${sub}`, (r) =>
      r.fulfill({ body: TINY_PNG, contentType: 'image/png' }),
    );
  await openEnhance(page);
  await expect(page.getByTestId('enhance-layout')).toContainText('Layout kept: 97 %');
  await expect(page.getByTestId('enhance-layout')).toContainText('retried 1× with less creativity');
  await expect(page.getByTestId('enhance-reference')).toBeVisible();
  await expect(page.getByTestId('enhance-layout')).not.toContainText('may have drifted');
  current = meta(0.4, 2);
  await page.getByRole('button', { name: 'Close' }).first().click();
  await page.getByTestId('present-enhance').click();
  await expect(page.getByTestId('enhance-layout')).toContainText('may have drifted');
});
