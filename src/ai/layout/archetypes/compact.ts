import { dist } from '../../../geometry/vec';
import type { Point } from '../../../model/types';
import type { DesignIntent } from '../../schemas';
import type { Rect } from '../plan';
import { rectArea, rectCenter } from '../plan';
import { mirror, real } from './geometry';
import type { Archetype, Candidate } from './types';

/** Every way of putting a hall of size hw × hh in a corner and cutting the rest into one or two rectangles. */
export function hallCandidates(
  shell: Rect,
  hw: number,
  hh: number,
  pos: DesignIntent['stair']['position'],
  entrance: Point,
  archetype = 'duplex-stacked',
): Candidate[] {
  const out: Candidate[] = [];
  const dims: ['x' | 'y', number, number][] = [
    ['x', hw, hh],
    ['y', hh, hw],
  ];
  for (const [orientation, w, h] of dims) {
    if (w > shell.w - 0.1 || h > shell.h - 0.1) continue;
    for (const fx of [false, true]) {
      for (const fy of [false, true]) {
        const hall0: Rect = { x: shell.x, y: shell.y, w, h };
        const way1: Rect[] = [
          { x: shell.x + w, y: shell.y, w: shell.w - w, h },
          { x: shell.x, y: shell.y + h, w: shell.w, h: shell.h - h },
        ];
        const way2: Rect[] = [
          { x: shell.x, y: shell.y + h, w, h: shell.h - h },
          { x: shell.x + w, y: shell.y, w: shell.w - w, h: shell.h },
        ];
        for (const regions0 of [way1, way2]) {
          const regions = real(regions0).map((r) => mirror(r, shell, fx, fy));
          if (regions.some((r) => rectArea(r) < 5.5 || Math.min(r.w, r.h) < 1.8)) continue;
          const hall = mirror(hall0, shell, fx, fy);
          out.push({
            archetype,
            hall,
            regions,
            penalty: hallPenalty(shell, hall, pos, entrance) + (regions.length === 1 ? 2 : 0),
            orientation,
          });
        }
      }
    }
  }
  return out;
}

/** How far a hall sits from where the brief wants the stair (lower is better). */
export function hallPenalty(
  shell: Rect,
  hall: Rect,
  pos: DesignIntent['stair']['position'],
  entrance: Point,
): number {
  const c = rectCenter(hall);
  return pos === 'near-entrance'
    ? dist(c, entrance) * 0.9
    : pos === 'back'
      ? -dist(c, entrance) * 0.6
      : pos === 'left'
        ? Math.abs(c.x - shell.x)
        : pos === 'right'
          ? Math.abs(c.x - (shell.x + shell.w))
          : dist(c, rectCenter(shell));
}

/** Stacked duplex: living below, bedrooms above, the stair hall in a corner; also the compact square plan. */
export const DUPLEX_STACKED: Archetype = {
  id: 'duplex-stacked',
  name: 'Stacked duplex',
  summary:
    'Living, kitchen and dining below, bedrooms above, the stair hall in a corner next to the entrance.',
  shapes: ['square', 'wide', 'deep'],
  area: [40, 220],
  levels: [2, 3],
  zones: {
    public: 'ground floor, entrance side',
    private: 'upper floor, away from the street',
    service: 'beside the stair so pipes stack',
    outdoor: 'garden on the side away from the entrance',
  },
  entrance: 'on the stair hall side',
  parking: 'in front',
  garden: 'behind',
  suits: (i) => i.nLevels > 1 && !!i.hall,
  candidates: (i) =>
    hallCandidates(i.shell, i.hall!.w, i.hall!.h, i.stairPosition, i.entrance, 'duplex-stacked'),
};

/** Loft duplex: a double-height living room takes the largest region; same corner hall. */
export const DUPLEX_LOFT: Archetype = {
  id: 'duplex-loft',
  name: 'Loft duplex',
  summary: 'A double-height living room open to the floor above, the stair hall in a corner.',
  shapes: ['square', 'wide', 'deep'],
  area: [60, 220],
  levels: [2, 3],
  zones: {
    public: 'double-height living room on the ground floor',
    private: 'upper floor around the void',
    service: 'beside the stair',
    outdoor: 'garden facing the living room',
  },
  entrance: 'next to the living room',
  parking: 'in front',
  garden: 'behind the living room',
  suits: (i) => i.nLevels > 1 && !!i.hall && i.doubleHeight,
  candidates: (i) =>
    hallCandidates(i.shell, i.hall!.w, i.hall!.h, i.stairPosition, i.entrance, 'duplex-loft').map(
      (c) => ({
        ...c,
        penalty: c.penalty - 3,
      }),
    ),
};

/** Compact square: one level, or a plain block, rooms around a single circulation point. */
export const COMPACT_SQUARE: Archetype = {
  id: 'compact-square',
  name: 'Compact square',
  summary: 'One block, rooms tiled around the entrance, the least circulation.',
  shapes: ['square', 'wide', 'deep'],
  area: [20, 140],
  levels: [1, 1],
  zones: {
    public: 'around the entrance',
    private: 'far corner',
    service: 'centre, sharing walls',
    outdoor: 'garden behind',
  },
  entrance: 'on the longest side',
  parking: 'in front',
  garden: 'behind',
  suits: (i) => i.nLevels === 1 && !i.wings,
  candidates: (i) => [
    {
      archetype: 'compact-square',
      hall: { x: i.shell.x, y: i.shell.y, w: 0, h: 0 },
      regions: [i.shell],
      penalty: 0,
      orientation: 'x',
    },
  ],
};
