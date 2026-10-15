import type { Rect } from '../plan';

/** Mirrors a rectangle inside the shell. */
export const mirror = (r: Rect, shell: Rect, fx: boolean, fy: boolean): Rect => ({
  x: fx ? shell.x * 2 + shell.w - r.x - r.w : r.x,
  y: fy ? shell.y * 2 + shell.h - r.y - r.h : r.y,
  w: r.w,
  h: r.h,
});

/** Drops rectangles with no area. */
export const real = (rs: Rect[]): Rect[] => rs.filter((r) => r.w > 1e-6 && r.h > 1e-6);
