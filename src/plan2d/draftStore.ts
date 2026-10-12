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
  | { kind: 'item'; id: string; startRaw: Vec2; grab: Vec2; moved: boolean; clickHit?: boolean }
  | { kind: 'opening'; id: string; startRaw: Vec2; moved: boolean; clickHit?: boolean }
  | { kind: 'rotate'; id: string }
  | { kind: 'endpoint'; wallId: string; end: 'start' | 'end'; to: Vec2 }
  | { kind: 'box'; a: Vec2; b: Vec2 };

/** Transient state of whatever the user is in the middle of doing in the 2D plan. Never saved. */
interface DraftState {
  chain: Vec2[];
  typed: string;
  roomPts: Vec2[];
  measure: { a: Vec2; b?: Vec2 } | null;
  drag: Drag | null;
  /** Pose of the item being dragged / rotated. `raw` is the unsnapped pointer target used on commit. */
  itemPreview: {
    id: string;
    raw: Vec2;
    position: Vec2;
    rotation: number;
    ok: boolean;
    messages: string[];
  } | null;
  /** Where the door/window being dragged would land. */
  openingPreview: {
    id: string;
    raw: Vec2;
    wallId: string;
    offset: number;
    ok: boolean;
    message?: string;
  } | null;
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
  itemPreview: null,
  openingPreview: null,
  hover: null,
};

export const useDraft = create<DraftState>((set) => ({
  ...empty,
  spaceDown: false,
  panning: false,
  reset: () => set({ ...empty }),
}));
