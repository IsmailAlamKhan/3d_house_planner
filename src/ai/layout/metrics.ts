import type { Point, RoomType } from '../../model/types';
import { DEFAULT_MIN_AREAS } from '../../checks/types';
import type { DesignIntent } from '../schemas';
import type { LayoutPlan, PlannedRoom, Rect } from './plan';
import { rectArea } from './plan';
import { aspect, sharedEdge } from './rect';
import { blockedWalkways } from './walkways';

/**
 * An independent judge of a finished LayoutPlan (it looks only at the result, never at how the plan was made),
 * so two engines can be compared on the same footing: `npm run eval:layout` and the unit tests use it.
 */

export interface PlanContext {
  /** The plot, when the project is a villa. */
  plot?: Point[];
  columns?: { position: Point; size: { w: number; d: number } }[];
}

const HABITABLE: RoomType[] = ['living', 'dining', 'kitchen', 'bedroom', 'study'];
const CIRCULATION: RoomType[] = ['corridor', 'stair', 'foyer'];
/** Small wet and storage rooms may be longer than 1 : 1.8 without being awkward. */
const SERVICE: RoomType[] = [
  'bathroom',
  'utility',
  'laundry',
  'walk-in-closet',
  'pantry',
  'sauna',
  'spa',
];
const eps = 1e-3;

const inside = (r: Rect, s: Rect) =>
  r.x >= s.x - eps &&
  r.y >= s.y - eps &&
  r.x + r.w <= s.x + s.w + eps &&
  r.y + r.h <= s.y + s.h + eps;

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** The rooms that count as part of the building (not the placeholder above a double-height room). */
const real = (plan: LayoutPlan): PlannedRoom[] => plan.rooms.filter((r) => !r.void);

/** Every hard constraint the plan breaks, in plain words (empty = valid). */
export function hardViolations(
  plan: LayoutPlan,
  intent: DesignIntent,
  ctx: PlanContext = {},
): string[] {
  const out: string[] = [];
  const rooms = real(plan);
  // Inside the outline, no overlaps.
  for (const r of rooms)
    if (!inside(r.rect, plan.shell)) out.push(`${r.name} is outside the building`);
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++)
      if (rooms[i]!.level === rooms[j]!.level && overlap(rooms[i]!.rect, rooms[j]!.rect) > 0.01)
        out.push(`${rooms[i]!.name} overlaps ${rooms[j]!.name}`);
  // Minimum width and area per room type.
  for (const r of rooms) {
    if (r.type === 'corridor' || r.type === 'stair' || r.type === 'outdoor') continue;
    const short = Math.min(r.rect.w, r.rect.h);
    if (short < r.minWidth - 0.06) out.push(`${r.name} is only ${short.toFixed(1)} m wide`);
    const min = DEFAULT_MIN_AREAS[r.type];
    if (min && rectArea(r.rect) < min * 0.9) out.push(`${r.name} is below its minimum area`);
  }
  // Every room reachable from the entrance through doors and archways.
  const reach = reachable(plan);
  for (const r of rooms) if (!reach.has(r.key)) out.push(`${r.name} cannot be reached`);
  // The stair is aligned: the same hall rectangle holds it on every level.
  if (plan.levelNames.length > 1) {
    const halls = plan.levelNames.map((_n, li) =>
      rooms.find((r) => r.level === li && (r.type === 'stair' || r.name === 'Landing')),
    );
    const base = plan.stair.roomRect;
    halls.forEach((h, li) => {
      if (!h) {
        // A wings plan keeps its stair in the central hall: the hall is a room whose rectangle holds the stair.
        const holder = rooms.find(
          (r) => r.level === li && overlap(r.rect, base) > rectArea(base) * 0.9,
        );
        if (!holder) out.push(`no stair hall on level ${li}`);
      } else if (overlap(h.rect, base) < rectArea(base) * 0.99)
        out.push(`stair misaligned on level ${li}`);
    });
  }
  // Fixed columns: no opening may sit on one (doors and windows are placed clear of them).
  for (const c of ctx.columns ?? []) {
    for (const o of plan.openings) {
      if (o.kind === 'archway') continue;
      if (
        Math.abs(o.at.x - c.position.x) < c.size.w / 2 + o.width / 2 - 0.05 &&
        Math.abs(o.at.y - c.position.y) < c.size.d / 2 + 0.05
      )
        out.push('an opening sits on a column');
      else if (
        Math.abs(o.at.y - c.position.y) < c.size.d / 2 + o.width / 2 - 0.05 &&
        Math.abs(o.at.x - c.position.x) < c.size.w / 2 + 0.05
      )
        out.push('an opening sits on a column');
    }
  }
  // Outdoors: what the brief asked for must exist on the plot.
  if (intent.site && ctx.plot) {
    const site = plan.site;
    const zones = site?.zones ?? [];
    for (const z of intent.site.zones) {
      if (z.type === 'path') continue;
      if (!zones.some((p) => p.type === z.type)) out.push(`no ${z.type} on the plot`);
    }
    const cars = intent.site.cars ?? 2;
    if (zones.some((z) => z.type === 'parking')) {
      const n = (site?.items ?? []).filter((i) => i.catalogId === 'car').length;
      if (n < Math.min(cars, 2)) out.push(`parking holds only ${n} cars`);
      if (!site?.gates.some((g) => g.kind === 'vehicle')) out.push('no vehicle gate');
    }
    if (!site?.gates.some((g) => g.kind === 'pedestrian')) out.push('no pedestrian gate');
  }
  return out;
}

/** Rooms (keys) reachable from the outside through the plan's doors and archways (and the stair between levels). */
export function reachable(plan: LayoutPlan): Set<string> {
  const rooms = real(plan);
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  for (const o of plan.openings) {
    if (o.kind === 'window' || o.rooms.length < 2) continue;
    link(o.rooms[0]!, o.rooms[1]!);
  }
  // The stair joins the hall rooms of all levels.
  const halls = rooms.filter(
    (r) => overlap(r.rect, plan.stair.roomRect) > rectArea(plan.stair.roomRect) * 0.9,
  );
  for (const h of halls) for (const g of halls) if (h !== g) link(h.key, g.key);
  const entrance = plan.openings.find((o) => o.catalogId === 'door-entrance');
  const start = entrance?.rooms[0];
  const seen = new Set<string>(start ? [start] : []);
  const queue = start ? [start] : [];
  while (queue.length) {
    const k = queue.shift()!;
    for (const n of adj.get(k) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen;
}

export interface PlanMetrics {
  hardOk: boolean;
  violations: string[];
  /** Share of the brief's requested adjacencies that are a shared wall with a door or archway (0–1). */
  adjacency: number;
  /** Share of habitable rooms with a window (0–1). */
  daylight: number;
  /** Corridors, halls and stairs as a share of all floor area. */
  corridorRatio: number;
  /** Share of rooms thinner than 1 : 1.8 (corridors excluded). */
  thin: number;
  /** Share of bedrooms with their bathroom directly beside them and a door between them (of those that asked). */
  ensuiteBeside: number;
  /** Share of upper-level bathrooms that sit above a wet room of the level below (1 when there are none). */
  stacked: number;
  /** Share of bedrooms reachable without walking through another bedroom. */
  privacy: number;
  /** Distinct partition lines per room (lower = straighter, simpler walls). */
  wallLines: number;
  /** Share of rooms with two or more doors whose walkway between them is clear (0.9 m) of furniture. */
  walkways: number;
  /** 0–100: one number for ranking plans (0 when a hard constraint fails). */
  quality: number;
}

export function planMetrics(
  plan: LayoutPlan,
  intent: DesignIntent,
  ctx: PlanContext = {},
): PlanMetrics {
  const violations = hardViolations(plan, intent, ctx);
  const rooms = real(plan);
  const byName = (level: number, name: string) =>
    rooms.find((r) => r.level === level && r.name.toLowerCase() === name.trim().toLowerCase());
  const connected = (a: PlannedRoom, b: PlannedRoom) =>
    plan.openings.some(
      (o) => o.kind !== 'window' && o.rooms.includes(a.key) && o.rooms.includes(b.key),
    );
  let adjTotal = 0;
  let adjOk = 0;
  let ensTotal = 0;
  let ensOk = 0;
  intent.levels.forEach((lvl, li) => {
    for (const w of lvl.rooms)
      for (const adj of w.adjacency) {
        const a = byName(li, w.name);
        const b = byName(li, adj.room);
        if (!a || !b) continue;
        adjTotal++;
        const e = sharedEdge(a.rect, b.rect);
        const ok = !!e && e.length >= 1.0 && connected(a, b);
        if (ok) adjOk++;
        const bedBath =
          (a.type === 'bedroom' && b.type === 'bathroom') ||
          (a.type === 'bathroom' && b.type === 'bedroom');
        if (bedBath && w.type === 'bedroom') {
          ensTotal++;
          if (ok) ensOk++;
        }
      }
  });
  const habitable = rooms.filter((r) => HABITABLE.includes(r.type));
  const lit = habitable.filter((r) =>
    plan.openings.some((o) => o.kind === 'window' && o.rooms.includes(r.key)),
  );
  const total = rooms.reduce((s, r) => s + rectArea(r.rect), 0);
  const circ = rooms
    .filter((r) => CIRCULATION.includes(r.type))
    .reduce((s, r) => s + rectArea(r.rect), 0);
  const shaped = rooms.filter(
    (r) => !CIRCULATION.includes(r.type) && !SERVICE.includes(r.type) && r.type !== 'outdoor',
  );
  const thin = shaped.filter((r) => aspect(r.rect) > 1.8).length / Math.max(1, shaped.length);
  const adjacency = adjTotal ? adjOk / adjTotal : 1;
  const daylight = habitable.length ? lit.length / habitable.length : 1;
  const corridorRatio = total ? circ / total : 0;
  // Plumbing stacks: upper bathrooms above a wet room below.
  const wetBelow = (level: number) =>
    rooms.filter(
      (r) =>
        r.level === level &&
        (r.type === 'bathroom' || r.type === 'kitchen' || r.type === 'utility'),
    );
  const uppers = rooms.filter((r) => r.level > 0 && r.type === 'bathroom');
  const stackedN = uppers.filter((u) =>
    wetBelow(u.level - 1).some(
      (b) => overlap(u.rect, b.rect) > 0.4 * Math.min(rectArea(u.rect), rectArea(b.rect)),
    ),
  ).length;
  // Privacy: bedrooms reached without crossing another bedroom (walk the door graph from the entrance).
  const beds = rooms.filter((r) => r.type === 'bedroom');
  const doorGraph = new Map<string, string[]>();
  for (const o of plan.openings) {
    if (o.kind === 'window' || o.rooms.length < 2) continue;
    (doorGraph.get(o.rooms[0]!) ?? doorGraph.set(o.rooms[0]!, []).get(o.rooms[0]!)!).push(
      o.rooms[1]!,
    );
    (doorGraph.get(o.rooms[1]!) ?? doorGraph.set(o.rooms[1]!, []).get(o.rooms[1]!)!).push(
      o.rooms[0]!,
    );
  }
  const typeOf = new Map(rooms.map((r) => [r.key, r.type]));
  const halls = rooms.filter(
    (r) => overlap(r.rect, plan.stair.roomRect) > rectArea(plan.stair.roomRect) * 0.9,
  );
  const entrance = plan.openings.find((o) => o.catalogId === 'door-entrance')?.rooms[0];
  const seenNoBed = new Set<string>([...(entrance ? [entrance] : []), ...halls.map((h) => h.key)]);
  const queue = [...seenNoBed];
  while (queue.length) {
    const k = queue.shift()!;
    if (typeOf.get(k) === 'bedroom') continue; // reached, but not walked through
    for (const nx of doorGraph.get(k) ?? [])
      if (!seenNoBed.has(nx)) {
        seenNoBed.add(nx);
        queue.push(nx);
      }
  }
  const lines = new Set<string>();
  for (const r of rooms) {
    for (const x of [r.rect.x, r.rect.x + r.rect.w])
      if (x > plan.shell.x + 0.05 && x < plan.shell.x + plan.shell.w - 0.05)
        lines.add('x' + r.level + Math.round(x * 10));
    for (const y of [r.rect.y, r.rect.y + r.rect.h])
      if (y > plan.shell.y + 0.05 && y < plan.shell.y + plan.shell.h - 0.05)
        lines.add('y' + r.level + Math.round(y * 10));
  }
  const walkRooms = rooms.filter(
    (r) => plan.openings.filter((o) => o.kind !== 'window' && o.rooms.includes(r.key)).length >= 2,
  );
  const blocked = blockedWalkways(rooms, plan.openings, plan.items).length;
  const hardOk = violations.length === 0;
  const quality = hardOk
    ? Math.max(
        0,
        100 -
          30 * (1 - adjacency) -
          25 * (1 - daylight) -
          250 * Math.max(0, corridorRatio - 0.14) -
          25 * thin -
          0 * 0,
      )
    : 0;
  return {
    hardOk,
    violations,
    adjacency,
    daylight,
    corridorRatio,
    thin,
    ensuiteBeside: ensTotal ? ensOk / ensTotal : 1,
    walkways: walkRooms.length ? 1 - blocked / walkRooms.length : 1,
    stacked: uppers.length ? stackedN / uppers.length : 1,
    privacy: beds.length ? beds.filter((b) => seenNoBed.has(b.key)).length / beds.length : 1,
    wallLines: lines.size / Math.max(1, rooms.length),
    quality,
  };
}
