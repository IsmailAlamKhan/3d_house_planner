import { create } from 'zustand';
import type { Underlay } from '../model/types';

/** A picture being set up: freshly chosen (`file` + `source` not yet stored) or an existing underlay being re-straightened. */
export interface SetupTarget {
  /** Object URL for showing the picture in the dialog. */
  imageUrl: string;
  width: number;
  height: number;
  name: string;
  /** New picture: the file the user picked (stored when they accept). */
  file?: File | Blob;
  /** Existing underlay being edited. */
  editId?: string;
  /** Points already marked (when editing). */
  points?: { x: number; y: number }[];
  mode?: 'corners' | 'two-point';
  /** Previous real size [width, depth] (corners) or [distance] in metres. */
  size?: number[];
  origin?: { x: number; y: number };
  source?: Underlay['source'];
}

interface UnderlayUi {
  panelOpen: boolean;
  setPanelOpen: (o: boolean) => void;
  setup: SetupTarget | null;
  openSetup: (t: SetupTarget) => void;
  closeSetup: () => void;
}

/** Ephemeral UI state of the reference-picture feature (never design state). */
export const useUnderlayUi = create<UnderlayUi>((set, get) => ({
  panelOpen: false,
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setup: null,
  openSetup: (setup) => set({ setup }),
  closeSetup: () => {
    const s = get().setup;
    if (s?.file && s.imageUrl.startsWith('blob:')) URL.revokeObjectURL(s.imageUrl);
    set({ setup: null });
  },
}));
