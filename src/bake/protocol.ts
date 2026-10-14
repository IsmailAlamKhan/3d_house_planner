import { z } from 'zod';
import { StudioSidecarSchema } from '../studio/protocol';

/**
 * Baked lighting: Blender (the studio service) bakes the diffuse lighting of the static geometry into one lightmap atlas
 * per lighting preset; the walkthrough shows it as `lightMap` on a second UV set. The browser makes the UV set (the
 * atlas), sends the static geometry and the lights, and keeps the result keyed on project + preset + revision.
 */

export const BAKE_PRESETS = ['day', 'dusk', 'night'] as const;
export type BakePreset = (typeof BAKE_PRESETS)[number];

export const BAKE_QUALITIES = ['low', 'medium', 'high'] as const;
export type BakeQuality = (typeof BAKE_QUALITIES)[number];

/** Texels per metre of the lightmap, and the Cycles samples, by quality. */
export const BAKE_DENSITY: Record<BakeQuality, { texelsPerMetre: number; samples: number }> = {
  low: { texelsPerMetre: 8, samples: 128 },
  medium: { texelsPerMetre: 16, samples: 256 },
  high: { texelsPerMetre: 32, samples: 512 },
};

/** One lightmapped mesh: the part's id, its vertex count after de-indexing and a hash of its geometry. */
export const BakePartSchema = z.object({
  id: z.string().max(200),
  vertexCount: z.number().int().positive(),
  /** Changes when the part's shape changes: such parts fall back to real-time light until the next bake. */
  hash: z.string().max(32),
});
export type BakePart = z.infer<typeof BakePartSchema>;

export const BakeSidecarSchema = StudioSidecarSchema.extend({
  bake: z.object({
    preset: z.enum(BAKE_PRESETS),
    atlasWidth: z.number().int().min(16).max(8192),
    atlasHeight: z.number().int().min(16).max(8192),
    parts: z.array(BakePartSchema).max(20000),
  }),
});
export type BakeSidecar = z.infer<typeof BakeSidecarSchema>;

export interface BakeMeta {
  projectId: string;
  preset: BakePreset;
  quality: BakeQuality;
  /** The revision key the bake was made for (see bakeKey.ts). */
  key: string;
  createdAt: string;
  atlas: { width: number; height: number };
  /** Multiply the decoded lightmap by this (it was normalised to fit 8 bits). */
  scale: number;
  /** Cycles bake time in seconds, samples, and the device. */
  seconds: number;
  samples: number;
  device: string;
  parts: BakePart[];
}

/** Which lighting preset a lighting state is baked for. */
export const presetOfMode = (mode: string, time: number): BakePreset =>
  mode === 'night'
    ? 'night'
    : mode === 'dusk' ||
        mode === 'evening' ||
        mode === 'marketing' ||
        (mode === 'custom' && time >= 18.5)
      ? 'dusk'
      : 'day';
