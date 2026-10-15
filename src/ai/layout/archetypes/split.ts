import type { Rect } from '../plan';
import { hallPenalty } from './compact';
import { type Archetype, type Candidate, usable } from './types';

/** Split duplex: the stair hall sits in the middle of one side and the rooms form two halves around it. */
export const DUPLEX_SPLIT: Archetype = {
  id: 'duplex-split',
  name: 'Split duplex',
  summary:
    'Two halves joined by a central stair hall: public rooms on one side of it, private rooms on the other.',
  shapes: ['wide', 'deep', 'square'],
  area: [70, 260],
  levels: [2, 3],
  zones: {
    public: 'one half of each floor, next to the entrance',
    private: 'the other half, behind the stair',
    service: 'against the stair hall',
    outdoor: 'garden along the private half',
  },
  entrance: 'into the middle hall',
  parking: 'beside the entrance half',
  garden: 'along the long side',
  suits: (i) =>
    i.nLevels > 1 && !!i.hall && Math.min(i.shell.w, i.shell.h) >= 7 && i.shell.w * i.shell.h >= 70,
  candidates: (i) => {
    const { shell } = i;
    const out: Candidate[] = [];
    for (const [hw, hh] of [
      [i.hall!.w, i.hall!.h],
      [i.hall!.h, i.hall!.w],
    ] as const) {
      // Flush with each of the four sides, centred on it.
      for (const side of ['N', 'S', 'W', 'E'] as const) {
        const horizontal = side === 'N' || side === 'S';
        const hall: Rect = horizontal
          ? {
              x: shell.x + (shell.w - hw) / 2,
              y: side === 'N' ? shell.y : shell.y + shell.h - hh,
              w: hw,
              h: hh,
            }
          : {
              x: side === 'W' ? shell.x : shell.x + shell.w - hw,
              y: shell.y + (shell.h - hh) / 2,
              w: hw,
              h: hh,
            };
        if (hall.w > shell.w - 6.5 && horizontal) continue;
        if (hall.h > shell.h - 6.5 && !horizontal) continue;
        const regions: Rect[] = horizontal
          ? [
              { x: shell.x, y: shell.y, w: hall.x - shell.x, h: shell.h },
              {
                x: hall.x + hall.w,
                y: shell.y,
                w: shell.x + shell.w - hall.x - hall.w,
                h: shell.h,
              },
              {
                x: hall.x,
                y: side === 'N' ? hall.y + hall.h : shell.y,
                w: hall.w,
                h: shell.h - hall.h,
              },
            ]
          : [
              { x: shell.x, y: shell.y, w: shell.w, h: hall.y - shell.y },
              {
                x: shell.x,
                y: hall.y + hall.h,
                w: shell.w,
                h: shell.y + shell.h - hall.y - hall.h,
              },
              {
                x: side === 'W' ? hall.x + hall.w : shell.x,
                y: hall.y,
                w: shell.w - hall.w,
                h: hall.h,
              },
            ];
        const rs = regions.filter((r) => r.w > 1e-6 && r.h > 1e-6);
        if (!rs.every(usable)) continue;
        out.push({
          archetype: 'duplex-split',
          hall,
          regions: rs,
          penalty: hallPenalty(shell, hall, i.stairPosition, i.entrance) + 1.5,
          orientation: hw >= hh ? 'x' : 'y',
        });
      }
    }
    return out;
  },
};
