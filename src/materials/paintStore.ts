import { create } from 'zustand';

/** The material currently "on the eyedropper" (copied from one surface, ready to paint others). */
interface PaintState {
  held: string | null;
  setHeld: (id: string | null) => void;
}

export const usePaint = create<PaintState>((set) => ({
  held: null,
  setHeld: (held) => set({ held }),
}));
