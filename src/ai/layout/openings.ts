import type { Point } from '../../model/types';
import { t } from '../../i18n';
import type { PlannedOpening, PlannedRoom, Rect } from './plan';
import { type SharedEdge, exteriorEdges, sharedEdge } from './rect';

export interface ColumnBox {
  position: Point;
  size: { w: number; d: number };
}

/** Keeps track of where openings already are so two never overlap and none lands on a column. */
export class OpeningTracker {
  private placed: { level: number; axis: 'x' | 'y'; line: number; a: number; b: number }[] = [];

  constructor(private columns: ColumnBox[]) {}

  /** Free if no other opening within 10 cm and no column in the way. `along` = distance coordinate along the wall. */
  free(level: number, axis: 'x' | 'y', line: number, along: number, width: number): boolean {
    const a = along - width / 2 - 0.1;
    const b = along + width / 2 + 0.1;
    if (
      this.placed.some(
        (o) =>
          o.level === level &&
          o.axis === axis &&
          Math.abs(o.line - line) < 0.05 &&
          o.a < b &&
          o.b > a,
      )
    )
      return false;
    return !this.columns.some((c) => {
      const cx0 = c.position.x - c.size.w / 2 - 0.15;
      const cx1 = c.position.x + c.size.w / 2 + 0.15;
      const cy0 = c.position.y - c.size.d / 2 - 0.15;
      const cy1 = c.position.y + c.size.d / 2 + 0.15;
      return axis === 'x'
        ? line > cy0 && line < cy1 && cx0 < b && cx1 > a
        : line > cx0 && line < cx1 && cy0 < b && cy1 > a;
    });
  }

  add(level: number, axis: 'x' | 'y', line: number, along: number, width: number): void {
    this.placed.push({ level, axis, line, a: along - width / 2 - 0.1, b: along + width / 2 + 0.1 });
  }
}

/** Finds a spot for an opening of `width` along a shared/exterior edge, nearest `prefer` (fraction 0–1 along the edge). */
export function findSpot(
  edge: SharedEdge,
  width: number,
  level: number,
  tracker: OpeningTracker,
  margin = 0.3,
  prefer = 0.5,
): Point | null {
  const lo = (edge.axis === 'x' ? edge.a.x : edge.a.y) + margin + width / 2;
  const hi = (edge.axis === 'x' ? edge.b.x : edge.b.y) - margin - width / 2;
  if (hi < lo - 1e-9) return null;
  const line = edge.axis === 'x' ? edge.a.y : edge.a.x;
  const start = lo + (hi - lo) * prefer;
  const candidates = [start];
  for (let k = 1; k <= 40; k++) candidates.push(start + 0.2 * k, start - 0.2 * k);
  for (const along of candidates) {
    if (along < lo - 1e-9 || along > hi + 1e-9) continue;
    if (tracker.free(level, edge.axis, line, along, width)) {
      tracker.add(level, edge.axis, line, along, width);
      return edge.axis === 'x' ? { x: along, y: line } : { x: line, y: along };
    }
  }
  return null;
}

export interface DoorRequest {
  a: string;
  b: string;
  connection: 'door' | 'open';
}

const GROUP_PRIORITY = (type: string): number =>
  type === 'corridor' || type === 'stair'
    ? 0
    : type === 'living' || type === 'dining' || type === 'kitchen'
      ? 1
      : type === 'study' || type === 'utility' || type === 'other'
        ? 2
        : type === 'bathroom'
          ? 3
          : 4;

const isPrivate = (type: string) => type === 'bedroom' || type === 'bathroom';

export interface OpeningPlanInput {
  rooms: PlannedRoom[];
  shell: Rect;
  entrance: { position: Point };
  columns: ColumnBox[];
  /** Explicit door requests per level (from the design's adjacency lists). */
  requests: Map<number, DoorRequest[]>;
  /** Room key of the hall / landing on each level (where the stair is). */
  hallKey: Map<number, string>;
  /** Rooms that asked for an en-suite style link (so a bathroom may open into a bedroom). */
  ensuite: Set<string>;
}

export interface OpeningPlan {
  openings: PlannedOpening[];
  warnings: string[];
}

const doorWidth = (a: PlannedRoom, b: PlannedRoom) =>
  a.type === 'bathroom' || b.type === 'bathroom' || a.type === 'utility' || b.type === 'utility'
    ? 0.8
    : 0.9;

/** Entrance, doors (requested + enough to reach every room), archways for open-plan links, and windows. */
export function planOpenings(input: OpeningPlanInput): OpeningPlan {
  const { rooms, shell, columns } = input;
  const tracker = new OpeningTracker(columns);
  const openings: PlannedOpening[] = [];
  const warnings: string[] = [];
  const levels = [...new Set(rooms.map((r) => r.level))].sort((a, b) => a - b);

  // ── Main entrance (ground level) ──
  const ground = rooms.filter((r) => r.level === 0);
  const ep = input.entrance.position;
  const onPerimeter = nearestOnRect(ep, shell);
  let entranceRoom: PlannedRoom | undefined;
  let entranceEdge: SharedEdge | undefined;
  let best = Infinity;
  for (const r of ground) {
    for (const e of exteriorEdges(r.rect, shell)) {
      const d = distToEdge(onPerimeter, e);
      if (d < best) {
        best = d;
        entranceRoom = r;
        entranceEdge = e;
      }
    }
  }
  if (entranceRoom && entranceEdge) {
    const frac = fractionAlong(onPerimeter, entranceEdge);
    const spot = findSpot(entranceEdge, 1.0, 0, tracker, 0.25, frac);
    if (spot) {
      openings.push({
        level: 0,
        kind: 'door',
        catalogId: 'door-entrance',
        at: spot,
        width: 1.0,
        height: 2.2,
        sillHeight: 0,
        rooms: [entranceRoom.key],
      });
    } else warnings.push(t('ai.warn.entrance'));
  }

  for (const level of levels) {
    const lr = rooms.filter((r) => r.level === level && !r.void);
    const byName = new Map(lr.map((r) => [r.name.toLowerCase(), r]));
    const hall = lr.find((r) => r.key === input.hallKey.get(level));
    const connected = new Set<string>();
    const addConnection = (a: PlannedRoom, b: PlannedRoom, open: boolean): boolean => {
      const edge = sharedEdge(a.rect, b.rect);
      if (!edge) return false;
      const wantArch = open && edge.length >= 1.9;
      const width = wantArch ? Math.min(2.0, edge.length - 0.6) : doorWidth(a, b);
      const spot = findSpot(edge, width, level, tracker, 0.25);
      if (!spot) return false;
      openings.push({
        level,
        kind: wantArch ? 'archway' : 'door',
        catalogId: wantArch ? 'archway' : 'door-single',
        at: spot,
        width,
        height: 2.1,
        sillHeight: 0,
        rooms: [a.key, b.key],
      });
      connected.add(`${a.key}|${b.key}`);
      connected.add(`${b.key}|${a.key}`);
      return true;
    };

    // Requested links.
    for (const req of input.requests.get(level) ?? []) {
      const a = byName.get(req.a.toLowerCase());
      const b = byName.get(req.b.toLowerCase());
      if (!a || !b || connected.has(`${a.key}|${b.key}`)) continue;
      if (!addConnection(a, b, req.connection === 'open')) {
        warnings.push(t('ai.warn.noDoor').replace('{a}', a.name).replace('{b}', b.name));
      }
    }

    // Reach every room from the hall: repeatedly add the best door from the reached set to an unreached neighbour.
    // Without a stair hall (a single-level home) start from the room the entrance opens into, else the most public room.
    const root =
      hall ??
      (level === 0 && entranceRoom && !entranceRoom.void ? entranceRoom : undefined) ??
      [...lr].sort(
        (a, b) =>
          GROUP_PRIORITY(a.type) - GROUP_PRIORITY(b.type) ||
          b.rect.w * b.rect.h - a.rect.w * a.rect.h,
      )[0];
    const reached = new Set<string>(root ? [root.key] : []);
    const graph = new Map<string, Set<string>>();
    for (const c of connected) {
      const [x, y] = c.split('|') as [string, string];
      (graph.get(x) ?? graph.set(x, new Set()).get(x)!).add(y);
    }
    // Expand what the requested doors already connect.
    const grow = () => {
      let changed = true;
      while (changed) {
        changed = false;
        for (const k of [...reached]) {
          for (const n of graph.get(k) ?? []) {
            if (reached.has(n)) continue;
            reached.add(n);
            changed = true;
          }
        }
      }
    };
    grow();
    while (reached.size < lr.length) {
      let pick: { a: PlannedRoom; b: PlannedRoom; score: number } | null = null;
      for (const a of lr.filter((r) => reached.has(r.key))) {
        for (const b of lr.filter((r) => !reached.has(r.key))) {
          const e = sharedEdge(a.rect, b.rect);
          if (!e || e.length < 1.0) continue;
          let score = GROUP_PRIORITY(a.type) * 3 + GROUP_PRIORITY(b.type) - e.length * 0.2;
          if (a.type === 'bedroom' && b.type === 'bedroom') score += 12; // keep bedrooms private from each other
          if (
            isPrivate(a.type) &&
            isPrivate(b.type) &&
            !input.ensuite.has(b.key) &&
            !input.ensuite.has(a.key)
          )
            score += 6;
          if (
            b.type === 'bathroom' &&
            a.type !== 'corridor' &&
            a.type !== 'stair' &&
            !input.ensuite.has(b.key) &&
            !input.ensuite.has(a.key)
          )
            score += 4;
          if (!pick || score < pick.score) pick = { a, b, score };
        }
      }
      if (!pick || !addConnection(pick.a, pick.b, false)) {
        const stuck = lr.filter((r) => !reached.has(r.key)).map((r) => r.name);
        warnings.push(t('ai.warn.unreachable').replace('{rooms}', stuck.join(', ')));
        break;
      }
      reached.add(pick.b.key);
      (graph.get(pick.a.key) ?? graph.set(pick.a.key, new Set()).get(pick.a.key)!).add(pick.b.key);
      (graph.get(pick.b.key) ?? graph.set(pick.b.key, new Set()).get(pick.b.key)!).add(pick.a.key);
      grow();
    }

    // ── Windows on outside walls ──
    for (const r of lr) {
      const wantsWindow =
        r.type === 'bathroom'
          ? true
          : ['living', 'kitchen', 'dining', 'bedroom', 'study', 'other'].includes(r.type);
      if (!wantsWindow) continue;
      const edges = exteriorEdges(r.rect, shell).sort((a, b) => b.length - a.length);
      let placed = 0;
      for (const e of edges) {
        const small = r.type === 'bathroom';
        const count = e.length >= 4.2 && !small ? 2 : 1;
        const width = small
          ? 0.7
          : Math.min(r.type === 'living' ? 2.0 : 1.5, Math.max(0.8, (e.length / count) * 0.5));
        for (let k = 0; k < count; k++) {
          const frac = count === 1 ? 0.5 : k === 0 ? 0.27 : 0.73;
          const spot = findSpot(e, width, level, tracker, 0.35, frac);
          if (!spot) continue;
          const sill = small ? 1.4 : r.type === 'kitchen' ? 1.05 : 0.9;
          openings.push({
            level,
            kind: 'window',
            catalogId: small
              ? 'window-fixed'
              : r.type === 'living' && width >= 1.8
                ? 'window-sliding'
                : 'window-casement',
            at: spot,
            width,
            height: small ? 0.6 : r.type === 'living' ? 1.4 : 1.2,
            sillHeight: sill,
            rooms: [r.key],
          });
          placed++;
        }
        if (placed > 0) break;
      }
      if (placed === 0 && r.type !== 'bathroom' && r.type !== 'other')
        warnings.push(t('ai.warn.noWindow').replace('{room}', r.name));
    }
  }
  return { openings, warnings };
}

function nearestOnRect(p: Point, r: Rect): Point {
  const cx = Math.min(r.x + r.w, Math.max(r.x, p.x));
  const cy = Math.min(r.y + r.h, Math.max(r.y, p.y));
  const inside = p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
  if (!inside) return { x: cx, y: cy };
  const d = [p.x - r.x, r.x + r.w - p.x, p.y - r.y, r.y + r.h - p.y];
  const m = Math.min(...d);
  if (m === d[0]) return { x: r.x, y: p.y };
  if (m === d[1]) return { x: r.x + r.w, y: p.y };
  if (m === d[2]) return { x: p.x, y: r.y };
  return { x: p.x, y: r.y + r.h };
}

function distToEdge(p: Point, e: SharedEdge): number {
  const x = Math.min(Math.max(p.x, Math.min(e.a.x, e.b.x)), Math.max(e.a.x, e.b.x));
  const y = Math.min(Math.max(p.y, Math.min(e.a.y, e.b.y)), Math.max(e.a.y, e.b.y));
  return Math.hypot(p.x - x, p.y - y);
}

function fractionAlong(p: Point, e: SharedEdge): number {
  const len = e.length || 1;
  const t = e.axis === 'x' ? (p.x - e.a.x) / len : (p.y - e.a.y) / len;
  return Math.min(0.9, Math.max(0.1, t));
}
