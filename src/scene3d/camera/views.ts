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

const DIRECTIONS: Record<Preset, Vec3> = {
  // Unit vectors from the building towards the camera.
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  iso: [
    Math.cos((35 * Math.PI) / 180) * Math.SQRT1_2,
    Math.sin((35 * Math.PI) / 180),
    Math.cos((35 * Math.PI) / 180) * Math.SQRT1_2,
  ],
};

/**
 * Camera pose looking at the middle of the building from direction `dir`, as close as possible while every corner of
 * the building's bounding box still fits the view (perspective-correct, for any window aspect ratio).
 */
export function fitPose(project: Project, dir: Vec3, aspect: number, margin = 1.08): CamPose {
  const m = modelBox(project);
  const target: Vec3 = [m.cx, m.top / 2, m.cz];
  const len = Math.hypot(...dir) || 1;
  const d0: Vec3 = [dir[0] / len, dir[1] / len, dir[2] / len];
  const f: Vec3 = [-d0[0], -d0[1], -d0[2]]; // viewing direction
  // right = f × up, up' = right × f
  const rx = f[1] * 0 - f[2] * 1;
  const ry = f[2] * 0 - f[0] * 0;
  const rz = f[0] * 1 - f[1] * 0;
  const rl = Math.hypot(rx, ry, rz) || 1;
  const right: Vec3 = [rx / rl, ry / rl, rz / rl];
  const up: Vec3 = [
    right[1] * f[2] - right[2] * f[1],
    right[2] * f[0] - right[0] * f[2],
    right[0] * f[1] - right[1] * f[0],
  ];
  const t = Math.tan((FOV * Math.PI) / 360);
  let dist = 2;
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const rel: Vec3 = [(sx * m.width) / 2, (sy * m.top) / 2, (sz * m.depth) / 2];
        const xr = Math.abs(rel[0] * right[0] + rel[1] * right[1] + rel[2] * right[2]);
        const yu = Math.abs(rel[0] * up[0] + rel[1] * up[1] + rel[2] * up[2]);
        const zf = rel[0] * f[0] + rel[1] * f[1] + rel[2] * f[2];
        dist = Math.max(dist, xr / (aspect * t) - zf, yu / t - zf);
      }
  dist *= margin;
  return {
    target,
    position: [target[0] + d0[0] * dist, target[1] + d0[1] * dist, target[2] + d0[2] * dist],
  };
}

/**
 * Camera pose for a named view. Plan (x, y) is world (x, z): "front" looks at the building from the bottom of the
 * plan (toward −z), "back" from the top, "left" from the −x side and "right" from the +x side.
 */
export function presetPose(project: Project, preset: Preset, aspect = 1.6): CamPose {
  return fitPose(project, DIRECTIONS[preset], aspect);
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
