import { expect, test, type Page } from '@playwright/test';
import { type Raster, encodePng } from '../scripts/lib/png';

// "Recreate from picture" end to end, with a pretend vision model: the browser calls /api/vision and these tests answer
// from a known plan. (The real model is exercised by `npm run ai:eval:vision` on the GPU PC.)

const W = 800;
const H = 500;
// 20 px per foot
const PLAN = [
  { name: 'Living', size: "20' x 14'", box: [40, 40, 440, 320] },
  { name: 'Kitchen', size: "10' x 10'", box: [440, 40, 640, 240] },
  { name: 'Bedroom 1', size: "10' x 10'", box: [440, 240, 640, 440] },
  { name: 'Foyer', size: "10' x 5'", box: [40, 320, 240, 420] },
] as const;

function picture(): Buffer {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const rect = (b: readonly number[], c: [number, number, number]) => {
    for (let y = b[1]!; y < b[3]!; y++)
      for (let x = b[0]!; x < b[2]!; x++) {
        const edge = x < b[0]! + 3 || x >= b[2]! - 3 || y < b[1]! + 3 || y >= b[3]! - 3;
        const o = (y * W + x) * 4;
        const v = edge ? [30, 41, 59] : c;
        data[o] = v[0]!;
        data[o + 1] = v[1]!;
        data[o + 2] = v[2]!;
      }
  };
  PLAN.forEach((r, i) =>
    rect(
      r.box,
      [
        [243, 237, 226],
        [226, 238, 244],
        [236, 226, 244],
        [244, 236, 226],
      ][i]! as [number, number, number],
    ),
  );
  const r: Raster = { data, width: W, height: H };
  return encodePng(r);
}

async function pretendModel(page: Page, calls: string[]) {
  await page.route('**/api/vision', async (route) => {
    const body = route.request().postDataJSON() as { prompt: string };
    const json = (v: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: JSON.stringify(v), model: 'pretend' }),
      });
    const nx = (x: number) => Math.round((x / W) * 1000);
    const ny = (y: number) => Math.round((y / H) * 1000);
    if (/bounding box of the plan drawing/.test(body.prompt)) {
      calls.push('outline');
      return json({ x0: 0, y0: 0, x1: 1000, y1: 1000 });
    }
    if (/text label/.test(body.prompt)) {
      calls.push('labels');
      return json({
        labels: PLAN.map((r) => ({
          name: r.name,
          size: r.size,
          x: nx((r.box[0] + r.box[2]) / 2),
          y: ny((r.box[1] + r.box[3]) / 2),
        })),
      });
    }
    if (/part of a floor plan/.test(body.prompt)) {
      calls.push('regions');
      return json({
        regions: PLAN.map((r) => ({
          label: r.name,
          kind: 'room',
          x0: nx(r.box[0]),
          y0: ny(r.box[1]),
          x1: nx(r.box[2]),
          y1: ny(r.box[3]),
        })),
      });
    }
    calls.push('other');
    return json({ items: [] });
  });
}

type P = {
  rooms: { name: string; polygon: { x: number; y: number }[] }[];
  options: { letter: string | null }[];
  currentOption: { letter: string | null };
  underlays: unknown[];
  openings: unknown[];
};
const project = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __duplex: { getProject: () => unknown } }).__duplex.getProject(),
  ) as Promise<P>;

test('recreate from a picture: read, review (edit, remove), build both options, undo', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls: string[] = [];
  await pretendModel(page, calls);
  await page.route('**/api/health', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        app: 'ok',
        vision: { model: 'qwen3-vl:8b-instruct', installed: true },
        ollama: { reachable: true, models: [], modelInstalled: true },
      }),
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.getByRole('tab', { name: /AI/ }).first().click();
  const roomsBefore = (await project(page)).rooms.length;

  // two clear modes
  await expect(
    page.getByTestId('ai-modes').getByRole('tab', { name: 'Describe it' }),
  ).toBeVisible();
  await page.getByTestId('ai-modes').getByRole('tab', { name: 'Recreate from picture' }).click();
  await page
    .getByTestId('recreate-file')
    .setInputFiles({ name: 'plan.png', mimeType: 'image/png', buffer: picture() });
  await expect(page.getByTestId('recreate-dialog')).toBeVisible();
  await page.getByTestId('recreate-read-auto').click();

  // review: one box and one row per room, sizes in feet worked out from the printed sizes
  await expect(page.getByTestId('recreate-rooms')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('recreate-room')).toHaveCount(4);
  await expect(page.getByTestId('recreate-box')).toHaveCount(4);
  expect(calls).toContain('outline');
  expect(calls).toContain('labels');
  expect(calls).toContain('regions');
  const living = page
    .getByTestId('recreate-room')
    .filter({ has: page.locator('input[value="Living"]') });
  await expect(living.getByLabel('Width')).toHaveValue('20');
  await expect(living.getByLabel('Depth')).toHaveValue('14');

  // correct it: rename a room, remove another
  const bed = page
    .getByTestId('recreate-room')
    .filter({ has: page.locator('input[value="Bedroom 1"]') });
  await bed.getByLabel('Name').fill('Master Bedroom');
  await page.getByRole('button', { name: 'Remove Foyer' }).click();
  await expect(page.getByTestId('recreate-room')).toHaveCount(3);

  // nothing has been built yet
  expect((await project(page)).rooms.length).toBe(roomsBefore);

  await page.getByTestId('recreate-build-both').click();
  await expect(page.getByTestId('recreate-dialog')).toHaveCount(0);
  const p = await project(page);
  expect(p.rooms.map((r) => r.name).sort()).toEqual(['Kitchen', 'Living', 'Master Bedroom']);
  expect(p.currentOption.letter).toBe('A');
  expect(p.options.map((o) => o.letter)).toEqual(['B']);
  expect(p.underlays).toHaveLength(1); // the picture goes under the plan, to be corrected there
  expect(p.openings.length).toBeGreaterThan(0); // doors were added, so every room can be reached

  // one undo step brings the old plan back
  await page.keyboard.press('Control+z');
  expect((await project(page)).rooms.length).toBe(roomsBefore);
  expect(errors).toEqual([]);
});

test('recreate from a picture: a model that is not installed is explained, and a failed read can be retried', async ({
  page,
}) => {
  await page.route('**/api/health', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        app: 'ok',
        vision: { model: 'qwen3-vl:8b-instruct', installed: false },
        ollama: { reachable: true, models: ['qwen3:14b'], modelInstalled: true },
      }),
    }),
  );
  await page.route('**/api/vision', (r) =>
    r.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error:
          'The picture-reading model "qwen3-vl:8b-instruct" is not installed. Run: ollama pull qwen3-vl:8b-instruct',
        code: 'no-model',
      }),
    }),
  );
  await page.goto('/');
  await page.getByRole('tab', { name: /AI/ }).first().click();
  await page.getByTestId('ai-modes').getByRole('tab', { name: 'Recreate from picture' }).click();
  await expect(page.getByTestId('vision-missing')).toContainText('qwen3-vl:8b-instruct');
  await page
    .getByTestId('recreate-file')
    .setInputFiles({ name: 'plan.png', mimeType: 'image/png', buffer: picture() });
  await page.getByTestId('recreate-read-auto').click();
  // the dialog goes back to the setup with the reason, nothing is built
  await expect(page.getByTestId('recreate-dialog').getByRole('alert')).toContainText(
    'ollama pull qwen3-vl:8b-instruct',
    {
      timeout: 60_000,
    },
  );
  await expect(page.getByTestId('recreate-read-auto')).toBeVisible();
});
