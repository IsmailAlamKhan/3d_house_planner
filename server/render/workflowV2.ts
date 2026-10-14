import type { EnhanceParams } from '../../src/render/protocol';

type Ref = [string, number];
type Node = { class_type: string; inputs: Record<string, unknown> };
export type Prompt = Record<string, Node>;

/** Version of the v2 graph (stored with every result). */
export const WORKFLOW_V2_VERSION = 2;

export interface V2Files {
  /** The source picture (a studio render, scaled for the image model). */
  color: string;
  /** Normalised depth, near = white. */
  depth: string;
  /** The style reference picture (when `ipWeight` > 0). */
  style?: string;
  /** One prompt and one mask per region that is on the picture. */
  regions: { prompt: string; mask: string }[];
  /** Where room labels will be drawn: the image model is told those places are plain. */
  labels?: string;
}

export interface V2Models {
  checkpoint: string;
  depthControlNet: string;
  cannyControlNet: string;
  /** IP-Adapter weights and CLIP vision encoder (needed with a style reference). */
  ipadapter?: string;
  clipVision?: string;
  /** The upscale model for the tiled upscale. */
  upscaleModel?: string;
}

/** Prompt added to the label mask: those places stay plain, so no text is invented there. */
export const LABEL_PROMPT =
  'plain clean surface, empty, no text, no letters, no numbers, no writing, no signs';

class Graph {
  readonly nodes: Prompt = {};
  private n = 0;
  add(class_type: string, inputs: Record<string, unknown>): string {
    const id = String(++this.n);
    this.nodes[id] = { class_type, inputs };
    return id;
  }
}

/**
 * The ComfyUI graph of Enhance v2, built in code:
 *
 *   studio render ─▶ VAE encode ─▶ KSampler (low denoise) ─▶ decode ─▶ [tiled upscale] ─▶ save
 *   model ─▶ [IP-Adapter, style transfer, with the style picture]
 *   conditioning = prompt ⊕ region prompts (each masked) ⊕ "plain, no text" (label areas)
 *                  ─▶ depth ControlNet ─▶ canny ControlNet (edges taken from the source)
 *
 * Pure: returns a new object; the server fills in model names it found on ComfyUI.
 */
export function buildWorkflowV2(params: EnhanceParams, files: V2Files, models: V2Models): Prompt {
  const g = new Graph();
  const ckpt = g.add('CheckpointLoaderSimple', { ckpt_name: models.checkpoint });
  const clip: Ref = [ckpt, 1];
  const vae: Ref = [ckpt, 2];
  const source = g.add('LoadImage', { image: files.color });
  const depth = g.add('LoadImage', { image: files.depth });
  const text = (t: string) => g.add('CLIPTextEncode', { text: t, clip });

  const base = text(params.prompt);
  const negative = text(params.negative);
  let positive: Ref = [base, 0];
  const masked = (prompt: string, maskFile: string, strength = 1): Ref => {
    const img = g.add('LoadImage', { image: maskFile });
    const mask = g.add('ImageToMask', { image: [img, 0], channel: 'red' });
    const cond = g.add('ConditioningSetMask', {
      conditioning: [text(prompt), 0],
      mask: [mask, 0],
      strength,
      set_cond_area: 'default',
    });
    return [cond, 0];
  };
  const combine = (a: Ref, b: Ref): Ref => [
    g.add('ConditioningCombine', { conditioning_1: a, conditioning_2: b }),
    0,
  ];
  for (const r of files.regions) positive = combine(positive, masked(r.prompt, r.mask));
  if (files.labels) positive = combine(positive, masked(LABEL_PROMPT, files.labels, 1.2));

  // layout lock: depth, then edges (canny on the source picture itself)
  const depthNet = g.add('ControlNetLoader', { control_net_name: models.depthControlNet });
  const withDepth = g.add('ControlNetApplyAdvanced', {
    positive,
    negative: [negative, 0],
    control_net: [depthNet, 0],
    image: [depth, 0],
    strength: params.controlStrength,
    start_percent: 0,
    end_percent: 1,
    vae,
  });
  let pos: Ref = [withDepth, 0];
  let neg: Ref = [withDepth, 1];
  if (params.edgeStrength > 0) {
    const edges = g.add('Canny', { image: [source, 0], low_threshold: 0.2, high_threshold: 0.5 });
    const cannyNet = g.add('ControlNetLoader', { control_net_name: models.cannyControlNet });
    const withEdges = g.add('ControlNetApplyAdvanced', {
      positive: pos,
      negative: neg,
      control_net: [cannyNet, 0],
      image: [edges, 0],
      strength: params.edgeStrength,
      start_percent: 0,
      end_percent: 0.85,
      vae,
    });
    pos = [withEdges, 0];
    neg = [withEdges, 1];
  }

  // style reference
  let model: Ref = [ckpt, 0];
  if (params.ipWeight > 0 && files.style && models.ipadapter && models.clipVision) {
    const style = g.add('LoadImage', { image: files.style });
    const adapter = g.add('IPAdapterModelLoader', { ipadapter_file: models.ipadapter });
    const vision = g.add('CLIPVisionLoader', { clip_name: models.clipVision });
    const applied = g.add('IPAdapterAdvanced', {
      model,
      ipadapter: [adapter, 0],
      image: [style, 0],
      weight: params.ipWeight,
      weight_type: 'style transfer',
      combine_embeds: 'concat',
      start_at: 0,
      end_at: 0.9,
      embeds_scaling: 'V only',
      clip_vision: [vision, 0],
    });
    model = [applied, 0];
  }

  const latent = g.add('VAEEncode', { pixels: [source, 0], vae });
  const sampler = g.add('KSampler', {
    model,
    positive: pos,
    negative: neg,
    latent_image: [latent, 0],
    seed: params.seed,
    steps: params.steps,
    cfg: 6.5,
    sampler_name: 'dpmpp_2m',
    scheduler: 'karras',
    denoise: params.creativity,
  });
  let image: Ref = [g.add('VAEDecode', { samples: [sampler, 0], vae }), 0];

  if (params.tiledUpscale > 0 && models.upscaleModel) {
    const up = g.add('UpscaleModelLoader', { model_name: models.upscaleModel });
    image = [
      g.add('UltimateSDUpscale', {
        image,
        model,
        positive: pos,
        negative: neg,
        vae,
        upscale_by: params.tiledUpscale,
        seed: params.seed,
        steps: 18,
        cfg: 6,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        denoise: 0.2,
        upscale_model: [up, 0],
        mode_type: 'Linear',
        tile_width: 1024,
        tile_height: 1024,
        mask_blur: 12,
        tile_padding: 48,
        seam_fix_mode: 'None',
        seam_fix_denoise: 1,
        seam_fix_width: 64,
        seam_fix_mask_blur: 8,
        seam_fix_padding: 16,
        force_uniform_tiles: true,
        tiled_decode: true,
      }),
      0,
    ];
  }
  g.add('SaveImage', { images: image, filename_prefix: 'duplex' });
  return g.nodes;
}

/** Picks the first available model name matching one of the patterns (in order of preference). */
export function pickModel(
  options: string[],
  patterns: RegExp[],
  wanted?: string,
): string | undefined {
  if (wanted && options.includes(wanted)) return wanted;
  for (const p of patterns) {
    const hit = options.find((o) => p.test(o));
    if (hit) return hit;
  }
  return undefined;
}
