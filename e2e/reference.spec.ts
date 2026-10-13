import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Underlay = {
  name: string;
  opacity: number;
  locked: boolean;
  onTop: boolean;
  offset: { x: number; y: number };
  transform: number[];
  setup?: {
    mode: string;
    points: { x: number; y: number }[];
    size: number[];
    origin: { x: number; y: number };
  };
};
type P = {
  underlays: Underlay[];
  rooms: { name: string }[];
  options: { letter: string | null }[];
  currentOption: { letter: string | null };
  views: { name: string }[];
  site: { zones: unknown[]; gates: unknown[] };
};
const project = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __duplex: { getProject: () => unknown } }).__duplex.getProject(),
  ) as Promise<P>;

/** Where picture pixel (x, y) lands on the plan under the stored homography. */
const apply = (m: number[], x: number, y: number) => {
  const w = m[6]! * x + m[7]! * y + m[8]!;
  return { x: (m[0]! * x + m[1]! * y + m[2]!) / w, y: (m[3]! * x + m[4]! * y + m[5]!) / w };
};

test('reference picture: straighten and scale it onto the plan, nudge and lock it, keep it across a reload, compare it with the render', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '2D', exact: true }).click();

  await page.getByRole('button', { name: /Reference picture/ }).click();
  await expect(page.getByTestId('underlay-panel')).toBeVisible();
  await expect(page.getByText('No reference picture yet.')).toBeVisible();
  await page.getByTestId('underlay-file').setInputFiles('reference/villa-reference.png');

  // Mark the four corners of the plot on the picture (top-left, top-right, bottom-right, bottom-left).
  await expect(page.getByTestId('underlay-setup')).toBeVisible();
  const picture = page.getByTestId('underlay-setup-picture');
  const box = (await picture.boundingBox())!;
  const corners: [number, number][] = [
    [60, 218],
    [698, 222],
    [712, 1197],
    [14, 1197],
  ];
  for (const [x, y] of corners)
    await page.mouse.click(box.x + (box.width * x) / 720, box.y + (box.height * y) / 1600);
  await expect(page.getByTestId('underlay-marker-3')).toBeVisible();
  await expect(page.getByTestId('underlay-use')).toBeEnabled();
  await page.getByLabel('Real width of the top edge').fill('17.6');
  await page.getByLabel('Real depth of the side edge').fill('25.8');
  await page.getByLabel('Plan position of the first corner: across').fill('2');
  await page.getByLabel('Plan position of the first corner: down').fill('3');
  await page.getByTestId('underlay-use').click();
  await expect(page.getByTestId('underlay-setup')).toHaveCount(0);

  let p = await project(page);
  expect(p.underlays).toHaveLength(1);
  const u = p.underlays[0]!;
  expect(u.setup!.mode).toBe('corners');
  expect(u.setup!.size).toEqual([17.6, 25.8]);
  // The marked corners land on the corners of a 17.6 × 25.8 m rectangle whose first corner is at (2, 3).
  const pts = u.setup!.points;
  const [a, b, c, d] = pts.map((q) => apply(u.transform, q.x, q.y));
  expect(a!.x).toBeCloseTo(2, 2);
  expect(a!.y).toBeCloseTo(3, 2);
  expect(b!.x).toBeCloseTo(19.6, 2);
  expect(c!.y).toBeCloseTo(28.8, 2);
  expect(d!.x).toBeCloseTo(2, 2);

  // The picture is drawn on the plan, straightened.
  await expect(page.locator('image[data-testid^="underlay-"]')).toBeVisible({ timeout: 60_000 });

  // Opacity and "show over the plan".
  await page.getByRole('slider', { name: 'Opacity' }).fill('0.8');
  await page.getByLabel('Show over the plan (to check alignment)').check();
  p = await project(page);
  expect(p.underlays[0]!.opacity).toBeCloseTo(0.8, 2);
  expect(p.underlays[0]!.onTop).toBe(true);

  // A locked picture cannot be moved; unlocked it moves, and the move undoes.
  await page.getByLabel('Lock', { exact: true }).check();
  await page.getByRole('button', { name: 'Move across −' }).click();
  await expect(page.getByText('Unlock the reference picture to move it.')).toBeVisible();
  expect((await project(page)).underlays[0]!.offset.x).toBe(0);
  await page.getByLabel('Lock', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Move across +' }).click();
  expect((await project(page)).underlays[0]!.offset.x).toBeCloseTo(0.05, 3);
  await page.keyboard.press('Control+z');
  expect((await project(page)).underlays[0]!.offset.x).toBe(0);

  // The picture is part of the project: it is still there after a reload.
  await page.waitForTimeout(1500);
  await page.reload();
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await expect.poll(async () => (await project(page)).underlays.length).toBe(1);
  await expect(page.locator('image[data-testid^="underlay-"]')).toBeVisible({ timeout: 60_000 });

  // Compare with reference: the picture beside a render from above, a divider, then back to where we were.
  await page.getByRole('button', { name: /Reference picture/ }).click();
  await page.getByTestId('compare-open').click();
  const compare = page.getByTestId('compare-view');
  await expect(compare).toBeVisible();
  await expect(compare).toHaveAttribute('data-ready', 'true', { timeout: 120_000 });
  const handle = page.getByTestId('compare-handle');
  await expect(handle).toHaveAttribute('aria-valuenow', '50');
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', '52');
  const view = (await compare.boundingBox())!;
  await page.mouse.move(view.x + view.width * 0.52, view.y + view.height / 2);
  await page.mouse.down();
  await page.mouse.move(view.x + view.width * 0.8, view.y + view.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThan(70);
  await page.keyboard.press('Escape');
  await expect(compare).toHaveCount(0);
  await expect(page.getByTestId('scene-canvas')).toHaveCount(0); // the 2D view is back
  expect(errors).toEqual([]);
});

test('the Reference Villa: built from its spec, two design options, exported back to a spec, compared with the picture', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // The committed build script (`npm run reference:build`) writes the project file.
  const out = join(mkdtempSync(join(tmpdir(), 'dd-ref-')), 'villa.json');
  const log = execFileSync(
    process.execPath,
    [
      'node_modules/tsx/dist/cli.mjs',
      'scripts/reference-build.ts',
      'reference/villa.spec.json',
      '--out',
      out,
      '--no-fidelity',
    ],
    { encoding: 'utf8' },
  );
  expect(log).toContain('Design A "As labelled"');
  expect(log).toContain('Design B "As pictured"');
  expect(log).not.toMatch(/UNREACHABLE|NOT WALKABLE|overlap\(s\)|gap\(s\)/);
  const built = JSON.parse(readFileSync(out, 'utf8')) as unknown;

  await page.goto('/');
  await page.evaluate(
    (proj) =>
      (
        window as unknown as {
          __duplex: {
            stores: { model: { getState: () => { loadProject: (p: unknown) => void } } };
          };
        }
      ).__duplex.stores.model
        .getState()
        .loadProject(proj),
    built,
  );
  const p = await project(page);
  expect(p.rooms.length).toBe(22);
  expect(p.currentOption.letter).toBe('A');
  expect(p.options.map((o) => o.letter)).toEqual(['B']);
  expect(p.views.map((v) => v.name)).toContain('Reference top-down');
  expect(p.underlays).toHaveLength(1);
  expect(p.site.gates).toHaveLength(2);

  // Export → Share → Reference spec (.json): a spec that builds again.
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('tab', { name: 'Share' }).click();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Reference spec (.json)' }).click(),
  ]);
  const spec = JSON.parse(readFileSync((await dl.path())!, 'utf8')) as {
    version: number;
    designs: unknown[];
    underlay?: { image: string };
  };
  expect(spec.version).toBe(1);
  expect(spec.designs).toHaveLength(2);
  expect(spec.underlay?.image).toBe('reference/villa-reference.png');
  await page.getByRole('button', { name: 'Close' }).click();

  // The picture loads from the app's own files and lines up in the comparison view.
  await page.getByRole('button', { name: /Reference picture/ }).click();
  await page.getByTestId('compare-open').click();
  await expect(page.getByTestId('compare-view')).toHaveAttribute('data-ready', 'true', {
    timeout: 180_000,
  });
  await expect(page.getByTestId('compare-picture')).toBeVisible();
  expect(errors).toEqual([]);
});
