import { expect, test } from '@playwright/test';

test('app loads with a 3D canvas', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('scene-canvas').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('plan-canvas')).toHaveCount(0);
});

test('levels panel: add a level, then undo with the keyboard', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Levels' }).click();
  const level3 = page.getByRole('button', { name: 'Active level: Level 3' });
  await page.getByRole('button', { name: 'Add level' }).click();
  await expect(level3).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(level3).toHaveCount(0);
});

test('2D editor: draw a 4 × 3 m room with typed lengths and see its area', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.getByRole('tab', { name: 'Levels' }).click();
  await page.getByRole('button', { name: 'Add level' }).click(); // empty level
  const canvas = page.getByTestId('plan-canvas');
  const box = (await canvas.boundingBox())!;
  const t = (await canvas.locator('g').first().getAttribute('transform'))!;
  const [tx, ty, s] = t.match(/-?[\d.]+/g)!.map(Number) as [number, number, number];
  const at = (wx: number, wy: number) => ({ x: box.x + tx! + wx * s!, y: box.y + ty! + wy * s! });
  const move = async (wx: number, wy: number) => {
    const p = at(wx, wy);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  };
  await page.keyboard.press('w');
  await move(3, 3);
  await page.mouse.down();
  await page.mouse.up();
  for (const [wx, wy, len] of [
    [7, 3, '4'],
    [7, 6, '3'],
    [3, 6, '4'],
    [3, 3, '3'],
  ] as const) {
    await move(wx, wy);
    await page.keyboard.type(len);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.press('Escape');
  await expect(page.getByText('12.0 m²')).toBeVisible();
  await expect(page.getByText('Room 1')).toBeVisible();

  // Select one wall and delete it: the room is no longer closed.
  await page.keyboard.press('v');
  await page.keyboard.press('Escape');
  const mid = at(5, 3);
  await page.mouse.click(mid.x, mid.y);
  await expect(page.getByRole('heading', { name: /^wall$/i })).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(page.getByText('12.0 m²')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByText('12.0 m²')).toBeVisible();
});
