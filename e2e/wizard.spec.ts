import { expect, test, type Page } from '@playwright/test';

type P = {
  levels: { floorToCeiling: number }[];
  stairs: unknown[];
  walls: unknown[];
  rooms: { name: string }[];
  openings: { kind: string; locked: boolean }[];
  shell: { footprint: unknown[]; windows: unknown[] };
};
const project = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __duplex: { getProject: () => unknown } }).__duplex.getProject(),
  ) as Promise<P>;

async function openWizard(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.getByRole('dialog', { name: 'New apartment shell' })).toBeVisible();
}

test('shell wizard: rectangle with a facade window and a template builds a duplex', async ({
  page,
}) => {
  await openWizard(page);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Upper floor ceiling')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /Add Existing facade windows/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByTestId('tpl-family-3br').click();

  const p = await project(page);
  expect(p.shell.footprint).toHaveLength(4);
  expect(p.levels).toHaveLength(2);
  expect(p.stairs).toHaveLength(1);
  expect(p.rooms.map((r) => r.name)).toEqual(expect.arrayContaining(['Living room', 'Kitchen']));
  expect(p.openings.filter((o) => o.kind === 'window' && o.locked).length).toBeGreaterThan(0);
});

test('shell wizard: too little height is refused with a warning', async ({ page }) => {
  await openWizard(page);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Slab-to-slab height (m)').fill('4.5');
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
});

test('checks: an empty shell reports an issue and clicking it selects the target', async ({
  page,
}) => {
  await openWizard(page);
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /Empty shell/ }).click();
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.getByRole('tab', { name: /Checks/ }).click();
  const issue = page.getByRole('list', { name: 'Checks' }).getByRole('button').first();
  await expect(issue).toBeVisible();
  await issue.click();
  await expect(page.locator('.plan-flash').first()).toBeVisible();
});
