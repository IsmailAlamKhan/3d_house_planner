import polygonClipping from 'polygon-clipping';
import { produce } from 'immer';
import { getEntry } from '../catalog';
import { runChecks } from '../checks';
import { polygonArea } from '../geometry/polygon';
import { type Vec2, projectOnSegment } from '../geometry/vec';
import {
  MIN_WALL_LENGTH,
  OPENING_END_MARGIN,
  findOverlappingOpening,
  openingFitsWall,
  wallHeight,
  wallLength,
} from '../model/integrity';
import * as ops from '../model/ops';
import { faceField, roomOnSide } from '../model/ops/paint';
import { createEmptyProject } from '../model/project';
import { SCHEMA_VERSION } from '../model/schemas';
import type { Opening, Project, RoomType, SavedView, Wall } from '../model/types';
import {
  type DesignSpec,
  type ItemLineSpec,
  type ItemSpec,
  type Pt,
  type ReferenceSpec,
  parseReferenceSpec,
  polygonOf,
  unitFactor,
} from './spec';

/** Default floor of a room type when the spec does not name one. */
const DEFAULT_FLOOR: Partial<Record<RoomType, string>> = {
  bathroom: 'floor-tile-grey',
  kitchen: 'floor-tile-large',
  living: 'floor-marble',
  foyer: 'floor-marble',
  dining: 'floor-marble',
  utility: 'floor-tile-grey',
  laundry: 'floor-tile-grey',
  sauna: 'floor-oak',
  spa: 'floor-tile-white',
  gym: 'floor-concrete',
  outdoor: 'decking',
};

export interface DesignReport {
  id: string;
  name: string;
  rooms: number;
  walls: number;
  openings: number;
  items: number;
  zones: number;
  /** Pairs of rooms on the same level that overlap by more than 0.02 m². */
  overlaps: { a: string; b: string; area: number }[];
  /** Enclosed holes in the area covered by rooms (m²), per level — wasted space, or a missing room. */
  gaps: { level: string; area: number }[];
  /** Rooms that cannot be reached through doors and openings from the entrance. */
  unreachable: string[];
  /** Everything that could not be placed exactly as asked, and why. */
  warnings: string[];
}

export interface BuildResult {
  /** The project showing the first design, with the others as design options. */
  project: Project;
  report: { designs: DesignReport[] };
}

const key = (p: Vec2) => `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)}`;
const segKey = (a: Vec2, b: Vec2) =>
  key(a) < key(b) ? `${key(a)}|${key(b)}` : `${key(b)}|${key(a)}`;

export interface WallSegment {
  a: Vec2;
  b: Vec2;
  /** Ids of the rooms that have this segment as an edge. */
  owners: string[];
}

/**
 * The wall graph of a set of polygons: every polygon edge, cut at every corner of any other polygon that touches it,
 * with edges shared by several rooms merged into one segment. A segment owned by one room is on the outside of the
 * built area; one owned by two or more is an interior wall.
 */
export function wallSegments(
  polys: { id: string; points: Vec2[] }[],
  extra: { a: Vec2; b: Vec2 }[] = [],
): WallSegment[] {
  const EPS = 1e-4;
  const vertices: Vec2[] = [...polys.flatMap((p) => p.points), ...extra.flatMap((e) => [e.a, e.b])];
  const edges: { a: Vec2; b: Vec2; owner: string }[] = [];
  for (const p of polys)
    p.points.forEach((a, i) =>
      edges.push({ a, b: p.points[(i + 1) % p.points.length]!, owner: p.id }),
    );
  for (const [i, e] of extra.entries()) edges.push({ a: e.a, b: e.b, owner: `extra:${i}` });

  const map = new Map<string, WallSegment>();
  for (const e of edges) {
    const dx = e.b.x - e.a.x;
    const dy = e.b.y - e.a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < EPS * EPS) continue;
    const ts = [0, 1];
    for (const v of vertices) {
      const t = ((v.x - e.a.x) * dx + (v.y - e.a.y) * dy) / len2;
      if (t <= EPS / Math.sqrt(len2) || t >= 1 - EPS / Math.sqrt(len2)) continue;
      const px = e.a.x + t * dx;
      const py = e.a.y + t * dy;
      if (Math.hypot(px - v.x, py - v.y) < EPS) ts.push(t);
    }
    ts.sort((x, y) => x - y);
    for (let i = 0; i + 1 < ts.length; i++) {
      const a = { x: e.a.x + ts[i]! * dx, y: e.a.y + ts[i]! * dy };
      const b = { x: e.a.x + ts[i + 1]! * dx, y: e.a.y + ts[i + 1]! * dy };
      if (Math.hypot(b.x - a.x, b.y - a.y) < EPS) continue;
      const k = segKey(a, b);
      const seg = map.get(k) ?? { a, b, owners: [] };
      if (!seg.owners.includes(e.owner)) seg.owners.push(e.owner);
      map.set(k, seg);
    }
  }
  return [...map.values()];
}

/** Area (m²) of the enclosed holes of the union of polygons (space inside the built area that no room covers). */
export function enclosedGaps(polys: Vec2[][]): number[] {
  if (polys.length === 0) return [];
  const rings = polys.map((p) => [p.map((q) => [q.x, q.y] as [number, number])]);
  const union = polygonClipping.union(rings[0] as never, ...(rings.slice(1) as never[]));
  const out: number[] = [];
  for (const poly of union) {
    for (const hole of poly.slice(1)) {
      const a = polygonArea(hole.map(([x, y]) => ({ x, y })));
      if (a > 0.05) out.push(a);
    }
  }
  return out;
}

const overlapArea = (a: Vec2[], b: Vec2[]): number => {
  const ra = [a.map((q) => [q.x, q.y] as [number, number])];
  const rb = [b.map((q) => [q.x, q.y] as [number, number])];
  const inter = polygonClipping.intersection(ra as never, rb as never);
  let area = 0;
  for (const poly of inter) {
    const outer = polygonArea(poly[0]!.map(([x, y]) => ({ x, y })));
    const holes = poly.slice(1).reduce((s, h) => s + polygonArea(h.map(([x, y]) => ({ x, y }))), 0);
    area += outer - holes;
  }
  return area;
};

const dirToRadians = (f: 'north' | 'south' | 'east' | 'west' | number): number =>
  typeof f === 'number'
    ? (f * Math.PI) / 180
    : { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 }[f];

const DEG = Math.PI / 180;

/** Points along a line every `every` metres, the first half a step in (so a row is centred on its line). */
function alongLine(a: Vec2, b: Vec2, every: number): { at: Vec2; angle: number }[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.round(len / every));
  const step = len / n;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  return Array.from({ length: n }, (_, i) => ({
    at: {
      x: a.x + ((b.x - a.x) * (i + 0.5) * step) / len,
      y: a.y + ((b.y - a.y) * (i + 0.5) * step) / len,
    },
    angle,
  }));
}

/** Builds one design of the spec into a project that already has the shared parts (levels, plot, shell …). */
function buildDesign(
  base: Project,
  spec: ReferenceSpec,
  design: DesignSpec,
): { project: Project; report: DesignReport } {
  const k = unitFactor(spec.units);
  const v = (p: Pt): Vec2 => ({ x: p[0] * k, y: p[1] * k });
  const thick = spec.wallThickness ?? { exterior: 0.25, interior: 0.12, partition: 0.05 };
  const warnings: string[] = [];
  const firstLevel = spec.levels[0]!.id;
  const lvl = (id?: string) => id ?? firstLevel;
  const itemKeys = new Map<string, string>();
  const roomIds = new Map<string, string>();

  const project = produce(base, (p) => {
    // ── Rooms and the walls around them, level by level ──
    for (const level of spec.levels) {
      const rooms = design.rooms.filter((r) => lvl(r.level) === level.id);
      const extraWalls = design.walls.filter((w) => lvl(w.level) === level.id);
      const polys = rooms.map((r) => ({ id: r.id, points: polygonOf(r).map(v) }));
      const segs = wallSegments(
        polys,
        extraWalls.map((w) => ({ a: v(w.from), b: v(w.to) })),
      );
      const skippedShort = segs.filter(
        (s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) < MIN_WALL_LENGTH,
      );
      if (skippedShort.length)
        warnings.push(
          `${skippedShort.length} wall piece(s) shorter than ${MIN_WALL_LENGTH * 100} cm were left out on ${level.name}`,
        );
      for (const s of segs) {
        if (Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) < MIN_WALL_LENGTH) continue;
        const extraOwner = s.owners.find((o) => o.startsWith('extra:'));
        const extra = extraOwner ? extraWalls[Number(extraOwner.slice(6))] : undefined;
        const roomOwners = s.owners.filter((o) => !o.startsWith('extra:'));
        const type = extra ? extra.type : roomOwners.length >= 2 ? 'interior' : 'exterior';
        const mat = extra?.material;
        ops.addWall(p, {
          levelId: level.id,
          start: s.a,
          end: s.b,
          type,
          thickness: extra?.thickness !== undefined ? extra.thickness * k : thick[type],
          height: extra?.height !== undefined ? extra.height * k : undefined,
          ...(mat ? { materialInside: mat, materialOutside: mat } : {}),
        });
      }
      for (const r of rooms) {
        const id = ops.addRoom(p, {
          levelId: level.id,
          polygon: polygonOf(r).map(v),
          name: r.name,
          type: r.type,
          floorMaterial: r.floor ?? DEFAULT_FLOOR[r.type] ?? 'floor-oak',
          ceilingMaterial: r.ceiling ?? 'paint-white',
          ceilingHeight: r.ceilingHeight !== undefined ? r.ceilingHeight * k : undefined,
          doubleHeight: r.doubleHeight ?? false,
        });
        roomIds.set(r.id, id);
        if (r.parapet) ops.setRoomParapet(p, id, true);
      }
    }

    // Wall finishes: each face takes the finish of the room it looks into.
    const finishOf = new Map<string, string>();
    for (const r of design.rooms) if (r.wallFinish) finishOf.set(roomIds.get(r.id)!, r.wallFinish);
    for (const w of p.walls) {
      if (w.materialInside === 'glass') continue;
      for (const side of ['left', 'right'] as const) {
        const room = roomOnSide(p, w, side);
        const fin = room && finishOf.get(room.id);
        if (fin) w[faceField(p, w, side)] = fin;
      }
    }

    // ── Doors, windows, archways ──
    for (const o of design.openings) {
      const levelId = lvl(o.level);
      const at = v(o.at);
      let best: { wall: Wall; d: number } | undefined;
      for (const w of p.walls.filter((x) => x.levelId === levelId)) {
        const d = projectOnSegment(at, w.start, w.end).distance;
        if (d < 0.3 && (!best || d < best.d)) best = { wall: w, d };
      }
      if (!best) {
        warnings.push(`${o.kind} at [${o.at.join(', ')}] is not on any wall`);
        continue;
      }
      const wall = best.wall;
      const len = wallLength(wall);
      const t = projectOnSegment(at, wall.start, wall.end).t;
      const entry = o.style ? getEntry(o.style) : undefined;
      const width0 = o.width !== undefined ? o.width * k : entry?.defaultSize.w;
      let width = width0 ?? { door: 0.9, window: 1.2, archway: 1.2 }[o.kind];
      const maxWidth = len - 2 * OPENING_END_MARGIN;
      if (width > maxWidth) {
        warnings.push(`${o.kind} at [${o.at.join(', ')}] was narrowed to fit its wall`);
        width = maxWidth;
      }
      if (width < 0.4) {
        warnings.push(`${o.kind} at [${o.at.join(', ')}] does not fit its wall and was left out`);
        continue;
      }
      let offset = t * len;
      const lo = width / 2 + OPENING_END_MARGIN;
      const hi = len - width / 2 - OPENING_END_MARGIN;
      offset = Math.min(hi, Math.max(lo, offset));
      if (!openingFitsWall(len, offset, width)) continue;
      const sill =
        o.sill !== undefined ? o.sill * k : (entry?.sill ?? (o.kind === 'window' ? 0.9 : 0));
      const maxH = wallHeight(p, wall) - sill;
      const height = Math.min(
        o.height !== undefined
          ? o.height * k
          : (entry?.defaultSize.h ?? (o.kind === 'door' ? 2.1 : 1.2)),
        maxH,
      );
      const candidate = { offset, width } as Pick<Opening, 'offset' | 'width'>;
      if (findOverlappingOpening(p.openings, wall.id, candidate)) {
        warnings.push(
          `${o.kind} at [${o.at.join(', ')}] overlaps another opening and was left out`,
        );
        continue;
      }
      ops.addOpening(p, {
        wallId: wall.id,
        offset,
        kind: o.kind,
        catalogId: o.style,
        width,
        height,
        sillHeight: sill,
        swing: o.swing,
        flip: o.flip,
      });
    }

    // ── Outdoor zones and gates ──
    for (const z of design.zones) {
      ops.addZone(p, {
        name: z.name,
        type: z.type,
        polygon: polygonOf(z).map(v),
        ...(z.material ? { material: z.material } : {}),
        covered: z.covered,
      });
    }
    for (const g of design.gates) {
      ops.addGate(p, {
        kind: g.kind,
        position: v(g.at),
        direction: dirToRadians(g.facing),
        ...(g.width !== undefined ? { width: g.width * k } : {}),
      });
    }

    // ── Items ──
    const putItem = (
      spec: Pick<ItemSpec, 'catalog' | 'level' | 'size' | 'props' | 'elevation'>,
      at: Vec2,
      rotation: number,
      itemKey?: string,
    ) => {
      if (!getEntry(spec.catalog) && !spec.catalog.startsWith('custom:'))
        warnings.push(`unknown catalogue item "${spec.catalog}"`);
      const entry = getEntry(spec.catalog);
      const scale =
        spec.size && entry
          ? {
              x: (spec.size[0] * k) / entry.defaultSize.w,
              y: (spec.size[2] * k) / entry.defaultSize.h,
              z: (spec.size[1] * k) / entry.defaultSize.d,
            }
          : undefined;
      try {
        const id = ops.addItem(p, {
          levelId: lvl(spec.level),
          catalogId: spec.catalog,
          position: at,
          rotation,
          elevation: spec.elevation !== undefined ? spec.elevation * k : undefined,
          scale,
          props: spec.props,
        });
        if (itemKey) itemKeys.set(itemKey, id);
      } catch (e) {
        warnings.push(
          `${spec.catalog} at [${(at.x / k).toFixed(1)}, ${(at.y / k).toFixed(1)}]: ${(e as Error).message}`,
        );
      }
    };
    for (const it of design.items) putItem(it, v(it.at), it.rotation * DEG, it.key);
    const putLine = (ln: ItemLineSpec) => {
      for (const { at, angle } of alongLine(v(ln.from), v(ln.to), ln.every * k))
        putItem(ln, at, ln.rotation === 'along' ? angle : ln.rotation * DEG);
    };
    for (const ln of design.lines) putLine(ln);

    // ── Boundary planting and lights, inside the plot wall ──
    const b = design.boundary;
    if (b && p.site.plot.length >= 3) {
      const plot = p.site.plot;
      // Shoelace sign: positive = counter-clockwise (y up), where the inward side of an edge is its left normal.
      let twice = 0;
      plot.forEach((a, i) => {
        const c = plot[(i + 1) % plot.length]!;
        twice += a.x * c.y - c.x * a.y;
      });
      const inwardSign = twice >= 0 ? 1 : -1;
      const clear = b.gateClearance * k;
      const nearGate = (q: Vec2) =>
        p.site.gates.some(
          (g) => Math.hypot(g.position.x - q.x, g.position.y - q.y) < clear + g.width / 2,
        );
      const run = (
        cfg: { inset: number; every: number } | undefined,
        catalog: string,
        rotate: boolean,
      ) => {
        if (!cfg) return;
        plot.forEach((a, i) => {
          const c = plot[(i + 1) % plot.length]!;
          const dx = c.x - a.x;
          const dy = c.y - a.y;
          const len = Math.hypot(dx, dy);
          if (len < 1e-6) return;
          const nx = (-dy / len) * inwardSign;
          const ny = (dx / len) * inwardSign;
          const off = cfg.inset * k;
          const from = { x: a.x + nx * off, y: a.y + ny * off };
          const to = { x: c.x + nx * off, y: c.y + ny * off };
          for (const { at, angle } of alongLine(from, to, cfg.every * k)) {
            if (nearGate(at)) continue;
            putItem({ catalog, props: {} }, at, rotate ? angle : 0);
          }
        });
      };
      run(b.hedges, 'hedge', true);
      run(b.palms, 'tree-palm', false);
      run(b.lights, 'garden-light', false);
    }

    // ── Stairs, roofs ──
    for (const s of design.stairs) {
      ops.addStair(p, {
        fromLevelId: s.from,
        toLevelId: s.to,
        type: s.type,
        position: v(s.at),
        rotation: s.direction * DEG,
        width: s.width * k,
        railing: s.railing,
      });
    }
    for (const r of design.roofs) {
      ops.addRoof(p, { levelId: lvl(r.level), kind: r.kind, polygon: polygonOf(r).map(v) });
    }
  });

  // ── Report ──
  const overlaps: DesignReport['overlaps'] = [];
  for (const level of spec.levels) {
    const rs = project.rooms.filter((r) => r.levelId === level.id);
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++) {
        const area = overlapArea(rs[i]!.polygon, rs[j]!.polygon);
        if (area > 0.02) overlaps.push({ a: rs[i]!.name, b: rs[j]!.name, area });
      }
  }
  const gaps: DesignReport['gaps'] = [];
  for (const level of spec.levels) {
    for (const area of enclosedGaps(
      project.rooms.filter((r) => r.levelId === level.id).map((r) => r.polygon),
    ))
      gaps.push({ level: level.name, area });
  }
  const unreachable = runChecks(project)
    .filter((i) => i.rule === 'unreachable')
    .map((i) => i.message ?? i.rule);
  return {
    project,
    report: {
      id: design.id,
      name: design.name,
      rooms: project.rooms.length,
      walls: project.walls.length,
      openings: project.openings.length,
      items: project.items.length,
      zones: project.site.zones.length,
      overlaps,
      gaps,
      unreachable,
      warnings,
    },
  };
}

/**
 * Turns a spec into a project, exactly: the first design becomes the project's own design and every further design
 * is stored as a design option. Nothing is solved or tiled; what is not as asked is listed in the report.
 */
export function buildProject(input: unknown, opts: { id?: string } = {}): BuildResult {
  const spec = parseReferenceSpec(input);
  const k = unitFactor(spec.units);
  const v = (p: Pt): Vec2 => ({ x: p[0] * k, y: p[1] * k });

  // Shared parts of the project.
  let base = createEmptyProject(spec.name);
  base = produce(base, (p) => {
    if (opts.id) p.id = opts.id;
    p.kind = 'villa';
    p.units = spec.units === 'ft' ? 'imperial' : 'metric';
    p.levels = [];
    for (const l of spec.levels) {
      p.levels.push({
        id: l.id,
        name: l.name,
        index: p.levels.length,
        elevation: 0,
        floorToCeiling: l.height * k,
        slabThickness: 0.2,
        visible: true,
        locked: false,
      });
    }
    ops.recomputeLevels(p);
    p.settings.compass = spec.compass ?? 0;
    p.settings.defaultWallThickness = spec.wallThickness?.interior ?? 0.12;
    ops.setPlot(p, spec.plot.map(v));
    if (spec.setback !== undefined) p.site.setback = spec.setback * k;
    // The shell: the outline of everything built on the first level, in any design.
    const first = spec.levels[0]!.id;
    const rings = spec.designs
      .flatMap((d) => d.rooms)
      .filter((r) => (r.level ?? first) === first && r.type !== 'outdoor')
      .map((r) => [polygonOf(r).map((q) => [q[0] * k, q[1] * k] as [number, number])]);
    if (rings.length) {
      const union = polygonClipping.union(rings[0] as never, ...(rings.slice(1) as never[]));
      const biggest = union
        .map((poly) => poly[0]!)
        .sort(
          (a, b) =>
            polygonArea(b.map(([x, y]) => ({ x, y }))) - polygonArea(a.map(([x, y]) => ({ x, y }))),
        )[0];
      if (biggest) {
        const ring = biggest.slice(0, -1).map(([x, y]) => ({ x, y }));
        p.shell.footprint = ring;
      }
    }
    p.shell.maxHeight = spec.levels.reduce((s, l) => s + l.height * k + 0.2, 0) + 0.5;
    p.shell.fixedPlumbingPoints = [];
    p.shell.windows = [];
  });

  const built = spec.designs.map((d) => buildDesign(base, spec, d));
  const main = built[0]!.project;

  // The entrance of the shell: the first main-door opening on the first level (else the front edge).
  const entranceOf = (p: Project) => {
    const first = spec.levels[0]!.id;
    const door = p.openings.find(
      (o) =>
        o.kind === 'door' &&
        (o.catalogId === 'door-entrance' || o.catalogId === 'door-double') &&
        p.walls.find((w) => w.id === o.wallId)?.levelId === first,
    );
    if (door) {
      const w = p.walls.find((x) => x.id === door.wallId)!;
      const t = door.offset / wallLength(w);
      return {
        position: {
          x: w.start.x + (w.end.x - w.start.x) * t,
          y: w.start.y + (w.end.y - w.start.y) * t,
        },
        direction: Math.PI / 2,
      };
    }
    const xs = p.shell.footprint.map((q) => q.x);
    const ys = p.shell.footprint.map((q) => q.y);
    return {
      position: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.max(...ys) },
      direction: Math.PI / 2,
    };
  };

  const project = produce(main, (p) => {
    p.shell.entrance = entranceOf(main);
    const first = spec.designs[0]!;
    p.currentOption = {
      id: `design-${first.id}`,
      letter: first.letter ?? null,
      name: first.name,
    };
    p.options = built.slice(1).map((b, i) => {
      const d = spec.designs[i + 1]!;
      return {
        id: `design-${d.id}`,
        letter: d.letter ?? null,
        name: d.name,
        design: ops.designOf(b.project),
      };
    });
    // Lights.
    if (spec.lights) {
      p.lights.master = spec.lights.master;
      // (per-item switches refer to item keys of the first design)
    }
    // Saved views (positions are [x, height, y] in spec units).
    p.views = [];
    for (const vw of spec.views) {
      const view: Omit<SavedView, 'id'> = {
        name: vw.name,
        mode: vw.mode,
        position: [vw.position[0] * k, vw.position[1] * k, vw.position[2] * k],
        target: [vw.target[0] * k, vw.target[1] * k, vw.target[2] * k],
        ...(vw.zoom !== undefined ? { zoom: vw.zoom } : {}),
      };
      ops.addView(p, view);
    }
    p.schemaVersion = SCHEMA_VERSION;
  });

  return { project, report: { designs: built.map((b) => b.report) } };
}

/** Summary line per design for a console or a log. */
export function describeReport(r: BuildResult['report']): string {
  return r.designs
    .map((d) => {
      const bits = [
        `${d.rooms} rooms, ${d.walls} walls, ${d.openings} openings, ${d.items} items, ${d.zones} zones`,
        d.overlaps.length ? `${d.overlaps.length} overlap(s)` : 'no overlaps',
        d.gaps.length ? `${d.gaps.length} gap(s)` : 'no gaps',
        d.unreachable.length ? `UNREACHABLE: ${d.unreachable.join('; ')}` : 'all rooms reachable',
        d.warnings.length ? `${d.warnings.length} warning(s)` : 'no warnings',
      ];
      return `Design ${d.id} "${d.name}": ${bits.join(' · ')}`;
    })
    .join('\n');
}
