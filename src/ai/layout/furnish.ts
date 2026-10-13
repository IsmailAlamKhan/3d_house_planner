import { getEntry } from '../../catalog';
import { boxCorners, overlapDepth } from '../../geometry/collide';
import type { Point } from '../../model/types';
import type { ColumnBox } from './openings';
import type { PlannedItem, PlannedOpening, PlannedRoom, Rect } from './plan';
import { exteriorEdges } from './rect';

type Side = 'north' | 'south' | 'east' | 'west';
const SIDES: Side[] = ['north', 'east', 'south', 'west'];
const GAP = 0.04;

interface Interval {
  a: number;
  b: number;
}

/** Furniture layout for ONE room: wall slots minus doors, collision checks against doors, columns and earlier items. */
class RoomFurnisher {
  readonly items: PlannedItem[] = [];
  private free = new Map<Side, Interval[]>();
  private obstacles: Point[][] = [];
  private rect: Rect;

  constructor(
    private room: PlannedRoom,
    private level: number,
    private shell: Rect,
    openings: PlannedOpening[],
    columns: ColumnBox[],
    private floorToCeiling: number,
  ) {
    this.rect = room.rect;
    const r = this.rect;
    for (const side of SIDES) {
      const len = side === 'north' || side === 'south' ? r.w : r.h;
      this.free.set(side, [{ a: 0, b: len }]);
    }
    for (const o of openings) {
      const side = this.sideOf(o.at);
      if (!side) continue;
      const along = side === 'north' || side === 'south' ? o.at.x - r.x : o.at.y - r.y;
      const pad = o.kind === 'door' ? 0.35 : o.kind === 'archway' ? 0.15 : 0;
      if (pad > 0) this.cut(side, along - o.width / 2 - pad, along + o.width / 2 + pad);
      if (o.kind === 'door') {
        // Keep the area in front of a door clear so it can open.
        const n = this.inward(side);
        const half = o.width / 2 + 0.1;
        const t = { x: -n.y, y: n.x };
        this.obstacles.push([
          { x: o.at.x - t.x * half, y: o.at.y - t.y * half },
          { x: o.at.x + t.x * half, y: o.at.y + t.y * half },
          { x: o.at.x + t.x * half + n.x * 1.0, y: o.at.y + t.y * half + n.y * 1.0 },
          { x: o.at.x - t.x * half + n.x * 1.0, y: o.at.y - t.y * half + n.y * 1.0 },
        ]);
      }
    }
    for (const c of columns)
      this.obstacles.push(boxCorners(c.position, c.size.w + 0.1, c.size.d + 0.1, 0));
  }

  private sideOf(p: Point): Side | null {
    const r = this.rect;
    const eps = 0.05;
    if (Math.abs(p.y - r.y) < eps && p.x >= r.x - eps && p.x <= r.x + r.w + eps) return 'north';
    if (Math.abs(p.y - (r.y + r.h)) < eps && p.x >= r.x - eps && p.x <= r.x + r.w + eps)
      return 'south';
    if (Math.abs(p.x - r.x) < eps && p.y >= r.y - eps && p.y <= r.y + r.h + eps) return 'west';
    if (Math.abs(p.x - (r.x + r.w)) < eps && p.y >= r.y - eps && p.y <= r.y + r.h + eps)
      return 'east';
    return null;
  }

  private inward(side: Side): Point {
    return side === 'north'
      ? { x: 0, y: 1 }
      : side === 'south'
        ? { x: 0, y: -1 }
        : side === 'west'
          ? { x: 1, y: 0 }
          : { x: -1, y: 0 };
  }

  private cut(side: Side, a: number, b: number): void {
    const next: Interval[] = [];
    for (const iv of this.free.get(side)!) {
      if (b <= iv.a || a >= iv.b) next.push(iv);
      else {
        if (a > iv.a) next.push({ a: iv.a, b: a });
        if (b < iv.b) next.push({ a: b, b: iv.b });
      }
    }
    this.free.set(side, next);
  }

  length(side: Side): number {
    return side === 'north' || side === 'south' ? this.rect.w : this.rect.h;
  }

  /** Longest free stretch on a side. */
  longestFree(side: Side): number {
    return Math.max(0, ...this.free.get(side)!.map((i) => i.b - i.a));
  }

  /** Sides ordered by their longest free stretch. */
  sidesByFree(prefer?: (s: Side) => number): Side[] {
    return SIDES.slice().sort(
      (a, b) =>
        this.longestFree(b) + (prefer?.(b) ?? 0) - (this.longestFree(a) + (prefer?.(a) ?? 0)),
    );
  }

  isExterior(side: Side): boolean {
    return exteriorEdges(this.rect, this.shell).some((e) => {
      const r = this.rect;
      return (
        (side === 'north' && Math.abs(e.a.y - r.y) < 1e-3 && e.axis === 'x') ||
        (side === 'south' && Math.abs(e.a.y - (r.y + r.h)) < 1e-3 && e.axis === 'x') ||
        (side === 'west' && Math.abs(e.a.x - r.x) < 1e-3 && e.axis === 'y') ||
        (side === 'east' && Math.abs(e.a.x - (r.x + r.w)) < 1e-3 && e.axis === 'y')
      );
    });
  }

  private poseOnWall(
    side: Side,
    s: number,
    width: number,
    depth: number,
  ): { position: Point; rotation: number } {
    const r = this.rect;
    const inset = this.isExterior(side) ? 0.17 : 0.1;
    switch (side) {
      case 'north':
        return { position: { x: r.x + s + width / 2, y: r.y + inset + depth / 2 }, rotation: 0 };
      case 'south':
        return {
          position: { x: r.x + s + width / 2, y: r.y + r.h - inset - depth / 2 },
          rotation: Math.PI,
        };
      case 'west':
        return {
          position: { x: r.x + inset + depth / 2, y: r.y + s + width / 2 },
          rotation: -Math.PI / 2,
        };
      case 'east':
        return {
          position: { x: r.x + r.w - inset - depth / 2, y: r.y + s + width / 2 },
          rotation: Math.PI / 2,
        };
    }
  }

  private clear(position: Point, width: number, depth: number, rotation: number): boolean {
    const mine = boxCorners(position, width, depth, rotation);
    return !this.obstacles.some((o) => overlapDepth(mine, o) > 0.02);
  }

  private commit(
    catalogId: string,
    position: Point,
    rotation: number,
    scale: PlannedItem['scale'],
    elevation: number,
    width: number,
    depth: number,
    props: PlannedItem['props'] = {},
  ): PlannedItem {
    const item: PlannedItem = {
      level: this.level,
      catalogId,
      position,
      rotation,
      elevation,
      scale,
      props,
      room: this.room.key,
    };
    this.items.push(item);
    this.obstacles.push(boxCorners(position, width, depth, rotation));
    return item;
  }

  /**
   * Puts an item back-to-wall on `side`. `width` (along the wall) and `depth` default to the catalog size; they are
   * applied through the item scale. `align` picks the start, centre or end of the free stretch (or `at` = metres from the start).
   */
  onWall(
    side: Side,
    catalogId: string,
    opts: {
      width?: number;
      depth?: number;
      align?: 'start' | 'center' | 'end';
      at?: number;
      props?: PlannedItem['props'];
      elevation?: number;
    } = {},
  ): PlannedItem | null {
    const entry = getEntry(catalogId);
    if (!entry) return null;
    const width = opts.width ?? entry.defaultSize.w;
    const depth = opts.depth ?? entry.defaultSize.d;
    const iv = this.free
      .get(side)!
      .filter((i) => i.b - i.a >= width - 1e-6)
      .sort((a, b) => b.b - b.a - (a.b - a.a))[0];
    if (!iv) return null;
    const s =
      opts.at !== undefined
        ? Math.min(Math.max(opts.at - width / 2, iv.a), iv.b - width)
        : opts.align === 'start'
          ? iv.a
          : opts.align === 'end'
            ? iv.b - width
            : iv.a + (iv.b - iv.a - width) / 2;
    const pose = this.poseOnWall(side, s, width, depth);
    if (!this.clear(pose.position, width, depth, pose.rotation)) return null;
    this.cut(side, s - GAP, s + width + GAP);
    const scale = { x: width / entry.defaultSize.w, y: 1, z: depth / entry.defaultSize.d };
    const elevation =
      opts.elevation ?? (entry.placement === 'wall-mounted' ? (entry.mountHeight ?? 1.2) : 0);
    return this.commit(
      catalogId,
      pose.position,
      pose.rotation,
      scale,
      elevation,
      width,
      depth,
      opts.props,
    );
  }

  /** Puts an item at a free-standing position (no wall). */
  at(
    catalogId: string,
    position: Point,
    rotation = 0,
    scale = { x: 1, y: 1, z: 1 },
    opts: { elevation?: number; ignoreObstacles?: boolean; props?: PlannedItem['props'] } = {},
  ): PlannedItem | null {
    const entry = getEntry(catalogId);
    if (!entry) return null;
    const width = entry.defaultSize.w * scale.x;
    const depth = entry.defaultSize.d * scale.z;
    if (!opts.ignoreObstacles && !this.clear(position, width, depth, rotation)) return null;
    const r = this.rect;
    const margin = 0.12;
    if (
      position.x - width / 2 < r.x + margin - 0.3 ||
      position.x + width / 2 > r.x + r.w - margin + 0.3 ||
      position.y - depth / 2 < r.y + margin - 0.3 ||
      position.y + depth / 2 > r.y + r.h - margin + 0.3
    )
      return null;
    const elevation =
      opts.elevation ??
      (entry.placement === 'ceiling'
        ? Math.max(0, this.floorToCeiling - entry.defaultSize.h * scale.y)
        : 0);
    return this.commit(
      catalogId,
      position,
      rotation,
      scale,
      elevation,
      width,
      depth,
      opts.props ?? {},
    );
  }

  /** Obstacle-free ceiling light in the middle of the room. */
  ceilingLight(): void {
    const c = { x: this.rect.x + this.rect.w / 2, y: this.rect.y + this.rect.h / 2 };
    this.at('ceiling-light', c, 0, { x: 1, y: 1, z: 1 }, { ignoreObstacles: true });
  }

  get area(): number {
    return this.rect.w * this.rect.h;
  }

  get rectW(): number {
    return this.rect.w;
  }

  get rectH(): number {
    return this.rect.h;
  }

  center(): Point {
    return { x: this.rect.x + this.rect.w / 2, y: this.rect.y + this.rect.h / 2 };
  }

  /** In-front-of-wall position at `dist` metres from the wall surface, at `along` metres from the side's start. */
  front(side: Side, along: number, dist: number): Point {
    const r = this.rect;
    switch (side) {
      case 'north':
        return { x: r.x + along, y: r.y + dist };
      case 'south':
        return { x: r.x + along, y: r.y + r.h - dist };
      case 'west':
        return { x: r.x + dist, y: r.y + along };
      case 'east':
        return { x: r.x + r.w - dist, y: r.y + along };
    }
  }
}

const opposite = (s: Side): Side =>
  s === 'north' ? 'south' : s === 'south' ? 'north' : s === 'east' ? 'west' : 'east';

/** Default furniture for each room type. Placement is best-effort: anything that doesn't fit is simply left out. */
function furnishRoom(f: RoomFurnisher, type: PlannedRoom['type']): void {
  const A = f.area;
  switch (type) {
    case 'living': {
      const [main] = f.sidesByFree((s) => (f.isExterior(s) ? -0.3 : 0.2));
      if (!main) break;
      const sofa = f.onWall(main, A < 14 ? 'sofa-2seat' : 'sofa-3seat');
      if (sofa) {
        const along =
          main === 'north' || main === 'south'
            ? sofa.position.x - f.center().x + f.length(main) / 2
            : sofa.position.y - f.center().y + f.length(main) / 2;
        const table = f.front(main, along, 1.75);
        f.at('coffee-table', table, main === 'north' || main === 'south' ? 0 : Math.PI / 2);
        if (A > 16)
          f.at(
            'rug',
            {
              x: (table.x + sofa.position.x) / 2 + (main === 'east' ? 0 : 0),
              y: (table.y + sofa.position.y) / 2,
            },
            main === 'north' || main === 'south' ? 0 : Math.PI / 2,
            { x: 1.2, y: 1, z: 1.2 },
            { ignoreObstacles: true },
          );
      }
      const opp = opposite(main);
      if (f.length(main) > 0 && (main === 'north' || main === 'south' ? f.rectH : f.rectW) >= 3.6)
        f.onWall(opp, 'tv-unit', { align: 'center' });
      if (A > 20) f.onWall(sideAfter(main), 'armchair', { align: 'start' });
      if (A > 22) f.onWall(sideBefore(main), 'bookshelf', { align: 'end' });
      f.onWall(sideBefore(main), 'floor-lamp', { align: 'start' });
      f.onWall(opposite(sideBefore(main)), 'plant', { align: 'end' });
      f.ceilingLight();
      break;
    }
    case 'dining': {
      const seats = A < 10 ? 4 : A < 16 ? 6 : 8;
      const c = f.center();
      const rot = f.rectW >= f.rectH ? 0 : Math.PI / 2;
      // Fall back to a smaller table when the first choice does not fit.
      if (!f.at(`dining-table-${seats}`, c, rot)) f.at('dining-table-4', c, rot);
      f.at('pendant-light', c, 0, { x: 1, y: 1, z: 1 }, { ignoreObstacles: true });
      break;
    }
    case 'kitchen': {
      const [main] = f.sidesByFree((s) => (f.isExterior(s) ? 0.4 : 0));
      if (!main) break;
      const len = f.longestFree(main);
      f.onWall(main, 'fridge', { align: 'start' });
      if (len > 3.0) f.onWall(main, 'sink-kitchen', { align: 'start', width: 1.0 });
      if (len > 2.2) f.onWall(main, 'stove', { align: 'end' });
      const rest = f.longestFree(main) - 0.1;
      if (rest > 0.6) {
        const run = f.onWall(main, 'kitchen-base-run', {
          width: Math.min(rest, 2.4),
          align: 'center',
        });
        if (run)
          f.onWall(main, 'kitchen-wall-cabinet', {
            width: Math.min(rest, 2.4),
            align: 'center',
            at: undefined,
          });
      }
      const depthAvail = main === 'north' || main === 'south' ? f.rectH : f.rectW;
      if (A > 15 && depthAvail >= 3.8) {
        const c = f.center();
        const horizontal = main === 'north' || main === 'south';
        f.at('kitchen-island', c, horizontal ? 0 : Math.PI / 2);
      }
      f.ceilingLight();
      break;
    }
    case 'bedroom': {
      const [headSide] = f.sidesByFree((s) => (f.isExterior(s) ? -0.8 : 0.5));
      if (!headSide) break;
      const bedId =
        A < 8 ? 'bed-single' : A < 11 ? 'bed-double' : A < 16 ? 'bed-queen' : 'bed-king';
      const bed = f.onWall(headSide, bedId, { align: 'center' });
      if (bed) {
        const bw = getEntry(bedId)!.defaultSize.w;
        const along =
          headSide === 'north' || headSide === 'south'
            ? bed.position.x - (f.center().x - f.length(headSide) / 2)
            : bed.position.y - (f.center().y - f.length(headSide) / 2);
        if (A >= 9) {
          f.onWall(headSide, 'side-table', { at: along - bw / 2 - 0.25 });
          f.onWall(headSide, 'side-table', { at: along + bw / 2 + 0.25 });
        }
      }
      const others = f.sidesByFree().filter((s) => s !== headSide);
      const wardrobeSide = others.find((s) => f.longestFree(s) >= 1.5);
      if (wardrobeSide)
        f.onWall(wardrobeSide, 'wardrobe', {
          width: Math.min(2.2, f.longestFree(wardrobeSide) - 0.1),
          align: 'start',
        });
      if (A > 13) {
        const dr = others.find((s) => f.longestFree(s) >= 1.3 && s !== wardrobeSide);
        if (dr) f.onWall(dr, 'dresser', { align: 'center' });
      }
      f.ceilingLight();
      break;
    }
    case 'bathroom': {
      const sides = f.sidesByFree();
      const tub = A >= 5.2 && sides[0] && f.longestFree(sides[0]) >= 1.75;
      if (tub && sides[0]) f.onWall(sides[0], 'bathtub', { align: 'start' });
      else if (sides[0]) f.onWall(sides[0], 'shower', { align: 'start' });
      const s2 = sides.find((s) => s !== sides[0] && f.longestFree(s) >= 1.0);
      if (s2) {
        const basin = f.onWall(s2, 'basin', { align: 'start' });
        f.onWall(s2, 'wc', { align: 'end', width: 0.4 });
        if (basin)
          f.onWall(s2, 'mirror', {
            at:
              s2 === 'north' || s2 === 'south'
                ? basin.position.x - f.center().x + f.length(s2) / 2
                : basin.position.y - f.center().y + f.length(s2) / 2,
            elevation: 1.15,
          });
      }
      f.ceilingLight();
      break;
    }
    case 'study': {
      const [side] = f.sidesByFree((s) => (f.isExterior(s) ? 0.3 : 0));
      if (side) {
        const desk = f.onWall(side, 'desk', { align: 'center' });
        if (desk)
          f.at(
            'office-chair',
            f.front(
              side,
              desk.position.x -
                f.center().x +
                f.length(side) / 2 +
                (side === 'north' || side === 'south' ? 0 : 0),
              1.15,
            ),
            0,
            undefined,
            {},
          );
        const other = f.sidesByFree().find((s) => s !== side && f.longestFree(s) >= 1.0);
        if (other) f.onWall(other, 'bookshelf', { align: 'center' });
      }
      f.ceilingLight();
      break;
    }
    case 'utility': {
      const [side] = f.sidesByFree();
      if (side) f.onWall(side, 'washing-machine', { align: 'start' });
      f.ceilingLight();
      break;
    }
    case 'outdoor':
    case 'balcony':
      f.at('plant', f.center());
      break;
    default:
      f.ceilingLight();
  }
}

const sideAfter = (s: Side): Side => SIDES[(SIDES.indexOf(s) + 1) % 4]!;
const sideBefore = (s: Side): Side => SIDES[(SIDES.indexOf(s) + 3) % 4]!;

export interface FurnishInput {
  rooms: PlannedRoom[];
  openings: PlannedOpening[];
  columns: ColumnBox[];
  shell: Rect;
  floorToCeiling: number;
}

/** Default furniture for every room of the plan. */
export function furnishPlan(input: FurnishInput): PlannedItem[] {
  const out: PlannedItem[] = [];
  for (const room of input.rooms.filter((r) => !r.void)) {
    const mine = input.openings.filter((o) => o.level === room.level && o.rooms.includes(room.key));
    const f = new RoomFurnisher(
      room,
      room.level,
      input.shell,
      mine,
      input.columns,
      input.floorToCeiling,
    );
    furnishRoom(f, room.type);
    out.push(...f.items);
  }
  return out;
}
