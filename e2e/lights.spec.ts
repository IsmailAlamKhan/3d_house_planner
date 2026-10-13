import { expect, test, type Page } from '@playwright/test';
import { whiteRoomProject } from './helpers/whiteRoom';

type P = {
  lights: { master: string; rooms: Record<string, boolean>; items: Record<string, boolean> };
  items: { id: string; catalogId: string }[];
  rooms: { id: string }[];
};
type Hook = {
  getProject: () => P;
  stores: {
    model: {
      getState: () => { loadProject: (p: unknown) => void; setViewMode: (m: string) => void };
    };
    scene: { getState: () => { setPref: (k: string, v: unknown) => void } };
  };
  select: (type: string, ids: string[]) => void;
};
const project = (page: Page) =>
  page.evaluate(() => (window as unknown as { __duplex: Hook }).__duplex.getProject());

async function open(page: Page) {
  await page.setViewportSize({ width: 1300, height: 850 });
  await page.goto('/');
  await page.evaluate((p) => {
    const h = (window as unknown as { __duplex: Hook }).__duplex;
    h.stores.model.getState().loadProject(p);
    h.stores.model.getState().setViewMode('3d');
    h.stores.scene.getState().setPref('lightStyle', 'realistic');
    h.stores.scene.getState().setPref('lighting', { mode: 'noon', time: 13 });
  }, whiteRoomProject());
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

test('light switches: per fixture, per room and for the whole home — and they are saved with the project', async ({
  page,
}) => {
  await open(page);
  const p0 = await project(page);
  const ceiling = p0.items.find((i) => i.catalogId === 'ceiling-light')!.id;
  const room = p0.rooms[0]!.id;
  expect(p0.lights).toEqual({ master: 'auto', rooms: {}, items: {} });

  // A fixture: select it, flip its switch in the Properties panel.
  await page.evaluate(
    (id) => (window as unknown as { __duplex: Hook }).__duplex.select('item', [id]),
    ceiling,
  );
  const lamp = page.getByTestId('lamp-switch');
  await expect(lamp).not.toBeChecked(); // noon: lights follow the preset (off)
  await lamp.check();
  expect((await project(page)).lights.items[ceiling]).toBe(true);

  // A room: the small bulb button in the 3D view switches every fixture of the room.
  const bulb = page.getByTestId('room-light-button');
  await expect(bulb).toHaveAttribute('data-on', 'true');
  await bulb.click();
  await expect(bulb).toHaveAttribute('data-on', 'false');
  let lights = (await project(page)).lights;
  expect(lights.rooms[room]).toBe(false);
  expect(lights.items[ceiling]).toBeUndefined(); // the room switch resets single-fixture overrides
  await bulb.click();
  expect((await project(page)).lights.rooms[room]).toBe(true);

  // Everything: "All off" in the light panel.
  await page.getByRole('button', { name: 'Light & quality' }).click();
  await page.getByTestId('lamps-off').click();
  lights = (await project(page)).lights;
  expect(lights).toEqual({ master: 'off', rooms: {}, items: {} });
  await expect(page.getByTestId('room-light-button')).toHaveAttribute('data-on', 'false');
  await page.getByTestId('lamps-on').click();
  await expect(page.getByTestId('room-light-button')).toHaveAttribute('data-on', 'true');
  await page.getByTestId('lamps-off').click();

  // Saved with the project: still off after a reload.
  await page.waitForTimeout(2500);
  await page.reload();
  await expect
    .poll(async () => (await project(page)).lights.master, { timeout: 20_000 })
    .toBe('off');
});

test('lighting style: "Work light" and the L key switch between realistic and design lighting', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Light & quality' }).click();
  await expect(page.getByTestId('light-style-realistic')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Light & quality' }).click();
  await page.getByRole('button', { name: 'Work light (L)' }).click();
  await page.getByRole('button', { name: 'Light & quality' }).click();
  await expect(page.getByTestId('light-style-design')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Light & quality' }).click();
  await page.getByTestId('scene-canvas').click({ position: { x: 600, y: 500 } });
  await page.keyboard.press('l');
  await page.getByRole('button', { name: 'Light & quality' }).click();
  await expect(page.getByTestId('light-style-realistic')).toHaveAttribute('aria-pressed', 'true');
  // The night-visibility slider only exists in realistic lighting, and can be set to 0.
  const slider = page.getByTestId('night-visibility');
  await expect(slider).toBeVisible();
  await slider.fill('0');
  await expect(slider).toHaveValue('0');
});

test('render debug panel (?debug=render) lists every effect and light type and the colour settings', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 850 });
  await page.goto('/?debug=render');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const panel = page.getByTestId('render-debug');
  await expect(panel).toBeVisible();
  for (const label of [
    'Shadows',
    'Ambient occlusion',
    'Bloom',
    'Tone mapping',
    'Environment light',
    'Sky (hemisphere) light',
    'Sun / moon',
    'Lamps (point / spot)',
    'Window area lights',
  ])
    await expect(panel.getByLabel(label)).toBeChecked();
  const info = page.getByTestId('render-debug-info');
  await expect(info).toContainText('Colour space: sRGB');
  await expect(info).toContainText('none (the pipeline tone-maps)');
  await expect(info).toContainText('Chain: scene');
  await expect(info).toContainText('tm'); // tone mapping appears once, in the pipeline
  await panel.getByLabel('Tone mapping').uncheck();
  await expect(info).not.toContainText('tm');
  // Without the query the panel is not there.
  await page.goto('/');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('render-debug')).toHaveCount(0);
});
