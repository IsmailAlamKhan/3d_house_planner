import { expect, test, type Page } from '@playwright/test';

type P = {
  levels: unknown[];
  stairs: unknown[];
  openings: { kind: string }[];
  rooms: { name: string }[];
  items: unknown[];
};
const project = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __duplex: { getProject: () => unknown } }).__duplex.getProject(),
  ) as Promise<P>;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.getByRole('tab', { name: 'AI Assistant' }).click();
});

test('with no model running, "2 bedroom duplex with open kitchen" falls back to the offline generator and builds a valid duplex', async ({
  page,
}) => {
  await page
    .getByRole('textbox', { name: /Describe the home/ })
    .fill('2 bedroom duplex with open kitchen');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const card = page.getByTestId('ai-candidate').first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByTestId('ai-source')).toHaveText('Offline generator');
  await expect(card.getByText(/not reachable/)).toBeVisible();
  await expect(card.getByText(/2 bedroom\(s\)/)).toBeVisible();
  await card.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Design applied.')).toBeVisible();

  const p = await project(page);
  expect(p.levels).toHaveLength(2);
  expect(p.stairs).toHaveLength(1);
  expect(p.openings.some((o) => o.kind === 'door')).toBe(true);
  expect(p.openings.some((o) => o.kind === 'window')).toBe(true);
  expect(p.rooms.map((r) => r.name)).toEqual(
    expect.arrayContaining(['Living room', 'Kitchen', 'Master bedroom']),
  );

  await page.keyboard.press('ControlOrMeta+z'); // the whole design is ONE undo step
  const back = await project(page);
  expect(back.rooms.map((r) => r.name)).toContain('Kitchen & dining');
  expect(back.rooms.map((r) => r.name)).not.toContain('Guest bath'); // a room only the generated design had
});

test('three variations arrive as options; edits are previewed and undo in one step', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Generate 3 variations' }).click();
  await expect(page.getByTestId('ai-candidate')).toHaveCount(3, { timeout: 30_000 });
  await page.getByTestId('ai-candidate').nth(1).getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByTestId('ai-candidate')).toHaveCount(2);

  // Edit mode: preview, then apply.
  await page.getByRole('tab', { name: 'Edit' }).click();
  await page
    .getByRole('textbox', { name: /Say what to change/ })
    .fill('make the living room 1 meter wider');
  await page.getByRole('button', { name: 'Preview change' }).click();
  const preview = page.getByTestId('ai-preview');
  await expect(preview).toBeVisible({ timeout: 20_000 });
  await expect(preview.getByText('Will change:')).toBeVisible();
  await expect(preview.getByText(/Living room 42\.0 m² → 49\.0 m²/)).toBeVisible();
  await preview.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Done.')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  // Back to the original Living room (42 m²) in the plan label.
  await expect(page.getByText('42.0 m²').first()).toBeVisible();

  // A command that cannot be done explains why and offers only Discard.
  await page
    .getByRole('textbox', { name: /Say what to change/ })
    .fill('make the living room 40 meters wider');
  await page.getByRole('button', { name: 'Preview change' }).click();
  await expect(page.getByTestId('ai-preview').getByText(/too small|break|outer/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('ai-preview').getByRole('button', { name: 'Apply' })).toHaveCount(
    0,
  );
});

test('AI settings: provider choice, model name and a clear unreachable status', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'AI settings' }).click();
  await expect(page.getByRole('radio', { name: /Local Ollama/ })).toBeChecked();
  await expect(page.getByRole('combobox', { name: /^Model/ })).toHaveValue('qwen3:14b');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Not reachable|Connected/ })).toBeVisible(
    { timeout: 20_000 },
  );
  await page.getByRole('radio', { name: /offline generator only/ }).check();
  await expect(page.getByText(/No AI model in use/)).toBeVisible();
});
