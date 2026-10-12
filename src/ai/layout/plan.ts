import type { Point, RoomType, StairType } from '../../model/types';

/** Axis-aligned rectangle: x/y = top-left corner in plan metres. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlannedRoom {
  /** Unique within the plan, e.g. `L0:Kitchen`. */
  key: string;
  level: number;
  name: string;
  type: RoomType;
  rect: Rect;
  /** Wanted area after scaling to the shell (m²) — used to report how close the result is. */
  wantedArea: number;
  /** Minimum width this room should keep (m). */
  minWidth: number;
  floorMaterial: string;
  ceilingMaterial: string;
  /** Open to the level above (the slab above is left out). */
  doubleHeight?: boolean;
  /** Only a placeholder for the floor opening above a double-height room: no doors, windows or furniture. */
  void?: boolean;
}

export interface PlannedWall {
  level: number;
  start: Point;
  end: Point;
  type: 'exterior' | 'interior';
}

export interface PlannedOpening {
  level: number;
  kind: 'door' | 'window' | 'archway';
  catalogId: string;
  /** Centre of the opening on the wall centreline. */
  at: Point;
  width: number;
  height: number;
  sillHeight: number;
  /** Rooms (keys) the opening belongs to / connects — for reporting and reachability checks. */
  rooms: string[];
}

export interface PlannedItem {
  level: number;
  catalogId: string;
  position: Point;
  rotation: number;
  elevation: number;
  scale: { x: number; y: number; z: number };
  props: Record<string, string | number | boolean>;
  room: string;
}

export interface PlannedStair {
  type: StairType;
  /** Bottom-centre of the first step (same position on every level). */
  position: Point;
  rotation: number;
  width: number;
  /** Room (hall / landing) the stair sits in. */
  roomRect: Rect;
}

export interface LayoutPlan {
  shell: Rect;
  levelNames: string[];
  floorToCeiling: number;
  rooms: PlannedRoom[];
  walls: PlannedWall[];
  openings: PlannedOpening[];
  items: PlannedItem[];
  stair: PlannedStair;
  /** Plain-language notes about constraints that could not be met. */
  warnings: string[];
  /** Lower is better; used to pick between candidate layouts. */
  score: number;
  title?: string;
}

export const rectArea = (r: Rect): number => r.w * r.h;
export const rectCenter = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export const rectCorners = (r: Rect): Point[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.w, y: r.y },
  { x: r.x + r.w, y: r.y + r.h },
  { x: r.x, y: r.y + r.h },
];
