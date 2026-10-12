import { create } from 'zustand';
import { type Isolation, NO_ISOLATION } from './isolation';
import type { Measurement } from './measure';
import { type SectionState, defaultSection } from './section';
import type { Vec3 } from './views';
import type { Walker } from './walk';

export type CameraMode = 'orbit' | 'walk' | 'top';

export interface FlyRequest {
  position: Vec3;
  target: Vec3;
  /** Orthographic zoom (top view). */
  zoom?: number;
  nonce: number;
}

interface CameraState {
  mode: CameraMode;
  setMode: (m: CameraMode) => void;
  /** Smoothly move the camera to a pose (orbit/top). */
  fly: FlyRequest | null;
  flyTo: (pose: { position: Vec3; target: Vec3; zoom?: number }) => void;
  /** Where the camera is now (updated about 10×/s) — drives the minimap and saved views. `heading` is the plan direction it faces (radians from +x toward +y). */
  live: { position: Vec3; target: Vec3; zoom?: number; heading: number };
  setLive: (l: CameraState['live']) => void;
  /** First-person state while in walk mode. */
  walker: Walker | null;
  setWalker: (w: Walker | null) => void;
  /** Ask the walker to jump to a plan position (minimap click). */
  teleport: { x: number; y: number; nonce: number } | null;
  requestTeleport: (x: number, y: number) => void;
  section: SectionState;
  setSection: (patch: Partial<SectionState>) => void;
  isolation: Isolation;
  setIsolation: (i: Isolation) => void;
  /** Everything see-through except furniture. */
  xray: boolean;
  setXray: (on: boolean) => void;
  measuring: boolean;
  setMeasuring: (on: boolean) => void;
  /** Completed measurements plus a first point waiting for its partner. */
  measurements: Measurement[];
  pending: Vec3 | null;
  addMeasurePoint: (p: Vec3) => void;
  clearMeasurements: () => void;
  /** Capture the current view (with a thumbnail) under this name. */
  capture: { name: string; nonce: number } | null;
  requestCapture: (name: string) => void;
  /** Focus the selection (F / double-click). */
  focusNonce: number;
  requestFocus: () => void;
}

let nonce = 0;

export const useCamera = create<CameraState>((set, get) => ({
  mode: 'orbit',
  setMode: (mode) => set({ mode }),
  fly: null,
  flyTo: (pose) => set({ fly: { ...pose, nonce: ++nonce } }),
  live: { position: [0, 0, 0], target: [0, 0, 0], heading: 0 },
  setLive: (live) => set({ live }),
  walker: null,
  setWalker: (walker) => set({ walker }),
  teleport: null,
  requestTeleport: (x, y) => set({ teleport: { x, y, nonce: ++nonce } }),
  section: defaultSection(),
  setSection: (patch) => set((s) => ({ section: { ...s.section, ...patch } })),
  isolation: NO_ISOLATION,
  setIsolation: (isolation) => set({ isolation }),
  xray: false,
  setXray: (xray) => set({ xray }),
  measuring: false,
  setMeasuring: (measuring) => set({ measuring, pending: null }),
  measurements: [],
  pending: null,
  addMeasurePoint: (p) => {
    const { pending } = get();
    if (!pending) set({ pending: p });
    else set((s) => ({ measurements: [...s.measurements, { a: pending, b: p }], pending: null }));
  },
  clearMeasurements: () => set({ measurements: [], pending: null }),
  capture: null,
  requestCapture: (name) => set({ capture: { name, nonce: ++nonce } }),
  focusNonce: 0,
  requestFocus: () => set((s) => ({ focusNonce: s.focusNonce + 1 })),
}));
