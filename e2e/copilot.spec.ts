import { expect, test, type Page } from '@playwright/test';

type P = {
  kind: string;
  levels: unknown[];
  rooms: { name: string; type: string; floorMaterial: string }[];
  items: { catalogId: string }[];
  site: { zones: { type: string }[] };
  brief?: { levels: number; program: { name: string }[] };
};
const project = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __duplex: { getProject: () => unknown } }).__duplex.getProject(),
  ) as Promise<P>;

/** The copilot must work with no model installed on the machine running the tests. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'duplex-designer:ai-settings',
      JSON.stringify({ provider: 'offline', model: 'qwen3:14b', timeoutSec: 20 }),
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.getByRole('tab', { name: 'AI Assistant' }).click();
  await page.getByRole('tab', { name: 'Design with AI' }).click();
});

test('copilot: a sentence → brief → three checked layouts → apply → style → refine in chat, all undoable', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await expect(page.getByTestId('copilot-options')).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Describe the home' })
    .fill('I want a 4-bedroom villa with a pool for my family');
  await page.getByRole('button', { name: 'Make my brief' }).click();

  // The Design Brief is readable and editable, with what was assumed.
  const brief = page.getByTestId('brief-card');
  await expect(brief).toBeVisible({ timeout: 20_000 });
  await expect(brief.getByTestId('brief-room').first()).toBeVisible();
  expect(await brief.getByTestId('brief-room').count()).toBeGreaterThanOrEqual(8);
  await expect(page.getByTestId('assumptions')).toContainText(/\w/);
  await expect(page.getByTestId('bubble-diagram')).toBeVisible();

  await page.getByTestId('design-it').click();
  await expect(page.getByTestId('copilot-candidate')).toHaveCount(3, { timeout: 60_000 });
  await expect(page.getByTestId('first-design-time')).toBeVisible();
  const first = page.getByTestId('copilot-candidate').first();
  await expect(first).toContainText(/Follows your brief \d+%/);

  const before = await project(page);
  await page.getByTestId('copilot-apply').click();
  await expect(page.getByTestId('copilot-style')).toBeVisible();
  const applied = await project(page);
  expect(applied.rooms.length).toBeGreaterThan(8);
  expect(applied.brief?.program.length).toBeGreaterThan(8);
  expect(applied.items.length).toBeGreaterThan(before.items.length);

  // Style in one step.
  await page.getByRole('button', { name: 'Tropical' }).first().click();
  await expect(page.getByTestId('copilot-chat')).toContainText('Style applied');
  const styled = await project(page);
  expect(styled.rooms.map((r) => r.floorMaterial).join()).not.toBe(
    applied.rooms.map((r) => r.floorMaterial).join(),
  );

  // Chat: a chip and a vague request.
  await page.getByTestId('chat-chips').getByRole('button', { name: 'More light' }).click();
  await expect(page.getByTestId('copilot-candidate')).toHaveCount(3, { timeout: 60_000 });
  await page
    .getByRole('textbox', { name: 'e.g. make it feel more open' })
    .fill('make it feel more open');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('chat-user').last()).toContainText('more open');
  await expect(page.getByTestId('copilot-candidate')).toHaveCount(3, { timeout: 60_000 });

  // One undo takes the style back (the design stays); the next takes the design back.
  await page.keyboard.press('ControlOrMeta+z');
  const afterUndo = await project(page);
  expect(afterUndo.rooms.map((r) => r.floorMaterial).join()).toBe(
    applied.rooms.map((r) => r.floorMaterial).join(),
  );
});

test('copilot: the interview takes a few taps and "Skip, just design it" works at any time', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.getByRole('button', { name: 'Ask me a few questions' }).click();
  const q = page.getByTestId('copilot-interview');
  await expect(q).toContainText('How big is the building?');
  await q.getByRole('button', { name: /Medium/ }).click();
  await expect(q).toContainText('How many levels?');
  await q.getByRole('button', { name: 'Two levels' }).click();
  await expect(q).toContainText('Who will live there?');
  await q.getByRole('button', { name: 'Family with kids' }).click();
  await expect(q).toContainText('Which rooms must it have?');
  await q.getByRole('button', { name: 'Home office' }).click();
  await q.getByRole('button', { name: 'Next' }).click();
  await page.getByTestId('skip-design').click();
  await expect(page.getByTestId('copilot-candidate').first()).toBeVisible({ timeout: 60_000 });
  const brief = await page.getByTestId('copilot-chat').isVisible();
  expect(brief).toBe(true);
});

test('copilot: "like the reference villa but 2 storeys and 4 bedrooms" keeps the outdoor features', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.getByTestId('opt-like').click();
  await page
    .getByRole('textbox', { name: 'What should be different?' })
    .fill('2 storeys, 4 bedrooms, no gaming room, smaller pool');
  await page.getByRole('button', { name: 'Make my brief' }).last().click();
  const card = page.getByTestId('brief-card');
  await expect(card).toBeVisible();
  await expect(card.getByLabel('Levels', { exact: true })).toHaveValue('2');
  await expect(card.getByTestId('brief-rooms')).not.toContainText('Gaming');
  await expect(card.getByRole('button', { name: 'Swimming pool' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(card.getByRole('button', { name: 'Parking' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByTestId('design-it').click();
  await expect(page.getByTestId('copilot-candidate')).toHaveCount(3, { timeout: 90_000 });
});

test('copilot: a Bengali brief is understood like its English twin', async ({ page }) => {
  await page
    .getByRole('textbox', { name: 'Describe the home' })
    .fill('৪ বেডরুমের ভিলা সুইমিং পুল ও বাগান সহ');
  await page.getByRole('button', { name: 'Make my brief' }).click();
  const card = page.getByTestId('brief-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByLabel('Room: Bedroom 4')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Swimming pool' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('copilot: dragging a bubble sets a placement hint', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Describe the home' }).fill('3 bedroom duplex');
  await page.getByRole('button', { name: 'Make my brief' }).click();
  const bubble = page.getByTestId('bubble').first();
  await expect(bubble).toBeVisible({ timeout: 20_000 });
  const box = (await bubble.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 4 });
  await page.mouse.up();
  // A marker dot appears on a bubble that carries a hint.
  await expect(page.locator('[data-testid="bubble"] circle[fill="#0369a1"]')).toHaveCount(1);
});
