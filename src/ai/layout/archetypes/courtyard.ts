import type { Rect } from '../plan';
import { carveHall } from './carve';
import { hallPenalty } from './compact';
import { type Archetype, type ArchetypeInput, type Candidate, usable } from './types';

/** Rooms all around an open court (centred, or pushed towards the back so the front stays solid). */
function courtyardCandidates(i: ArchetypeInput): Candidate[] {
  const { shell } = i;
  const out: Candidate[] = [];
  const cw = Math.min(6, Math.max(3.2, shell.w * 0.26));
  const ch = Math.min(6, Math.max(3.2, shell.h * 0.26));
  const tx = (shell.w - cw) / 2;
  if (tx < 3 || (shell.h - ch) / 2 < 2.8) return out;
  // The court may sit towards the back (away from the entrance) as well as in the middle.
  const frontIsBottom = i.entrance.y >= shell.y + shell.h / 2;
  for (const shift of [0, 0.3]) {
    const midTop = (shell.h - ch) / 2;
    const top = Math.max(
      2.8,
      Math.min(shell.h - ch - 2.8, midTop + (frontIsBottom ? -1 : 1) * shift * midTop),
    );
    const court: Rect = { x: shell.x + tx, y: shell.y + top, w: cw, h: ch };
    const bands: Rect[] = [
      { x: shell.x, y: shell.y, w: shell.w, h: top },
      { x: shell.x, y: court.y + ch, w: shell.w, h: shell.h - top - ch },
      { x: shell.x, y: court.y, w: tx, h: ch },
      { x: court.x + cw, y: court.y, w: tx, h: ch },
    ];
    if (!bands.every(usable)) continue;
    if (!i.hall) {
      out.push({
        archetype: 'villa-courtyard',
        hall: { x: shell.x, y: shell.y, w: 0, h: 0 },
        regions: bands,
        penalty: 3,
        orientation: 'x',
        courts: [court],
      });
      continue;
    }
    // Stair hall in a corner of the front or back band.
    bands.slice(0, 2).forEach((band, bi) => {
      const rest = bands.filter((_, k) => k !== bi);
      for (const c of carveHall(band, i.hall!.w, i.hall!.h)) {
        out.push({
          archetype: 'villa-courtyard',
          hall: c.hall,
          regions: [...rest, ...c.pieces],
          penalty: hallPenalty(shell, c.hall, i.stairPosition, i.entrance) + 3,
          orientation: 'x',
          courts: [court],
        });
      }
    });
  }
  return out;
}

/** An L around a garden: the building wraps two sides of an open corner. */
function lShapeCandidates(i: ArchetypeInput): Candidate[] {
  const { shell } = i;
  const out: Candidate[] = [];
  const cw = Math.min(8, Math.max(3.6, shell.w * 0.34));
  const ch = Math.min(8, Math.max(3.6, shell.h * 0.34));
  if (shell.w - cw < 4.5 || shell.h - ch < 4.5) return out;
  for (const fx of [false, true]) {
    for (const fy of [false, true]) {
      const court: Rect = {
        x: fx ? shell.x : shell.x + shell.w - cw,
        y: fy ? shell.y : shell.y + shell.h - ch,
        w: cw,
        h: ch,
      };
      // The notch is at a corner; the L is a full-height column plus a block under (or over) the notch.
      const column: Rect = {
        x: fx ? shell.x + cw : shell.x,
        y: shell.y,
        w: shell.w - cw,
        h: shell.h,
      };
      const arm: Rect = {
        x: fx ? shell.x : shell.x + shell.w - cw,
        y: fy ? shell.y + ch : shell.y,
        w: cw,
        h: shell.h - ch,
      };
      const regions = [column, arm];
      if (!regions.every(usable)) continue;
      if (!i.hall) {
        out.push({
          archetype: 'villa-l-garden',
          hall: { x: shell.x, y: shell.y, w: 0, h: 0 },
          regions,
          penalty: 3,
          orientation: 'x',
          courts: [court],
        });
        continue;
      }
      regions.forEach((region, ri) => {
        const rest = regions.filter((_, k) => k !== ri);
        for (const c of carveHall(region, i.hall!.w, i.hall!.h)) {
          out.push({
            archetype: 'villa-l-garden',
            hall: c.hall,
            regions: [...rest, ...c.pieces],
            penalty: hallPenalty(shell, c.hall, i.stairPosition, i.entrance) + 3,
            orientation: 'x',
            courts: [court],
          });
        }
      });
    }
  }
  return out;
}

export const VILLA_COURTYARD: Archetype = {
  id: 'villa-courtyard',
  name: 'Courtyard',
  summary:
    'Rooms arranged around an open court, every room facing the court as well as the outside; the court is the cool, private heart of the house.',
  shapes: ['square', 'wide', 'deep'],
  area: [190, 600],
  levels: [1, 3],
  zones: {
    public: 'the front band, opening onto the court',
    private: 'the side and back bands',
    service: 'in the corners, away from the court',
    outdoor: 'the court itself, with the garden and pool behind',
  },
  entrance: 'through the front band into the court',
  parking: 'covered bay beside the front band',
  garden: 'the court and the plot behind',
  suits: (i) =>
    Math.min(i.shell.w, i.shell.h) >= 12 && i.shell.w * i.shell.h >= 190 && i.nLevels <= 2,
  candidates: courtyardCandidates,
};

export const VILLA_L_GARDEN: Archetype = {
  id: 'villa-l-garden',
  name: 'L around a garden',
  summary:
    'An L-shaped building wrapping an open garden corner: living rooms look onto the garden from two sides.',
  shapes: ['square', 'wide', 'deep'],
  area: [170, 500],
  levels: [1, 2],
  zones: {
    public: 'the long arm of the L, facing the garden',
    private: 'the short arm, quiet and far from the street',
    service: 'at the inner corner of the L',
    outdoor: 'the garden in the notch, with the pool',
  },
  entrance: 'at the end of the long arm',
  parking: 'in front of the long arm',
  garden: 'in the notch of the L',
  suits: (i) =>
    Math.min(i.shell.w, i.shell.h) >= 11 && i.shell.w * i.shell.h >= 170 && i.nLevels <= 2,
  candidates: lShapeCandidates,
};
