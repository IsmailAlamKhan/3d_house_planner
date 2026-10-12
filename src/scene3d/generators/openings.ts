import { Group } from 'three';
import { entryForOpening, withDefaults } from '../../catalog';
import { type Vec2, dist } from '../../geometry/vec';
import type { Opening, Wall } from '../../model/types';
import type { ObjectPart } from './common';
import { insideSign } from './walls';

export interface OpeningBuildInput {
  opening: Opening;
  wall: Wall;
  /** Door leaves are drawn ajar when true, closed otherwise. */
  doorsOpen: boolean;
  /** Shell footprint — tells bay windows which side is outdoors. */
  footprint: Vec2[];
}

/**
 * Frame, leaf / sash and glass for one door or window, from the catalog model for its style.
 * The object is placed on the wall (origin = centre of the opening at sill height).
 */
export function generateOpeningParts({
  opening: o,
  wall,
  doorsOpen,
  footprint,
}: OpeningBuildInput): ObjectPart[] {
  if (o.kind === 'archway') return [];
  const entry = entryForOpening(o.catalogId, o.kind);
  const model = entry.build3D(
    withDefaults(entry, o.props),
    { w: o.width, d: wall.thickness, h: o.height },
    {
      swing: o.swing,
      flip: o.flip,
      open: doorsOpen,
      outward: insideSign(wall, footprint) === 1 ? -1 : 1,
    },
  );
  const len = dist(wall.start, wall.end);
  const ux = (wall.end.x - wall.start.x) / len;
  const uy = (wall.end.y - wall.start.y) / len;
  const holder = new Group();
  holder.position.set(wall.start.x + ux * o.offset, o.sillHeight, wall.start.y + uy * o.offset);
  holder.rotation.y = -Math.atan2(uy, ux);
  holder.add(model);
  return [
    {
      id: `opening:${o.id}`,
      layer: 'frame',
      entity: { type: 'opening', id: o.id },
      object: holder,
      clipToCut: true,
    },
  ];
}
