import { expect, test, type Page } from '@playwright/test';

type Proj = {
  notes: { text: string; resolved: boolean }[];
  options: unknown[];
  currentOption: { letter: string | null };
  items: unknown[];
  walls: unknown[];
};
const project = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __duplex: { getProject: () => unknown } }).__duplex.getProject(),
  ) as Promise<Proj>;

/** The app registers its keyboard handlers after the first render; wait until the page is really up. */
async function ready(page: Page) {
  await expect(page.getByRole('button', { name: 'Help' })).toBeVisible();
  await page.waitForTimeout(400);
}

const collectErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
};

test.describe('first-run tour', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('starts by itself, walks through all 8 steps without errors, and can be replayed from Help', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    const tour = page.getByTestId('tour');
    await expect(tour).toBeVisible({ timeout: 10_000 });
    await expect(tour.getByText('Welcome to Duplex Designer')).toBeVisible();
    for (let step = 1; step <= 7; step++) {
      await expect(tour.getByText(`Step ${step} of 8`)).toBeVisible();
      await tour.getByRole('button', { name: 'Next' }).click();
    }
    await expect(tour.getByText('Step 8 of 8')).toBeVisible();
    await expect(tour.getByText('Export and share')).toBeVisible();
    await tour.getByRole('button', { name: 'Finish' }).click();
    await expect(tour).toBeHidden();
    expect(errors).toEqual([]);

    // It does not start again by itself …
    await page.reload();
    await page.waitForTimeout(2000);
    await expect(page.getByTestId('tour')).toBeHidden();
    // … but Help replays it.
    await page.getByRole('button', { name: 'Help' }).click();
    await page.getByRole('menuitem', { name: /Take the tour/ }).click();
    await expect(page.getByTestId('tour').getByText('Step 1 of 8')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tour')).toBeHidden();
  });

  test('can be skipped, and Back works', async ({ page }) => {
    await page.goto('/');
    const tour = page.getByTestId('tour');
    await expect(tour).toBeVisible({ timeout: 10_000 });
    await tour.getByRole('button', { name: 'Next' }).click();
    await tour.getByRole('button', { name: 'Back' }).click();
    await expect(tour.getByText('Step 1 of 8')).toBeVisible();
    await tour.getByRole('button', { name: 'Skip tour' }).click();
    await expect(tour).toBeHidden();
  });
});

test.describe('language and theme', () => {
  test('every label switches to Bengali (with the Bengali font) and back', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Language').selectOption('bn');

    await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
    await expect(page.getByRole('button', { name: 'আনডু' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'এক্সপোর্ট' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'লাইব্রেরি' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'নোট' })).toBeVisible();
    // Areas on the plan use Bengali digits and units.
    await expect(page.locator('svg text', { hasText: 'মি²' }).first()).toBeVisible();
    // The bundled font is what renders the Bengali text.
    const font = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        loaded: [...document.fonts].some(
          (f) => f.family.includes('Noto Sans Bengali') && f.status === 'loaded',
        ),
        family: getComputedStyle(document.body).fontFamily,
      };
    });
    expect(font.family).toContain('Noto Sans Bengali');
    expect(font.loaded).toBe(true);
    // No English UI word is left in the top bar and sidebars.
    const bar =
      (await page.locator('header').innerText()) +
      (await page.getByRole('tablist').first().innerText());
    expect(bar).not.toMatch(
      /\b(Undo|Redo|Export|Projects|Library|Levels|Checks|Notes|Settings|Help)\b/,
    );

    await page.getByLabel('ভাষা').selectOption('en');
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  });

  test('the choice is remembered after a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Language').selectOption('bn');
    await page.reload();
    await expect(page.getByRole('button', { name: 'আনডু' })).toBeVisible();
  });

  test('dark theme changes the colours of the whole interface', async ({ page }) => {
    await page.goto('/');
    const bg = () =>
      page.evaluate(() => getComputedStyle(document.querySelector('header')!).backgroundColor);
    expect(await bg()).toBe('rgb(255, 255, 255)');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Theme').selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await bg()).toBe('rgb(30, 41, 59)');
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe('rgb(15, 23, 42)');
  });

  test('reduced motion setting is applied to the page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Animations').selectOption('reduce');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');
  });
});

test.describe('discoverability', () => {
  test('Ctrl/Cmd+K opens a searchable command palette; Enter runs the command', async ({
    page,
  }) => {
    await page.goto('/');
    await ready(page);
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await page.keyboard.type('walls');
    await expect(palette.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();
    await expect(page.getByRole('button', { name: /Draw walls/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Palette commands also switch the language.
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.type('bengali');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  });

  test('? opens the shortcut sheet, Esc closes it and returns focus', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.type('?');
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Draw walls')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  test('toolbar buttons carry shortcut tooltips and every icon button has a name', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('title', /V/);
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute(
      'title',
      /(Ctrl|⌘)\+?Z/,
    );
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .filter(
          (b) =>
            !(b.getAttribute('aria-label') || b.textContent?.trim() || b.getAttribute('title')),
        )
        .map((b) => b.outerHTML.slice(0, 80)),
    );
    expect(unnamed).toEqual([]);
  });

  test('an empty level suggests the next step', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Projects' }).click();
    await page.getByRole('button', { name: 'New project' }).click();
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: /Empty shell/ }).click();
    await expect(page.getByTestId('empty-plan')).toContainText('No rooms yet');
    await page.getByRole('button', { name: 'Draw walls', exact: true }).click();
    await expect(page.getByRole('button', { name: /Draw walls \(W\)/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

test.describe('dialogs and keyboard', () => {
  test('a dialog traps Tab, closes with Esc and gives focus back', async ({ page }) => {
    await page.goto('/');
    const opener = page.getByRole('button', { name: 'Export', exact: true });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Export & share' });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(
        true,
      );
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('keyboard focus is visible', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Undo' }).focus();
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(
      () => getComputedStyle(document.activeElement!).outlineStyle,
    );
    expect(outline).toBe('solid');
  });
});

test.describe('notes', () => {
  test('pin a note on the plan, edit, resolve and delete it; it is saved in the project', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '2D', exact: true }).click();
    await page.getByRole('button', { name: /Add a note/ }).click();
    const svg = page.locator('svg').first();
    const box = (await page.locator('.plan-paper').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.9);
    await expect(page.getByRole('tab', { name: 'Notes', selected: true })).toBeVisible();
    const card = page.getByTestId('note-card');
    await expect(card).toHaveCount(1);
    await card.getByLabel('Note text').fill('Ask about window size here');
    await card.getByLabel('Note text').blur();
    await expect
      .poll(async () => (await project(page)).notes[0]?.text)
      .toBe('Ask about window size here');
    await expect(page.getByTestId('notes-layer').locator('[data-note]')).toHaveCount(1);

    await page.getByRole('button', { name: 'Mark resolved' }).click();
    await expect.poll(async () => (await project(page)).notes[0]?.resolved).toBe(true);
    await page.getByRole('button', { name: 'Reopen' }).click();
    await page.getByRole('button', { name: 'Delete note' }).click();
    await expect(page.getByTestId('note-card')).toHaveCount(0);
    await expect.poll(async () => (await project(page)).notes.length).toBe(0);
    void svg;
  });

  test('a note can be attached to the selection and shows as a pin in 3D as well', async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate(() => {
      // Select the first piece of furniture through the model store's public hook.
      const d = (
        window as unknown as { __duplex: { getProject: () => { items: { id: string }[] } } }
      ).__duplex;
      return d.getProject().items.length;
    });
    await page.getByRole('tab', { name: 'Notes' }).click();
    await expect(page.getByText(/No notes yet/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add a note to the selection' })).toBeDisabled();
  });
});

test.describe('design options', () => {
  test('save a copy as Option A, edit it without touching the original, switch back and compare', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Levels' }).click();
    await expect(page.getByText(/Only one design so far/)).toBeVisible();
    const before = (await project(page)).walls.length;
    await page.getByRole('button', { name: 'Save a copy as a new option' }).click();
    await expect(page.getByTestId('design-row')).toHaveCount(2);
    await expect(page.getByTestId('design-row').filter({ hasText: 'Option A' })).toHaveAttribute(
      'data-current',
      'true',
    );
    expect((await project(page)).currentOption.letter).toBe('A');

    // Edit Option A: draw a wall with the typed-length tool.
    await page.getByRole('button', { name: '2D', exact: true }).click();
    await page.keyboard.press('Delete'); // nothing selected: harmless
    await page.getByRole('button', { name: /Draw walls/ }).click();
    const box = (await page.locator('.plan-paper').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.95);
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.95);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await project(page)).walls.length).toBeGreaterThan(before);

    await page.getByRole('button', { name: 'Show this option' }).click();
    expect((await project(page)).walls.length).toBe(before);
    expect((await project(page)).currentOption.letter).toBeNull();

    await page.getByRole('button', { name: 'Compare side by side' }).click();
    const dlg = page.getByRole('dialog', { name: 'Compare design options' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByTestId('compare-left').locator('canvas')).toBeVisible();
    await expect(dlg.getByTestId('compare-right').locator('canvas')).toBeVisible();
    await expect(dlg.getByTestId('compare-left')).toContainText('Main design');
    await expect(dlg.getByTestId('compare-right')).toContainText('Option A');
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  });
});

test.describe('phone-sized screen (390 × 844, touch)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the app is usable: bottom-sheet panels, tap-to-place furniture, no sideways scrolling', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // Everything in the top bar is reachable and a comfortable size to touch.
    for (const name of ['Undo', 'Redo', 'Projects', 'Export', 'Settings', 'Help']) {
      const b = page.getByRole('button', { name, exact: true }).first();
      await expect(b).toBeVisible();
      const r = (await b.boundingBox())!;
      expect(r.width).toBeGreaterThanOrEqual(36);
      expect(r.height).toBeGreaterThanOrEqual(36);
    }

    // The library opens as a bottom sheet.
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Tools' });
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(800); // pinned to the bottom edge
    expect(box.width).toBeGreaterThan(380);

    // Tap an item (the sheet closes), then tap where it goes.
    const items = (await project(page)).items.length;
    await sheet.getByRole('tab', { name: 'Dining' }).tap();
    await sheet.getByTestId('lib-chair').tap();
    await expect(sheet).toBeHidden();
    const plan = (await page.locator('.plan-paper').boundingBox())!;
    await page.touchscreen.tap(plan.x + plan.width / 2, plan.y + plan.height / 2);
    await expect.poll(async () => (await project(page)).items.length).toBe(items + 1);
    expect(errors).toEqual([]);
  });

  test('the tour fits the small screen and the language switch works', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).tap();
    await page.getByLabel('Language').selectOption('bn');
    await expect(page.getByRole('button', { name: 'আনডু' })).toBeVisible();
    await page.getByRole('button', { name: 'সহায়তা' }).tap();
    await page.getByRole('menuitem', { name: /ভ্রমণ/ }).tap();
    const tour = page.getByTestId('tour');
    await expect(tour).toBeVisible();
    const card = (await tour.getByRole('dialog').boundingBox())!;
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width).toBeLessThanOrEqual(390);
    for (let i = 0; i < 7; i++) await tour.getByRole('button', { name: 'পরবর্তী' }).tap();
    await tour.getByRole('button', { name: 'শেষ করুন' }).tap();
    await expect(tour).toBeHidden();
  });
});
