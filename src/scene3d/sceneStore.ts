import { create } from 'zustand';
import type { LightingState } from './lighting';
import type { QualityChoice } from './quality';
import type { WallMode } from './sceneModel';

export type LevelFilter = 'all' | 'below';
export type GizmoMode = 'translate' | 'rotate';

const KEY = 'duplex-designer:scene-prefs';

interface Prefs {
  levelFilter: LevelFilter;
  /** Hides ceilings and roofs so you can look down into the rooms. */
  dollhouse: boolean;
  wallMode: WallMode;
  doorsOpen: boolean;
  /** What the on-canvas handle does for a selected piece of furniture. */
  gizmoMode: GizmoMode;
  /** Time of day / look of the light. */
  lighting: LightingState;
  quality: QualityChoice;
  showFps: boolean;
}

const defaults: Prefs = {
  levelFilter: 'all',
  dollhouse: false,
  wallMode: 'up',
  doorsOpen: true,
  gizmoMode: 'translate',
  lighting: { mode: 'noon', time: 13 },
  quality: 'auto',
  showFps: false,
};

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Prefs>) } : defaults;
  } catch {
    return defaults;
  }
}

interface SceneState extends Prefs {
  /** Incremented to ask the camera to re-frame the apartment. */
  cameraResetKey: number;
  /** Live frames per second (updated about once a second while the FPS readout is on). */
  fps: number;
  setFps: (fps: number) => void;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  resetCamera: () => void;
}

export const useSceneStore = create<SceneState>((set, get) => ({
  ...load(),
  cameraResetKey: 0,
  fps: 0,
  setFps: (fps) => set({ fps }),
  setPref: (key, value) => {
    set({ [key]: value } as Pick<Prefs, typeof key>);
    const { levelFilter, dollhouse, wallMode, doorsOpen, gizmoMode, lighting, quality, showFps } =
      get();
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          levelFilter,
          dollhouse,
          wallMode,
          doorsOpen,
          gizmoMode,
          lighting,
          quality,
          showFps,
        }),
      );
    } catch {
      // Preferences are a convenience only.
    }
  },
  resetCamera: () => set((s) => ({ cameraResetKey: s.cameraResetKey + 1 })),
}));
