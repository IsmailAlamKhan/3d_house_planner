import { create } from 'zustand';
import type { Vec2 } from '../geometry/vec';
import type { Evaluation } from './actions';

/** What the user is currently carrying from the library (drag in progress, or armed by a tap/click). */
interface CatalogDragState {
  /** Entry being dragged with the mouse (HTML5 drag and drop). */
  dragId: string | null;
  /** Entry picked by tapping a card; the next tap on the plan or 3D view places it. */
  armedId: string | null;
  /** Live result of dropping at the pointer position (for the ghost + message). */
  hover: { point: Vec2; evaluation: Evaluation } | null;
  setDrag: (id: string | null) => void;
  setArmed: (id: string | null) => void;
  setHover: (h: CatalogDragState['hover']) => void;
}

export const useCatalogDrag = create<CatalogDragState>((set) => ({
  dragId: null,
  armedId: null,
  hover: null,
  setDrag: (dragId) => set({ dragId, hover: null }),
  setArmed: (armedId) => set({ armedId, hover: null }),
  setHover: (hover) => set({ hover }),
}));

/** The entry id currently being carried, whichever way. */
export const carriedId = (s: Pick<CatalogDragState, 'dragId' | 'armedId'>): string | null =>
  s.dragId ?? s.armedId;
