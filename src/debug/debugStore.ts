import { create } from 'zustand';

/** Every effect and light type the render debug panel (`?debug=render`) can switch off to find what darkens a scene. */
export interface DebugFlags {
  shadows: boolean;
  ao: boolean;
  bloom: boolean;
  toneMapping: boolean;
  environment: boolean;
  hemisphere: boolean;
  sun: boolean;
  interiorLights: boolean;
  windowLights: boolean;
  /** Off = every surface gets the full sky light (what the old pipeline did). */
  skyMask: boolean;
}

export const DEBUG_DEFAULTS: DebugFlags = {
  shadows: true,
  ao: true,
  bloom: true,
  toneMapping: true,
  environment: true,
  hemisphere: true,
  sun: true,
  interiorLights: true,
  windowLights: true,
  skyMask: true,
};

export interface RenderInfo {
  outputColorSpace: string;
  toneMapping: string;
  exposure: number;
  pixelRatio: number;
  shadowMapType: string;
  pipeline: string[];
}

interface DebugState {
  flags: DebugFlags;
  info: RenderInfo | null;
  set: (patch: Partial<DebugFlags>) => void;
  setInfo: (info: RenderInfo) => void;
}

export const useDebug = create<DebugState>((set) => ({
  flags: DEBUG_DEFAULTS,
  info: null,
  set: (patch) => set((s) => ({ flags: { ...s.flags, ...patch } })),
  setInfo: (info) => set({ info }),
}));

/** `?debug=render` in the address turns the panel on. */
export const debugRenderEnabled = (): boolean =>
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('debug') === 'render';
