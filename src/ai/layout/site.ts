import { polygonBounds } from '../../geometry/polygon';
import { t } from '../../i18n';
import type { Point, ZoneType } from '../../model/types';
import type { SiteIntent, SiteSide, SiteZoneIntent } from '../schemas';
import type { Rect } from './plan';

/** What the layout solver decides for the plot: zones, gates and outdoor furniture (plan metres). */
export interface PlannedSite {
  zones: { type: ZoneType; name: string; polygon: Point[]; covered: boolean }[];
  gates: { kind: 'pedestrian' | 'vehicle'; position: Point }[];
  items: {
    catalogId: string;
    position: Point;
    rotation: number;
    scale: { x: number; y: number; z: number };
    props: Record<string, string | number | boolean>;
  }[];
  warnings: string[];
}

export interface SitePlanInput {
  intent: SiteIntent;
  plot: Point[];
  /** The building's bounding box. */
  building: Rect;
  entrance: { position: Point; direction: number };
}

/** Space kept clear between the building and zones, and between zones and the fence. */
const BUILDING_GAP = 0.8;
const FENCE_GAP = 0.5;
const CAR_W = 2.7;
const CAR_L = 5.2;
const PATH_W = 1.6;

/** How long (along its strip) each kind of zone likes to be, in metres. */
const NATURAL: Record<ZoneType, number> = {
  pool: 7,
  deck: 4.5,
  patio: 4.5,
  parking: 5.4,
  play: 5,
  garden: 6,
  lawn: 7,
  path: 3,
  'water-feature': 3,
};
/** Zones that absorb spare length (the rest keep close to their natural size). */
const GROWS: ZoneType[] = ['garden', 'lawn'];

const rectPoly = (r: Rect): Point[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.w, y: r.y },
  { x: r.x + r.w, y: r.y + r.h },
  { x: r.x, y: r.y + r.h },
];
const rectArea = (r: Rect) => r.w * r.h;
const centre = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Which plan side the entrance faces: N (−y), S (+y), W (−x) or E (+x). */
function facing(direction: number): 'N' | 'S' | 'W' | 'E' {
  const nx = Math.cos(direction);
  const ny = Math.sin(direction);
  if (Math.abs(ny) >= Math.abs(nx)) return ny >= 0 ? 'S' : 'N';
  return nx >= 0 ? 'E' : 'W';
}

/** Zone widths (along the strip) for a list of zones filling `length`. */
function lengths(zones: SiteZoneIntent[], length: number, cars: number): number[] {
  const natural = zones.map(
    (z) =>
      (z.type === 'parking' ? CAR_W * Math.max(1, cars) + 0.4 : NATURAL[z.type]) * (z.scale ?? 1),
  );
  const total = natural.reduce((a, b) => a + b, 0);
  if (!total) return [];
  const growers = zones.map((z) => GROWS.includes(z.type));
  if (total <= length) {
    const spare = length - total;
    const nGrow = growers.filter(Boolean).length;
    if (nGrow) return natural.map((n, i) => (growers[i] ? n + spare / nGrow : n));
    // No zone wants more room: stretch all of them a bit (at most 1.5×) and leave the rest as lawn.
    const k = Math.min(1.5, length / total);
    return natural.map((n) => n * k);
  }
  return natural.map((n) => (n / total) * length);
}

/**
 * Places the requested outdoor zones around the building on the plot: front (entrance side), back, left and right
 * strips, a path from the pedestrian gate to the entrance, gates, and outdoor furniture. Everything is a plain
 * rectangle inside the plot's bounding box; constraints that cannot be met are returned as plain-language warnings.
 */
export function planSite(input: SitePlanInput): PlannedSite {
  const { intent, building: B } = input;
  const P = polygonBounds(input.plot);
  const out: PlannedSite = { zones: [], gates: [], items: [], warnings: [] };
  const cars = intent.cars ?? 2;
  const face = facing(input.entrance.direction);

  // The four strips around the building (plan N/S/W/E).
  const left = P.min.x + FENCE_GAP;
  const right = P.max.x - FENCE_GAP;
  const top = P.min.y + FENCE_GAP;
  const bottom = P.max.y - FENCE_GAP;
  const strips: Record<'N' | 'S' | 'W' | 'E', Rect> = {
    N: { x: left, y: top, w: right - left, h: B.y - BUILDING_GAP - top },
    S: {
      x: left,
      y: B.y + B.h + BUILDING_GAP,
      w: right - left,
      h: bottom - (B.y + B.h + BUILDING_GAP),
    },
    W: { x: left, y: B.y, w: B.x - BUILDING_GAP - left, h: B.h },
    E: { x: B.x + B.w + BUILDING_GAP, y: B.y, w: right - (B.x + B.w + BUILDING_GAP), h: B.h },
  };
  // Side names are relative to someone standing at the front looking at the house.
  const SIDE_OF: Record<typeof face, Record<SiteSide, 'N' | 'S' | 'W' | 'E'>> = {
    S: { front: 'S', back: 'N', left: 'W', right: 'E' },
    N: { front: 'N', back: 'S', left: 'E', right: 'W' },
    E: { front: 'E', back: 'W', left: 'S', right: 'N' },
    W: { front: 'W', back: 'E', left: 'N', right: 'S' },
  };
  const map = SIDE_OF[face];

  // The path from the entrance to the plot edge, and the pedestrian gate at its end.
  const ep = input.entrance.position;
  const frontStrip = strips[map.front];
  const alongX = map.front === 'N' || map.front === 'S';
  const edgePoint: Point = (() => {
    switch (map.front) {
      case 'S':
        return { x: ep.x, y: P.max.y };
      case 'N':
        return { x: ep.x, y: P.min.y };
      case 'E':
        return { x: P.max.x, y: ep.y };
      case 'W':
        return { x: P.min.x, y: ep.y };
    }
  })();
  if (frontStrip.w > 0.5 && frontStrip.h > 0.5) {
    const pathRect: Rect = alongX
      ? {
          x: ep.x - PATH_W / 2,
          y: map.front === 'S' ? B.y + B.h : P.min.y,
          w: PATH_W,
          h: map.front === 'S' ? P.max.y - (B.y + B.h) : B.y - P.min.y,
        }
      : {
          x: map.front === 'E' ? B.x + B.w : P.min.x,
          y: ep.y - PATH_W / 2,
          w: map.front === 'E' ? P.max.x - (B.x + B.w) : B.x - P.min.x,
          h: PATH_W,
        };
    out.zones.push({
      type: 'path',
      name: t('zone.path'),
      polygon: rectPoly(pathRect),
      covered: false,
    });
    out.gates.push({ kind: 'pedestrian', position: edgePoint });
  } else out.warnings.push(t('site.warn.noFront'));

  // Group the requested zones by side (paths are automatic).
  const bySide = new Map<SiteSide, SiteZoneIntent[]>();
  for (const z of intent.zones) {
    if (z.type === 'path') continue;
    (bySide.get(z.side) ?? bySide.set(z.side, []).get(z.side)!).push(z);
  }

  const place = (zone: SiteZoneIntent, rect: Rect) => {
    const name = zone.name ?? t(`zone.${zone.type}` as 'zone.garden');
    out.zones.push({
      type: zone.type,
      name,
      polygon: rectPoly(rect),
      covered: zone.covered ?? false,
    });
    furnishZone(out, zone, rect, cars);
  };

  for (const [side, zones] of bySide) {
    const strip = strips[map[side]];
    if (strip.w < 1 || strip.h < 1) {
      out.warnings.push(
        t('site.warn.noRoom').replace('{side}', t(`site.side.${side}` as 'site.side.front')),
      );
      continue;
    }
    const horizontal = strip.w >= strip.h;
    // The front strip is split by the path; every other strip is one slot.
    const slots: Rect[] = [];
    if (side === 'front' && (alongX ? strip.w : strip.h) > 4) {
      const c = alongX ? ep.x : ep.y;
      const half = PATH_W / 2 + 0.4;
      if (alongX) {
        slots.push(
          { ...strip, w: c - half - strip.x },
          { ...strip, x: c + half, w: strip.x + strip.w - (c + half) },
        );
      } else {
        slots.push(
          { ...strip, h: c - half - strip.y },
          { ...strip, y: c + half, h: strip.y + strip.h - (c + half) },
        );
      }
    } else slots.push(strip);
    const usable = slots.filter((s) => s.w > 0.5 && s.h > 0.5);
    // Deal zones to slots: parking and the pool want the roomiest slot.
    const queue = zones.slice().sort((a, b) => NATURAL[b.type] - NATURAL[a.type]);
    const assigned = usable.map(() => [] as SiteZoneIntent[]);
    const load = usable.map(() => 0);
    for (const z of queue) {
      const nat = z.type === 'parking' ? CAR_W * cars + 0.4 : NATURAL[z.type];
      let best = 0;
      let bestFree = -Infinity;
      usable.forEach((s, i) => {
        const free = (horizontal ? s.w : s.h) - load[i]!;
        if (free > bestFree) {
          bestFree = free;
          best = i;
        }
      });
      assigned[best]!.push(z);
      load[best]! += nat;
    }
    usable.forEach((slot, si) => {
      const list = assigned[si]!;
      if (!list.length) return;
      const len = horizontal ? slot.w : slot.h;
      const ls = lengths(list, len, cars);
      let cursor = horizontal ? slot.x : slot.y;
      list.forEach((z, i) => {
        const l = ls[i]!;
        const depth = horizontal ? slot.h : slot.w;
        let d = depth;
        if (z.type === 'pool') d = Math.min(depth, 4.6 * (z.scale ?? 1));
        if (z.type === 'parking') {
          d = Math.min(depth, CAR_L + 0.3);
          if (d < CAR_L - 0.01) out.warnings.push(t('site.warn.parkingDepth'));
        }
        // Pools and parking sit against the building side of the strip; everything else fills it.
        const near = z.type === 'pool' || z.type === 'deck' ? 0 : 0;
        const rect: Rect = horizontal
          ? {
              x: cursor,
              y: map[side] === 'S' ? slot.y + near : slot.y + slot.h - d - near,
              w: l,
              h: d,
            }
          : {
              x: map[side] === 'E' ? slot.x + near : slot.x + slot.w - d - near,
              y: cursor,
              w: d,
              h: l,
            };
        if (rectArea(rect) > 0.8) place(z, rect);
        cursor += l;
      });
    });
  }

  // Gates: a vehicle gate in front of the parking zone, on the nearest plot edge.
  const parking = out.zones.find((z) => z.type === 'parking');
  if (parking) {
    const b = polygonBounds(parking.polygon);
    const c = { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 };
    const dists: [number, Point][] = [
      [c.y - P.min.y, { x: c.x, y: P.min.y }],
      [P.max.y - c.y, { x: c.x, y: P.max.y }],
      [c.x - P.min.x, { x: P.min.x, y: c.y }],
      [P.max.x - c.x, { x: P.max.x, y: c.y }],
    ];
    dists.sort((a, b2) => a[0] - b2[0]);
    out.gates.push({ kind: 'vehicle', position: dists[0]![1] });
  }
  return out;
}

const item = (
  out: PlannedSite,
  catalogId: string,
  position: Point,
  rotation = 0,
  props: Record<string, string | number | boolean> = {},
  scale = { x: 1, y: 1, z: 1 },
) => out.items.push({ catalogId, position, rotation, scale, props });

/** Outdoor furniture and planting for one zone. */
function furnishZone(out: PlannedSite, zone: SiteZoneIntent, r: Rect, cars: number): void {
  const c = centre(r);
  const long = r.w >= r.h;
  switch (zone.type) {
    case 'parking': {
      const n = Math.min(Math.max(0, Math.floor((long ? r.w : r.h) / CAR_W + 1e-6)), cars, 6);
      for (let i = 0; i < n; i++) {
        const along = (long ? r.x : r.y) + CAR_W * (i + 0.5) + ((long ? r.w : r.h) - n * CAR_W) / 2;
        item(
          out,
          'car',
          long ? { x: along, y: c.y } : { x: c.x, y: along },
          long ? 0 : Math.PI / 2,
          { color: i % 2 ? '#1f2937' : '#e5e7eb' },
        );
      }
      break;
    }
    case 'pool': {
      item(out, 'pool-ladder', { x: r.x + 0.35, y: c.y }, Math.PI / 2);
      for (const p of [
        { x: r.x + 0.1, y: r.y + 0.1 },
        { x: r.x + r.w - 0.1, y: r.y + r.h - 0.1 },
      ])
        item(out, 'garden-light', p);
      break;
    }
    case 'deck': {
      item(out, 'sun-lounger', { x: r.x + 0.6, y: r.y + r.h - 1.2 }, 0);
      if (r.w > 3) item(out, 'sun-lounger', { x: r.x + 1.6, y: r.y + r.h - 1.2 }, 0);
      if (r.w > 3.5 && r.h > 2.4) item(out, 'parasol', { x: r.x + r.w - 1.5, y: r.y + 1.5 });
      break;
    }
    case 'patio': {
      if (r.w >= 2.6 && r.h >= 1.4) item(out, 'outdoor-dining', c, 0);
      else item(out, 'lounge-set', c, 0);
      if (zone.covered) item(out, 'garden-light', { x: r.x + 0.2, y: r.y + 0.2 });
      break;
    }
    case 'play': {
      item(out, 'play-frame', { x: r.x + Math.min(2, r.w / 2), y: r.y + r.h / 2 });
      if (r.w > 5.5 || r.h > 5.5)
        item(out, 'trampoline', { x: r.x + r.w - 1.7, y: r.y + r.h - 1.7 });
      break;
    }
    case 'water-feature': {
      item(out, 'fountain', c, 0, {}, { x: Math.min(1, r.w / 2), y: 1, z: Math.min(1, r.h / 2) });
      break;
    }
    case 'garden':
    case 'lawn': {
      const area = rectArea(r);
      const trees = Math.min(3, Math.floor(area / 30));
      const kinds = ['tree-broad', 'tree-palm', 'tree-conifer'];
      for (let i = 0; i < trees; i++)
        item(out, kinds[i % kinds.length]!, {
          x: r.x + r.w * (i % 2 ? 0.75 : 0.25),
          y: r.y + r.h * (0.3 + 0.4 * ((i + 1) % 2)),
        });
      if (r.h > 2 && r.w > 2) {
        item(out, 'shrub', { x: r.x + 0.7, y: r.y + r.h - 0.7 });
        item(out, 'flower-bed', { x: r.x + r.w / 2, y: r.y + r.h - 0.6 }, 0);
        item(out, 'garden-light', { x: r.x + r.w - 0.4, y: r.y + 0.4 });
      }
      if (zone.type === 'garden' && zone.side === 'front' && r.w >= 5 && r.h >= 3.5)
        item(out, 'fountain', c, 0, {}, { x: 0.8, y: 0.8, z: 0.8 });
      break;
    }
    default:
      break;
  }
}
