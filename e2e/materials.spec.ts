import { expect, test, type Page } from '@playwright/test';

type P = {
  walls: {
    id: string;
    start: { x: number; y: number };
    end: { x: number; y: number };
    levelId: string;
    materialInside: string;
    materialOutside: string;
  }[];
  rooms: { name: string; levelId: string; floorMaterial: string }[];
  levels: { id: string }[];
  settings: { compass: number };
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
  return (wx: number, wy: number) => ({ x: box.x + tx + wx * s, y: box.y + ty + wy * s });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '2D', exact: true }).click();
});

test('pick a wall finish from the swatch grid and copy it to the whole room', async ({ page }) => {
  const at = await planPoint(page);
  // Click the partition between the living room and the kitchen (x = 6) high up, away from the door.
  const p = at(6, 1.0);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByRole('heading', { name: /^wall$/i })).toBeVisible();

  const wallId = (await project(page)).walls.find(
    (w) => w.start.x === 6 && w.end.x === 6 && w.start.y === 0,
  )!.id;
  await page.getByRole('button', { name: /^Inside finish:/ }).click();
  await page.getByRole('button', { name: 'Striped wallpaper' }).click();
  expect((await project(page)).walls.find((w) => w.id === wallId)!.materialInside).toBe(
    'wallpaper-stripes',
  );

  // Living room is on the wall's left (inside) face → paint every wall of that room.
  await page.getByRole('button', { name: 'Same for this room' }).first().click();
  const after = await project(page);
  const north = after.walls.find(
    (w) =>
      w.start.x === 0 && w.start.y === 0 && w.end.x === 10 && w.levelId === after.levels[0]!.id,
  )!;
  expect(north.materialInside).toBe('wallpaper-stripes');
  const south = after.walls.find((w) => w.start.x === 10 && w.start.y === 12)!; // not around the living room
  expect(south.materialInside).not.toBe('wallpaper-stripes');
});

test('eyedropper: copy a floor material from one room and paint another', async ({ page }) => {
  const at = await planPoint(page);
  const before = await project(page);
  const level0 = before.levels[0]!.id;
  const floorOf = (p: P, name: string) =>
    p.rooms.find((r) => r.name === name && r.levelId === level0)!.floorMaterial;
  // Give the study a distinctive floor first, via the picker.
  const study = at(5, 10.5);
  await page.mouse.click(study.x, study.y);
  await page.getByRole('button', { name: /^Floor:/ }).click();
  await page.getByRole('button', { name: 'Herringbone parquet' }).click();
  expect(floorOf(await project(page), 'Study')).toBe('floor-herringbone');

  await page.keyboard.press('Escape');
  await page.keyboard.press('i'); // eyedropper
  await page.mouse.click(study.x, study.y); // copy
  await expect(page.getByRole('status').filter({ hasText: /Copied/ })).toBeVisible();
  const bath = at(1.5, 9.5);
  await page.mouse.click(bath.x, bath.y); // paint the bathroom
  expect(floorOf(await project(page), 'Bathroom')).toBe('floor-herringbone');
  await page.keyboard.press('ControlOrMeta+z');
  expect(floorOf(await project(page), 'Bathroom')).not.toBe('floor-herringbone');
});

test('3D light & quality panel: presets, time of day, compass and quality', async ({ page }) => {
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Light & quality' }).click();
  const panel = page.getByRole('dialog', { name: 'Light & quality' });
  await panel.getByRole('button', { name: 'Evening' }).click();
  await expect(panel.getByText('19:00')).toBeVisible();
  await panel.getByRole('button', { name: 'Night' }).click();
  await expect(panel.getByText('Night', { exact: true }).nth(1)).toBeVisible();
  await panel.getByRole('button', { name: 'Morning' }).click();
  await expect(panel.getByText('08:00')).toBeVisible();

  const time = panel.getByRole('slider', { name: 'Time of day' });
  await time.focus();
  await time.press('ArrowRight');
  await expect(panel.getByText('08:15')).toBeVisible();

  const compass = panel.getByRole('slider', { name: 'Which way the plan faces' });
  await compass.focus();
  for (let i = 0; i < 5; i++) await compass.press('ArrowRight');
  await compass.press('Tab'); // release = commit to the project
  // (Software GL renders slowly, so leave the 3D view before reading the model back.)
  await panel.getByRole('combobox').selectOption('low');
  await panel.getByRole('checkbox').check();
  await expect(panel.getByText(/\d+ fps/)).toBeVisible();
  await page.getByRole('button', { name: '2D', exact: true }).click();
  expect((await project(page)).settings.compass).toBe(5);
});
