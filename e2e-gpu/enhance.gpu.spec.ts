import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import sharp, { type OverlayOptions } from 'sharp';
import { PRESET_SETTINGS, type EnhancePresetId } from '../src/render/presets';
import { layoutScore } from '../server/render/imageOps';
import { decodePng } from '../server/render/png';
import { goToView, loadVilla, record, studioRenderHere, villaProject } from './helpers';

// Enhance v2 evaluated on the PC with the RTX card: three views of the reference villa, each as a Studio render, enhanced
// by the old pipeline (raster source, v1) and the presets "Reference villa look", "Subtle polish" and "Bold restyle".
// Per result: time, VRAM, layout kept (edge overlap with its own source), CLIP similarity to the reference picture.
// Writes reference/renders/enhance-eval.png (contact sheet) and test-results/gpu/enhance-eval.json.
// Needs ComfyUI (COMFYUI_URL, default http://127.0.0.1:8188) and Blender (BLENDER_PATH or tools/blender-…).
const project = villaProject();
const REFERENCE = 'reference/villa-reference.png';
const PYTHON = process.env.COMFYUI_PYTHON ?? 'E:/ComfyUI/venv/Scripts/python.exe';

const vramMiB = (): number => {
  try {
    const out = execFileSync(
      'nvidia-smi',
      ['--query-gpu=memory.used', '--format=csv,noheader,nounits'],
      {
        encoding: 'utf8',
      },
    );
    return Number(out.split('\n')[0]);
  } catch {
    return 0;
  }
};

type Hook = {
  __duplex: {
    captureEnhanceInputs: (edges: boolean) => Promise<{
      color: string;
      depth: string;
      view: { viewProjection: number[]; width: number; height: number };
    }>;
    studio: { applyReferenceLook: (q: string) => Record<string, unknown> };
  };
};

interface Source {
  key: string;
  label: string;
  studioId: string;
  studio: Buffer;
  view: { viewProjection: number[]; width: number; height: number };
  raster: { color: string; depth: string };
}

async function pngDataUrl(file: string, longSide = 1024): Promise<string> {
  const buf = await sharp(file)
    .resize({ width: longSide, height: longSide, fit: 'inside' })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

async function makeSource(
  page: Page,
  request: APIRequestContext,
  key: string,
  label: string,
  setup: () => Promise<Record<string, unknown>>,
  reuseId?: string,
): Promise<Source> {
  const options = await setup();
  await page.waitForTimeout(5000);
  const studioId = reuseId ?? (await studioRenderHere(page, { quality: 'standard', ...options }));
  const studio = Buffer.from(await (await request.get(`/api/studio/results/${studioId}`)).body());
  const meta = (await (await request.get(`/api/studio/results/${studioId}/meta`)).json()) as {
    viewProjection: number[];
    width: number;
    height: number;
  };
  const raster = await page.evaluate(async () => {
    const i = await (window as unknown as Hook).__duplex.captureEnhanceInputs(false);
    return { color: i.color, depth: i.depth };
  });
  mkdirSync('reference/renders/enhance', { recursive: true });
  writeFileSync(`reference/renders/enhance/${key}-studio.png`, studio);
  return { key, label, studioId, studio, view: meta, raster };
}

interface Run {
  view: string;
  preset: string;
  file: string;
  seconds: number;
  vramPeakMiB: number;
  layout: number;
  retries: number;
  clip?: number;
  creativity: number;
}

async function enhance(
  request: APIRequestContext,
  src: Source,
  preset: EnhancePresetId,
  style: string,
): Promise<Run> {
  const s = PRESET_SETTINGS[preset];
  const params = {
    prompt:
      'luxury villa floor plan, photorealistic architectural visualization, warm dusk lighting, glowing interior lamps, lush tropical garden, turquoise pool, premium materials',
    negative: 'text, letters, numbers, watermark, blurry, deformed, distorted, cartoon, lowres',
    creativity: s.creativity,
    controlStrength: s.controlStrength,
    seed: 1234,
    steps: s.steps,
    upscale: false,
    pipeline: s.pipeline,
    preset,
    ipWeight: s.ipWeight,
    edgeStrength: s.edgeStrength,
    regions: s.regions,
    tiledUpscale: s.tiledUpscale,
    layoutCheck: s.layoutCheck,
    // ENHANCE_OVERRIDE='{"creativity":0.4}': try other settings of a preset without editing it
    ...(JSON.parse(process.env.ENHANCE_OVERRIDE ?? '{}') as Record<string, unknown>),
  };
  const body =
    s.pipeline === 'v2'
      ? {
          projectId: 'ref-villa',
          projectName: 'Reference Villa',
          params,
          source: { kind: 'studio', id: src.studioId },
          style: s.ipWeight > 0 ? style : undefined,
          view: src.view,
          labels: [],
        }
      : {
          projectId: 'ref-villa',
          projectName: 'Reference Villa',
          params,
          images: { color: src.raster.color, depth: src.raster.depth },
          view: src.view,
          labels: [],
        };
  let peak = vramMiB();
  const sampler = setInterval(() => (peak = Math.max(peak, vramMiB())), 1000);
  const t0 = Date.now();
  try {
    const r = await request.post('/api/render/enhance', { data: body, timeout: 120_000 });
    expect(r.ok(), await r.text()).toBe(true);
    const { id } = (await r.json()) as { id: string };
    for (;;) {
      await new Promise((res) => setTimeout(res, 1500));
      const j = (await (await request.get(`/api/render/jobs/${id}`)).json()) as {
        status: string;
        error?: string;
      };
      if (j.status === 'error' || j.status === 'cancelled')
        throw new Error(`${preset}: ${j.error ?? j.status}`);
      if (j.status === 'done') break;
      if (Date.now() - t0 > 15 * 60_000) throw new Error('the enhancement took too long');
    }
    const seconds = Math.round((Date.now() - t0) / 100) / 10;
    const meta = (await (await request.get(`/api/render/results/${id}/meta`)).json()) as {
      layoutScore?: number;
      retries?: number;
      params: { creativity: number };
    };
    const result = Buffer.from(await (await request.get(`/api/render/results/${id}`)).body());
    const before = Buffer.from(
      await (await request.get(`/api/render/results/${id}/before`)).body(),
    );
    const file = `reference/renders/enhance/${src.key}-${preset}${process.env.ENHANCE_TAG ?? ''}.png`;
    writeFileSync(file, result);
    // the same measure for every pipeline: strong edges of its own source still present in the result
    const layout = layoutScore(decodePng(before), decodePng(result));
    return {
      view: src.key,
      preset,
      file,
      seconds,
      vramPeakMiB: peak,
      layout: Math.round(layout * 1000) / 1000,
      retries: meta.retries ?? 0,
      creativity: meta.params.creativity,
    };
  } finally {
    clearInterval(sampler);
  }
}

function clipScores(reference: string, files: string[]): Record<string, number> {
  const out = execFileSync(PYTHON, ['scripts/clip_similarity.py', reference, ...files], {
    encoding: 'utf8',
    maxBuffer: 10_000_000,
    // the reference is a phone screenshot: score against the design inside it
    env: { ...process.env, REF_CROP: '0,195,720,1078' },
  });
  const line = out.split('\n').find((l) => l.startsWith('{'));
  if (!line) throw new Error('the CLIP score script printed nothing');
  const j = JSON.parse(line) as Record<string, number>;
  return Object.fromEntries(
    Object.entries(j).map(([k, v]) => [k.replace(/\\/g, '/').split('/').slice(-3).join('/'), v]),
  );
}

async function contactSheet(sources: Source[], runs: Run[]): Promise<void> {
  const cols = ['studio', 'classic', 'reference', 'subtle', 'bold'];
  const W = 420;
  const H = 540;
  const pad = 8;
  const head = 56;
  const tiles: OverlayOptions[] = [];
  const label = (text: string, x: number, y: number, w = W) =>
    ({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="40"><rect width="100%" height="100%" fill="#0f172a"/><text x="8" y="26" font-family="sans-serif" font-size="18" fill="#e2e8f0">${text}</text></svg>`,
      ),
      left: x,
      top: y,
    }) as OverlayOptions;
  cols.forEach((c, i) =>
    tiles.push(label(c === 'studio' ? 'Studio render (source)' : c, pad + i * (W + pad), 8)),
  );
  for (const [r, s] of sources.entries()) {
    for (const [c, name] of cols.entries()) {
      const file =
        name === 'studio'
          ? `reference/renders/enhance/${s.key}-studio.png`
          : runs.find((x) => x.view === s.key && x.preset === name)?.file;
      if (!file) continue;
      const img = await sharp(file)
        .resize({ width: W, height: H, fit: 'contain', background: '#0f172a' })
        .png()
        .toBuffer();
      const x = pad + c * (W + pad);
      const y = head + r * (H + pad);
      tiles.push({ input: img, left: x, top: y });
      const run = runs.find((q) => q.view === s.key && q.preset === name);
      if (run)
        tiles.push(
          label(
            `layout ${run.layout.toFixed(2)} · clip ${run.clip?.toFixed(3) ?? '–'} · ${run.seconds}s`,
            x,
            y + H - 40,
          ),
        );
    }
  }
  const width = pad + cols.length * (W + pad);
  const height = head + sources.length * (H + pad);
  await sharp({ create: { width, height, channels: 3, background: '#0f172a' } })
    .composite(tiles)
    .png()
    .toFile('reference/renders/enhance-eval.png');
}

test('Enhance v2 against the old pipeline on three views of the reference villa', async ({
  page,
  request,
}) => {
  test.setTimeout(3_600_000);
  const health = (await (await request.get('/api/health')).json()) as {
    studio: { ready: boolean };
    render: {
      configured: boolean;
      reachable: boolean;
      capabilities?: { styleReference: boolean; tiledUpscale: boolean };
    };
  };
  test.skip(!health.studio.ready, 'Blender is not set up (BLENDER_PATH)');
  test.skip(!health.render.reachable, 'ComfyUI is not running (COMFYUI_URL)');
  expect(
    health.render.capabilities?.styleReference,
    'the IP-Adapter pack is missing in ComfyUI',
  ).toBe(true);
  const style = await pngDataUrl(REFERENCE);

  await page.goto('/');
  await loadVilla(page, project, { quality: 'medium', lighting: { mode: 'dusk', time: 19.4 } });
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await page.waitForTimeout(6000);

  // ENHANCE_REUSE=1: use the studio renders already on the server (newest first: front gate, living room, top-down)
  const reuse = process.env.ENHANCE_REUSE
    ? (
        (await (await request.get('/api/studio/results?project=ref-villa')).json()) as {
          id: string;
        }[]
      ).map((r) => r.id)
    : [];
  const only = (process.env.ENHANCE_VIEWS ?? 'top-down,living-room,front-gate').split(',');
  const presets = (process.env.ENHANCE_PRESETS ?? 'classic,reference,subtle,bold').split(
    ',',
  ) as EnhancePresetId[];
  const sources: Source[] = [];
  if (only.includes('top-down'))
    sources.push(
      await makeSource(
        page,
        request,
        'top-down',
        'Reference look, from above',
        () =>
          page.evaluate(() =>
            (window as unknown as Hook).__duplex.studio.applyReferenceLook('standard'),
          ),
        reuse[2],
      ),
    );
  for (const [key, view, at] of [
    ['living-room', 'Living room', 1],
    ['front-gate', 'Front gate', 0],
  ] as const)
    if (only.includes(key))
      sources.push(
        await makeSource(
          page,
          request,
          key,
          view,
          async () => {
            await goToView(page, view);
            return { look: 'walk', glare: true, accent: true, kelvin: 2700 };
          },
          reuse[at],
        ),
      );

  const runs: Run[] = [];
  for (const s of sources)
    for (const preset of presets) {
      const run = await enhance(request, s, preset, style);
      console.log('enhance', s.key, preset, JSON.stringify(run));
      runs.push(run);
    }

  // give the VRAM back: the CLIP model shares the card with the idle SDXL weights and would crawl
  await request.post(`${process.env.COMFYUI_URL ?? 'http://127.0.0.1:8188'}/free`, {
    data: { unload_models: true, free_memory: true },
  });
  const clip = clipScores(REFERENCE, [
    ...sources.map((s) => `reference/renders/enhance/${s.key}-studio.png`),
    ...runs.map((r) => r.file),
  ]);
  const clipOf = (file: string) => clip[file.split('/').slice(-3).join('/')];
  for (const r of runs) r.clip = clipOf(r.file);
  const studioClip = Object.fromEntries(
    sources.map((s) => [s.key, clipOf(`reference/renders/enhance/${s.key}-studio.png`)]),
  );
  await contactSheet(sources, runs);

  const mean = (preset: string, f: (r: Run) => number) => {
    const xs = runs.filter((r) => r.preset === preset).map(f);
    return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000;
  };
  const summary = Object.fromEntries(
    ['classic', 'reference', 'subtle', 'bold'].map((p) => [
      p,
      {
        layout: mean(p, (r) => r.layout),
        clip: mean(p, (r) => r.clip ?? 0),
        seconds: mean(p, (r) => r.seconds),
        vramPeakMiB: Math.max(...runs.filter((r) => r.preset === p).map((r) => r.vramPeakMiB)),
      },
    ]),
  );
  record('enhance-eval', { summary, studioClip, runs });
  console.log('summary', JSON.stringify(summary), 'studio clip', JSON.stringify(studioClip));
  // the target: "Reference villa look" beats the old pipeline on both scores
  expect(summary.reference!.clip).toBeGreaterThan(summary.classic!.clip);
  expect(summary.reference!.layout).toBeGreaterThanOrEqual(summary.classic!.layout);
});
