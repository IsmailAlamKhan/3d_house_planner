import { polygonBounds } from '../../geometry/polygon';
import type { Project } from '../../model/types';

export type Vec3 = [number, number, number];
export type Preset = 'front' | 'back' | 'left' | 'right' | 'iso';
export const PRESETS: Preset[] = ['front', 'back', 'left', 'right', 'iso'];

export interface CamPose {
  position: Vec3;
  target: Vec3;
}

export const FOV = 45;

/** Centre of the footprint, its largest horizontal span and the top of the building. */
export function modelBox(project: Project) {
  const b = polygonBounds(project.shell.footprint);
  const top = Math.max(
    project.shell.maxHeight,
    ...project.levels.map((l) => l.elevation + l.floorToCeiling),
  );
  return {
    cx: (b.min.x + b.max.x) / 2,
    cz: (b.min.y + b.max.y) / 2,
    width: b.max.x - b.min.x,
    depth: b.max.y - b.min.y,
    top,
  };
}

/** Distance at which an object `w` wide and `h` tall fits a camera with vertical field of view FOV. */
export function fitDistance(w: number, h: number, aspect: number): number {
  const t = Math.tan((FOV * Math.PI) / 360);
  return Math.max(h / 2 / t, w / aspect / 2 / t);
}

/**
 * Camera pose for a named view. Plan (x, y) is world (x, z): "front" looks at the building from the bottom of the
 * plan (toward −z), "back" from the top, "left" from the −x side and "right" from the +x side.
 */
export function presetPose(project: Project, preset: Preset, aspect = 1.6): CamPose {
  const m = modelBox(project);
  const target: Vec3 = [m.cx, m.top / 2, m.cz];
  if (preset === 'iso') {
    const span = Math.max(m.width, m.depth, 4);
    const d = fitDistance(span * 1.25, m.top * 1.6, aspect) * 0.9;
    // 35° above the horizon, 45° around.
    const h = d * Math.sin((35 * Math.PI) / 180);
    const r = d * Math.cos((35 * Math.PI) / 180);
    return {
      target,
      position: [m.cx + r * Math.SQRT1_2, target[1] + h, m.cz + r * Math.SQRT1_2],
    };
  }
  const along = preset === 'front' || preset === 'back' ? m.width : m.depth;
  const depth = preset === 'front' || preset === 'back' ? m.depth : m.width;
  const d = fitDistance(along * 1.1, m.top * 1.2, aspect) + depth / 2;
  const sign = preset === 'front' || preset === 'right' ? 1 : -1;
  const position: Vec3 =
    preset === 'front' || preset === 'back'
      ? [m.cx, target[1], m.cz + sign * d]
      : [m.cx + sign * d, target[1], m.cz];
  return { position, target };
}

/** Orthographic plan view from above, with the zoom (pixels per metre) that fits the footprint in the viewport. */
export function topPose(
  project: Project,
  viewport: { width: number; height: number },
): CamPose & { zoom: number } {
  const m = modelBox(project);
  const zoom = Math.max(
    1,
    Math.min(
      viewport.width / Math.max(m.width * 1.25, 1),
      viewport.height / Math.max(m.depth * 1.25, 1),
    ),
  );
  return {
    // A hair off vertical so "up" on screen is north (−z) and the camera never looks along its own up vector.
    position: [m.cx, m.top + 20, m.cz + 0.01],
    target: [m.cx, 0, m.cz],
    zoom,
  };
}

/** Ease-in-out for camera transitions (0 → 1). */
export const smoothstep = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
