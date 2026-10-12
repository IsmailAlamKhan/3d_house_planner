import { projectOnSegment } from '../../geometry/vec';
import type { Project, Room } from '../../model/types';
import type { Side } from '../schemas';
import { roomBox } from './walls';

/** Which sides of a rectangular room lie along the apartment's outer wall. */
export function exteriorSides(p: Project, room: Room): Side[] {
  const b = roomBox(room);
  const fp = p.shell.footprint;
  const onOutline = (a: { x: number; y: number }, c: { x: number; y: number }) =>
    fp.some(
      (q, i) =>
        projectOnSegment(a, q, fp[(i + 1) % fp.length]!).distance < 1e-3 &&
        projectOnSegment(c, q, fp[(i + 1) % fp.length]!).distance < 1e-3,
    );
  const out: Side[] = [];
  if (onOutline({ x: b.min.x, y: b.min.y }, { x: b.max.x, y: b.min.y })) out.push('north');
  if (onOutline({ x: b.min.x, y: b.max.y }, { x: b.max.x, y: b.max.y })) out.push('south');
  if (onOutline({ x: b.min.x, y: b.min.y }, { x: b.min.x, y: b.max.y })) out.push('west');
  if (onOutline({ x: b.max.x, y: b.min.y }, { x: b.max.x, y: b.max.y })) out.push('east');
  return out;
}
