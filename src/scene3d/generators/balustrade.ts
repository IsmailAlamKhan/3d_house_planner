import { BoxGeometry, type BufferGeometry } from 'three';
import { type Vec2, projectOnSegment } from '../../geometry/vec';
import type { Wall } from '../../model/types';
import { type Part, mergeAll } from './common';

export const BALUSTRADE_HEIGHT = 1.0;

/**
 * Glass balustrade with a slim handrail along the edge of a floor opening (the upper level of a double-height room).
 * Edges that run along an existing wall are skipped — the wall already guards them.
 */
export function generateVoidBalustrade(
  id: string,
  polygon: Vec2[],
  walls: Wall[],
  roomId: string,
): Part[] {
  const glass: BufferGeometry[] = [];
  const metal: BufferGeometry[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.2) continue;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Covered by a wall? (midpoint and both ends within the wall's thickness of its centre line)
    const covered = walls.some((w) =>
      [a, mid, b].every(
        (p) => projectOnSegment(p, w.start, w.end).distance <= w.thickness / 2 + 0.05,
      ),
    );
    if (covered) continue;
    const angle = -Math.atan2(b.y - a.y, b.x - a.x);
    const place = <T extends BufferGeometry>(g: T, y: number): T => {
      g.translate(0, y, 0);
      g.rotateY(angle);
      g.translate(mid.x, 0, mid.y);
      return g;
    };
    glass.push(
      place(
        new BoxGeometry(len - 0.08, BALUSTRADE_HEIGHT - 0.1, 0.02),
        0.05 + (BALUSTRADE_HEIGHT - 0.1) / 2,
      ),
    );
    metal.push(place(new BoxGeometry(len, 0.05, 0.07), BALUSTRADE_HEIGHT - 0.025));
    metal.push(place(new BoxGeometry(len, 0.04, 0.05), 0.02));
    for (const t of [-1, 1]) {
      const post = new BoxGeometry(0.05, BALUSTRADE_HEIGHT, 0.05);
      post.translate((t * (len - 0.05)) / 2, BALUSTRADE_HEIGHT / 2, 0);
      post.rotateY(angle);
      post.translate(mid.x, 0, mid.y);
      metal.push(post);
    }
  }
  const out: Part[] = [];
  const g = mergeAll(glass);
  const m = mergeAll(metal);
  const entity = { type: 'room' as const, id: roomId };
  if (g) out.push({ id: `${id}:glass`, layer: 'frame', entity, geometry: g, materials: ['glass'] });
  if (m) out.push({ id: `${id}:rail`, layer: 'frame', entity, geometry: m, materials: ['rail'] });
  return out;
}
