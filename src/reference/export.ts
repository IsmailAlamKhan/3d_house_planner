import { projectOnSegment } from '../geometry/vec';
import { getEntry } from '../catalog';
import { wallLength } from '../model/integrity';
import { allDesigns, projectForDesign } from '../model/ops/options';
import type { Project, Room, Wall } from '../model/types';
import type { DesignSpec, Pt, ReferenceSpecInput } from './spec';

const DEG = 180 / Math.PI;

/** Is the polygon an axis-aligned rectangle? Then it is exported as `[x, y, w, d]`. */
function asRect(poly: { x: number; y: number }[]): [number, number, number, number] | null {
  if (poly.length !== 4) return null;
  const xs = [...new Set(poly.map((p) => Math.round(p.x * 1e4)))];
  const ys = [...new Set(poly.map((p) => Math.round(p.y * 1e4)))];
  if (xs.length !== 2 || ys.length !== 2) return null;
  const x0 = Math.min(...poly.map((p) => p.x));
  const y0 = Math.min(...poly.map((p) => p.y));
  return [x0, y0, Math.max(...poly.map((p) => p.x)) - x0, Math.max(...poly.map((p) => p.y)) - y0];
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'room';

/** The plot, or for an apartment (no plot drawn) the outline of the building plus a 3 m margin. */
function plotOf(project: Project): { x: number; y: number }[] {
  if (project.site.plot.length >= 3) return project.site.plot;
  const xs = project.shell.footprint.map((p) => p.x);
  const ys = project.shell.footprint.map((p) => p.y);
  const m = 3;
  const [x0, x1, y0, y1] = [
    Math.min(...xs) - m,
    Math.max(...xs) + m,
    Math.min(...ys) - m,
    Math.max(...ys) + m,
  ];
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/**
 * The current project (and its design options) as a spec: edit it by hand, or use it as a backup that the exact
 * builder recreates. Lengths are written in the project's own units, rounded to a thousandth.
 */
export function projectToSpec(project: Project): ReferenceSpecInput {
  const ft = project.units === 'imperial';
  const f = ft ? 1 / 0.3048 : 1;
  const n = (v: number) => Math.round(v * f * 1000) / 1000;
  const pt = (p: { x: number; y: number }): Pt => [n(p.x), n(p.y)];

  const designs: DesignSpec[] = allDesigns(project).map((meta) => {
    const p = projectForDesign(project, meta.id) ?? project;
    const taken = new Set<string>();
    const roomKey = new Map<string, string>();
    const unique = (base: string) => {
      let id = base;
      for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
      taken.add(id);
      return id;
    };

    const roomEdges = (r: Room) =>
      r.polygon.map((a, i) => [a, r.polygon[(i + 1) % r.polygon.length]!] as const);
    const onRoomEdge = (w: Wall) =>
      p.rooms.some(
        (r) =>
          r.levelId === w.levelId &&
          roomEdges(r).some(
            ([a, b]) =>
              projectOnSegment(w.start, a, b).distance < 1e-3 &&
              projectOnSegment(w.end, a, b).distance < 1e-3,
          ),
      );

    const rooms = p.rooms.map((r) => {
      const id = unique(slug(r.name));
      roomKey.set(r.id, id);
      const rect = asRect(r.polygon);
      const parapet =
        r.type === 'outdoor' &&
        p.walls.some((w) => w.levelId === r.levelId && w.height !== undefined && w.height <= 1.01);
      return {
        id,
        name: r.name,
        type: r.type,
        level: r.levelId,
        ...(rect
          ? { rect: rect.map(n) as [number, number, number, number] }
          : { polygon: r.polygon.map(pt) }),
        floor: r.floorMaterial,
        ...(r.ceilingMaterial !== 'paint-white' ? { ceiling: r.ceilingMaterial } : {}),
        ...(r.ceilingHeight !== undefined ? { ceilingHeight: n(r.ceilingHeight) } : {}),
        ...(r.doubleHeight ? { doubleHeight: true } : {}),
        ...(parapet ? { parapet: true } : {}),
      };
    });

    const walls = p.walls
      .filter((w) => !onRoomEdge(w))
      .map((w) => ({
        level: w.levelId,
        from: pt(w.start),
        to: pt(w.end),
        type: w.type,
        thickness: n(w.thickness),
        ...(w.materialInside === w.materialOutside ? { material: w.materialInside } : {}),
        ...(w.height !== undefined ? { height: n(w.height) } : {}),
      }));

    const openings = p.openings.flatMap((o) => {
      const w = p.walls.find((x) => x.id === o.wallId);
      if (!w) return [];
      const t = o.offset / wallLength(w);
      return [
        {
          level: w.levelId,
          at: pt({
            x: w.start.x + (w.end.x - w.start.x) * t,
            y: w.start.y + (w.end.y - w.start.y) * t,
          }),
          kind: o.kind,
          style: o.catalogId,
          width: n(o.width),
          height: n(o.height),
          sill: n(o.sillHeight),
          swing: o.swing,
          ...(o.flip ? { flip: true } : {}),
        },
      ];
    });

    const zones = p.site.zones.map((z) => {
      const rect = asRect(z.polygon);
      return {
        id: unique(`zone-${slug(z.name)}`),
        name: z.name,
        type: z.type,
        ...(rect
          ? { rect: rect.map(n) as [number, number, number, number] }
          : { polygon: z.polygon.map(pt) }),
        material: z.material,
        ...(z.covered ? { covered: true } : {}),
      };
    });

    const gates = p.site.gates.map((g) => ({
      kind: g.kind,
      at: pt(g.position),
      facing: Math.round(g.direction * DEG * 100) / 100,
      width: n(g.width),
    }));

    const items = p.items.map((i) => {
      const e = getEntry(i.catalogId);
      const scaled =
        e &&
        (Math.abs(i.scale.x - 1) > 1e-6 ||
          Math.abs(i.scale.y - 1) > 1e-6 ||
          Math.abs(i.scale.z - 1) > 1e-6);
      return {
        catalog: i.catalogId,
        level: i.levelId,
        at: pt(i.position),
        rotation: Math.round(i.rotation * DEG * 100) / 100,
        ...(i.elevation ? { elevation: n(i.elevation) } : {}),
        ...(scaled && e
          ? {
              size: [
                n(e.defaultSize.w * i.scale.x),
                n(e.defaultSize.d * i.scale.z),
                n(e.defaultSize.h * i.scale.y),
              ] as [number, number, number],
            }
          : {}),
        props: i.props,
      };
    });

    const stairs = p.stairs.map((s) => ({
      id: unique(`stair-${s.fromLevelId}-${s.toLevelId}`),
      from: s.fromLevelId,
      to: s.toLevelId,
      type: s.type,
      at: pt(s.position),
      direction: Math.round(s.rotation * DEG * 100) / 100,
      width: n(s.width),
      railing: s.railing,
    }));

    const roofs = p.roofs.map((r) => ({
      level: r.levelId,
      kind: r.kind,
      polygon: r.polygon.map(pt),
    }));

    return {
      id: meta.letter ?? (meta.id === project.currentOption.id ? 'main' : meta.id),
      ...(meta.letter ? { letter: meta.letter } : {}),
      name: meta.name ?? (meta.letter ? `Option ${meta.letter}` : 'Main design'),
      rooms,
      walls,
      openings,
      zones,
      gates,
      items,
      lines: [],
      stairs,
      roofs,
    } as DesignSpec;
  });

  const mode = (type: Wall['type'], fallback: number) => {
    const t = project.walls
      .filter((w) => w.type === type)
      .map((w) => Math.round(w.thickness * 1e4) / 1e4);
    if (!t.length) return fallback;
    const count = new Map<number, number>();
    for (const x of t) count.set(x, (count.get(x) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  };

  // The picture the plan was traced from, when it can be named by a path (a picture kept as an upload cannot).
  const pic = project.underlays.find(
    (u) => u.source.kind === 'url' && u.setup?.mode === 'corners' && u.setup.points.length === 4,
  );
  const underlay =
    pic && pic.source.kind === 'url' && pic.setup
      ? {
          image: pic.source.url,
          corners: pic.setup.points.map(
            (q) => [Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100] as Pt,
          ),
          size: [n(pic.setup.size[0] ?? 1), n(pic.setup.size[1] ?? 1)] as [number, number],
          imageSize: [pic.imageWidth, pic.imageHeight] as [number, number],
          origin: pt(pic.setup.origin),
          opacity: pic.opacity,
        }
      : undefined;

  return {
    version: 1,
    name: project.name,
    units: ft ? 'ft' : 'm',
    plot: plotOf(project).map(pt),
    setback: n(project.site.setback),
    levels: project.levels.map((l) => ({ id: l.id, name: l.name, height: n(l.floorToCeiling) })),
    wallThickness: {
      exterior: Math.round(mode('exterior', 0.25) * f * 1000) / 1000,
      interior: Math.round(mode('interior', 0.12) * f * 1000) / 1000,
      partition: Math.round(mode('partition', 0.05) * f * 1000) / 1000,
    },
    compass: project.settings.compass,
    lights: { master: project.lights.master, off: [], on: [] },
    views: project.views.map((v) => ({
      name: v.name,
      mode: v.mode,
      position: v.position.map((x) => n(x)) as [number, number, number],
      target: v.target.map((x) => n(x)) as [number, number, number],
      ...(v.zoom !== undefined ? { zoom: v.zoom } : {}),
    })),
    ...(underlay ? { underlay } : {}),
    designs,
  };
}
