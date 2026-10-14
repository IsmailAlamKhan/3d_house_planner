import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { COUNT_DRAWS, fps, goToView, loadVilla, record, villaProject } from './helpers';

// Lighting bake of the Reference Villa (Dusk) with Blender on the RTX card, and the walkthrough with it:
//  - bake time per quality (Low 8 / Medium 16 / High 32 texels per metre),
//  - walkthrough frame rate with the bake on (target >= 60 fps),
//  - the walkthrough views with real-time lighting, with the bake and as Studio renders (reference/walkthrough/ and
//    reference/compare-walkthrough.html).
// The villa is rebuilt for every run with new part ids, so the bake of an earlier run is deleted first.
const project = villaProject();

type BakeMeta = {
  key: string;
  seconds: number;
  samples: number;
  device: string;
  atlas: { width: number; height: number };
  parts: unknown[];
};
type Hook = {
  __duplex: {
    captureView: () => Promise<string>;
    bakeStats: Record<string, unknown>;
    stores: {
      bake: {
        getState: () => {
          patch: (p: object) => void;
          start: (p: string) => Promise<void>;
          error: string | null;
          bakes: { dusk?: BakeMeta };
          applied: { key: string } | null;
        };
      };
    };
    studio: {
      buildStudioBundle: (o: Record<string, unknown>) => Promise<unknown>;
      packBundle: (b: unknown) => Blob;
    };
  };
};

async function bake(page: Page, quality: string) {
  const t0 = Date.now();
  const error = await page.evaluate(async (q) => {
    const b = (window as unknown as Hook).__duplex.stores.bake.getState();
    b.patch({ quality: q });
    await b.start('dusk');
    return b.error;
  }, quality);
  expect(error).toBeNull();
  const meta = await page.evaluate(
    () => (window as unknown as Hook).__duplex.stores.bake.getState().bakes.dusk!,
  );
  return { meta, wallSeconds: Math.round((Date.now() - t0) / 1000) };
}

/** Waits until the scene shows the newest bake (not an older one). */
async function bakeOnScreen(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const s = (window as unknown as Hook).__duplex.stores.bake.getState();
          return !!s.applied && s.applied.key === s.bakes.dusk?.key;
        }),
      { timeout: 90_000 },
    )
    .toBe(true);
}

async function open(page: Page, request: APIRequestContext): Promise<void> {
  await request.delete('/api/bake/ref-villa/dusk');
  await page.addInitScript(COUNT_DRAWS);
  await loadVilla(page, project, { quality: 'medium', lighting: { mode: 'dusk', time: 19.4 } });
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await page.waitForTimeout(6000);
}

const VIEWS = [
  ['living-room', 'Living room'],
  ['master-bedroom', 'Master bedroom'],
  ['front-gate', 'Front gate'],
] as const;

test('bake the villa at three qualities, then walk through it at 60 fps', async ({
  page,
  request,
}) => {
  test.setTimeout(1_800_000);
  const health = (await (await request.get('/api/health')).json()) as {
    studio: { ready: boolean };
  };
  test.skip(!health.studio.ready, 'Blender is not set up (BLENDER_PATH)');
  await open(page, request);

  const times: Record<string, unknown> = {};
  for (const q of ['low', 'high', 'medium']) {
    const r = await bake(page, q);
    times[q] = {
      bakeSeconds: r.meta.seconds,
      wallSeconds: r.wallSeconds,
      samples: r.meta.samples,
      atlas: `${r.meta.atlas.width}x${r.meta.atlas.height}`,
      meshes: r.meta.parts.length,
      device: r.meta.device,
    };
    console.log('bake', q, JSON.stringify(times[q]));
  }
  record('bake-times', times);
  await bakeOnScreen(page); // the Medium bake is on show

  const results: Record<string, number> = {};
  for (const [, view] of VIEWS) {
    await goToView(page, view);
    await page.waitForTimeout(5000);
    results[view] = Math.round((await fps(page, 5000)) * 10) / 10;
  }
  const stats = await page.evaluate(() => (window as unknown as Hook).__duplex.bakeStats);
  record('bake-walkthrough-fps', { fps: results, parts: stats });
  console.log('walkthrough fps with the bake:', results, JSON.stringify(stats));
  expect((stats as { baked: number }).baked).toBeGreaterThan(100); // the parts on screen really use their lightmaps
  for (const v of Object.values(results)) expect(v).toBeGreaterThanOrEqual(58);
});

/** A Studio render (Blender, Standard quality) from the camera the 3D view has right now, as a base64 PNG. */
async function studioFromHere(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const d = (window as unknown as Hook).__duplex;
    const bundle = await d.studio.buildStudioBundle({
      quality: 'standard',
      look: 'walk',
      glare: true,
      accent: true,
      kelvin: 2700,
    });
    const r = await fetch('/api/studio/render?quality=standard', {
      method: 'POST',
      body: d.studio.packBundle(bundle),
    });
    const { id } = (await r.json()) as { id: string };
    for (;;) {
      await new Promise((res) => setTimeout(res, 1000));
      const j = (await (await fetch(`/api/studio/jobs/${id}`)).json()) as {
        status: string;
        error?: string;
      };
      if (j.status === 'error' || j.status === 'cancelled') throw new Error(j.error ?? j.status);
      if (j.status === 'done') break;
    }
    const buf = new Uint8Array(await (await fetch(`/api/studio/results/${id}`)).arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000)
      s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
}

test('the walkthrough with the Dusk bake next to the Studio render of the same view', async ({
  page,
  request,
}) => {
  test.setTimeout(1_800_000);
  const health = (await (await request.get('/api/health')).json()) as {
    studio: { ready: boolean };
  };
  test.skip(!health.studio.ready, 'Blender is not set up (BLENDER_PATH)');
  await open(page, request);
  await bake(page, 'medium');
  await bakeOnScreen(page);

  mkdirSync('reference/walkthrough', { recursive: true });
  const rows: string[] = [];
  for (const [name, view] of VIEWS) {
    await goToView(page, view);
    await page.waitForTimeout(6000);
    const save = (suffix: string, b64: string) =>
      writeFileSync(`reference/walkthrough/${name}-${suffix}.png`, Buffer.from(b64, 'base64'));
    const capture = () => page.evaluate(() => (window as unknown as Hook).__duplex.captureView());
    save('baked', await capture());
    save('studio', await studioFromHere(page));
    const toggle = (enabled: boolean) =>
      page.evaluate(
        (e) => (window as unknown as Hook).__duplex.stores.bake.getState().patch({ enabled: e }),
        enabled,
      );
    await toggle(false);
    await page.waitForTimeout(3000);
    save('realtime', await capture());
    await toggle(true);
    await page.waitForTimeout(3000);
    rows.push(
      `<tr><th>${view}</th>${['realtime', 'baked', 'studio']
        .map((s) => `<td><img src="walkthrough/${name}-${s}.png" alt="${view}, ${s}"></td>`)
        .join('')}</tr>`,
    );
  }
  writeFileSync(
    'reference/compare-walkthrough.html',
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Walkthrough, baked lighting and the Studio render</title>
<style>
  body{font:14px system-ui,sans-serif;margin:16px;background:#0f172a;color:#e2e8f0}
  h1{font-size:18px} p{max-width:70ch;color:#94a3b8}
  table{border-collapse:collapse;width:100%} th,td{padding:4px;vertical-align:top}
  th{writing-mode:vertical-rl;transform:rotate(180deg);text-align:center;color:#94a3b8;width:28px}
  thead th{writing-mode:horizontal-tb;transform:none;text-align:center;width:auto}
  img{width:100%;height:auto;border-radius:4px;display:block}
</style></head><body>
<h1>Reference Villa, Dusk: walkthrough views</h1>
<p>Left: real-time lighting (what the walkthrough looked like before). Middle: the walkthrough with the Dusk lighting bake
(Medium, Blender Cycles). Right: the Studio render (Blender, Standard quality) from exactly the same camera.
Made by <code>npm run test:gpu</code> (e2e-gpu/bake.gpu.spec.ts).</p>
<table><thead><tr><th></th><th>Real-time</th><th>Baked</th><th>Studio render</th></tr></thead><tbody>
${rows.join('\n')}
</tbody></table></body></html>
`,
  );
});
