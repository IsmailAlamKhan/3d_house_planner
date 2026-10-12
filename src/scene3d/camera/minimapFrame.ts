import { polygonBounds } from '../../geometry/polygon';
import type { Vec2 } from '../../geometry/vec';
import type { Project } from '../../model/types';

export interface MinimapFrame {
  width: number;
  height: number;
  /** Pixels per metre. */
  scale: number;
  /** Plan coordinates of the top-left corner of the map. */
  origin: Vec2;
}

/** Fits the footprint (with a margin) into a map box of the given size. */
export function minimapFrame(
  project: Project,
  box: { width: number; height: number },
  margin = 0.6,
): MinimapFrame {
  const b = polygonBounds(project.shell.footprint);
  const w = b.max.x - b.min.x + margin * 2;
  const h = b.max.y - b.min.y + margin * 2;
  const scale = Math.min(box.width / w, box.height / h);
  const width = w * scale;
  const height = h * scale;
  return { width, height, scale, origin: { x: b.min.x - margin, y: b.min.y - margin } };
}

export const toMap = (f: MinimapFrame, p: Vec2): Vec2 => ({
  x: (p.x - f.origin.x) * f.scale,
  y: (p.y - f.origin.y) * f.scale,
});

export const fromMap = (f: MinimapFrame, p: Vec2): Vec2 => ({
  x: p.x / f.scale + f.origin.x,
  y: p.y / f.scale + f.origin.y,
});
