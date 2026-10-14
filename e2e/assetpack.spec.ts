import { expect, test, type Page, type Route } from '@playwright/test';

// A tiny fake pack: one texture set, one model (an empty but valid glb). Proves the app starts, switches and falls back
// without errors whether the pack is there or not. The real pack is exercised by the GPU tests (`npm run test:gpu`).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
function emptyGlb(): Buffer {
  const json = Buffer.from(
    '{"asset":{"version":"2.0"},"scenes":[{"nodes":[]}],"scene":0}'.padEnd(68, ' '),
  );
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + json.length, 8);
  head.writeUInt32LE(json.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, json]);
}
const index = {
  version: 1,
  generated: '2026-01-01T00:00:00Z',
  models: [
    {
      id: 'kn-wc',
      catalogId: 'wc',
      file: 'models/kn-wc.glb',
      size: { w: 0.4, d: 0.7, h: 0.75 },
      recolor: [],
      lod: 0,
    },
  ],
  textures: [{ id: 'acg-test', materialId: 'floor-marble', scale: 1.2, albedo: 'textures/a.png' }],
  hdris: [],
};

async function fakePack(page: Page): Promise<void> {
  await page.route('**/pack/**', (route: Route) => {
    const url = route.request().url();
    if (url.endsWith('pack.json')) return route.fulfill({ json: index });
    if (url.endsWith('.glb'))
      return route.fulfill({ body: emptyGlb(), contentType: 'model/gltf-binary' });
    return route.fulfill({ body: PNG, contentType: 'image/png' });
  });
}

const errors = (page: Page): string[] => {
  const out: string[] = [];
  page.on('pageerror', (e) => out.push(e.message));
  page.on(
    'console',
    (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && out.push(m.text()),
  );
  return out;
};

async function openQuality(page: Page): Promise<void> {
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Light & quality' }).click();
}

test('with a pack: the real models and textures can be switched off and on, and the choice is kept', async ({
  page,
}) => {
  const errs = errors(page);
  await fakePack(page);
  await page.goto('/');
  await openQuality(page);
  const box = page.getByRole('checkbox', { name: 'Real 3D models and textures' });
  await expect(box).toBeEnabled();
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect(box).not.toBeChecked();
  await page.reload();
  await openQuality(page);
  await expect(
    page.getByRole('checkbox', { name: 'Real 3D models and textures' }),
  ).not.toBeChecked();
  expect(errs).toEqual([]);
});

test('without a pack: the app runs on the built-in models with no errors and the switch is disabled', async ({
  page,
}) => {
  const errs = errors(page);
  await page.route('**/pack/**', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/');
  await openQuality(page);
  await expect(page.getByRole('checkbox', { name: 'Real 3D models and textures' })).toBeDisabled();
  expect(errs).toEqual([]);
});
