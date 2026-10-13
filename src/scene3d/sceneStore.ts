import { create } from 'zustand';
import type { LightingState } from './lighting';
import type { QualityChoice } from './quality';
import type { WallMode } from './sceneModel';

export type LevelFilter = 'all' | 'below';
export type GizmoMode = 'translate' | 'rotate';
/** `realistic`: dark unless daylight or a lamp lights it. `design`: even, neutral light for editing. `auto`: design while editing in the split view, realistic otherwise. */
export type LightStyle = 'auto' | 'realistic' | 'design';

/** A lighting preset the user saved: the sky look plus which lamps are on. */
export interface CustomLightPreset {
  name: string;
  lighting: LightingState;
  master: 'auto' | 'on' | 'off';
}

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
  lightStyle: LightStyle;
  /** Exposure in stops (EV), applied once before tone mapping. */
  exposure: number;
  /** Smallest share of sky light that reaches interiors in realistic lighting (0–0.1). */
  nightVisibility: number;
  customPresets: CustomLightPreset[];
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
  lightStyle: 'auto',
  exposure: 0,
  nightVisibility: 0.02,
  customPresets: [],
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
    const {
      levelFilter,
      dollhouse,
      wallMode,
      doorsOpen,
      gizmoMode,
      lighting,
      quality,
      showFps,
      lightStyle,
      exposure,
      nightVisibility,
      customPresets,
    } = get();
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
          lightStyle,
          exposure,
          nightVisibility,
          customPresets,
        }),
      );
    } catch {
      // Preferences are a convenience only.
    }
  },
  resetCamera: () => set((s) => ({ cameraResetKey: s.cameraResetKey + 1 })),
}));

/** The lighting style in force: an explicit choice wins; `auto` is realistic when walking or presenting and design lighting in the split view. */
export function effectiveLightStyle(
  pref: LightStyle,
  viewMode: '2d' | '3d' | 'split',
  walking: boolean,
  presenting: boolean,
): 'realistic' | 'design' {
  if (pref !== 'auto') return pref; // an explicit choice always wins
  if (walking || presenting) return 'realistic';
  return viewMode === 'split' ? 'design' : 'realistic';
}
