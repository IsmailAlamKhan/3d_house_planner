import { polygonBounds, pointInPolygon } from '../geometry/polygon';
import { type Vec2, projectOnSegment } from '../geometry/vec';
import { t } from '../i18n';
import { buildingWithinSetback } from '../model/ops/site';
import type { Project, SiteZone } from '../model/types';
import { formatLength } from '../ui/units';
import { sidesOf } from './rules';
import type { CheckIssue } from './types';

/** Width of a parking space, and its length (m). */
export const CAR_WIDTH = 2.7;
export const CAR_LENGTH = 5.2;
/** A pool needs a fence, wall, hedge or gate this close to its edge. */
export const POOL_BARRIER_DISTANCE = 1.2;

const sub = (template: string, vars: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

const edges = (poly: Vec2[]): [Vec2, Vec2][] =>
  poly.map((a, i) => [a, poly[(i + 1) % poly.length]!]);

/** Distance from a point to a polygon (0 inside). */
export function distanceToPolygon(p: Vec2, poly: Vec2[]): number {
  if (poly.length >= 3 && pointInPolygon(p, poly)) return 0;
  return Math.min(...edges(poly).map(([a, b]) => projectOnSegment(p, a, b).distance));
}

/** Shortest distance between two polygons' outlines (0 when they overlap or touch). */
export function polygonGap(a: Vec2[], b: Vec2[]): number {
  let best = Infinity;
  for (const p of a) best = Math.min(best, distanceToPolygon(p, b));
  for (const p of b) best = Math.min(best, distanceToPolygon(p, a));
  return best;
}

/** How many cars fit in a parking zone (spaces of 2.7 × 5.2 m, either orientation of its bounding box). */
export function parkingCapacity(zone: SiteZone): number {
  const b = polygonBounds(zone.polygon);
  const w = b.max.x - b.min.x;
  const d = b.max.y - b.min.y;
  const fit = (a: number, c: number) =>
    Math.floor(a / CAR_WIDTH + 1e-6) * Math.floor(c / CAR_LENGTH + 1e-6);
  return Math.max(fit(w, d), fit(d, w));
}

function sampleSegment(a: Vec2, b: Vec2, step = 0.5): Vec2[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: a.x + ((b.x - a.x) * i) / n,
    y: a.y + ((b.y - a.y) * i) / n,
  }));
}

/** Checks that only make sense for a villa on a plot. Plain-language messages; never throws. */
export function siteRules(project: Project): CheckIssue[] {
  if (project.kind !== 'villa') return [];
  const out: CheckIssue[] = [];
  const { site } = project;
  const zones = site.zones;
  const fmt = (m: number) => formatLength(m, project.units);

  // Building inside the plot, away from the boundary by the setback.
  if (site.plot.length >= 3) {
    const r = buildingWithinSetback(project);
    if (!r.ok) {
      const b = polygonBounds(project.shell.footprint);
      out.push({
        id: 'setback',
        rule: 'setback',
        severity: 'error',
        message:
          r.worst < 0
            ? t('checks.outsidePlot')
            : sub(t('checks.setback'), { d: fmt(Math.max(0, r.worst)), min: fmt(site.setback) }),
        target: { rect: { min: b.min, max: b.max } },
      });
    }
  }

  // Vehicle gates lead to a parking zone with room for the cars.
  const cars = project.items.filter((i) => i.catalogId === 'car').length;
  const parking = zones.filter((z) => z.type === 'parking');
  for (const g of site.gates.filter((x) => x.kind === 'vehicle')) {
    const target = { selection: { type: 'gate' as const, ids: [g.id] } };
    const near = parking.filter((z) => distanceToPolygon(g.position, z.polygon) <= 12);
    if (!near.length) {
      out.push({
        id: `gate-parking:${g.id}`,
        rule: 'gate-parking',
        severity: 'warning',
        message: t('checks.gateNoParking'),
        target,
      });
      continue;
    }
    const cap = Math.max(...near.map(parkingCapacity));
    if (cap < Math.max(1, cars)) {
      out.push({
        id: `gate-parking-size:${g.id}`,
        rule: 'gate-parking',
        severity: 'warning',
        message: sub(t('checks.parkingSmall'), {
          n: String(Math.max(1, cars)),
          fit: String(cap),
          w: fmt(CAR_WIDTH),
        }),
        target: { selection: { type: 'zone' as const, ids: [near[0]!.id] } },
      });
    }
  }

  // Pedestrian gates connect to the entrance by a path or paving.
  const entrance = project.shell.entrance.position;
  const paved = zones.filter(
    (z) => z.type === 'path' || z.type === 'patio' || z.type === 'parking',
  );
  for (const g of site.gates.filter((x) => x.kind === 'pedestrian')) {
    const touchesGate = paved.filter((z) => distanceToPolygon(g.position, z.polygon) <= 1);
    const connected = touchesGate.some((z) => distanceToPolygon(entrance, z.polygon) <= 2.5);
    if (!connected) {
      out.push({
        id: `gate-path:${g.id}`,
        rule: 'gate-path',
        severity: 'warning',
        message: t('checks.gateNoPath'),
        target: { selection: { type: 'gate' as const, ids: [g.id] } },
      });
    }
  }

  // Pools need a barrier close by.
  const barrierPoints: Vec2[] = [];
  for (const [a, b] of edges(site.plot)) barrierPoints.push(...sampleSegment(a, b));
  for (const g of site.gates) barrierPoints.push(g.position);
  for (const w of project.walls.filter((x) => x.type === 'exterior'))
    barrierPoints.push(...sampleSegment(w.start, w.end));
  for (const i of project.items) if (i.catalogId === 'hedge') barrierPoints.push(i.position);
  for (const z of zones.filter((x) => x.type === 'pool')) {
    const safe = barrierPoints.some(
      (p) => distanceToPolygon(p, z.polygon) <= POOL_BARRIER_DISTANCE,
    );
    if (!safe) {
      out.push({
        id: `pool-safety:${z.id}`,
        rule: 'pool-safety',
        severity: 'warning',
        message: sub(t('checks.poolSafety'), { name: z.name, d: fmt(POOL_BARRIER_DISTANCE) }),
        target: { selection: { type: 'zone' as const, ids: [z.id] } },
      });
    }
  }

  // A garage needs a door to the outside.
  for (const r of project.rooms.filter((x) => x.type === 'garage')) {
    const has = project.openings.some((o) => {
      const w = project.walls.find((x) => x.id === o.wallId);
      if (!w || w.levelId !== r.levelId) return false;
      const [a, b] = sidesOf(project, w, o);
      return (a?.id === r.id && !b) || (b?.id === r.id && !a);
    });
    if (!has) {
      const b = polygonBounds(r.polygon);
      out.push({
        id: `garage:${r.id}`,
        rule: 'garage-exterior',
        severity: 'error',
        message: sub(t('checks.garageNoDoor'), { room: r.name }),
        target: {
          levelId: r.levelId,
          selection: { type: 'room' as const, ids: [r.id] },
          rect: { min: b.min, max: b.max },
        },
      });
    }
  }
  return out;
}
