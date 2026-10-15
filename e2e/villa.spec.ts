import { expect, test, type Page } from '@playwright/test';

type P = {
  kind: string;
  levels: unknown[];
  stairs: unknown[];
  rooms: { name: string; type: string }[];
  items: { catalogId: string }[];
  site: {
    plot: unknown[];
    zones: { type: string; covered: boolean }[];
    gates: { kind: string }[];
  };
};
const project = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __duplex: { getProject: () => unknown } }).__duplex.getProject(),
  ) as Promise<P>;

test('villa: wizard → Luxury villa template → plot, zones, gates in 2D and 3D, checks, marketing light', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByTestId('kind-villa').click();
  await page.getByLabel('Width (m)', { exact: true }).fill('18');
  await page.getByLabel('Depth (m)', { exact: true }).fill('16');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('wiz-storeys')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByTestId('tpl-luxury-villa').click();

  const p = await project(page);
  expect(p.kind).toBe('villa');
  expect(p.levels).toHaveLength(1);
  expect(p.stairs).toHaveLength(0);
  expect(p.site.plot).toHaveLength(4);
  expect(p.site.zones.map((z) => z.type)).toEqual(
    expect.arrayContaining(['pool', 'deck', 'parking', 'lawn', 'garden', 'patio']),
  );
  expect(p.site.gates.map((g) => g.kind).sort()).toEqual(['pedestrian', 'vehicle']);
  expect(p.rooms.map((r) => r.type)).toEqual(
    expect.arrayContaining(['foyer', 'gym', 'sauna', 'spa', 'game-room']),
  );
  expect(p.items.some((i) => i.catalogId === 'car')).toBe(true);

  // 2D: the site is drawn and listed in the Levels panel.
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  await page.getByRole('tab', { name: /Levels/ }).click();
  await expect(page.getByText(/Site \(plot/)).toBeVisible();

  // Checks run and report in plain language.
  await page.getByRole('tab', { name: /Checks/ }).click();
  await expect(page.getByText(/error\(s\)|Everything checks out/)).toBeVisible();

  // 3D with the marketing look: no errors while the plot, pool and lights render.
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Light & quality' }).click();
  await page.getByRole('button', { name: 'Marketing render' }).click();
  await expect(page.getByRole('button', { name: 'Marketing render' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Light & quality' }).click();
  await page.getByRole('button', { name: 'Plan view' }).click();
  await page.waitForTimeout(1200);
  expect(errors).toEqual([]);
});

test('villa: the offline brief designs a villa on the plot', async ({ page }) => {
  test.setTimeout(180_000);
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
  await page.goto('/');
  await page.getByRole('button', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByTestId('kind-villa').click();
  await page.getByLabel('Width (m)', { exact: true }).fill('18');
  await page.getByLabel('Depth (m)', { exact: true }).fill('16');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /AI Assistant/ }).click();
  await page.getByRole('tab', { name: 'Describe it' }).click(); // the classic one-shot generator (the copilot is the other tab)
  await page
    .getByRole('textbox', { name: /Describe the home/ })
    .fill('luxury villa with pool, garden, 2-car garage, gym and sauna');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const card = page.getByTestId('ai-candidate').first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Design applied.')).toBeVisible();
  const p = await project(page);
  expect(p.rooms.map((r) => r.type)).toEqual(expect.arrayContaining(['foyer', 'gym', 'sauna']));
  expect(p.site.zones.map((z) => z.type)).toEqual(expect.arrayContaining(['pool', 'parking']));
});
