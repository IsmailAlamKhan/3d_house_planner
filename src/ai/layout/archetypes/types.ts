import type { Point, RoomType } from '../../../model/types';
import type { StairIntent } from '../../schemas';
import type { Rect } from '../plan';

/** A room the skeleton decides by itself (a corridor); every level gets it, or only the ground level. */
export interface SkeletonRoom {
  name: string;
  type: RoomType;
  rect: Rect;
  levels: 'all' | 'ground';
}

/**
 * The zone skeleton an archetype proposes for the building shell: where the stair hall goes, which rectangles are
 * left for rooms, and any fixed circulation or open court. The optimiser then fills the regions with rooms.
 */
export interface Candidate {
  /** Which archetype made it. */
  archetype: string;
  hall: Rect;
  regions: Rect[];
  /** Penalty for how well the hall sits relative to the requested position. */
  penalty: number;
  orientation: 'x' | 'y';
  /** Wings strategy: the rectangle the reachability search starts from (the central hall). */
  reach?: Rect;
  /** Wings strategy: rooms whose rectangles are decided up front. */
  fixedRects?: { role: 'foyer' | 'hall'; rect: Rect }[];
  /** Corridors the skeleton lays out itself. */
  rooms?: SkeletonRoom[];
  /** Open-air court(s) inside the shell: outdoor on the ground level, open to the sky above. */
  courts?: Rect[];
}

export interface ArchetypeInput {
  shell: Rect;
  entrance: Point;
  nLevels: number;
  /** Size of the stair hall (null for a single level). */
  hall: { w: number; h: number } | null;
  stairPosition: StairIntent['position'];
  /** The brief asks for the villa's central hall with two wings. */
  wings: { foyer: boolean } | null;
  /** The brief has a double-height room. */
  doubleHeight: boolean;
  /** Fixed columns on the level (used to place corridors on a column line). */
  columns: { position: Point; size: { w: number; d: number } }[];
  villa: boolean;
}

export type PlotShape = 'wide' | 'deep' | 'square' | 'narrow';

/** One parametric plan type: what it suits and how it arranges the zones (documented in docs/ARCHITECTURE.md). */
export interface Archetype {
  id: string;
  name: string;
  summary: string;
  /** Building shapes it suits (long side vs short side). */
  shapes: PlotShape[];
  /** Building floor area it works for (m² per level). */
  area: [number, number];
  levels: [number, number];
  /** Where the zones go, in words. */
  zones: { public: string; private: string; service: string; outdoor: string };
  entrance: string;
  parking: string;
  garden: string;
  /** Whether it applies to this brief and shell at all. */
  suits: (input: ArchetypeInput) => boolean;
  candidates: (input: ArchetypeInput) => Candidate[];
}

export const shapeOf = (shell: Rect): PlotShape => {
  const r = Math.max(shell.w, shell.h) / Math.min(shell.w, shell.h);
  return r >= 1.9 ? 'narrow' : r >= 1.25 ? (shell.w >= shell.h ? 'wide' : 'deep') : 'square';
};

/** A region worth putting a room in. */
export const usable = (r: Rect): boolean =>
  r.w > 1e-6 && r.h > 1e-6 && Math.min(r.w, r.h) >= 1.8 && r.w * r.h >= 5.5;
