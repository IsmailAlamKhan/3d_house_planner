import { z } from 'zod';

/**
 * The studio render (Blender Cycles): what the browser sends and what the app server and the Blender job runner agree on.
 * A job is one "studio bundle": the design as a glb plus this sidecar (camera, light, sky, cutaway, output size).
 */

export const STUDIO_QUALITIES = ['preview', 'standard', 'poster'] as const;
export type StudioQuality = (typeof STUDIO_QUALITIES)[number];

/** Cycles samples and the long side of the picture for each quality preset. */
export const QUALITY_PRESETS: Record<StudioQuality, { samples: number; longSide: number }> = {
  preview: { samples: 64, longSide: 1280 },
  standard: { samples: 256, longSide: 1920 },
  poster: { samples: 1024, longSide: 3840 },
};

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const StudioLampSchema = z.object({
  id: z.string(),
  position: vec3,
  /** `#rrggbb` from the colour temperature. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /** Luminous flux of the bulb. */
  lumens: z.number().min(0),
  /** Spotlight beam angle in degrees (a point light when absent). */
  beam: z.number().min(5).max(180).optional(),
  aim: vec3.optional(),
  /** Soft accent lights (garden path, cabinet, ceiling glow) have a short reach and no bulb. */
  accent: z.boolean().default(false),
});
export type StudioLamp = z.infer<typeof StudioLampSchema>;

export const StudioWindowSchema = z.object({
  id: z.string(),
  position: vec3,
  aim: vec3,
  width: z.number().positive(),
  height: z.number().positive(),
});

export const StudioCameraSchema = z.object({
  /** The camera's world matrix, column-major (three.js `matrixWorld.toArray()`), y up. */
  matrixWorld: z.array(z.number()).length(16),
  kind: z.enum(['perspective', 'ortho']),
  /** Vertical field of view in degrees (perspective). */
  fov: z.number().min(5).max(150).default(45),
  /** Height in metres of the view (orthographic). */
  orthoHeight: z.number().positive().optional(),
  near: z.number().positive().default(0.1),
  far: z.number().positive().default(800),
});

export const StudioSidecarSchema = z.object({
  version: z.literal(1),
  projectId: z.string().max(64),
  projectName: z.string().max(120),
  /** Look name for the file name and the gallery ("reference" for the Reference look). */
  look: z.string().max(40).default('custom'),
  output: z.object({
    width: z.number().int().min(64).max(8192),
    height: z.number().int().min(64).max(8192),
  }),
  camera: StudioCameraSchema,
  environment: z.object({
    /** Which pack HDRI lights the sky. */
    hdri: z.enum(['day', 'dusk', 'night']),
    /** The strength of the sky light (1 = as photographed). */
    hdriStrength: z.number().min(0).max(10).default(1),
    sun: z.object({
      /** Unit vector from the scene towards the sun / moon. */
      direction: vec3,
      color: z.string(),
      /** Watts per square metre of the Blender sun lamp; 0 = none (dusk and night are lit by the sky). */
      strength: z.number().min(0).max(50),
    }),
    /** Exposure in stops (EV) applied by the view transform. */
    exposure: z.number().min(-8).max(8).default(0),
  }),
  cutaway: z.object({
    /** Ceilings and roofs are hidden from the camera but still shade and light the rooms. */
    enabled: z.boolean(),
    cutHeight: z.number().positive().optional(),
  }),
  lights: z.object({
    lamps: z.array(StudioLampSchema).max(300),
    windows: z.array(StudioWindowSchema).max(40),
  }),
  /** Projection × view matrix of the camera (column-major), to put labels on the finished picture. */
  viewProjection: z.array(z.number()).length(16).optional(),
  /** Soft glow around bright lights (the "Reference look"). */
  glare: z.boolean().default(false),
});
export type StudioSidecar = z.infer<typeof StudioSidecarSchema>;

/** Quality preset + the bundle's own settings: what the server hands to the Blender runner. */
export const StudioJobRequestSchema = z.object({
  quality: z.enum(STUDIO_QUALITIES),
});

export type StudioJobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface StudioJobInfo {
  id: string;
  status: StudioJobStatus;
  /** Jobs (of any kind) in front of this one on the GPU. */
  ahead: number;
  gpuBusyWith: 'design' | 'render' | null;
  /** Cycles progress: samples done of the total, and the estimated seconds left. */
  progress: { sample: number; total: number; etaSeconds: number | null } | null;
  error?: string;
}

export interface StudioResultMeta {
  id: string;
  kind: 'studio';
  projectId: string;
  projectName: string;
  look: string;
  quality: StudioQuality;
  createdAt: string;
  width: number;
  height: number;
  samples: number;
  /** Wall-clock seconds the render took. */
  seconds: number;
  /** The device Cycles used ("OPTIX: NVIDIA GeForce RTX 4060 Ti"). */
  device: string;
  /** Picture-space labels are re-applied by the browser from the camera. */
  viewProjection: number[];
  hasMask: boolean;
  hasDepth: boolean;
}

export interface StudioHealth {
  /** The server knows where Blender is (BLENDER_PATH, or BLENDER_URL for the docker service). */
  configured: boolean;
  /** Blender answered and Cycles has a GPU (OptiX / CUDA). */
  ready: boolean;
  /** "OPTIX: NVIDIA GeForce RTX 4060 Ti", or why Cycles has no GPU. */
  device?: string;
  version?: string;
  problem?: string;
}

/** The command that starts the optional Blender service. */
export const ENABLE_STUDIO_COMMAND = 'docker compose --profile render up -d';
