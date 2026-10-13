import { BoxGeometry, type BufferGeometry } from 'three';
import polygonClipping from 'polygon-clipping';
import { polygonBounds } from '../../geometry/polygon';
import type { Vec2 } from '../../geometry/vec';
import type { Gate, Project, SiteZone } from '../../model/types';
import { type Part, extrudeMulti, flatMulti, mergeAll, subtractPolygons, toRing } from './common';

/** Height of the surfaces above the ground plane (m). */
const ZONE_RAISE: Record<SiteZone['type'], number> = {
  garden: 0.01,
  lawn: 0.01,
  play: 0.01,
  patio: 0.02,
  parking: 0.02,
  path: 0.02,
  deck: 0.15,
  pool: 0,
  'water-feature': 0,
};

export const POOL_DEPTH = 1.4;
export const WATER_LEVEL = -0.12;
export const COVER_HEIGHT = 2.7;
const FENCE_HEIGHT = 0.9;
const FENCE_THICKNESS = 0.2;

const entityOf = (type: 'zone' | 'gate', id: string) => ({ type, id });

/** A box between two plan points (along its length), `h` tall from `y`, `t` thick. */
function strip(a: Vec2, b: Vec2, t: number, h: number, y: number): BufferGeometry {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 0.01;
  const g = new BoxGeometry(len, h, t);
  g.rotateY(-Math.atan2(b.y - a.y, b.x - a.x));
  g.translate((a.x + b.x) / 2, y + h / 2, (a.y + b.y) / 2);
  return g;
}

const post = (p: Vec2, size: number, h: number, y = 0): BufferGeometry => {
  const g = new BoxGeometry(size, h, size);
  g.translate(p.x, y + h / 2, p.y);
  return g;
};

/** The grass of the whole plot (with holes where pools sit) and a larger surround so there is no "edge of the world". */
function generateGround(project: Project): Part[] {
  const { plot, zones } = project.site;
  if (plot.length < 3) return [];
  const b = polygonBounds(plot);
  const m = 40;
  const surround: Vec2[] = [
    { x: b.min.x - m, y: b.min.y - m },
    { x: b.max.x + m, y: b.min.y - m },
    { x: b.max.x + m, y: b.max.y + m },
    { x: b.min.x - m, y: b.max.y + m },
  ];
  const pools = zones
    .filter((z) => z.type === 'pool' || z.type === 'water-feature')
    .map((z) => z.polygon);
  const parts: Part[] = [];
  // Outside the plot: wild grass, a little lower, so the plot reads as a raised lawn.
  const outside = polygonClipping.difference([toRing(surround)], [toRing(plot)]);
  const outsideGeo = flatMulti(outside, -0.03, true);
  if (outsideGeo)
    parts.push({ id: 'site:surround', layer: 'site', geometry: outsideGeo, materials: ['grass'] });
  const inside = pools.length ? subtractPolygons(plot, pools) : [[toRing(plot)]];
  const insideGeo = flatMulti(inside as never, 0, true);
  if (insideGeo)
    parts.push({ id: 'site:ground', layer: 'site', geometry: insideGeo, materials: ['grass'] });
  return parts;
}

/** Pool: water surface, tiled basin and a coping border (also used, shallower, for water features). */
function generatePool(z: SiteZone): Part[] {
  const depth = z.type === 'pool' ? POOL_DEPTH : 0.3;
  const entity = entityOf('zone', z.id);
  const parts: Part[] = [];
  const water = flatMulti([[toRing(z.polygon)]], z.type === 'pool' ? WATER_LEVEL : 0.18, true);
  if (water)
    parts.push({
      id: `zone:${z.id}:water`,
      layer: 'site',
      entity,
      geometry: water,
      materials: [z.material === 'water' ? 'water' : z.material],
    });
  // Basin floor and walls (visible through the translucent water).
  const floor = flatMulti([[toRing(z.polygon)]], -depth, true);
  const walls: BufferGeometry[] = [];
  const poly = z.polygon;
  poly.forEach((a, i) => walls.push(strip(a, poly[(i + 1) % poly.length]!, 0.06, depth, -depth)));
  const basin = mergeAll([...(floor ? [floor] : []), ...walls]);
  if (basin)
    parts.push({
      id: `zone:${z.id}:basin`,
      layer: 'site',
      geometry: basin,
      materials: ['pool-tile'],
    });
  // Coping: a paved border around the rim.
  const coping = poly.map((a, i) => strip(a, poly[(i + 1) % poly.length]!, 0.35, 0.08, 0));
  const copingGeo = mergeAll(coping);
  if (copingGeo)
    parts.push({
      id: `zone:${z.id}:coping`,
      layer: 'site',
      geometry: copingGeo,
      materials: ['paving-stone'],
    });
  return parts;
}

/** A flat or slightly raised surface, with posts and a roof when the zone is covered (car bay, pergola). */
function generateSurface(z: SiteZone): Part[] {
  const entity = entityOf('zone', z.id);
  const raise = ZONE_RAISE[z.type];
  const parts: Part[] = [];
  const geo =
    raise >= 0.1
      ? extrudeMulti([[toRing(z.polygon)]], raise, 0)
      : flatMulti([[toRing(z.polygon)]], raise, true);
  if (geo)
    parts.push({
      id: `zone:${z.id}`,
      layer: 'site',
      entity,
      geometry: geo,
      materials: [z.material],
    });
  if (z.covered) {
    const b = polygonBounds(z.polygon);
    const posts: BufferGeometry[] = [];
    z.polygon.forEach((p) => posts.push(post(p, 0.2, COVER_HEIGHT, raise)));
    const roof = extrudeMulti([[toRing(z.polygon)]], 0.12, COVER_HEIGHT);
    // A pergola (open slats) over decks and patios; a solid roof elsewhere.
    if (z.type === 'deck' || z.type === 'patio') {
      const slats: BufferGeometry[] = [];
      for (let x = b.min.x; x <= b.max.x + 1e-6; x += 0.45)
        slats.push(strip({ x, y: b.min.y }, { x, y: b.max.y }, 0.08, 0.12, COVER_HEIGHT));
      const frame = mergeAll([...posts, ...slats]);
      if (frame)
        parts.push({
          id: `zone:${z.id}:pergola`,
          layer: 'site',
          entity,
          geometry: frame,
          materials: ['wood-panel'],
        });
      roof?.dispose();
    } else {
      const g = mergeAll(posts);
      if (g)
        parts.push({
          id: `zone:${z.id}:posts`,
          layer: 'site',
          entity,
          geometry: g,
          materials: ['paint-white'],
        });
      if (roof)
        parts.push({
          id: `zone:${z.id}:roof`,
          layer: 'site',
          entity,
          geometry: roof,
          materials: ['paint-white'],
        });
    }
  }
  return parts;
}

/** Splits a plot edge around the gates on it; returns the solid pieces. */
function fencePieces(a: Vec2, b: Vec2, gates: Gate[]): [Vec2, Vec2][] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-6) return [];
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const gaps: [number, number][] = [];
  for (const g of gates) {
    const t = (g.position.x - a.x) * ux + (g.position.y - a.y) * uy;
    const dx = g.position.x - (a.x + ux * t);
    const dy = g.position.y - (a.y + uy * t);
    if (Math.hypot(dx, dy) < 0.15 && t > -0.01 && t < len + 0.01)
      gaps.push([t - g.width / 2, t + g.width / 2]);
  }
  gaps.sort((p, q) => p[0] - q[0]);
  const at = (d: number): Vec2 => ({ x: a.x + ux * d, y: a.y + uy * d });
  const out: [Vec2, Vec2][] = [];
  let cursor = 0;
  for (const [g0, g1] of gaps) {
    if (g0 > cursor + 0.05) out.push([at(cursor), at(Math.max(cursor, g0))]);
    cursor = Math.max(cursor, g1);
  }
  if (cursor < len - 0.05) out.push([at(cursor), at(len)]);
  return out;
}

function generateFence(project: Project): Part[] {
  const { plot, gates } = project.site;
  if (plot.length < 3) return [];
  const pieces: BufferGeometry[] = [];
  const pillars: BufferGeometry[] = [];
  plot.forEach((a, i) => {
    const b = plot[(i + 1) % plot.length]!;
    for (const [p, q] of fencePieces(a, b, gates))
      pieces.push(strip(p, q, FENCE_THICKNESS, FENCE_HEIGHT, 0));
    pillars.push(post(a, 0.4, FENCE_HEIGHT + 0.25));
  });
  for (const g of gates) {
    // Pillars either side of the opening.
    const nx = Math.cos(g.direction);
    const ny = Math.sin(g.direction);
    const along = { x: -ny, y: nx };
    for (const s of [-1, 1])
      pillars.push(
        post(
          {
            x: g.position.x + along.x * (g.width / 2 + 0.2) * s,
            y: g.position.y + along.y * (g.width / 2 + 0.2) * s,
          },
          0.4,
          FENCE_HEIGHT + 0.5,
        ),
      );
  }
  const parts: Part[] = [];
  const fence = mergeAll(pieces);
  if (fence)
    parts.push({ id: 'site:fence', layer: 'site', geometry: fence, materials: ['paint-white'] });
  const pil = mergeAll(pillars);
  if (pil)
    parts.push({ id: 'site:pillars', layer: 'site', geometry: pil, materials: ['paving-stone'] });
  return parts;
}

/** Gate leaves: a tall dark-wood pedestrian door, or a wide sliding panel for vehicles. */
function generateGates(project: Project): Part[] {
  const parts: Part[] = [];
  for (const g of project.site.gates) {
    const vehicle = g.kind === 'vehicle';
    const h = vehicle ? 1.6 : 1.9;
    const geo = new BoxGeometry(0.08, h, g.width - 0.1);
    // Local frame: x = outward normal, z = along the boundary.
    geo.translate(0, h / 2 + 0.05, 0);
    geo.rotateY(-g.direction);
    geo.translate(g.position.x, 0, g.position.y);
    parts.push({
      id: `gate:${g.id}`,
      layer: 'site',
      entity: entityOf('gate', g.id),
      geometry: geo,
      materials: [vehicle ? 'metal-black' : 'wood-panel'],
    });
  }
  return parts;
}

/** Everything outdoors: ground, zones, fence and gates (world coordinates, y = 0 at the ground). */
export function generateSite(project: Project): Part[] {
  if (project.kind !== 'villa') return [];
  const parts = [...generateGround(project), ...generateFence(project), ...generateGates(project)];
  for (const z of project.site.zones) {
    if (z.type === 'pool' || z.type === 'water-feature') parts.push(...generatePool(z));
    else parts.push(...generateSurface(z));
  }
  // Everything outdoors takes the sky light (`@out`) even under realistic lighting.
  return parts.map((p) => ({ ...p, materials: p.materials.map((m) => `${m}@out`) }));
}
