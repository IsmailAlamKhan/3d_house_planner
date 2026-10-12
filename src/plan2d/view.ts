import type { Vec2 } from '../geometry/vec';

export interface View {
  /** Pixels per meter. */
  scale: number;
  /** Screen position of world origin. */
  tx: number;
  ty: number;
}

export const MIN_SCALE = 5;
export const MAX_SCALE = 600;

export const toWorld = (v: View, sx: number, sy: number): Vec2 => ({
  x: (sx - v.tx) / v.scale,
  y: (sy - v.ty) / v.scale,
});

export const toScreen = (v: View, p: Vec2): Vec2 => ({
  x: p.x * v.scale + v.tx,
  y: p.y * v.scale + v.ty,
});

/** Zooms by `factor`, keeping the world point under screen position (sx, sy) fixed. */
export function zoomAt(v: View, sx: number, sy: number, factor: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
  const k = scale / v.scale;
  return { scale, tx: sx - (sx - v.tx) * k, ty: sy - (sy - v.ty) * k };
}

export const panBy = (v: View, dx: number, dy: number): View => ({
  ...v,
  tx: v.tx + dx,
  ty: v.ty + dy,
});

export function fitBounds(
  min: Vec2,
  max: Vec2,
  size: { w: number; h: number },
  padding = 48,
): View {
  const bw = Math.max(max.x - min.x, 0.1);
  const bh = Math.max(max.y - min.y, 0.1);
  const scale = Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, Math.min((size.w - padding * 2) / bw, (size.h - padding * 2) / bh)),
  );
  return {
    scale,
    tx: (size.w - bw * scale) / 2 - min.x * scale,
    ty: (size.h - bh * scale) / 2 - min.y * scale,
  };
}

const STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50];

/** Picks grid spacing so minor lines are at least ~14 px apart; major lines every 5th or 4th line. */
export function gridSpacing(scale: number): { minor: number; major: number } {
  const minor = STEPS.find((s) => s * scale >= 14) ?? STEPS[STEPS.length - 1]!;
  const major = minor * (minor === 0.25 || minor === 2 || minor === 25 ? 4 : 5);
  return { minor, major };
}
