import { getEntry, itemSize } from '../catalog';
import { boxCorners, overlapDepth } from '../geometry/collide';
import { polygonArea, polygonBounds, pointInPolygon } from '../geometry/polygon';
import { type Vec2, dist, projectOnSegment } from '../geometry/vec';
import { type TranslationKey, t } from '../i18n';
import type { Opening, Project, Room, Wall } from '../model/types';
import { formatArea, formatLength } from '../ui/units';
import { layoutStair, stairFootprintPlan, validateStair } from '../scene3d/generators/stairs';
import { isVoidRoom } from './voidRoom';
import { DEFAULT_MIN_AREAS, type CheckIssue } from './types';

const sub = (template: string, vars: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
const rectOf = (poly: Vec2[], pad = 0.3) => {
  const b = polygonBounds(poly);
  return {
    min: { x: b.min.x - pad, y: b.min.y - pad },
    max: { x: b.max.x + pad, y: b.max.y + pad },
  };
};
const nameOf = (room: Room | undefined) => room?.name ?? t('checks.outside');
const levelName = (project: Project, id: string) =>
  project.levels.find((l) => l.id === id)?.name ?? '';

/** The two rooms a door/window connects (undefined = outside / no room on that side). */
export function sidesOf(
  project: Project,
  wall: Wall,
  o: Opening,
): [Room | undefined, Room | undefined] {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy) || 1;
  const c = { x: wall.start.x + (dx / len) * o.offset, y: wall.start.y + (dy / len) * o.offset };
  const k = wall.thickness / 2 + 0.12;
  const probe = (s: number) => ({ x: c.x + (-dy / len) * k * s, y: c.y + (dx / len) * k * s });
  const find = (p: Vec2) =>
    project.rooms.find((r) => r.levelId === wall.levelId && pointInPolygon(p, r.polygon));
  return [find(probe(1)), find(probe(-1))];
}

const centerOf = (o: Opening, w: Wall): Vec2 => {
  const len = dist(w.start, w.end) || 1;
  return {
    x: w.start.x + ((w.end.x - w.start.x) / len) * o.offset,
    y: w.start.y + ((w.end.y - w.start.y) / len) * o.offset,
  };
};

// ───────────────────────── stairs ─────────────────────────

export function stairRules(project: Project): CheckIssue[] {
  const out: CheckIssue[] = [];
  for (const stair of project.stairs) {
    const from = project.levels.find((l) => l.id === stair.fromLevelId);
    const to = project.levels.find((l) => l.id === stair.toLevelId);
    if (!from || !to) continue;
    const layout = layoutStair(stair, from, to);
    const target = { levelId: from.id, selection: { type: 'stair' as const, ids: [stair.id] } };
    for (const w of validateStair(project, stair)) {
      const headroom = /[Hh]eadroom/.test(w);
      const fit = /inside the apartment/.test(w);
      out.push({
        id: `stair:${stair.id}:${w}`,
        rule: headroom ? 'stair-headroom' : fit ? 'stair-fit' : 'stair-comfort',
        severity: headroom || fit ? 'error' : 'warning',
        message: w,
        target,
      });
    }
    // Beams over the stair.
    for (const beam of project.shell.beams) {
      const bottom = from.floorToCeiling - beam.drop;
      const beamPoly = beamPolygon(beam.start, beam.end, beam.width);
      const steps = stairFootprintPlan(stair, layout);
      let worst = Infinity;
      steps.forEach((poly, i) => {
        if (overlapDepth(poly, beamPoly) > 0.02)
          worst = Math.min(worst, bottom - layout.steps[i]!.top);
      });
      if (worst < 2.0 - 1e-6) {
        out.push({
          id: `beam-stair:${beam.id}:${stair.id}`,
          rule: 'beam-headroom',
          severity: 'error',
          message: sub(t('checks.beamStair'), {
            h: formatLength(Math.max(worst, 0), project.units),
          }),
          target: {
            levelId: from.id,
            rect: rectOf(beamPoly, 0.5),
            selection: { type: 'stair', ids: [stair.id] },
          },
        });
      }
    }
  }
  return out;
}

export function beamPolygon(a: Vec2, b: Vec2, width: number): Vec2[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (width / 2);
  const ny = (dx / len) * (width / 2);
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ];
}

// ───────────────────────── reachability ─────────────────────────

/** Rooms that cannot be reached from the entrance (through doors/archways, and the stair between levels). */
export function reachabilityRules(project: Project): CheckIssue[] {
  const out: CheckIssue[] = [];
  if (!project.rooms.length) return out;
  const rooms = project.rooms.filter((r) => !isVoidRoom(project, r));
  const ground = project.levels.find((l) => l.index === 0);
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  for (const o of project.openings) {
    if (o.kind === 'window') continue;
    const wall = project.walls.find((w) => w.id === o.wallId);
    if (!wall) continue;
    const [a, b] = sidesOf(project, wall, o);
    if (a && b && a.id !== b.id) link(a.id, b.id);
  }
  // The stair joins the rooms it lands in on both levels.
  for (const s of project.stairs) {
    const from = project.levels.find((l) => l.id === s.fromLevelId);
    const to = project.levels.find((l) => l.id === s.toLevelId);
    if (!from || !to) continue;
    const layout = layoutStair(s, from, to);
    const pts = stairFootprintPlan(s, layout).flat();
    const roomFor = (levelId: string) => {
      for (const p of pts) {
        const r = project.rooms.find((x) => x.levelId === levelId && pointInPolygon(p, x.polygon));
        if (r) return r;
      }
      return undefined;
    };
    const lower = roomFor(from.id);
    const upper = roomFor(to.id);
    if (lower && upper) link(lower.id, upper.id);
  }
  // Start: the room just inside the entrance.
  const ep = project.shell.entrance.position;
  const groundRooms = project.rooms.filter((r) => r.levelId === ground?.id);
  let entranceRoom: Room | undefined;
  const entranceDoor = project.openings.find((o) => {
    const w = project.walls.find((x) => x.id === o.wallId);
    return w && w.levelId === ground?.id && o.kind === 'door' && dist(centerOf(o, w), ep) < 1.6;
  });
  if (entranceDoor) {
    const w = project.walls.find((x) => x.id === entranceDoor.wallId)!;
    const [a, b] = sidesOf(project, w, entranceDoor);
    entranceRoom = a ?? b;
  }
  if (!entranceDoor) {
    out.push({
      id: 'entrance:missing',
      rule: 'entrance',
      severity: 'warning',
      message: t('checks.entranceMissing'),
      target: {
        levelId: ground?.id,
        rect: { min: { x: ep.x - 1.2, y: ep.y - 1.2 }, max: { x: ep.x + 1.2, y: ep.y + 1.2 } },
      },
    });
  }
  entranceRoom ??= groundRooms.slice().sort((a, b) => nearest(ep, a) - nearest(ep, b))[0];
  if (!entranceRoom) return out;
  const reached = new Set([entranceRoom.id]);
  const queue = [entranceRoom.id];
  while (queue.length) {
    for (const n of adj.get(queue.shift()!) ?? []) {
      if (!reached.has(n)) {
        reached.add(n);
        queue.push(n);
      }
    }
  }
  for (const r of rooms) {
    if (reached.has(r.id)) continue;
    out.push({
      id: `unreachable:${r.id}`,
      rule: 'unreachable',
      severity: 'error',
      message: sub(t('checks.unreachable'), { room: r.name, level: levelName(project, r.levelId) }),
      target: {
        levelId: r.levelId,
        selection: { type: 'room', ids: [r.id] },
        rect: rectOf(r.polygon, 0.2),
      },
    });
  }
  return out;
}

const nearest = (p: Vec2, room: Room): number =>
  Math.min(
    ...room.polygon.map(
      (a, i) => projectOnSegment(p, a, room.polygon[(i + 1) % room.polygon.length]!).distance,
    ),
  );

// ───────────────────────── rooms ─────────────────────────

export function roomRules(project: Project): CheckIssue[] {
  const out: CheckIssue[] = [];
  const minAreas = { ...DEFAULT_MIN_AREAS, ...project.settings.checks.minAreas } as Record<
    string,
    number
  >;
  for (const r of project.rooms) {
    const target = {
      levelId: r.levelId,
      selection: { type: 'room' as const, ids: [r.id] },
      rect: rectOf(r.polygon, 0.2),
    };
    // Bedrooms need a window to the outside.
    if (r.type === 'bedroom') {
      const has = project.openings.some((o) => {
        if (o.kind !== 'window') return false;
        const w = project.walls.find((x) => x.id === o.wallId);
        if (!w || w.levelId !== r.levelId) return false;
        const [a, b] = sidesOf(project, w, o);
        return (a?.id === r.id && !b) || (b?.id === r.id && !a);
      });
      if (!has) {
        out.push({
          id: `window:${r.id}`,
          rule: 'bedroom-window',
          severity: 'error',
          message: sub(t('checks.noWindow'), { room: r.name }),
          target,
        });
      }
    }
    // Wet rooms near a plumbing point.
    if (
      ['bathroom', 'kitchen', 'utility'].includes(r.type) &&
      project.shell.fixedPlumbingPoints.length
    ) {
      const d = Math.min(
        ...project.shell.fixedPlumbingPoints.map((p) =>
          pointInPolygon(p, r.polygon) ? 0 : nearest(p, r),
        ),
      );
      const max = project.settings.checks.maxDrainRun;
      if (d > max) {
        out.push({
          id: `drain:${r.id}`,
          rule: 'drain',
          severity: 'warning',
          message: sub(t('checks.drain'), {
            room: r.name,
            d: formatLength(d, project.units),
            max: formatLength(max, project.units),
          }),
          target,
        });
      }
    }
    // Minimum area per type.
    const min = minAreas[r.type];
    const area = polygonArea(r.polygon);
    if (min && area < min - 1e-6) {
      out.push({
        id: `area:${r.id}`,
        rule: 'min-area',
        severity: 'warning',
        message: sub(t('checks.minArea'), {
          room: r.name,
          area: formatArea(area, project.units),
          min: formatArea(min, project.units),
        }),
        target,
      });
    }
  }
  return out;
}

// ───────────────────────── furniture, columns, entrance, doors ─────────────────────────

const itemBox = (i: Project['items'][number]) => {
  const e = getEntry(i.catalogId);
  if (!e) return null;
  const s = itemSize(e, i.scale);
  return { entry: e, size: s, poly: boxCorners(i.position, s.w, s.d, i.rotation) };
};

export function placementRules(project: Project): CheckIssue[] {
  const out: CheckIssue[] = [];
  const ground = project.levels.find((l) => l.index === 0);
  const ep = project.shell.entrance.position;
  const zone = boxCorners(ep, 1.6, 1.6, 0);
  for (const it of project.items) {
    const box = itemBox(it);
    if (!box || box.size.h <= 0.05) continue;
    const name = t(box.entry.nameKey as TranslationKey).toLowerCase();
    const level = project.levels.find((l) => l.id === it.levelId);
    // Columns
    for (const c of project.columns.filter((x) => x.levelId === it.levelId)) {
      if (
        overlapDepth(box.poly, boxCorners(c.position, c.size.w, c.size.d, 0)) > 0.03 &&
        it.elevation < (level?.floorToCeiling ?? 2.7) - 0.3
      ) {
        out.push({
          id: `column:${it.id}:${c.id}`,
          rule: 'column-obstructed',
          severity: 'warning',
          message: sub(t('checks.column'), { item: name }),
          target: {
            levelId: it.levelId,
            selection: { type: 'item', ids: [it.id] },
            rect: rectOf(box.poly, 0.4),
          },
        });
        break;
      }
    }
    // The entrance
    if (it.levelId === ground?.id && it.elevation < 0.5 && overlapDepth(box.poly, zone) > 0.03) {
      out.push({
        id: `entrance-blocked:${it.id}`,
        rule: 'entrance',
        severity: 'error',
        message: sub(t('checks.entranceBlocked'), { item: name }),
        target: {
          levelId: it.levelId,
          selection: { type: 'item', ids: [it.id] },
          rect: rectOf(zone, 0.2),
        },
      });
    }
  }
  // Stairs over columns
  for (const s of project.stairs) {
    const from = project.levels.find((l) => l.id === s.fromLevelId);
    const to = project.levels.find((l) => l.id === s.toLevelId);
    if (!from || !to) continue;
    const polys = stairFootprintPlan(s, layoutStair(s, from, to));
    for (const c of project.columns.filter((x) => x.levelId === s.fromLevelId)) {
      if (
        polys.some((p) => overlapDepth(p, boxCorners(c.position, c.size.w, c.size.d, 0)) > 0.03)
      ) {
        out.push({
          id: `stair-column:${s.id}:${c.id}`,
          rule: 'column-obstructed',
          severity: 'error',
          message: t('checks.stairColumn'),
          target: { levelId: from.id, selection: { type: 'stair', ids: [s.id] } },
        });
        break;
      }
    }
  }
  return out;
}

/** The area a door's leaf sweeps (a square on the +normal side, hinged at one jamb). */
export function doorSwingPolygon(o: Opening, w: Wall): Vec2[] | null {
  if (o.kind !== 'door' || o.swing === 'none') return null;
  const len = dist(w.start, w.end) || 1;
  const d = { x: (w.end.x - w.start.x) / len, y: (w.end.y - w.start.y) / len };
  const n = { x: -d.y, y: d.x };
  const lw = Math.max(o.width - 0.1, 0.4);
  const hingeAtStart = (o.swing === 'right') === o.flip;
  const hingeU = hingeAtStart ? o.offset - o.width / 2 + 0.05 : o.offset + o.width / 2 - 0.05;
  const dir = hingeAtStart ? 1 : -1;
  const at = (u: number, z: number): Vec2 => ({
    x: w.start.x + d.x * u + n.x * z,
    y: w.start.y + d.y * u + n.y * z,
  });
  return [at(hingeU, 0), at(hingeU + dir * lw, 0), at(hingeU + dir * lw, lw), at(hingeU, lw)];
}

export function doorRules(project: Project): CheckIssue[] {
  const out: CheckIssue[] = [];
  const doors = project.openings
    .map((o) => ({ o, w: project.walls.find((x) => x.id === o.wallId)! }))
    .filter((d) => d.w)
    .map((d) => ({ ...d, poly: doorSwingPolygon(d.o, d.w) }))
    .filter((d): d is typeof d & { poly: Vec2[] } => d.poly !== null);
  const doorName = (o: Opening, w: Wall) => {
    const [a, b] = sidesOf(project, w, o);
    return a && b
      ? sub(t('checks.doorBetween'), { a: a.name, b: b.name })
      : sub(t('checks.doorOf'), { room: nameOf(a ?? b) });
  };
  for (const d of doors) {
    const target = {
      levelId: d.w.levelId,
      selection: { type: 'opening' as const, ids: [d.o.id] },
      rect: rectOf(d.poly, 0.3),
    };
    for (const it of project.items.filter((i) => i.levelId === d.w.levelId)) {
      const box = itemBox(it);
      if (!box || box.size.h <= 0.1 || it.elevation > 1.9) continue;
      if (overlapDepth(box.poly, d.poly) > 0.05) {
        out.push({
          id: `swing-item:${d.o.id}:${it.id}`,
          rule: 'door-swing',
          severity: 'warning',
          message: sub(t('checks.swingItem'), {
            door: doorName(d.o, d.w),
            item: t(box.entry.nameKey as TranslationKey).toLowerCase(),
          }),
          target,
        });
        break;
      }
    }
  }
  for (let i = 0; i < doors.length; i++) {
    for (let j = i + 1; j < doors.length; j++) {
      const a = doors[i]!;
      const b = doors[j]!;
      if (a.w.levelId !== b.w.levelId) continue;
      if (overlapDepth(a.poly, b.poly) > 0.05) {
        out.push({
          id: `swing-door:${a.o.id}:${b.o.id}`,
          rule: 'door-swing',
          severity: 'warning',
          message: sub(t('checks.swingDoor'), { a: doorName(a.o, a.w), b: doorName(b.o, b.w) }),
          target: {
            levelId: a.w.levelId,
            selection: { type: 'opening', ids: [a.o.id, b.o.id] },
            rect: rectOf([...a.poly, ...b.poly], 0.3),
          },
        });
      }
    }
  }
  return out;
}
