import { polygonBounds } from '../geometry/polygon';
import type { Project } from '../model/types';
import { type CamPose, type Vec3, fitPose } from '../scene3d/camera/views';
import type { LightingState } from '../scene3d/lighting';
import { PRESET_TIME } from '../scene3d/lighting';

export type PresentPreset = 'cutaway-top' | 'cutaway-34' | 'eye';
export const PRESENT_PRESETS: PresentPreset[] = ['cutaway-top', 'cutaway-34', 'eye'];

export type PresentLook = 'dusk' | 'daylight' | 'night';
export const PRESENT_LOOKS: PresentLook[] = ['dusk', 'daylight', 'night'];

/** The lighting state each look uses. */
export function lightingFor(look: PresentLook): LightingState {
  const mode = look === 'dusk' ? 'dusk' : look === 'night' ? 'night' : 'noon';
  return { mode, time: PRESET_TIME[mode] };
}

/** Where a cutaway camera looks from: straight down (a hair off, so walls get a little depth) or 3/4 at 55°. */
const DIRECTION: Record<'cutaway-top' | 'cutaway-34', Vec3> = {
  'cutaway-top': [0, 1, 0.16],
  'cutaway-34': [
    Math.cos((55 * Math.PI) / 180) * Math.sin((22 * Math.PI) / 180),
    Math.sin((55 * Math.PI) / 180),
    Math.cos((55 * Math.PI) / 180) * Math.cos((22 * Math.PI) / 180),
  ],
};

/** Height of the cut: walls are capped about here, so the box we frame is this tall. */
export const CUTAWAY_WALL_HEIGHT = 1.4;

/**
 * Camera pose that frames one level of the building (its footprint, floor to the wall cut) with a margin.
 * `eye` presets are not computed here: they use a saved view.
 */
export function cutawayPose(
  project: Project,
  preset: 'cutaway-top' | 'cutaway-34',
  levelId: string,
  aspect: number,
  margin = 1.12,
): CamPose {
  const level = project.levels.find((l) => l.id === levelId) ?? project.levels[0]!;
  const b = polygonBounds(project.shell.footprint);
  const box = {
    cx: (b.min.x + b.max.x) / 2,
    cz: (b.min.y + b.max.y) / 2,
    width: b.max.x - b.min.x,
    depth: b.max.y - b.min.y,
    top: CUTAWAY_WALL_HEIGHT,
  };
  const pose = fitPose(project, DIRECTION[preset], aspect, margin, box);
  const up = level.elevation;
  return {
    position: [pose.position[0], pose.position[1] + up, pose.position[2]],
    target: [pose.target[0], pose.target[1] + up, pose.target[2]],
  };
}
