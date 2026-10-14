import type { EnhanceParams } from './protocol';

/**
 * The Enhance presets. `reference` is tuned (npm run eval:enhance) to make a studio render of the villa read as the
 * reference picture: the reference's style through the style reference, the regions that matter prompted (pool, bedding,
 * cars, lawn …), the layout held by depth and edges, and a creativity low enough that nothing moves (layout kept ≥ 98 %). `subtle` only polishes; `bold` restyles more; `classic` is the
 * first pipeline (kept for comparison and for when the v2 parts are not installed).
 */
export type EnhancePresetId = 'reference' | 'subtle' | 'bold' | 'classic';
export const ENHANCE_PRESETS: EnhancePresetId[] = ['reference', 'subtle', 'bold', 'classic'];

export type PresetSettings = Pick<
  EnhanceParams,
  | 'pipeline'
  | 'creativity'
  | 'controlStrength'
  | 'edgeStrength'
  | 'ipWeight'
  | 'regions'
  | 'tiledUpscale'
  | 'steps'
  | 'layoutCheck'
>;

export const PRESET_SETTINGS: Record<EnhancePresetId, PresetSettings> = {
  reference: {
    pipeline: 'v2',
    creativity: 0.38,
    controlStrength: 0.8,
    edgeStrength: 0.45,
    ipWeight: 0.75,
    regions: true,
    tiledUpscale: 0,
    steps: 26,
    layoutCheck: true,
  },
  subtle: {
    pipeline: 'v2',
    creativity: 0.18,
    controlStrength: 0.9,
    edgeStrength: 0.7,
    ipWeight: 0,
    regions: false,
    tiledUpscale: 0,
    steps: 28,
    layoutCheck: true,
  },
  bold: {
    pipeline: 'v2',
    creativity: 0.5,
    controlStrength: 0.75,
    edgeStrength: 0.4,
    ipWeight: 0.9,
    regions: true,
    tiledUpscale: 0,
    steps: 26,
    layoutCheck: true,
  },
  classic: {
    pipeline: 'v1',
    creativity: 0.35,
    controlStrength: 0.8,
    edgeStrength: 0.5,
    ipWeight: 0,
    regions: false,
    tiledUpscale: 0,
    steps: 28,
    layoutCheck: false,
  },
};
