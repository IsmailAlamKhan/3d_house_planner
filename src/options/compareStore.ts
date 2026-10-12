import { create } from 'zustand';
import type { Vec3 } from '../scene3d/camera/views';

export type Side = 'left' | 'right';

interface ComparePose {
  position: Vec3;
  target: Vec3;
  /** Which view the user is moving; the other follows. */
  source: Side | null;
  nonce: number;
}

interface CompareState {
  pose: ComparePose | null;
  publish: (source: Side, position: Vec3, target: Vec3) => void;
  reset: () => void;
}

/** The shared camera of the two comparison views: whichever one you drag, the other follows. */
export const useCompare = create<CompareState>((set, get) => ({
  pose: null,
  publish: (source, position, target) =>
    set({ pose: { source, position, target, nonce: (get().pose?.nonce ?? 0) + 1 } }),
  reset: () => set({ pose: null }),
}));
