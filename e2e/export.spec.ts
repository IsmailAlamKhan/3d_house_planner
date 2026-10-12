import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function download(page: Page, click: () => Promise<void>): Promise<Buffer> {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), click()]);
  return readFileSync((await dl.path())!);
}

async function openExport(page: Page, tab: string) {
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByRole('dialog', { name: 'Export & share' })).toBeVisible();
  await page.getByRole('tab', { name: tab }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '2D', exact: true }).click(); // exports must work without the 3D view open
});

test('image: a PNG is produced from the 3D view even when only the plan is showing', async ({
  page,
}) => {
  await openExport(page, 'Images');
  const png = await download(page, () =>
    page.getByRole('button', { name: 'Download image' }).click(),
  );
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  expect(w).toBeGreaterThan(400);
  expect(h).toBeGreaterThan(300);
  await expect(page.getByTestId('export-done')).toContainText('×');
  // The view the user was in is back.
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('scene-canvas')).toHaveCount(0);
});

test('image: 2× is twice the size of 1×', async ({ page }) => {
  await openExport(page, 'Images');
  await page.getByRole('radio', { name: '1×' }).check();
  const a = await download(page, () =>
    page.getByRole('button', { name: 'Download image' }).click(),
  );
  await page.getByRole('radio', { name: '2×' }).check();
  const b = await download(page, () =>
    page.getByRole('button', { name: 'Download image' }).click(),
  );
  // The 2D-only view opens a split 3D pane of the same size each time.
  expect(Math.abs(b.readUInt32BE(16) - a.readUInt32BE(16) * 2)).toBeLessThanOrEqual(1);
});

test('PDF plan set: cover, a plan per level, schedule and materials, with the disclaimer', async ({
  page,
}) => {
  await openExport(page, 'PDF plans');
  const pdf = await download(page, () =>
    page.getByRole('button', { name: 'Download PDF' }).click(),
  );
  const text = pdf.toString('latin1');
  expect(text.startsWith('%PDF-')).toBe(true);
  const pages = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  expect(pages).toBe(5); // cover + 2 levels + schedule + materials
  expect((text.match(/Indicative only/g) ?? []).length).toBeGreaterThanOrEqual(1);
});

test('GLB opens as glTF 2.0; DXF and SVG carry the plan', async ({ page }) => {
  await openExport(page, '3D model');
  const glb = await download(page, () => page.getByRole('button', { name: 'GLB' }).click());
  expect(glb.readUInt32LE(0)).toBe(0x46546c67);
  expect(glb.readUInt32LE(4)).toBe(2);
  expect(glb.readUInt32LE(8)).toBe(glb.length);
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString()) as {
    images?: unknown[];
    materials: unknown[];
  };
  expect(json.materials.length).toBeGreaterThan(3);
  expect(json.images?.length ?? 0).toBeGreaterThan(0); // procedural textures are embedded

  await page.getByRole('tab', { name: 'Plan files' }).click();
  const dxf = (
    await download(page, () => page.getByRole('button', { name: 'DXF' }).click())
  ).toString();
  expect(dxf).toContain('WALLS');
  expect(dxf).toContain('ROOM_LABELS');
  const svg = (
    await download(page, () => page.getByRole('button', { name: 'SVG' }).click())
  ).toString();
  expect(svg).toContain('<svg');
  expect(svg).toContain('Living room');
});

test('costs: totals follow the unit costs you type, and export as CSV', async ({ page }) => {
  await openExport(page, 'Costs');
  const total = page.getByTestId('cost-total');
  await expect(total).toContainText('0.00');
  const first = page.getByTestId('cost-row').first();
  await first.getByRole('spinbutton').fill('10');
  await first.getByRole('spinbutton').press('Enter');
  await expect(total).not.toContainText('$0.00');
  const before = await total.textContent();
  await first.getByRole('spinbutton').fill('20');
  await first.getByRole('spinbutton').press('Enter');
  await expect.poll(async () => total.textContent()).not.toBe(before);
  await page.getByRole('combobox', { name: 'Currency' }).selectOption('EUR');
  await expect(total).toContainText('€');
  const csv = (
    await download(page, () => page.getByRole('button', { name: 'CSV' }).click())
  ).toString();
  expect(csv).toContain('TOTAL');
  expect(csv).toContain('EUR');
});

test('share: the snapshot .html opens offline from disk and shows the model, with walkthrough', async ({
  page,
  browser,
}) => {
  await openExport(page, 'Share');
  const html = await download(page, () =>
    page.getByRole('button', { name: /read-only snapshot/ }).click(),
  );
  const file = join(mkdtempSync(join(tmpdir(), 'snap-')), 'home.html');
  writeFileSync(file, html);

  const ctx = await browser.newContext();
  await ctx.setOffline(true);
  const v = await ctx.newPage();
  const errors: string[] = [];
  v.on('pageerror', (e) => errors.push(e.message));
  await v.goto(`file://${file}`);
  await expect(v.getByRole('heading', { name: 'Sample duplex' })).toBeVisible({ timeout: 30_000 });
  await expect(v.getByText('Read-only snapshot')).toBeVisible();
  await expect(v.getByTestId('viewer-canvas').locator('canvas')).toBeVisible();
  await v.getByRole('button', { name: 'Walk', exact: true }).click();
  await expect(v.getByTestId('walk-hud')).toBeVisible();
  await v.keyboard.press('Escape');
  await v.getByRole('button', { name: 'Top', exact: true }).click();
  expect(errors).toEqual([]);
  await ctx.close();
});
