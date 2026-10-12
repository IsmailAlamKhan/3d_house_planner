import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

type P = {
  levels: unknown[];
  stairs: unknown[];
  rooms: { id: string; name: string; floorMaterial: string; levelId: string }[];
  items: unknown[];
  walls: { materialInside: string }[];
};
const project = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __duplex: { getProject: () => unknown } }).__duplex.getProject(),
  ) as Promise<P>;

async function download(page: Page, click: () => Promise<void>): Promise<Buffer> {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), click()]);
  return readFileSync((await dl.path())!);
}

test('the whole journey: wizard → AI design (offline) → edit → place furniture → material → walkthrough → PDF and GLB', async ({
  page,
}) => {
  test.setTimeout(240_000);
  // Keep the AI step independent of any model installed on this machine.
  await page.addInitScript(() => {
    localStorage.setItem(
      'duplex-designer:ai-settings',
      JSON.stringify({
        provider: 'offline',
        model: 'qwen3:14b',
        openaiBaseUrl: '',
        openaiModel: '',
        timeoutSec: 20,
      }),
    );
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');

  // 1. Wizard: a 10 × 12 m shell, then hand over to the AI Assistant.
  await page.getByRole('button', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /AI Assistant/ }).click();
  await expect(page.getByRole('tab', { name: 'AI Assistant', selected: true })).toBeVisible();

  // 2. Generate offline and apply.
  await page
    .getByRole('textbox', { name: /Describe the home/ })
    .fill('3 bedroom duplex with open kitchen');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const card = page.getByTestId('ai-candidate').first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Design applied.')).toBeVisible();
  let p = await project(page);
  expect(p.levels).toHaveLength(2);
  expect(p.stairs).toHaveLength(1);
  expect(p.rooms.filter((r) => /bedroom/i.test(r.name)).length).toBeGreaterThanOrEqual(3);

  // 3. Edit by words.
  await page.getByRole('tab', { name: 'Edit' }).click();
  await page
    .getByRole('textbox', { name: /Say what to change/ })
    .fill('paint the living room sage');
  await page.getByRole('button', { name: 'Preview change' }).click();
  await expect(page.getByTestId('ai-preview')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('ai-preview').getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Done.')).toBeVisible();

  // 4. Place furniture by tapping an item and then the plan.
  const before = (await project(page)).items.length;
  await page.getByRole('tab', { name: 'Library' }).click();
  await page.getByRole('tab', { name: 'Other' }).click();
  await page.getByTestId('lib-plant').click();
  const living =
    p.rooms.find((r) => /living/i.test(r.name) && r.levelId === (p.levels[0] as never)) ??
    p.rooms[0]!;
  void living;
  const plan = (await page.locator('.plan-paper').boundingBox())!;
  // Try a few spots: the first free one takes the plant.
  for (const [fx, fy] of [
    [0.5, 0.45],
    [0.4, 0.5],
    [0.6, 0.4],
    [0.35, 0.35],
  ] as const) {
    await page.mouse.click(plan.x + plan.width * fx, plan.y + plan.height * fy);
    if ((await project(page)).items.length > before) break;
    await page.getByTestId('lib-plant').click();
  }
  await expect.poll(async () => (await project(page)).items.length).toBeGreaterThan(before);

  // 5. Change a floor material through the Properties panel.
  p = await project(page);
  const room = p.rooms.find((r) => r.levelId === (p.levels[0] as { id: string }).id)!;
  await page.evaluate(
    (id) =>
      (
        window as unknown as { __duplex: { select: (t: string, i: string[]) => void } }
      ).__duplex.select('room', [id]),
    room.id,
  );
  await page.getByRole('button', { name: /^Floor:/ }).click();
  await page.getByRole('button', { name: 'Dark walnut planks' }).click();
  await expect
    .poll(async () => (await project(page)).rooms.find((r) => r.id === room.id)?.floorMaterial)
    .toBe('floor-walnut');

  // 6. Walk through the 3D model.
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Walk', exact: true }).click();
  await expect(page.getByTestId('walk-hud')).toBeVisible();
  await page.keyboard.down('w');
  await page.waitForTimeout(1500);
  await page.keyboard.up('w');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('walk-hud')).toBeHidden();

  // 7. Export a PDF plan set and a GLB model.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('tab', { name: 'PDF plans' }).click();
  const pdf = await download(page, () =>
    page.getByRole('button', { name: 'Download PDF' }).click(),
  );
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  await page.getByRole('tab', { name: '3D model' }).click();
  const glb = await download(page, () => page.getByRole('button', { name: 'GLB' }).click());
  expect(glb.readUInt32LE(0)).toBe(0x46546c67);

  expect(errors).toEqual([]);
});
