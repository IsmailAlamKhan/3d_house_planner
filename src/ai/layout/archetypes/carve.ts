import type { Rect } from '../plan';
import { usable } from './types';

export interface Carved {
  hall: Rect;
  /** What is left of the region: rectangles that tile it together with the hall. */
  pieces: Rect[];
}

/**
 * Every way to put a hall of hw × hh in a corner of `region` (either orientation) and cut the remainder into at most
 * two rectangles that are all big enough for a room. A hall that nearly fills the region's depth is stretched to fill it.
 */
export function carveHall(region: Rect, hw: number, hh: number): Carved[] {
  const out: Carved[] = [];
  for (const [w0, h0] of [
    [hw, hh],
    [hh, hw],
  ] as const) {
    let w = w0;
    let h = h0;
    if (w > region.w + 1e-6 || h > region.h + 1e-6) continue;
    if (region.h - h < 1.8 && region.h - h < 1.0) h = region.h;
    if (region.w - w < 1.8 && region.w - w < 1.0) w = region.w;
    for (const fx of [false, true]) {
      for (const fy of [false, true]) {
        const hall: Rect = {
          x: fx ? region.x + region.w - w : region.x,
          y: fy ? region.y + region.h - h : region.y,
          w,
          h,
        };
        // Two ways to cut the rest: full-width strip then a block beside the hall, or the reverse.
        const ways: Rect[][] = [
          [
            { x: fx ? region.x : hall.x + w, y: region.y, w: region.w - w, h },
            { x: region.x, y: fy ? region.y : hall.y + h, w: region.w, h: region.h - h },
          ].map((r, k) => (k === 0 ? { ...r, y: hall.y } : r)),
          [
            { x: hall.x, y: fy ? region.y : hall.y + h, w, h: region.h - h },
            { x: fx ? region.x : hall.x + w, y: region.y, w: region.w - w, h: region.h },
          ],
        ];
        for (const way of ways) {
          const pieces = way.filter((r) => r.w > 1e-6 && r.h > 1e-6);
          if (pieces.every(usable)) out.push({ hall, pieces });
        }
      }
    }
  }
  return out;
}
