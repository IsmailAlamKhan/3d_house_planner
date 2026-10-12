import { create } from 'zustand';
import type { SnapResult } from '../geometry/snap';
import type { Vec2 } from '../geometry/vec';
import type { WallGeometry } from '../model/ops/plan';

export type Drag =
  | {
      kind: 'move';
      startRaw: Vec2;
      ref: Vec2;
      ids: string[];
      roomId?: string;
      delta: Vec2;
      moved: boolean;
      clickHit?: { type: 'wall' | 'room'; id: string };
    }
  | { kind: 'endpoint'; wallId: string; end: 'start' | 'end'; to: Vec2 }
  | { kind: 'box'; a: Vec2; b: Vec2 };

/** Transient state of whatever the user is in the middle of doing in the 2D plan. Never saved. */
interface DraftState {
  chain: Vec2[];
  typed: string;
  roomPts: Vec2[];
  measure: { a: Vec2; b?: Vec2 } | null;
  drag: Drag | null;
  /** Walls with in-progress geometry shown while dragging. */
  preview: WallGeometry[];
  spaceDown: boolean;
  panning: boolean;
  /** Last snapped hover position, used for typed lengths and previews. */
  hover: { point: Vec2; raw: Vec2; snap: SnapResult } | null;
  reset: () => void;
}

const empty = {
  chain: [] as Vec2[],
  typed: '',
  roomPts: [] as Vec2[],
  measure: null,
  drag: null,
  preview: [] as WallGeometry[],
  hover: null,
};

export const useDraft = create<DraftState>((set) => ({
  ...empty,
  spaceDown: false,
  panning: false,
  reset: () => set({ ...empty }),
}));
