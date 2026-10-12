import type { ReactNode } from 'react';
import { entryForOpening, getEntry, itemSize, withDefaults } from '../catalog';
import { boxCorners } from '../geometry/collide';
import { type Vec2, dist } from '../geometry/vec';
import type { Item, Opening, Project, Stair, Wall } from '../model/types';
import { layoutStair, stairFootprintPlan, stairVoidPlan } from '../scene3d/generators/stairs';
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

const ptsOf = (poly: Vec2[]) => poly.map((p) => `${p.x},${p.y}`).join(' ');

/** Plan polygons of a stair for hit-testing: its steps on the lower level, the arrival opening on the upper one. */
export function stairHitPolys(project: Project, stair: Stair, levelId: string): Vec2[][] {
  const from = project.levels.find((l) => l.id === stair.fromLevelId);
  const to = project.levels.find((l) => l.id === stair.toLevelId);
  if (!from || !to) return [];
  const layout = layoutStair(stair, from, to);
  if (levelId === stair.fromLevelId) return stairFootprintPlan(stair, layout);
  if (levelId === stair.toLevelId) return stairFootprintPlan(stair, layout);
  return [];
}

/**
 * Stair in plan. On its lower level: every step with an arrow marked UP. On the level it arrives at: the footprint
 * as a dashed outline (that is where the slab opens), marked DN — it is the same stair, so moving one moves both.
 */
export function StairSymbol({
  project,
  stair,
  levelId,
  selected,
  override,
}: {
  project: Project;
  stair: Stair;
  levelId: string;
  selected: boolean;
  override?: { position: Vec2; rotation: number };
}): ReactNode {
  const from = project.levels.find((l) => l.id === stair.fromLevelId);
  const to = project.levels.find((l) => l.id === stair.toLevelId);
  if (!from || !to) return null;
  const pose = override
    ? { ...stair, position: override.position, rotation: override.rotation }
    : stair;
  const layout = layoutStair(pose, from, to);
  const steps = stairFootprintPlan(pose, layout);
  const stroke = selected ? '#0284c7' : '#9d174d';
  const toWorld = (p: Vec2): Vec2 => ({
    x: pose.position.x + p.x * Math.cos(pose.rotation) - p.y * Math.sin(pose.rotation),
    y: pose.position.y + p.x * Math.sin(pose.rotation) + p.y * Math.cos(pose.rotation),
  });
  const run = layout.runs[0]?.points ?? [];
  const a = run[0] ? toWorld(run[0].p) : pose.position;
  const b = run.length ? toWorld(run[run.length - 1]!.p) : pose.position;
  const isFrom = levelId === stair.fromLevelId;
  const label = isFrom ? 'UP' : 'DN';
  const voids = stairVoidPlan(pose, layout);
  return (
    <g data-stair={stair.id} pointerEvents="none">
      {isFrom ? (
        <>
          {steps.map((poly, i) => (
            <polygon
              key={i}
              points={ptsOf(poly)}
              fill={selected ? '#e0f2fe' : '#fdf2f8'}
              fillOpacity={0.9}
              stroke={stroke}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={stroke}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={a.x} cy={a.y} r={0.07} fill={stroke} />
        </>
      ) : (
        voids.map((poly, i) => (
          <polygon
            key={i}
            points={ptsOf(poly)}
            fill="none"
            stroke={stroke}
            strokeWidth={1.5}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
        ))
      )}
      <text
        x={(a.x + b.x) / 2}
        y={(a.y + b.y) / 2 - 0.15}
        fontSize={0.22}
        textAnchor="middle"
        fill={stroke}
        fontWeight={700}
      >
        {label}
      </text>
    </g>
  );
}
