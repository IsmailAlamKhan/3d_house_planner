import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REGIONS } from '../../src/render/regions';
import type { EnhanceParams, EnhanceRequest } from '../../src/render/protocol';
import { ComfyClient, ComfyError } from './comfy';
import {
  labelMask,
  layoutScore,
  promptedRegions,
  regionMasks,
  resizeLong,
  resizeTo,
} from './imageOps';
import { type Raster, decodePng, encodePng } from './png';
import {
  WORKFLOW_V2_VERSION,
  type V2Files,
  type V2Models,
  buildWorkflowV2,
  pickModel,
} from './workflowV2';

/** The long side of the pictures the image model works on (SDXL is happiest around 1024). */
export const V2_LONG_SIDE = 1024;
/** Below this share of the source's strong edges kept, a result counts as "walls moved". */
export const MIN_LAYOUT_SCORE = 0.55;
const MAX_RETRIES = 2;

export interface V2Result {
  image: Buffer;
  /** The source picture the model worked from (PNG), for the before / after view. */
  before: Buffer;
  layoutScore?: number;
  retries: number;
  creativityUsed: number;
  seconds: number;
  source: 'studio' | 'live';
  workflow: number;
}

export interface V2Options {
  comfy: ComfyClient;
  /** `<data>/studio`: where studio renders are kept. */
  studioDir: string;
  jobId: string;
  signal: AbortSignal;
  onProgress: (step: number, max: number) => void;
  /** Hook for the files the run wants to keep with the job (before / depth pictures). */
  keep?: (name: string, data: Buffer) => void;
}

const dataUrlBuffer = (v: string): Buffer =>
  Buffer.from(v.replace(/^data:image\/[a-z+]+;base64,/, ''), 'base64');

/** Where a studio render's room labels fall on its picture, in pixels (they are drawn after the enhancement). */
function labelPoints(
  labels: EnhanceRequest['labels'],
  viewProjection: number[],
  width: number,
  height: number,
): { x: number; y: number; chars: number }[] {
  const m = viewProjection;
  const out: { x: number; y: number; chars: number }[] = [];
  for (const l of labels) {
    const { x, y, z } = l.world;
    const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
    if (cw <= 0) continue;
    const px = (cx / cw / 2 + 0.5) * width;
    const py = (1 - (cy / cw / 2 + 0.5)) * height;
    if (px < -50 || py < -50 || px > width + 50 || py > height + 50) continue;
    out.push({ x: px, y: py, chars: Math.max(l.title.length, l.detail.length) });
  }
  return out;
}

/** The model files this run needs, found on ComfyUI by pattern; throws a plain explanation when something is missing. */
export async function resolveModels(comfy: ComfyClient, params: EnhanceParams): Promise<V2Models> {
  const [ckpts, cns, ipas, visions, ups] = await Promise.all([
    comfy.choices('CheckpointLoaderSimple', 'ckpt_name'),
    comfy.choices('ControlNetLoader', 'control_net_name'),
    comfy.choices('IPAdapterModelLoader', 'ipadapter_file'),
    comfy.choices('CLIPVisionLoader', 'clip_name'),
    comfy.choices('UpscaleModelLoader', 'model_name'),
  ]);
  const need = (what: string, v: string | undefined): string => {
    if (!v) throw new ComfyError(`The image service has no ${what}.`, 503, '');
    return v;
  };
  const checkpoint = need(
    'SDXL checkpoint',
    pickModel(ckpts ?? [], [/sd_xl_base_1\.0/i, /sdxl/i], params.checkpoint),
  );
  const models: V2Models = {
    checkpoint,
    depthControlNet: need(
      'depth ControlNet for SDXL',
      pickModel(cns ?? [], [/depth.*sdxl/i, /sdxl.*depth/i]),
    ),
    cannyControlNet: need(
      'canny ControlNet for SDXL',
      pickModel(cns ?? [], [/canny.*sdxl/i, /sdxl.*canny/i]),
    ),
  };
  if (params.ipWeight > 0) {
    if (ipas === null)
      throw new ComfyError(
        'The style reference needs the IP-Adapter node pack (ComfyUI_IPAdapter_plus), which is not installed in ComfyUI.',
        503,
        '',
      );
    models.ipadapter = need(
      'IP-Adapter for SDXL (ip-adapter-plus_sdxl_vit-h)',
      pickModel(ipas, [
        /plus[._-]sdxl[._-]vit[._-]?h/i,
        /ip[._-]?adapter[._-]sdxl[._-]vit[._-]?h/i,
        /sdxl.*vit/i,
      ]),
    );
    models.clipVision = need(
      'CLIP vision encoder (CLIP-ViT-H-14)',
      pickModel(visions ?? [], [/ViT-H-14/i]),
    );
  }
  if (params.tiledUpscale > 0) {
    if (ups === null || !(await comfy.hasNodes(['UltimateSDUpscale'])).UltimateSDUpscale)
      throw new ComfyError(
        'The tiled upscale needs the Ultimate SD Upscale node pack, which is not installed in ComfyUI.',
        503,
        '',
      );
    models.upscaleModel = need(
      'upscale model (RealESRGAN x4)',
      pickModel(ups, [/RealESRGAN_x4plus/i, /4x.?NMKD/i, /remacri/i, /4x/i]),
    );
  }
  return models;
}

/**
 * Enhance v2: reads the source (a studio render with its depth and region passes, or the live pictures), builds the masks,
 * runs the graph, checks that the layout survived and retries with less creativity when it did not.
 */
export async function runEnhanceV2(
  o: V2Options,
  req: EnhanceRequest,
  params: EnhanceParams,
): Promise<V2Result> {
  const t0 = Date.now();
  let color: Raster;
  let depth: Raster;
  let regions: Raster | null = null;
  let view = req.view;
  let source: 'studio' | 'live' = 'live';
  if (req.source) {
    source = 'studio';
    const dir = join(o.studioDir, req.source.id);
    const file = (name: string) => join(dir, 'out', name);
    if (!existsSync(file('beauty.png')) || !existsSync(join(dir, 'meta.json')))
      throw new ComfyError('That studio render is no longer stored.', 410, '');
    color = decodePng(readFileSync(file('beauty.png')));
    depth = existsSync(file('depthvis.png'))
      ? decodePng(readFileSync(file('depthvis.png')))
      : // an older studio render has no guide pictures: a flat depth keeps the model free but never wrong
        {
          width: color.width,
          height: color.height,
          channels: 1,
          data: new Uint8Array(color.width * color.height).fill(128),
        };
    if (existsSync(file('mask.png'))) regions = decodePng(readFileSync(file('mask.png')));
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as {
      viewProjection: number[];
      width: number;
      height: number;
    };
    if (meta.viewProjection.length === 16)
      view = { viewProjection: meta.viewProjection, width: meta.width, height: meta.height };
  } else {
    if (!req.images) throw new ComfyError('The request has no pictures.', 400, '');
    color = decodePng(dataUrlBuffer(req.images.color));
    depth = decodePng(dataUrlBuffer(req.images.depth));
  }
  const scaledColor = resizeLong(color, V2_LONG_SIDE);
  const scaledDepth = resizeTo(depth, scaledColor.width, scaledColor.height);
  const scaledRegions = regions
    ? resizeTo(regions, scaledColor.width, scaledColor.height, 'nearest')
    : null;
  o.keep?.('before.png', encodePng(scaledColor));
  o.keep?.('depth.png', encodePng(scaledDepth));

  const models = await resolveModels(o.comfy, params);
  const up = (name: string, r: Raster) =>
    o.comfy.upload(`duplex-${o.jobId}-${name}.png`, encodePng(r));
  const files: V2Files = {
    color: await up('color', scaledColor),
    depth: await up('depth', scaledDepth),
    regions: [],
  };
  const styleBuf = req.images?.style ?? req.style;
  if (params.ipWeight > 0 && styleBuf) {
    const style = decodePng(dataUrlBuffer(styleBuf));
    files.style = await up('style', style);
  }
  if (params.regions && scaledRegions) {
    const ids = promptedRegions(scaledRegions);
    const masks = regionMasks(scaledRegions, ids);
    for (const id of ids)
      files.regions.push({
        prompt: REGIONS.find((r) => r.id === id)!.prompt,
        mask: await up(`region-${id}`, masks.get(id)!),
      });
  }
  const points = labelPoints(
    req.labels,
    view.viewProjection,
    scaledColor.width,
    scaledColor.height,
  );
  if (points.length)
    files.labels = await up(
      'labels',
      labelMask(scaledColor.width, scaledColor.height, points, 0.022),
    );

  let creativity = params.creativity;
  let best: { image: Buffer; score: number | undefined; creativity: number } | null = null;
  let retries = 0;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const prompt = buildWorkflowV2(
      {
        ...params,
        creativity,
        controlStrength: Math.min(1.2, params.controlStrength + retries * 0.1),
      },
      files,
      models,
    );
    const tracker = await o.comfy.track(o.jobId, o.onProgress, o.signal);
    const onAbort = () => void o.comfy.interrupt().catch(() => undefined);
    o.signal.addEventListener('abort', onAbort);
    let promptId: string;
    try {
      promptId = await o.comfy.queue(prompt, o.jobId);
      await tracker.wait(promptId);
    } finally {
      o.signal.removeEventListener('abort', onAbort);
      tracker.close();
    }
    const out = await o.comfy.waitForOutput(promptId, 300_000);
    if (!out) throw new ComfyError('ComfyUI finished but returned no picture', 502, '');
    const image = await o.comfy.view(out);
    const score = params.layoutCheck ? layoutScore(scaledColor, decodePng(image)) : undefined;
    if (!best || (score ?? 1) > (best.score ?? 0)) best = { image, score, creativity };
    if (score === undefined || score >= MIN_LAYOUT_SCORE || attempt === MAX_RETRIES) break;
    // the walls moved: try again with less creativity and a firmer hold on the layout
    creativity = Math.max(0.12, creativity * 0.7);
    retries++;
  }
  return {
    image: best!.image,
    before: encodePng(scaledColor),
    layoutScore: best!.score,
    retries,
    creativityUsed: best!.creativity,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    source,
    workflow: WORKFLOW_V2_VERSION,
  };
}
