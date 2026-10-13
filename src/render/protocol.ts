import { z } from 'zod';

/** The shapes the browser and the app server agree on for "Enhance render" (shared, so both validate the same thing). */

export const CREATIVITY_RANGE = { min: 0.25, max: 0.6, default: 0.35 } as const;
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
  images: z.object({
    /** The presentation render WITHOUT labels. */
    color: dataUrl,
    /** Normalised depth, near = white. */
    depth: dataUrl,
    /** Optional edge / line pass. */
    edge: dataUrl.optional(),
  }),
  /** The camera of all three images, so labels can be put back on the result. */
  view: z.object({
    viewProjection: z.array(z.number()).length(16),
    width: z.number().int().min(64).max(4096),
    height: z.number().int().min(64).max(4096),
  }),
  labels: z.array(StoredLabelSchema).max(60).default([]),
});
export type EnhanceRequest = z.infer<typeof EnhanceRequestSchema>;

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
}

export interface RenderHealth {
  /** The server was told where ComfyUI is (COMFYUI_URL). */
  configured: boolean;
  /** ComfyUI answered just now. */
  reachable: boolean;
}

/** The command that starts the optional image service. */
export const ENABLE_RENDER_COMMAND = 'docker compose up -d';
/** Shown while the image service is still starting (the first start downloads the models). */
export const WATCH_RENDER_COMMAND = 'docker compose logs -f comfyui-init';
