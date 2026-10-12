import type { ReactNode } from 'react';
import { entryForOpening, getEntry, itemSize, withDefaults } from '../catalog';
import { boxCorners } from '../geometry/collide';
import { type Vec2, dist } from '../geometry/vec';
import type { Item, Opening, Wall } from '../model/types';
import { insideSign } from '../scene3d/generators/walls';

const rad = (r: number) => (r * 180) / Math.PI;

/** Plan symbol of a furniture item at its position and rotation. `override` previews a different pose. */
export function ItemSymbol({
  item,
  override,
  tint,
}: {
  item: Item;
  override?: { position: Vec2; rotation: number };
  tint?: string;
}): ReactNode {
  const entry = getEntry(item.catalogId);
  const pos = override?.position ?? item.position;
  const rot = override?.rotation ?? item.rotation;
  if (!entry) return null;
  const size = itemSize(entry, item.scale);
  return (
    <g
      transform={`translate(${pos.x} ${pos.y}) rotate(${rad(rot)})`}
      data-item={item.id}
      style={tint ? { filter: 'none' } : undefined}
      opacity={tint ? 0.85 : 1}
    >
      {entry.draw2D(withDefaults(entry, item.props), size)}
      {tint && (
        <rect
          x={-size.w / 2}
          y={-size.d / 2}
          width={size.w}
          height={size.d}
          fill={tint}
          fillOpacity={0.25}
          stroke={tint}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
}

/** Where an opening sits in plan: centre point, wall angle (degrees). */
export function openingFrame(
  o: Pick<Opening, 'offset'>,
  wall: Pick<Wall, 'start' | 'end'>,
): { center: Vec2; angle: number } {
  const len = dist(wall.start, wall.end) || 1;
  const ux = (wall.end.x - wall.start.x) / len;
  const uy = (wall.end.y - wall.start.y) / len;
  return {
    center: { x: wall.start.x + ux * o.offset, y: wall.start.y + uy * o.offset },
    angle: rad(Math.atan2(uy, ux)),
  };
}

/** Plan symbol of a door or window, drawn in the wall's local frame (x along the wall, y across it). */
export function OpeningSymbol({
  opening,
  wall,
  footprint,
  override,
  tint,
}: {
  opening: Opening;
  wall: Wall;
  footprint: Vec2[];
  override?: { offset: number };
  tint?: string;
}): ReactNode {
  const entry = entryForOpening(opening.catalogId, opening.kind);
  const { center, angle } = openingFrame({ offset: override?.offset ?? opening.offset }, wall);
  const size = { w: opening.width, d: wall.thickness, h: opening.height };
  const ctx = {
    swing: opening.swing,
    flip: opening.flip,
    outward: (insideSign(wall, footprint) === 1 ? -1 : 1) as 1 | -1,
  };
  return (
    <g
      transform={`translate(${center.x} ${center.y}) rotate(${angle})`}
      data-opening={opening.id}
      pointerEvents="none"
    >
      {entry.draw2D(withDefaults(entry, opening.props), size, ctx)}
      {tint && (
        <rect
          x={-size.w / 2}
          y={-size.d / 2 - 0.02}
          width={size.w}
          height={size.d + 0.04}
          fill={tint}
          fillOpacity={0.25}
          stroke={tint}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
}

/** Corners of an item's footprint in plan (for selection outlines and hit tests). */
export function itemCorners(item: Item, pose?: { position: Vec2; rotation: number }): Vec2[] {
  const entry = getEntry(item.catalogId);
  const size = entry ? itemSize(entry, item.scale) : { w: 0.5, d: 0.5, h: 0.5 };
  return boxCorners(
    pose?.position ?? item.position,
    size.w,
    size.d,
    pose?.rotation ?? item.rotation,
  );
}
