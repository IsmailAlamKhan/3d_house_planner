import { expect, test, type Page } from '@playwright/test';

type Cam = {
  mode: string;
  walker: { x: number; y: number; floor: number } | null;
  measurements: unknown[];
};
const cam = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __duplex: { getCamera: () => unknown } }).__duplex.getCamera(),
  ) as Promise<Cam>;
const project = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __duplex: { getProject: () => unknown } }).__duplex.getProject(),
  ) as Promise<{ views: { name: string; thumbnail?: string }[] }>;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
});

/** Holds keys until the walker's position satisfies `done` (frame rates in CI are low, so never rely on elapsed time). */
async function holdUntil(
  page: Page,
  keys: string[],
  done: (w: { x: number; y: number }) => boolean,
  timeout = 15_000,
) {
  for (const k of keys) await page.keyboard.down(k);
  try {
    await expect.poll(async () => done((await cam(page)).walker!), { timeout }).toBe(true);
  } finally {
    for (const k of keys) await page.keyboard.up(k);
  }
}

test('walkthrough: starts at the entrance, WASD moves, walls stop you, Esc exits', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Walk', exact: true }).click();
  await expect(page.getByTestId('walk-hud')).toBeVisible();
  await page.waitForTimeout(300);
  const start = (await cam(page)).walker!;
  expect(start.x).toBeGreaterThan(8);

  // Strafe left along the entrance hall (facing west, "A" moves toward the south wall).
  await holdUntil(page, ['a'], (w) => w.y > start.y + 0.5);

  // Keep pushing against the south wall: it stops us inside the building.
  await page.keyboard.down('a');
  await page.waitForTimeout(5000);
  await page.keyboard.up('a');
  const end = (await cam(page)).walker!;
  expect(end.y).toBeLessThan(12);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('walk-hud')).toBeHidden();
  expect((await cam(page)).mode).toBe('orbit');
});

test('walkthrough: walk through the door, up the stairs and arrive on the upper level', async ({
  page,
}) => {
  // Start just north of the stair hall door, facing south (yaw π), then walk forward.
  await page.evaluate(() =>
    (
      window as unknown as {
        __duplex: { getCamera: () => { setWalker: (w: unknown) => void } };
      }
    ).__duplex
      .getCamera()
      .setWalker({ x: 8.5, y: 6.3, floor: 0, yaw: Math.PI, pitch: 0 }),
  );
  await page.getByRole('button', { name: 'Walk', exact: true }).click();
  await expect(page.getByTestId('walk-hud')).toBeVisible();
  await page.keyboard.down('w');
  try {
    await expect
      .poll(async () => (await cam(page)).walker!.floor, { timeout: 60_000, intervals: [500] })
      .toBeGreaterThan(2.8);
  } finally {
    await page.keyboard.up('w');
  }
  // The level indicator follows the stair.
  await expect(page.getByTestId('walk-hud')).toHaveAttribute('data-level', '1');
});

test('walkthrough: clicking the minimap teleports you to that spot', async ({ page }) => {
  await page.getByRole('button', { name: 'Walk', exact: true }).click();
  await page.waitForTimeout(300);
  const map = page.getByTestId('minimap');
  const box = (await map.boundingBox())!;
  await map.click({ position: { x: box.width * 0.4, y: box.height * 0.4 } });
  await page.waitForTimeout(400);
  const w = (await cam(page)).walker!;
  expect(w.x).toBeLessThan(8);
  expect(w.floor).toBe(0);
});

test('camera modes and standard views', async ({ page }) => {
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  await expect.poll(async () => (await cam(page)).mode).toBe('top');
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  await expect.poll(async () => (await cam(page)).mode).toBe('orbit');
  await page.getByRole('button', { name: 'Isometric', exact: true }).click();
  await expect(page.getByTestId('scene-canvas').locator('canvas')).toBeVisible();
});

test('section tools: horizontal and vertical cuts add clipping caps', async ({ page }) => {
  await page.getByRole('button', { name: 'Section' }).click();
  await page.getByLabel('Horizontal cut').check();
  await page.getByLabel('Vertical cut').check();
  await expect(page.getByLabel('Cut height')).toBeVisible();
  await expect(page.getByLabel('Cut position')).toBeVisible();
  const s = await page.evaluate(
    () =>
      (
        window as unknown as { __duplex: { getCamera: () => { section: unknown } } }
      ).__duplex.getCamera().section,
  );
  expect(s).toMatchObject({ horizontal: { on: true }, vertical: { on: true } });
});

test('saved views are stored in the project with a thumbnail and can be removed', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Save this view' }).click();
  await page.getByLabel('View name').fill('Kitchen from living room');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('saved-view')).toHaveCount(1);
  const p = await project(page);
  expect(p.views[0]!.name).toBe('Kitchen from living room');
  expect(p.views[0]!.thumbnail).toMatch(/^data:image\/jpeg/);
  await page
    .getByRole('button', { name: /Delete view/ })
    .first()
    .click({ force: true });
  await expect(page.getByTestId('saved-view')).toHaveCount(0);
});

test('isolation and x-ray controls', async ({ page }) => {
  await page.getByRole('button', { name: 'Isolate' }).click();
  await page.getByRole('button', { name: 'Only this level' }).click();
  await page.getByRole('button', { name: /X-ray/ }).click();
  const c = await page.evaluate(() =>
    (
      window as unknown as { __duplex: { getCamera: () => { isolation: unknown; xray: boolean } } }
    ).__duplex.getCamera(),
  );
  expect(c.xray).toBe(true);
  expect(c.isolation).toMatchObject({ kind: 'level' });
});

test('measure: two clicks on surfaces give a labelled 3D distance', async ({ page }) => {
  await page.getByRole('button', { name: 'Measure distance' }).click();
  const canvas = page.getByTestId('scene-canvas').locator('canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.6);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.7);
  await expect.poll(async () => (await cam(page)).measurements.length).toBe(1);
  await expect(page.getByTestId('measure-label')).toContainText('m');
  await page.getByRole('button', { name: 'Clear measurements' }).click();
  await expect(page.getByTestId('measure-label')).toHaveCount(0);
});
