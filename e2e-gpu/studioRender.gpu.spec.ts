import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { loadVilla, OUT, record, villaProject } from './helpers';

// The studio render end to end on the Windows PC: the app builds the bundle in the browser, the app server hands it to
// Blender (Cycles, OptiX), the picture comes back with its labels. Needs Blender (BLENDER_PATH or tools/blender-…).
// Saves the Reference look at Standard quality to reference/renders/ and records render time and VRAM use.
const project = villaProject();

const vramMiB = (): number => {
  try {
    const out = execFileSync(
      'nvidia-smi',
      ['--query-gpu=memory.used', '--format=csv,noheader,nounits'],
      { encoding: 'utf8' },
    );
    return Number(out.split('\n')[0]);
  } catch {
    return 0;
  }
};

const OLLAMA = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';

async function ollamaLoaded(): Promise<string[]> {
  try {
    const r = await fetch(`${OLLAMA}/api/ps`, { signal: AbortSignal.timeout(3000) });
    return ((await r.json()) as { models?: { name: string }[] }).models?.map((m) => m.name) ?? [];
  } catch {
    return [];
  }
}

test('Studio render of the Reference Villa: Reference look at Standard quality', async ({
  page,
  request,
}) => {
  test.setTimeout(900_000);
  const health = (await (await request.get('/api/health')).json()) as {
    studio: { configured: boolean; ready: boolean; device?: string; problem?: string };
  };
  test.skip(!health.studio.configured, 'Blender is not set up (BLENDER_PATH)');
  expect(health.studio.ready, health.studio.problem).toBe(true);
  expect(health.studio.device).toMatch(/OPTIX|CUDA/);

  // GPU hand-over: a language model sits in VRAM (Ollama) when the studio render is queued; the queue must unload it first.
  let ollamaModel = '';
  try {
    const tags = (await (await fetch(`${OLLAMA}/api/tags`)).json()) as {
      models?: { name: string }[];
    };
    ollamaModel = tags.models?.find((m) => !/vl|embed/.test(m.name))?.name ?? '';
  } catch {
    // no Ollama on this PC: the hand-over check is skipped
  }
  if (ollamaModel)
    await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST',
      body: JSON.stringify({ model: ollamaModel, prompt: 'hi', stream: false, keep_alive: '10m' }),
    });
  const loadedBefore = ollamaModel ? await ollamaLoaded() : [];
  const vramBefore = vramMiB();

  await loadVilla(page, project, { quality: 'medium' });
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await page.waitForTimeout(6000);
  await page.getByTestId('present-button').click();
  // the studio button is shown while presenting
  await page.getByTestId('present-cutaway-top').click();
  await page.getByTestId('present-studio').click();
  await expect(page.getByTestId('studio-device')).toContainText(/OPTIX|CUDA/);
  await page.getByTestId('studio-quality').selectOption('standard');

  let peak = vramBefore;
  const sampler = setInterval(() => (peak = Math.max(peak, vramMiB())), 1500);
  const t0 = Date.now();
  await page.getByTestId('studio-reference').click();
  await expect(page.getByTestId('studio-progress')).toBeVisible({ timeout: 120_000 });
  let loadedDuring: string[] = loadedBefore;
  const watch = setInterval(() => void ollamaLoaded().then((l) => (loadedDuring = l)), 2000);
  const picture = page.getByTestId('studio-picture');
  await expect(picture).toBeVisible({ timeout: 300_000 });
  clearInterval(sampler);
  clearInterval(watch);
  const seconds = Math.round((Date.now() - t0) / 1000);

  // the finished picture (labels drawn on it again)
  const meta = (await (
    await request.get(`/api/studio/results?project=${project && (project as { id: string }).id}`)
  ).json()) as {
    id: string;
    seconds: number;
    device: string;
    width: number;
    height: number;
    samples: number;
  }[];
  const latest = meta[0]!;
  mkdirSync('reference/renders', { recursive: true });
  const png = await (await request.get(`/api/studio/results/${latest.id}`)).body();
  writeFileSync('reference/renders/villa-reference-look-standard.png', png);
  await picture.screenshot({ path: `${OUT}/studio-dialog-picture.png` });

  record('studio-render', {
    quality: 'standard',
    renderSeconds: latest.seconds,
    wallSeconds: seconds,
    device: latest.device,
    size: `${latest.width}x${latest.height}`,
    samples: latest.samples,
    vramMiB: { before: vramBefore, peak },
    ollama: { model: ollamaModel, loadedBefore, loadedDuringRender: loadedDuring },
  });
  console.log('studio render:', latest.seconds, 's;', latest.device, '; VRAM peak', peak, 'MiB');
  expect(latest.seconds).toBeLessThan(180);
  if (ollamaModel) expect(loadedBefore.length).toBeGreaterThan(0);
  expect(loadedDuring).toEqual([]); // the language model was unloaded before Blender took the card
});

test('without Blender the studio dialog explains how to turn it on', async ({ page }) => {
  await page.route('**/api/health', async (route) => {
    const r = await route.fetch();
    const body = (await r.json()) as Record<string, unknown>;
    await route.fulfill({ json: { ...body, studio: { configured: false, ready: false } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByTestId('present-button').click();
  await page.getByTestId('present-cutaway-top').click();
  await page.getByTestId('present-studio').click();
  await expect(page.getByTestId('studio-unavailable')).toContainText(
    'docker compose --profile render up -d',
  );
  await expect(page.getByTestId('studio-render')).toBeDisabled();
});
