import { z } from 'zod';

/** The shapes the browser and the app server agree on for "Enhance render" (shared, so both validate the same thing). */

export const CREATIVITY_RANGE = { min: 0.1, max: 0.6, default: 0.35 } as const;
export const MAX_SEED = 2 ** 32 - 1;

export const EnhanceParamsSchema = z.object({
  prompt: z.string().trim().min(3).max(2000),
  negative: z.string().trim().max(1000).default(''),
  /** Denoise strength of the img2img pass: low keeps the exact render, high repaints more. */
  creativity: z
    .number()
    .min(CREATIVITY_RANGE.min)
    .max(CREATIVITY_RANGE.max)
    .default(CREATIVITY_RANGE.default),
  /** How strictly the ControlNets (depth, optional edges) hold the layout. */
  controlStrength: z.number().min(0).max(1.5).default(0.8),
  seed: z.number().int().min(0).max(MAX_SEED),
  steps: z.number().int().min(8).max(60).default(28),
  /** Add a 1.5× upscale pass. */
  upscale: z.boolean().default(false),
  style: z.string().max(40).optional(),

  // ── Enhance v2 (all optional: a v1 request is still valid) ──
  /** `v2`: studio source, style reference, region prompts, layout check, tiled upscale. */
  pipeline: z.enum(['v1', 'v2']).default('v1'),
  /** The preset the settings came from (shown in the gallery). */
  preset: z.enum(['reference', 'subtle', 'bold', 'classic']).optional(),
  /** Strength of the style reference (IP-Adapter, 'style transfer'); 0 = not used. */
  ipWeight: z.number().min(0).max(1.2).default(0),
  /** Strength of the canny (edges) ControlNet; the depth ControlNet uses `controlStrength`. */
  edgeStrength: z.number().min(0).max(1.5).default(0.5),
  /** Give each region of the picture (pool, lawn, floors, beds, cars, …) its own prompt. */
  regions: z.boolean().default(false),
  /** Tiled upscale of the result by 2× or 3× (0 = none). */
  tiledUpscale: z.union([z.literal(0), z.literal(2), z.literal(3)]).default(0),
  /** The SDXL checkpoint (empty = SDXL base 1.0). */
  checkpoint: z.string().max(160).optional(),
  /** Compare the result's edges with the source's and retry with less creativity when walls moved. */
  layoutCheck: z.boolean().default(true),
});
export type EnhanceParams = z.infer<typeof EnhanceParamsSchema>;

const dataUrl = z.string().min(20).max(12_000_000);

/** A label already projected by the browser: where it sits in the 3D world (the browser re-projects it on the result). */
export const StoredLabelSchema = z.object({
  roomId: z.string(),
  title: z.string(),
  detail: z.string(),
  world: z.object({ x: z.number(), y: z.number(), z: z.number() }),
});

export const EnhanceRequestSchema = z.object({
  projectId: z.string().min(1).max(64),
  projectName: z.string().max(120).default(''),
  params: EnhanceParamsSchema,
  images: z
    .object({
      /** The presentation render WITHOUT labels. */
      color: dataUrl,
      /** Normalised depth, near = white. */
      depth: dataUrl,
      /** Optional edge / line pass. */
      edge: dataUrl.optional(),
      /** The style reference picture (v2). */
      style: dataUrl.optional(),
    })
    .optional(),
  /** v2: take the picture, depth and region passes of a studio render stored on the server. */
  source: z
    .object({ kind: z.literal('studio'), id: z.string().regex(/^[a-f0-9]{16}$/) })
    .optional(),
  /** v2 with a studio source: the style reference picture (the studio render is not in the request). */
  style: dataUrl.optional(),
  /** The camera of all three images, so labels can be put back on the result. */
  view: z.object({
    viewProjection: z.array(z.number()).length(16),
    width: z.number().int().min(64).max(4096),
    height: z.number().int().min(64).max(4096),
  }),
  labels: z.array(StoredLabelSchema).max(60).default([]),
});
export type EnhanceRequest = z.infer<typeof EnhanceRequestSchema>;

/** A request needs pictures: its own, or a studio render on the server. */
export const EnhanceRequestChecked = EnhanceRequestSchema.refine((r) => !!r.images || !!r.source, {
  message: 'send the pictures or name a studio render',
  path: ['images'],
});

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface JobInfo {
  id: string;
  status: JobStatus;
  /** Jobs (of any kind) in front of this one on the GPU. */
  ahead: number;
  /** What the GPU is busy with right now. */
  gpuBusyWith: 'design' | 'render' | null;
  progress: { step: number; max: number } | null;
  error?: string;
}

export interface ResultMeta {
  id: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  params: EnhanceParams;
  width: number;
  height: number;
  hasEdge: boolean;
  view: EnhanceRequest['view'];
  labels: EnhanceRequest['labels'];
  /** Version of the workflow template that produced it. */
  workflow: number;
  // ── v2 ──
  pipeline?: 'v1' | 'v2';
  /** Where the source picture came from. */
  source?: 'studio' | 'live';
  /** How much of the source's layout the result kept (0–1), and how often it was retried with less creativity. */
  layoutScore?: number;
  retries?: number;
  /** Seconds the image model needed (all attempts). */
  seconds?: number;
  /** The creativity of the attempt that was kept. */
  creativityUsed?: number;
}

export interface RenderHealth {
  /** The server was told where ComfyUI is (COMFYUI_URL). */
  configured: boolean;
  /** ComfyUI answered just now. */
  reachable: boolean;
  /** What Enhance v2 can use on this ComfyUI (only when it is reachable). */
  capabilities?: {
    /** SDXL checkpoints to choose from. */
    checkpoints: string[];
    /** The IP-Adapter node pack, its SDXL weights and the CLIP vision encoder are there (style reference). */
    styleReference: boolean;
    /** The Ultimate SD Upscale node pack and an upscale model are there (tiled upscale). */
    tiledUpscale: boolean;
  };
}

/** The command that starts the optional image service. */
export const ENABLE_RENDER_COMMAND = 'docker compose up -d';
/** Shown while the image service is still starting (the first start downloads the models). */
export const WATCH_RENDER_COMMAND = 'docker compose logs -f comfyui-init';
