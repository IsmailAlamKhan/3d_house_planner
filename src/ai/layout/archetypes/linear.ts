import { dist } from '../../../geometry/vec';
import type { Rect } from '../plan';
import { rectCenter } from '../plan';
import { carveHall } from './carve';
import { hallPenalty } from './compact';
import { type Archetype, type ArchetypeInput, type Candidate, shapeOf, usable } from './types';

const CORRIDOR_W = 1.3;

/**
 * A corridor along one axis with rooms on both sides (double-loaded) or on one side (single-loaded). Multi-level
 * plans put the stair hall against the corridor.
 */
function corridorCandidates(i: ArchetypeInput, loading: 'double' | 'single'): Candidate[] {
  const { shell } = i;
  const out: Candidate[] = [];
  const archetype = loading === 'double' ? 'linear-double' : 'linear-single';
  for (const axis of ['x', 'y'] as const) {
    const long = axis === 'x' ? shell.w : shell.h;
    const across = axis === 'x' ? shell.h : shell.w;
    if (long < 7 || across < (loading === 'double' ? 6.8 : 4.8)) continue;
    // Where the corridor sits across the building.
    const offsets = loading === 'double' ? [0.42, 0.5, 0.58] : [0, 1];
    for (const f of offsets) {
      const along =
        loading === 'double' ? across * f - CORRIDOR_W / 2 : f === 0 ? 0 : across - CORRIDOR_W;
      const corridor: Rect =
        axis === 'x'
          ? { x: shell.x, y: shell.y + along, w: shell.w, h: CORRIDOR_W }
          : { x: shell.x + along, y: shell.y, w: CORRIDOR_W, h: shell.h };
      const sides: Rect[] =
        axis === 'x'
          ? [
              { x: shell.x, y: shell.y, w: shell.w, h: corridor.y - shell.y },
              {
                x: shell.x,
                y: corridor.y + CORRIDOR_W,
                w: shell.w,
                h: shell.y + shell.h - corridor.y - CORRIDOR_W,
              },
            ]
          : [
              { x: shell.x, y: shell.y, w: corridor.x - shell.x, h: shell.h },
              {
                x: corridor.x + CORRIDOR_W,
                y: shell.y,
                w: shell.x + shell.w - corridor.x - CORRIDOR_W,
                h: shell.h,
              },
            ];
      const regionsSides = sides.filter((r) => r.w > 1e-6 && r.h > 1e-6);
      if (!regionsSides.every(usable)) continue;
      const rooms = [
        { name: 'Corridor', type: 'corridor' as const, rect: corridor, levels: 'all' as const },
      ];
      if (!i.hall) {
        out.push({
          archetype,
          hall: { x: shell.x, y: shell.y, w: 0, h: 0 },
          regions: regionsSides,
          penalty: 2 + dist(rectCenter(corridor), i.entrance) * 0.1,
          orientation: axis,
          reach: corridor,
          rooms,
        });
        continue;
      }
      // Stair hall: in a corner of one side region, against the corridor.
      regionsSides.forEach((side, si) => {
        const others = regionsSides.filter((_, k) => k !== si);
        for (const c of carveHall(side, i.hall!.w, i.hall!.h)) {
          const touches =
            axis === 'x'
              ? Math.abs(c.hall.y + c.hall.h - corridor.y) < 1e-6 ||
                Math.abs(c.hall.y - (corridor.y + CORRIDOR_W)) < 1e-6
              : Math.abs(c.hall.x + c.hall.w - corridor.x) < 1e-6 ||
                Math.abs(c.hall.x - (corridor.x + CORRIDOR_W)) < 1e-6;
          if (!touches) continue;
          out.push({
            archetype,
            hall: c.hall,
            regions: [...others, ...c.pieces],
            penalty: hallPenalty(shell, c.hall, i.stairPosition, i.entrance) + 2,
            orientation: axis,
            rooms,
          });
        }
      });
    }
  }
  return out;
}

export const LINEAR_DOUBLE: Archetype = {
  id: 'linear-double',
  name: 'Linear with corridor',
  summary:
    'A straight corridor with rooms on both sides (double-loaded); every room opens off the corridor.',
  shapes: ['narrow', 'wide', 'deep'],
  area: [45, 400],
  levels: [1, 3],
  zones: {
    public: 'the end by the entrance',
    private: 'along the corridor, bedrooms on the quiet side',
    service: 'wet rooms back to back on the corridor wall',
    outdoor: 'garden at the far end',
  },
  entrance: 'at one end of the corridor',
  parking: 'in front, beside the entrance',
  garden: 'at the far end',
  suits: (i) => shapeOf(i.shell) !== 'square' || i.shell.w * i.shell.h >= 90,
  candidates: (i) => corridorCandidates(i, 'double'),
};

export const LINEAR_SINGLE: Archetype = {
  id: 'linear-single',
  name: 'Single-loaded corridor',
  summary:
    'A corridor along one outside wall, all rooms on the other side with their windows on the opposite wall.',
  shapes: ['narrow', 'wide'],
  area: [40, 200],
  levels: [1, 3],
  zones: {
    public: 'the entrance end',
    private: 'the quiet end',
    service: 'on the corridor wall',
    outdoor: 'garden along the room side',
  },
  entrance: 'at one end of the corridor',
  parking: 'in front',
  garden: 'along the rooms',
  suits: (i) =>
    shapeOf(i.shell) === 'narrow' ||
    (i.shell.w * i.shell.h >= 50 && Math.min(i.shell.w, i.shell.h) <= 8),
  candidates: (i) => corridorCandidates(i, 'single'),
};

export const APARTMENT_DOUBLE: Archetype = {
  id: 'apartment-double',
  name: 'Apartment, double-loaded',
  summary:
    'An apartment shell with its columns: a central corridor, rooms on both sides, wet rooms at the plumbing points.',
  shapes: ['wide', 'deep', 'narrow'],
  area: [40, 200],
  levels: [1, 1],
  zones: {
    public: 'living and kitchen on the shell side with the most light',
    private: 'bedrooms on the other side of the corridor',
    service: 'wet rooms at the fixed plumbing points',
    outdoor: 'balcony on the living side',
  },
  entrance: 'at the corridor end',
  parking: 'n/a',
  garden: 'n/a',
  suits: (i) => i.nLevels === 1 && i.columns.length > 0 && !i.villa,
  candidates: (i) =>
    corridorCandidates(i, 'double').map((c) => ({ ...c, archetype: 'apartment-double' })),
};
