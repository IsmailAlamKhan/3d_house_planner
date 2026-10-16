import { expect, test, type Page } from '@playwright/test';
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { minimalGlb } from '../src/custom/minimalGlb';

// The user's own models and textures live on the app server (/api/assets), so these tests run against the real
// server (static build + API + data folder), not `vite preview`.
const PORT = 4182;
const URL = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;

test.beforeAll(async () => {
  server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: mkdtempSync(join(tmpdir(), 'dd-e2e-custom-')),
      OLLAMA_URL: 'http://127.0.0.1:9',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${URL}/api/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('The app server did not start');
});
test.afterAll(() => void server?.kill());

type P = {
  items: { id: string; catalogId: string }[];
  walls: {
    id: string;
    start: { x: number; y: number };
    end: { x: number; y: number };
    materialInside: string;
  }[];
};
const project = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __duplex: { getProject: () => unknown } }).__duplex.getProject(),
  ) as Promise<P>;

async function planPoint(page: Page) {
  const canvas = page.getByTestId('plan-canvas');
  const box = (await canvas.boundingBox())!;
  const t = (await canvas.locator('g').first().getAttribute('transform'))!;
  const [tx, ty, s] = t.match(/-?[\d.]+/g)!.map(Number) as [number, number, number];
  return (wx: number, wy: number) => ({
    x: tx + wx * s,
    y: ty + wy * s,
    abs: { x: box.x + tx + wx * s, y: box.y + ty + wy * s },
  });
}

async function open(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem('duplex-designer:prefs', JSON.stringify({ tourSeen: true })),
  );
  await page.goto(URL);
  await page.getByRole('button', { name: '2D', exact: true }).click();
}

// A 2 × 2 px PNG (any real picture works: the server checks the bytes, not the name).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mNk+M/wn4EIwDiqEF8oAAA9ugX9d8d+6AAAAABJRU5ErkJggg==',
  'base64',
);

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

test('add your own 3D model, find it under My items, place it, and it is still there after a reload', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('add-custom-model').click();
  const glb = minimalGlb(0.8, 0.9, 0.7);
  await page.getByTestId('custom-model-file').setInputFiles({
    name: 'my-chair.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(glb),
  });
  // The name comes from the file name, the size from the model itself.
  await expect(page.getByTestId('custom-model-name')).toHaveValue('my chair');
  await expect(page.getByTestId('custom-model-h')).toHaveValue('0.9');
  await expect(page.getByTestId('custom-model-w')).toHaveValue('0.8');
  await page.getByTestId('custom-model-name').fill('Test chair');
  // Changing one size keeps the proportions.
  await page.getByTestId('custom-model-h').fill('1.8');
  await expect(page.getByTestId('custom-model-w')).toHaveValue('1.6');
  await page.getByTestId('custom-model-h').fill('0.9');
  await page.getByTestId('custom-model-save').click();
  await expect(page.getByText('Added “Test chair”.')).toBeVisible();

  await page.getByRole('tab', { name: 'My items' }).click();
  const card = page.getByTestId(/^lib-custom:/);
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Test chair');

  const at = await planPoint(page);
  const target = at(1.6, 2.0);
  await card.dragTo(page.getByTestId('plan-canvas'), {
    targetPosition: { x: target.x, y: target.y },
  });
  await expect(page.getByRole('heading', { name: 'Test chair' })).toBeVisible();
  const placed = (await project(page)).items.filter((i) => i.catalogId.startsWith('custom:'));
  expect(placed).toHaveLength(1);

  // Stored on the server: a reload brings back both the library entry and the placed copy.
  await page.waitForTimeout(1500); // let the autosave run
  await page.reload();
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await expect
    .poll(async () => (await project(page)).items.some((i) => i.catalogId === placed[0]!.catalogId))
    .toBe(true);
  await page.getByRole('tab', { name: 'My items' }).click();
  await expect(page.getByTestId(/^lib-custom:/)).toHaveCount(1);
});

test('upload a texture, it is applied to the wall at once, and it can be deleted again', async ({
  page,
}) => {
  await open(page);
  const at = await planPoint(page);
  const p = at(6, 1.0); // the partition between the living room and the kitchen, away from the door
  // Under load the first click can land before the plan has settled: click again until the wall's properties show.
  await expect(async () => {
    await page.mouse.click(p.abs.x, p.abs.y);
    await expect(page.getByRole('button', { name: /^Inside finish:/ })).toBeVisible({
      timeout: 3000,
    });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: /^wall$/i })).toBeVisible();

  await page.getByRole('button', { name: /^Inside finish:/ }).click();
  await page.getByTestId('upload-texture').click();
  await page.getByTestId('custom-texture-file').setInputFiles({
    name: 'blue-tiles.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(page.getByTestId('custom-texture-name')).toHaveValue('blue tiles');
  await page.getByTestId('custom-texture-name').fill('Test tiles');
  await page.getByTestId('custom-texture-scale').fill('0.5');
  await page.getByTestId('custom-texture-save').click();
  await expect(page.getByText('Added “Test tiles”.')).toBeVisible();

  // The wall now uses it, and it appears under "My textures".
  await expect
    .poll(async () =>
      (await project(page)).walls.some(
        (w) => w.start.x === 6 && w.end.x === 6 && /^tex:[a-f0-9]{16}$/.test(w.materialInside),
      ),
    )
    .toBe(true);
  // (the picker stays open after the upload)
  await expect(page.getByTestId(/^mat-tex:/)).toHaveCount(1);

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete Test tiles' }).click({ force: true });
  await expect(page.getByText('Deleted “Test tiles”.')).toBeVisible();
  await expect(page.getByTestId(/^mat-tex:/)).toHaveCount(0);
});
