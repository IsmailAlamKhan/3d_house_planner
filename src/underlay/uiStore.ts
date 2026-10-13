import { create } from 'zustand';
import { useModel } from '../model/store';
import type { Underlay } from '../model/types';
import { useCamera } from '../scene3d/camera/cameraStore';
import { PRESET_TIME } from '../scene3d/lighting';
import { useSceneStore } from '../scene3d/sceneStore';

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
  /** "Compare with reference": the picture beside a render from above, with a divider at `compareSplit` (0–1). */
  compareOpen: boolean;
  compareSplit: number;
  openCompare: () => void;
  closeCompare: () => void;
  setCompareSplit: (v: number) => void;
  setup: SetupTarget | null;
  openSetup: (t: SetupTarget) => void;
  closeSetup: () => void;
}

/** What the comparison changed, to put back when it closes. */
let before: {
  viewMode: '2d' | '3d' | 'split';
  activeLevelId: string;
  levelFilter: ReturnType<typeof useSceneStore.getState>['levelFilter'];
  dollhouse: boolean;
  wallMode: ReturnType<typeof useSceneStore.getState>['wallMode'];
  lighting: ReturnType<typeof useSceneStore.getState>['lighting'];
  cameraMode: ReturnType<typeof useCamera.getState>['mode'];
} | null = null;

/** Ephemeral UI state of the reference-picture feature (never design state). */
export const useUnderlayUi = create<UnderlayUi>((set, get) => ({
  panelOpen: false,
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  compareOpen: false,
  compareSplit: 0.5,
  openCompare: () => {
    if (get().compareOpen) return;
    // The comparison lives in the 3D view, from above, at dusk with every lamp on and no roofs: remember what the
    // user had so that closing puts it back.
    const m = useModel.getState();
    const scene = useSceneStore.getState();
    before = {
      viewMode: m.viewMode,
      activeLevelId: m.activeLevelId,
      levelFilter: scene.levelFilter,
      dollhouse: scene.dollhouse,
      wallMode: scene.wallMode,
      lighting: scene.lighting,
      cameraMode: useCamera.getState().mode,
    };
    // Only the ground floor (the picture shows no upper floor, no roof), looked into from above.
    const ground = [...m.project.levels].sort((a, b) => a.index - b.index)[0];
    if (ground) m.setActiveLevel(ground.id);
    scene.setPref('levelFilter', 'below');
    scene.setPref('dollhouse', true);
    scene.setPref('wallMode', 'cut');
    scene.setPref('lighting', { mode: 'dusk', time: PRESET_TIME.dusk });
    useCamera.getState().setMode('top');
    m.setViewMode('3d');
    set({ compareOpen: true });
  },
  closeCompare: () => {
    if (!get().compareOpen) return;
    set({ compareOpen: false });
    if (!before) return;
    const scene = useSceneStore.getState();
    scene.setPref('levelFilter', before.levelFilter);
    scene.setPref('dollhouse', before.dollhouse);
    scene.setPref('wallMode', before.wallMode);
    scene.setPref('lighting', before.lighting);
    useCamera.getState().setMode(before.cameraMode);
    useModel.getState().setViewMode(before.viewMode);
    if (useModel.getState().project.levels.some((l) => l.id === before!.activeLevelId))
      useModel.getState().setActiveLevel(before.activeLevelId);
    before = null;
  },
  setCompareSplit: (v) => set({ compareSplit: Math.min(0.98, Math.max(0.02, v)) }),
  setup: null,
  openSetup: (setup) => set({ setup }),
  closeSetup: () => {
    const s = get().setup;
    if (s?.file && s.imageUrl.startsWith('blob:')) URL.revokeObjectURL(s.imageUrl);
    set({ setup: null });
  },
}));
