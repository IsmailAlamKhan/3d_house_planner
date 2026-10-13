import { pointInPolygon, polygonArea } from '../../geometry/polygon';
import { type Vec2, projectOnSegment } from '../../geometry/vec';
import type { Gate, Project, SiteZone, ZoneType } from '../types';
import { ModelError, newId } from './common';

/** Default surface per zone type (material keys of the library). */
export const ZONE_MATERIAL: Record<ZoneType, string> = {
  garden: 'grass',
  lawn: 'grass',
  pool: 'water',
  deck: 'decking',
  patio: 'paving-stone',
  parking: 'paving-stone',
  play: 'grass',
  path: 'paving-stone',
  'water-feature': 'water',
};

export function setPlot(p: Project, plot: Vec2[]): void {
  if (plot.length < 3 || polygonArea(plot) < 20)
    throw new ModelError('The plot needs at least 3 corners and some area', 'err.plot');
  p.site.plot = plot.map((q) => ({ x: q.x, y: q.y }));
}

export interface NewZone {
  name?: string;
  type: ZoneType;
  polygon: Vec2[];
  material?: string;
  covered?: boolean;
}

export function addZone(p: Project, input: NewZone): string {
  if (input.polygon.length < 3 || polygonArea(input.polygon) < 0.5)
    throw new ModelError('A zone needs at least 3 corners and some area', 'err.zoneShape');
  const id = newId();
  p.site.zones.push({
    id,
    name: input.name ?? input.type,
    type: input.type,
    polygon: input.polygon.map((q) => ({ x: q.x, y: q.y })),
    material: input.material ?? ZONE_MATERIAL[input.type],
    covered: input.covered ?? false,
  });
  return id;
}

export function updateZone(p: Project, id: string, patch: Partial<Omit<SiteZone, 'id'>>): void {
  const z = p.site.zones.find((x) => x.id === id);
  if (!z) throw new ModelError(`Zone not found: ${id}`);
  Object.assign(z, patch);
}

export function deleteZone(p: Project, id: string): void {
  p.site.zones = p.site.zones.filter((z) => z.id !== id);
}

/** Moves a point onto the nearest edge of the plot and returns it with the outward direction of that edge. */
export function snapToPlot(p: Project, at: Vec2): { position: Vec2; direction: number } | null {
  const plot = p.site.plot;
  if (plot.length < 3) return null;
  let best: { position: Vec2; direction: number; d: number } | null = null;
  plot.forEach((a, i) => {
    const b = plot[(i + 1) % plot.length]!;
    const r = projectOnSegment(at, a, b);
    if (best && r.distance >= best.d) return;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = (b.y - a.y) / len;
    let ny = -(b.x - a.x) / len;
    const probe = { x: r.point.x + nx * 0.2, y: r.point.y + ny * 0.2 };
    if (pointInPolygon(probe, plot)) {
      nx = -nx;
      ny = -ny;
    }
    best = { position: r.point, direction: Math.atan2(ny, nx), d: r.distance };
  });
  return best
    ? {
        position: (best as { position: Vec2 }).position,
        direction: (best as { direction: number }).direction,
      }
    : null;
}

export interface NewGate {
  kind: Gate['kind'];
  position: Vec2;
  /** Omitted: taken from the plot edge nearest to `position`. */
  direction?: number;
  width?: number;
}

export function addGate(p: Project, input: NewGate): string {
  const snapped = snapToPlot(p, input.position);
  if (!snapped) throw new ModelError('Draw the plot before placing gates', 'err.noPlot');
  const id = newId();
  p.site.gates.push({
    id,
    kind: input.kind,
    position: snapped.position,
    direction: input.direction ?? snapped.direction,
    width: input.width ?? (input.kind === 'vehicle' ? 3.5 : 1.2),
  });
  return id;
}

export function updateGate(p: Project, id: string, patch: Partial<Omit<Gate, 'id'>>): void {
  const g = p.site.gates.find((x) => x.id === id);
  if (!g) throw new ModelError(`Gate not found: ${id}`);
  Object.assign(g, patch);
}

export function deleteGate(p: Project, id: string): void {
  p.site.gates = p.site.gates.filter((g) => g.id !== id);
}

/** Is the whole building outline inside the plot, set back from the boundary by `site.setback`? */
export function buildingWithinSetback(p: Project): { ok: boolean; worst: number } {
  const plot = p.site.plot;
  if (plot.length < 3) return { ok: true, worst: Infinity };
  let worst = Infinity;
  for (const c of p.shell.footprint) {
    if (!pointInPolygon(c, plot)) return { ok: false, worst: -1 };
    plot.forEach((a, i) => {
      worst = Math.min(worst, projectOnSegment(c, a, plot[(i + 1) % plot.length]!).distance);
    });
  }
  return { ok: worst >= p.site.setback - 1e-6, worst };
}
