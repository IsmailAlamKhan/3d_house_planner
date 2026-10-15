import type { Point } from '../../../model/types';
import type { Rect } from '../plan';
import type { Archetype, Candidate } from './types';

/**
 * The "wings" arrangement of a villa: a central open hall (with a foyer at the front) and a wing of rooms on each
 * side. The front is the long side the entrance is on.
 */
export function wingsCandidate(shell: Rect, entrance: Point, withFoyer: boolean): Candidate | null {
  if (shell.w < 12 || shell.h < 8) return null;
  const centerW = Math.min(shell.w - 7, Math.max(6, shell.w * 0.4));
  const wingW = (shell.w - centerW) / 2;
  const foyerD = withFoyer ? Math.min(3.4, Math.max(2.4, shell.h * 0.18)) : 0;
  const frontIsBottom = entrance.y >= shell.y + shell.h / 2;
  const cx = shell.x + wingW;
  const hall: Rect = frontIsBottom
    ? { x: cx, y: shell.y, w: centerW, h: shell.h - foyerD }
    : { x: cx, y: shell.y + foyerD, w: centerW, h: shell.h - foyerD };
  const foyer: Rect = frontIsBottom
    ? { x: cx, y: shell.y + shell.h - foyerD, w: centerW, h: foyerD }
    : { x: cx, y: shell.y, w: centerW, h: foyerD };
  return {
    archetype: 'villa-wings',
    hall: { x: shell.x, y: shell.y, w: 0, h: 0 },
    regions: [
      { x: shell.x, y: shell.y, w: wingW, h: shell.h },
      { x: shell.x + wingW + centerW, y: shell.y, w: wingW, h: shell.h },
    ],
    penalty: 0,
    orientation: 'x',
    reach: hall,
    fixedRects: [
      ...(withFoyer ? [{ role: 'foyer' as const, rect: foyer }] : []),
      { role: 'hall', rect: hall },
    ],
  };
}

/** The reference villa's plan: a central hall with a wing of bedroom suites and service rooms on each side. */
export const VILLA_WINGS: Archetype = {
  id: 'villa-wings',
  name: 'Central hall with two wings',
  summary:
    'A large central living hall with a foyer at the front; a private wing on each side (bedroom suites on one, kitchen, gym and service on the other). The reference villa is this plan.',
  shapes: ['wide', 'square'],
  area: [120, 600],
  levels: [1, 1],
  zones: {
    public: 'the central hall and foyer',
    private: 'one wing with the bedroom suites',
    service: 'the other wing: kitchen, laundry, gym',
    outdoor: 'pool and garden behind the hall, parking in front',
  },
  entrance: 'centre of the front, into the foyer',
  parking: 'covered bay at the front',
  garden: 'behind the hall, facing the living space',
  suits: (i) => !!i.wings && i.nLevels === 1,
  candidates: (i) => {
    const c = wingsCandidate(i.shell, i.entrance, i.wings!.foyer);
    return c ? [c] : [];
  },
};
