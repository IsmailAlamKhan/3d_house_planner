import { expect, test, type Page } from '@playwright/test';

/** Maps plan coordinates (metres) to page pixels using the plan's current view transform. */
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

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '2D', exact: true }).click();
});

test('drag furniture from the library into the plan, then rotate, nudge, duplicate and delete it', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'Living' }).click();
  const at = await planPoint(page);
  const target = at(1.6, 2.0);
  await page
    .getByTestId('lib-sofa-2seat')
    .dragTo(page.getByTestId('plan-canvas'), { targetPosition: { x: target.x, y: target.y } });

  await expect(page.getByRole('heading', { name: 'Sofa (2-seat)' })).toBeVisible();
  const rotation = page.getByLabel('Rotation');
  await expect(rotation).toHaveValue('0°');

  await page.keyboard.press('r');
  await expect(rotation).toHaveValue('90°');

  const width = page.getByLabel('Width');
  await expect(width).toHaveValue('1.70 m');
  await width.fill('2');
  await width.press('Enter');
  await expect(page.getByLabel('Width')).toHaveValue('2.00 m');

  await page.getByTestId('plan-canvas').click({ position: { x: target.x, y: target.y } }); // keep focus off inputs
  await page.keyboard.press('Control+d');
  await expect(page.getByRole('heading', { name: 'Sofa (2-seat)' })).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(page.getByText('Select something to see its properties.')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z'); // undo the delete
  // Selection isn't part of undo history; click the restored copy (nudged 0.5 m from the original).
  const copy = at(1.6 + 0.5 + 0.25, 2.0 + 0.5);
  await page.getByTestId('plan-canvas').click({ position: { x: copy.x, y: copy.y } });
  await expect(page.getByRole('heading', { name: 'Sofa (2-seat)' })).toBeVisible();
});

test('windows snap onto walls (dimensions shown) and invalid drops are refused with a message', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'Windows' }).click();
  const at = await planPoint(page);
  // Free stretch of the south wall (y = 12) next to the existing small window.
  const wall = at(4.5, 12.0);
  await page
    .getByTestId('lib-window-fixed')
    .dragTo(page.getByTestId('plan-canvas'), { targetPosition: { x: wall.x, y: wall.y - 6 } });
  await expect(page.getByRole('heading', { name: 'Fixed window' })).toBeVisible();
  await expect(page.getByLabel('Sill height')).toHaveValue('1.00 m');

  // A door dropped in the middle of the living room is refused.
  await page.getByRole('tab', { name: 'Doors' }).click();
  const room = at(3.0, 2.0);
  await page
    .getByTestId('lib-door-single')
    .dragTo(page.getByTestId('plan-canvas'), { targetPosition: { x: room.x, y: room.y } });
  await expect(page.getByRole('status').filter({ hasText: /wall/i })).toBeVisible();
});

test('tap a library item, then tap where it goes (touch-friendly alternative to dragging)', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'Bedroom' }).click();
  await page.getByTestId('lib-wardrobe').click();
  await expect(page.getByText(/place the wardrobe/i)).toBeVisible();
  const at = await planPoint(page);
  const p = at(5.0, 11.2);
  const box = (await page.getByTestId('plan-canvas').boundingBox())!;
  await page.mouse.move(box.x + p.x, box.y + p.y);
  await page.mouse.click(box.x + p.x, box.y + p.y);
  await expect(page.getByRole('heading', { name: 'Wardrobe' })).toBeVisible();
  // Snapped against the south wall → faces the room (180°).
  await expect(page.getByLabel('Rotation')).toHaveValue('180°');
});

test('drag furniture into the 3D view: it lands on the floor of the active level', async ({
  page,
}) => {
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('tab', { name: 'Living' }).click();
  const canvas = page.getByTestId('scene-canvas');
  await expect(canvas.locator('canvas')).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.getByTestId('lib-armchair').dragTo(canvas.locator('canvas'), {
    targetPosition: { x: box.width / 2, y: box.height * 0.62 },
  });
  // The armchair was added (selection syncs to the Properties panel).
  await expect(page.getByRole('heading', { name: 'Armchair' })).toBeVisible();
});

test('drag a placed item to move it (snapped), and drag a door along its wall', async ({
  page,
}) => {
  const getProject = () =>
    page.evaluate(() =>
      (
        window as unknown as {
          __duplex: {
            getProject: () => {
              items: { catalogId: string; position: { x: number; y: number } }[];
              openings: { catalogId: string; offset: number }[];
            };
          };
        }
      ).__duplex.getProject(),
    );
  const at = await planPoint(page);
  const before = (await getProject()).items.find((i) => i.catalogId === 'sofa-3seat')!.position;
  const from = at(before.x, before.y);
  const to = at(before.x - 1.5, before.y - 1.0);
  const canvas = page.getByTestId('plan-canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 });
  await page.mouse.up();
  const after = (await getProject()).items.find((i) => i.catalogId === 'sofa-3seat')!.position;
  expect(after.x).toBeCloseTo(before.x - 1.5, 0);
  expect(after.y).toBeCloseTo(before.y - 1.0, 0);

  // Slide the entrance door (east wall, y = 9.5) up the wall by 0.5 m.
  const doorBefore = (await getProject()).openings.find(
    (o) => o.catalogId === 'door-entrance',
  )!.offset;
  const d0 = at(10, doorBefore);
  const d1 = at(10, doorBefore - 0.5);
  await page.mouse.move(box.x + d0.x, box.y + d0.y);
  await page.mouse.down();
  await page.mouse.move(box.x + d1.x, box.y + d1.y, { steps: 6 });
  await page.mouse.up();
  const doorAfter = (await getProject()).openings.find(
    (o) => o.catalogId === 'door-entrance',
  )!.offset;
  expect(doorAfter).toBeCloseTo(doorBefore - 0.5, 1);
});
