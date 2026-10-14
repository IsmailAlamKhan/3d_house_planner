import { expect, test } from '@playwright/test';
import {
  COUNT_DRAWS,
  drawStats,
  fps,
  goToView,
  gpu,
  loadVilla,
  OUT,
  record,
  villaProject,
} from './helpers';

// Run on the Windows PC with the RTX 4060 Ti: `npm run test:gpu`. Needs the asset pack (`npm run assets:download`) for the
// "pack on" numbers; without it both runs show the procedural models.
const project = villaProject();

test('the graphics card is a real GPU, not the software renderer', async ({ page }) => {
  await page.goto('/');
  const adapter = await gpu(page);
  record('adapter', { adapter });
  expect(adapter).not.toMatch(/swiftshader|llvmpipe|software/i);
});

for (const pack of ['on', 'off'] as const) {
  test(`Reference Villa at Medium, asset pack ${pack}: frame rate in 3D`, async ({ page }) => {
    const files = new Set<string>();
    page.on(
      'request',
      (r) => /\/pack\/models\/.*\.glb/.test(r.url()) && files.add(r.url().split('/').pop()!),
    );
    await page.addInitScript(COUNT_DRAWS);
    await page.addInitScript((v) => localStorage.setItem('duplex-designer:asset-pack', v), pack);
    await loadVilla(page, project, { quality: 'medium', lighting: { mode: 'dusk', time: 19.4 } });
    await expect(page.getByTestId('scene-canvas')).toBeVisible();
    const results: Record<string, number> = {};
    const draws: Record<string, unknown> = {};
    for (const view of ['Front gate', 'Isometric']) {
      await goToView(page, view);
      await page.waitForTimeout(5000); // the camera flies there and the scene settles
      results[view] = Math.round((await fps(page, 6000)) * 10) / 10;
      draws[view] = await drawStats(page);
      await page.screenshot({
        path: `${OUT}/villa-${pack}-${view.replace(/\W+/g, '-').toLowerCase()}.png`,
      });
    }
    record(`fps-pack-${pack}`, {
      fps: results,

      draws,
      models: [...files].sort(),
    });
    expect(files.size > 0).toBe(pack === 'on');
    console.log(`fps (pack ${pack}):`, results, 'draws per frame:', draws);
    // the real-asset villa is the one that has to stay smooth (>= 45 fps at Medium); the procedural run is for comparison
    if (pack === 'on') for (const v of Object.values(results)) expect(v).toBeGreaterThanOrEqual(45);
  });
}
