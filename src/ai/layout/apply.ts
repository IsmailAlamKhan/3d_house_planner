import { pointInPolygon } from '../../geometry/polygon';
import { projectOnSegment } from '../../geometry/vec';
import { t } from '../../i18n';
import * as ops from '../../model/ops';
import { ModelError } from '../../model/ops';
import type { Project } from '../../model/types';
import type { LayoutPlan, PlannedRoom } from './plan';
import { rectCenter } from './plan';
import { addFacadeWindows } from '../../wizard/shell';
import { wallFor } from './defaults';
import type { DesignIntent } from '../schemas';

const EXTERIOR_THICKNESS = 0.3;
const INTERIOR_THICKNESS = 0.15;

export interface ApplyResult {
  warnings: string[];
}

/**
 * Replaces the design (levels' walls, doors, windows, rooms, stairs, furniture, roofs) with a layout plan.
 * Fixed elements — the shell and structural columns — are kept. Runs inside ONE store `apply`, so it is one undo
 * step, and throws (changing nothing) if the plan breaks a model rule.
 */
export function applyPlan(
  p: Project,
  plan: LayoutPlan,
  style?: DesignIntent['style'],
): ApplyResult {
  const warnings: string[] = [];

  // Levels: reuse what exists, add or drop to match.
  const n = plan.levelNames.length;
  const oldColumns = p.columns.filter((c) => c.levelId === p.levels[0]?.id);
  while (p.levels.length < n) ops.addLevel(p);
  const dropped = p.levels.slice(n).map((l) => l.id);
  p.levels = p.levels.slice(0, n);
  p.columns = p.columns.filter((c) => !dropped.includes(c.levelId));
  p.levels.forEach((l, i) => {
    l.name = plan.levelNames[i]!;
    l.floorToCeiling = plan.floorToCeiling;
  });
  ops.updateLevel(p, p.levels[0]!.id, { floorToCeiling: plan.floorToCeiling });
  // Structural columns repeat on every level.
  for (const l of p.levels) {
    if (!p.columns.some((c) => c.levelId === l.id)) {
      for (const c of oldColumns)
        ops.addColumn(p, { levelId: l.id, position: c.position, size: c.size, shape: c.shape });
    }
  }

  // Clear the old design.
  p.walls = [];
  p.openings = [];
  p.rooms = [];
  p.stairs = [];
  p.items = [];
  p.roofs = [];

  const levelId = (i: number) => p.levels[i]!.id;

  for (const w of plan.walls) {
    ops.addWall(p, {
      levelId: levelId(w.level),
      start: w.start,
      end: w.end,
      type: w.type === 'exterior' ? 'exterior' : 'interior',
      thickness: w.type === 'exterior' ? EXTERIOR_THICKNESS : INTERIOR_THICKNESS,
      materialInside: 'paint-white',
      materialOutside: w.type === 'exterior' ? 'brick-red' : 'paint-white',
    });
  }

  // The building's existing windows are fixed: they go in first, planned openings fit around them.
  for (const l of p.levels) addFacadeWindows(p, l.id);

  for (const o of plan.openings) {
    const wall = p.walls.find(
      (w) =>
        w.levelId === levelId(o.level) && projectOnSegment(o.at, w.start, w.end).distance < 0.02,
    );
    if (!wall) {
      warnings.push(t('ai.warn.openingSkipped'));
      continue;
    }
    const offset = Math.hypot(o.at.x - wall.start.x, o.at.y - wall.start.y);
    try {
      ops.addOpening(p, {
        wallId: wall.id,
        offset,
        kind: o.kind,
        catalogId: o.catalogId,
        width: o.width,
        height: o.height,
        sillHeight: o.sillHeight,
        swing: o.kind === 'door' ? 'left' : 'none',
      });
    } catch (e) {
      if (!(e instanceof ModelError)) throw e;
      warnings.push(t('ai.warn.openingSkipped'));
    }
  }

  for (let i = 0; i + 1 < n; i++) {
    ops.addStair(p, {
      fromLevelId: levelId(i),
      toLevelId: levelId(i + 1),
      type: plan.stair.type,
      position: plan.stair.position,
      rotation: plan.stair.rotation,
      width: plan.stair.width,
    });
  }

  // Rooms are detected from the walls; then they receive the planned names, types and finishes.
  const wallMaterial = wallFor(style);
  for (let i = 0; i < n; i++) {
    ops.syncRooms(p, levelId(i));
    const planned = plan.rooms.filter((r) => r.level === i);
    for (const room of p.rooms.filter((r) => r.levelId === levelId(i))) {
      const match = planned.find((pr: PlannedRoom) =>
        pointInPolygon(rectCenter(pr.rect), room.polygon),
      );
      if (!match) continue;
      room.name = match.name;
      room.type = match.type;
      room.floorMaterial = match.floorMaterial;
      room.ceilingMaterial = match.ceilingMaterial;
      room.doubleHeight = match.doubleHeight ?? false;
      ops.paintRoomWalls(p, room.id, match.type === 'bathroom' ? 'tile-white' : wallMaterial);
    }
  }

  for (const it of plan.items) {
    try {
      ops.addItem(p, {
        levelId: levelId(it.level),
        catalogId: it.catalogId,
        position: it.position,
        rotation: it.rotation,
        elevation: it.elevation,
        scale: it.scale,
        props: it.props,
      });
    } catch (e) {
      if (!(e instanceof ModelError)) throw e;
    }
  }

  // Outdoors (villa on a plot): zones, gates and garden furniture replace the old site design.
  if (plan.site && p.kind === 'villa' && p.site.plot.length >= 3) {
    p.site.zones = [];
    p.site.gates = [];
    for (const z of plan.site.zones) ops.addZone(p, z);
    for (const g of plan.site.gates) ops.addGate(p, g);
    for (const it of plan.site.items) {
      try {
        ops.addItem(p, { levelId: levelId(0), ...it, elevation: 0 });
      } catch (e) {
        if (!(e instanceof ModelError)) throw e;
      }
    }
  }

  const top = n - 1;
  ops.addRoof(p, { levelId: levelId(top), kind: 'flat', polygon: p.shell.footprint });
  return { warnings };
}
