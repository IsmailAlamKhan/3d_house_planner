import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

type P = { items: { catalogId: string }[] };
const project = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __duplex: { getProject: () => unknown } }).__duplex.getProject(),
  ) as Promise<P>;

test.describe.configure({ mode: 'serial' });

test('presentation: a labelled dusk cutaway exported at 2× in three clicks', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const canvas = page.getByTestId('scene-canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;

  await page.getByTestId('present-button').click(); //                  click 1
  await page.getByTestId('present-cutaway-top').click(); //             click 2
  await expect(page.getByTestId('present-labels')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dusk', exact: true }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.getByTestId('present-export').click(), //                      click 3 (2× is the default)
  ]);
  expect(dl.suggestedFilename()).toMatch(/\.png$/);
  const png = readFileSync((await dl.path())!);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  const width = png.readUInt32BE(16);
  expect(width).toBeGreaterThanOrEqual(Math.floor(box.width) * 2 - 4);
  expect(errors).toEqual([]);
});

test('presentation: the experimental browser path tracer (?debug=render) reports progress and can be cancelled', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto('/?debug=render');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByTestId('present-button').click();
  await page.getByTestId('present-cutaway-34').click();
  let downloaded = false;
  page.on('download', () => (downloaded = true));
  await page.getByTestId('present-still').click();
  await expect(page.getByTestId('present-progress')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('present-samples')).toContainText('/ 200');
  await page.getByTestId('present-cancel').click();
  await expect(page.getByTestId('present-still')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(500);
  expect(downloaded).toBe(false);
});

test('auto-decorate furnishes the rooms in one undoable step', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const before = (await project(page)).items.length;
  await page.getByTestId('present-button').click();
  await page.getByTestId('present-decorate').click();
  await expect.poll(async () => (await project(page)).items.length).toBeGreaterThan(before);
  await page.getByTestId('scene-canvas').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await project(page)).items.length).toBe(before);
});
