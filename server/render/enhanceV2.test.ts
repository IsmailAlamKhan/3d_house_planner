// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { EnhanceParamsSchema, type EnhanceRequest } from '../../src/render/protocol';
import { REGIONS, regionOfItem, regionOfPart } from '../../src/render/regions';
import { ComfyClient } from './comfy';
import { runEnhanceV2 } from './enhanceV2';
import {
  dilate,
  labelMask,
  layoutScore,
  promptedRegions,
  regionAreas,
  regionMasks,
  resizeLong,
  resizeTo,
  sobel,
  toGrey,
} from './imageOps';
import { type Raster, decodePng, encodePng } from './png';
import { buildWorkflowV2, pickModel } from './workflowV2';

const servers: Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

/** A picture of a house plan: a bright floor with dark walls. */
function plan(w = 160, h = 120, shift = 0): Raster {
  const data = new Uint8Array(w * h * 3).fill(190);
  const set = (x: number, y: number, v: number) =>
    data.fill(v, (y * w + x) * 3, (y * w + x) * 3 + 3);
  for (let x = 0; x < w; x++)
    for (let t = 0; t < 4; t++) {
      set(x, 20 + t + shift, 30);
      set(x, 90 + t + shift, 30);
    }
  for (let y = 20; y < 95; y++)
    for (let t = 0; t < 4; t++) {
      set(30 + t + shift, y, 30);
      set(110 + t + shift, y, 30);
    }
  return { width: w, height: h, channels: 3, data };
}

/** The same picture with texture noise (an AI result adds detail). */
function textured(r: Raster): Raster {
  const data = Uint8Array.from(r.data);
  let seed = 1;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = Math.max(0, Math.min(255, data[i]! + ((seed >> 8) % 21) - 10));
  }
  return { ...r, data };
}

describe('png', () => {
  it('writes and reads back every kind of 8-bit picture', () => {
    for (const channels of [1, 3, 4] as const) {
      const w = 7;
      const h = 5;
      const data = Uint8Array.from({ length: w * h * channels }, (_, i) => (i * 37) % 256);
      const back = decodePng(encodePng({ width: w, height: h, channels, data }));
      expect([back.width, back.height, back.channels]).toEqual([w, h, channels]);
      expect(Array.from(back.data)).toEqual(Array.from(data));
    }
  });

  it('reads the greyscale PNG Blender writes for the region pass', () => {
    const pic = plan();
    expect(decodePng(encodePng(pic)).data.length).toBe(pic.data.length);
    expect(() => decodePng(Buffer.from('not a png at all, not at all'))).toThrow();
  });
});

describe('layout score', () => {
  it('is 1 for the same picture, stays high when only texture is added, and falls when walls move', () => {
    const src = plan();
    expect(layoutScore(src, src)).toBe(1);
    expect(layoutScore(src, textured(src))).toBeGreaterThan(0.85);
    expect(layoutScore(src, plan(160, 120, 9))).toBeLessThan(0.45);
  });

  it('compares an upscaled result at the size of the source', () => {
    const src = plan();
    const big = resizeTo(src, 480, 360);
    expect(layoutScore(src, big)).toBeGreaterThan(0.9);
  });

  it('sobel finds the walls and dilate grows them', () => {
    const src = plan();
    const mag = sobel(toGrey(src), src.width, src.height);
    expect(Math.max(...mag)).toBeGreaterThan(100);
    const one = new Uint8Array(25);
    one[12] = 1;
    expect(dilate(one, 5, 5, 1).reduce((a, b) => a + b, 0)).toBe(9);
  });
});

describe('regions', () => {
  const regions: Raster = (() => {
    const w = 40;
    const h = 30;
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) data[y * w + x] = x < 20 ? 5 : y < 15 ? 4 : 0;
    return { width: w, height: h, channels: 1, data };
  })();

  it('finds which regions are on the picture and makes a mask for each', () => {
    const areas = regionAreas(regions);
    expect(areas.get(5)).toBeCloseTo(0.5);
    expect(areas.get(4)).toBeCloseTo(0.25);
    expect(areas.get(0)).toBeCloseTo(0.25); // the sky
    expect(promptedRegions(regions)).toEqual([4, 5]);
    const masks = regionMasks(regions, [5], 0);
    const m = masks.get(5)!;
    expect(m.channels).toBe(3);
    expect(m.data[(5 * 40 + 5) * 3]).toBe(255);
    expect(m.data[(5 * 40 + 30) * 3]).toBe(0);
  });

  it('classifies surfaces and furniture for the prompts', () => {
    expect(regionOfPart('site', ['water'])).toBe('water');
    expect(regionOfPart('site', ['pool-tile'])).toBe('water');
    expect(regionOfPart('site', ['grass@out'])).toBe('lawn');
    expect(regionOfPart('site', ['paving-stone'])).toBe('paving');
    expect(regionOfPart('floor', ['floor-oak'])).toBe('floor');
    expect(regionOfPart('wall', ['paint-white'])).toBe('wall');
    expect(regionOfPart('wall', ['glass'])).toBe('glass');
    expect(regionOfItem('car')).toBe('car');
    expect(regionOfItem('bed-king')).toBe('soft');
    expect(regionOfItem('tree-palm')).toBe('plant');
    expect(regionOfItem('dining-table-8')).toBe('furniture');
    expect(new Set(REGIONS.map((r) => r.id)).size).toBe(REGIONS.length);
  });

  it('puts the label masks where the labels will be drawn', () => {
    const m = labelMask(200, 100, [{ x: 100, y: 50, chars: 12 }], 0.04);
    expect(m.data[(50 * 200 + 100) * 3]).toBe(255);
    expect(m.data[(5 * 200 + 5) * 3]).toBe(0);
  });

  it('scales to the size the image model works at', () => {
    const r = resizeLong(plan(1920, 1440), 1024);
    expect(Math.max(r.width, r.height)).toBe(1024);
    expect(r.width % 8).toBe(0);
    expect(r.height % 8).toBe(0);
  });
});

describe('the v2 graph', () => {
  const params = (over: object = {}) =>
    EnhanceParamsSchema.parse({ prompt: 'a villa', seed: 7, pipeline: 'v2', ...over });
  const models = {
    checkpoint: 'sd_xl_base_1.0.safetensors',
    depthControlNet: 'depth.safetensors',
    cannyControlNet: 'canny.safetensors',
    ipadapter: 'plus.sdxl.vit.h.safetensors',
    clipVision: 'CLIP-ViT-H-14.safetensors',
    upscaleModel: 'RealESRGAN_x4plus.pth',
  };
  const classes = (p: Record<string, { class_type: string }>) =>
    Object.values(p).map((n) => n.class_type);

  it('is a plain img2img with both ControlNets without the extras', () => {
    const p = buildWorkflowV2(params(), { color: 'c.png', depth: 'd.png', regions: [] }, models);
    const c = classes(p);
    expect(c.filter((x) => x === 'ControlNetApplyAdvanced')).toHaveLength(2);
    expect(c).not.toContain('IPAdapterAdvanced');
    expect(c).not.toContain('UltimateSDUpscale');
    expect(c).toContain('Canny');
    expect(c.at(-1)).toBe('SaveImage');
  });

  it('adds the style reference, a masked prompt per region, the label mask and the tiled upscale', () => {
    const p = buildWorkflowV2(
      params({ ipWeight: 0.55, regions: true, tiledUpscale: 2 }),
      {
        color: 'c.png',
        depth: 'd.png',
        style: 's.png',
        regions: [
          { prompt: 'pool', mask: 'r5.png' },
          { prompt: 'lawn', mask: 'r4.png' },
        ],
        labels: 'l.png',
      },
      models,
    );
    const c = classes(p);
    expect(c.filter((x) => x === 'ConditioningSetMask')).toHaveLength(3); // two regions + the labels
    expect(c.filter((x) => x === 'ConditioningCombine')).toHaveLength(3);
    const ip = Object.values(p).find((n) => n.class_type === 'IPAdapterAdvanced')!;
    expect(ip.inputs.weight).toBe(0.55);
    expect(ip.inputs.weight_type).toBe('style transfer');
    const up = Object.values(p).find((n) => n.class_type === 'UltimateSDUpscale')!;
    expect(up.inputs.upscale_by).toBe(2);
    expect(up.inputs.tile_width).toBe(1024); // tiles keep it inside 16 GB
    const sampler = Object.values(p).find((n) => n.class_type === 'KSampler')!;
    expect(sampler.inputs.denoise).toBe(0.35);
  });

  it('leaves the edge ControlNet out at strength 0 and the style out without a picture', () => {
    const p = buildWorkflowV2(
      params({ edgeStrength: 0, ipWeight: 0.6 }),
      { color: 'c.png', depth: 'd.png', regions: [] },
      models,
    );
    const c = classes(p);
    expect(c.filter((x) => x === 'ControlNetApplyAdvanced')).toHaveLength(1);
    expect(c).not.toContain('IPAdapterAdvanced');
  });

  it('picks model files by pattern, with the wanted one first', () => {
    const files = [
      'plus.face.sdxl.vit.h.safetensors',
      'plus.sdxl.vit.h.safetensors',
      'ip.adapter.sdxl.safetensors',
    ];
    expect(pickModel(files, [/plus[._-]sdxl[._-]vit/i])).toBe('plus.sdxl.vit.h.safetensors');
    expect(pickModel(files, [/nothing/], 'ip.adapter.sdxl.safetensors')).toBe(
      'ip.adapter.sdxl.safetensors',
    );
    expect(pickModel(files, [/nothing/])).toBeUndefined();
  });
});

/** A pretend ComfyUI with the node packs of v2; result pictures come from `results` in turn. */
async function fakeComfy(
  results: Buffer[],
  caps: { ip?: boolean; upscale?: boolean } = { ip: true, upscale: true },
) {
  const log = {
    uploads: [] as string[],
    prompts: [] as Record<string, { class_type: string; inputs: Record<string, unknown> }>[],
  };
  const sockets = new Map<string, import('ws').WebSocket>();
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url ?? '/', 'http://x');
      const json = (o: unknown, status = 200) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(o));
      };
      const info = (node: string, input: string, options: string[]) =>
        json({ [node]: { input: { required: { [input]: [options] } } } });
      if (url.pathname === '/object_info/CheckpointLoaderSimple')
        return info('CheckpointLoaderSimple', 'ckpt_name', [
          'sd_xl_base_1.0.safetensors',
          'other.safetensors',
        ]);
      if (url.pathname === '/object_info/ControlNetLoader')
        return info('ControlNetLoader', 'control_net_name', [
          'controlnet-depth-sdxl-1.0.fp16.safetensors',
          'controlnet-canny-sdxl-1.0.fp16.safetensors',
        ]);
      if (url.pathname === '/object_info/IPAdapterModelLoader')
        return caps.ip
          ? info('IPAdapterModelLoader', 'ipadapter_file', ['plus.sdxl.vit.h.safetensors'])
          : json({});
      if (url.pathname === '/object_info/CLIPVisionLoader')
        return info('CLIPVisionLoader', 'clip_name', ['CLIP-ViT-H-14-laion2B.safetensors']);
      if (url.pathname === '/object_info/UpscaleModelLoader')
        return info('UpscaleModelLoader', 'model_name', ['RealESRGAN_x4plus.pth']);
      if (url.pathname === '/object_info/UltimateSDUpscale')
        return caps.upscale ? json({ UltimateSDUpscale: { input: {} } }) : json({});
      if (url.pathname === '/upload/image') {
        const name = /filename="([^"]+)"/.exec(body.toString('latin1'))?.[1] ?? 'x.png';
        log.uploads.push(name);
        return json({ name, subfolder: '', type: 'input' });
      }
      if (url.pathname === '/prompt') {
        const j = JSON.parse(body.toString());
        log.prompts.push(j.prompt);
        const id = `p${log.prompts.length}`;
        const ws = sockets.get(j.client_id);
        setTimeout(
          () =>
            ws?.send(JSON.stringify({ type: 'executing', data: { node: null, prompt_id: id } })),
          10,
        );
        return json({ prompt_id: id });
      }
      const m = /^\/history\/p(\d+)$/.exec(url.pathname);
      if (m)
        return json({
          [`p${m[1]}`]: {
            status: { status_str: 'success' },
            outputs: {
              '99': { images: [{ filename: `out${m[1]}.png`, subfolder: '', type: 'output' }] },
            },
          },
        });
      if (url.pathname === '/view') {
        const n = Number(/out(\d+)\.png/.exec(url.searchParams.get('filename') ?? '')?.[1] ?? 1);
        res.setHeader('Content-Type', 'image/png');
        return void res.end(results[Math.min(n, results.length) - 1]);
      }
      json({ error: 'nope' }, 404);
    });
  });
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    sockets.set(new URL(req.url ?? '', 'http://x').searchParams.get('clientId') ?? '', ws);
  });
  servers.push(server);
  const url = await new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );
  return { url, log };
}

/** A studio render folder: the picture, its depth, its region pass and its meta. */
function studio(): { dir: string; id: string } {
  const root = mkdtempSync(join(tmpdir(), 'dd-v2-'));
  const id = 'abcdef0123456789';
  const out = join(root, id, 'out');
  mkdirSync(out, { recursive: true });
  const src = plan(320, 240);
  writeFileSync(join(out, 'beauty.png'), encodePng(src));
  writeFileSync(
    join(out, 'depthvis.png'),
    encodePng({ width: 320, height: 240, channels: 1, data: new Uint8Array(320 * 240).fill(100) }),
  );
  const reg = new Uint8Array(320 * 240);
  for (let y = 0; y < 240; y++) for (let x = 0; x < 320; x++) reg[y * 320 + x] = x < 160 ? 5 : 4;
  writeFileSync(
    join(out, 'mask.png'),
    encodePng({ width: 320, height: 240, channels: 1, data: reg }),
  );
  writeFileSync(
    join(root, id, 'meta.json'),
    JSON.stringify({
      viewProjection: [0.1, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 1],
      width: 320,
      height: 240,
    }),
  );
  return { dir: root, id };
}

const request = (
  id: string,
  params: object,
): { req: EnhanceRequest; params: ReturnType<typeof EnhanceParamsSchema.parse> } => {
  const p = EnhanceParamsSchema.parse({
    prompt: 'a luxury villa at dusk',
    seed: 3,
    pipeline: 'v2',
    ...params,
  });
  return {
    params: p,
    req: {
      projectId: 'p1',
      projectName: 'P',
      params: p,
      source: { kind: 'studio', id },
      style: `data:image/png;base64,${encodePng(plan(64, 48)).toString('base64')}`,
      view: { viewProjection: new Array(16).fill(0), width: 320, height: 240 },
      labels: [{ roomId: 'r', title: 'Kitchen', detail: "16' × 12'", world: { x: 0, y: 0, z: 0 } }],
    } as EnhanceRequest,
  };
};

describe('enhance v2 run', () => {
  const opts = (comfy: ComfyClient, dir: string) => ({
    comfy,
    studioDir: dir,
    jobId: 'aaaaaaaaaaaaaaaa',
    signal: new AbortController().signal,
    onProgress: () => undefined,
  });

  it('works from a studio render: masks per region, the style picture, a result that kept the layout', async () => {
    const s = studio();
    const same = encodePng(textured(plan(1024 * 1, 768)));
    const c = await fakeComfy([same]);
    const { req, params } = request(s.id, { ipWeight: 0.55, regions: true, tiledUpscale: 2 });
    const r = await runEnhanceV2(opts(new ComfyClient(c.url), s.dir), req, params);
    expect(r.source).toBe('studio');
    expect(r.retries).toBe(0);
    expect(r.layoutScore).toBeGreaterThan(0.8);
    expect(c.log.uploads.some((u) => u.includes('region-5'))).toBe(true);
    expect(c.log.uploads.some((u) => u.includes('region-4'))).toBe(true);
    expect(c.log.uploads.some((u) => u.includes('labels'))).toBe(true);
    expect(c.log.uploads.some((u) => u.includes('style'))).toBe(true);
    const graph = Object.values(c.log.prompts[0]!).map((n) => n.class_type);
    expect(graph).toContain('IPAdapterAdvanced');
    expect(graph).toContain('UltimateSDUpscale');
    expect(r.before.subarray(1, 4).toString()).toBe('PNG');
  });

  it('retries with less creativity when the walls moved, and keeps the better picture', async () => {
    const s = studio();
    const moved = encodePng(plan(1024, 768, 40));
    const kept = encodePng(textured(plan(1024, 768)));
    const c = await fakeComfy([moved, kept]);
    const { req, params } = request(s.id, { creativity: 0.4 });
    const r = await runEnhanceV2(opts(new ComfyClient(c.url), s.dir), req, params);
    expect(r.retries).toBe(1);
    expect(r.creativityUsed).toBeCloseTo(0.28, 2);
    expect(r.layoutScore).toBeGreaterThan(0.8);
    const sampler = (i: number) =>
      Object.values(c.log.prompts[i]!).find((n) => n.class_type === 'KSampler')!.inputs
        .denoise as number;
    expect(sampler(0)).toBeCloseTo(0.4);
    expect(sampler(1)).toBeCloseTo(0.28);
  });

  it('gives up after two retries and returns the best attempt with its score', async () => {
    const s = studio();
    const c = await fakeComfy([
      encodePng(plan(1024, 768, 40)),
      encodePng(plan(1024, 768, 30)),
      encodePng(plan(1024, 768, 35)),
    ]);
    const { req, params } = request(s.id, {});
    const r = await runEnhanceV2(opts(new ComfyClient(c.url), s.dir), req, params);
    expect(r.retries).toBe(2);
    expect(r.layoutScore).toBeLessThan(0.55);
    expect(c.log.prompts).toHaveLength(3);
  });

  it('does not check the layout when asked not to', async () => {
    const s = studio();
    const c = await fakeComfy([encodePng(plan(1024, 768, 40))]);
    const { req, params } = request(s.id, { layoutCheck: false });
    const r = await runEnhanceV2(opts(new ComfyClient(c.url), s.dir), req, params);
    expect(r.layoutScore).toBeUndefined();
    expect(r.retries).toBe(0);
  });

  it('says what is missing when the style reference is not installed, or the studio render is gone', async () => {
    const s = studio();
    const c = await fakeComfy([encodePng(plan(1024, 768))], { ip: false, upscale: true });
    const style = request(s.id, { ipWeight: 0.5 });
    await expect(
      runEnhanceV2(opts(new ComfyClient(c.url), s.dir), style.req, style.params),
    ).rejects.toThrow(/IP-Adapter/);
    const gone = request('0000000000000000', {});
    await expect(
      runEnhanceV2(opts(new ComfyClient(c.url), s.dir), gone.req, gone.params),
    ).rejects.toThrow(/no longer stored/);
  });
});
