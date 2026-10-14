import { expect, test } from '@playwright/test';
import { loadVilla, OUT, saveBakeBundle, saveStudioBundle, villaProject } from './helpers';

// Writes the Reference look's studio bundle of the villa (glb + sidecar) to test-results/gpu/studio-bundle/, ready for
// `docker/blender/render.py` (see studioRender.gpu.spec.ts for the full render through the app server).
const project = villaProject();

test('the Reference look makes a studio bundle of the villa', async ({ page }) => {
  test.setTimeout(240_000);
  await loadVilla(page, project, { quality: 'medium' });
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await page.waitForTimeout(8000);
  const { glbBytes, sidecar } = await saveStudioBundle(page, `${OUT}/studio-bundle`, {
    quality: 'preview',
    reference: true,
  });
  console.log(
    'bundle:',
    glbBytes,
    'bytes glb;',
    (sidecar.lights as { lamps: unknown[] }).lamps.length,
    'lamps',
  );
  expect(glbBytes).toBeGreaterThan(100_000);
});

test('the lighting bake makes a bake bundle of the villa', async ({ page }) => {
  test.setTimeout(240_000);
  await loadVilla(page, project, { quality: 'medium', lighting: { mode: 'dusk', time: 19.4 } });
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await page.waitForTimeout(6000);
  for (const quality of ['low', 'medium', 'high']) {
    const { glbBytes } = await saveBakeBundle(page, `${OUT}/bake-bundle-${quality}`, {
      preset: 'dusk',
      quality,
    });
    console.log('bake bundle', quality, glbBytes, 'bytes');
    expect(glbBytes).toBeGreaterThan(10_000);
  }
});
