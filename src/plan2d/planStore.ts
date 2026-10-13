import { create } from 'zustand';
import type { SnapResult } from '../geometry/snap';
import type { Vec2 } from '../geometry/vec';
import type { ZoneType } from '../model/types';
import type { View } from './view';

export type RoomMode = 'rect' | 'poly';
export const GRID_SIZES = [0.05, 0.1, 0.25] as const;

const PREFS_KEY = 'duplex-designer:plan-prefs';

interface Prefs {
  snapEnabled: boolean;
  gridSize: number;
  showGhosts: boolean;
  showAllDimensions: boolean;
  roomMode: RoomMode;
  /** Villa: what the zone tool draws and what the gate tool places. */
  zoneType: ZoneType;
  gateKind: 'pedestrian' | 'vehicle';
  siteVisible: boolean;
  siteLocked: boolean;
}

const defaults: Prefs = {
  snapEnabled: true,
  gridSize: 0.1,
  showGhosts: true,
  showAllDimensions: false,
  roomMode: 'rect',
  zoneType: 'lawn',
  gateKind: 'pedestrian',
  siteVisible: true,
  siteLocked: false,
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Prefs>) } : defaults;
  } catch {
    return defaults;
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // Preferences are a convenience only.
  }
}

interface PlanState extends Prefs {
  view: View;
  size: { w: number; h: number };
  cursor: Vec2 | null;
  snapResult: SnapResult | null;
  /** Short message shown over the canvas (e.g. why an edit was refused). */
  toast: string | null;
  /** A region to pulse on the plan for a moment (used when jumping to a check result). */
  flash: { min: Vec2; max: Vec2; key: number } | null;
  setFlash: (f: { min: Vec2; max: Vec2 } | null) => void;
  setView: (v: View) => void;
  setSize: (s: { w: number; h: number }) => void;
  setCursor: (c: Vec2 | null, s?: SnapResult | null) => void;
  setToast: (m: string | null) => void;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
}

export const usePlanStore = create<PlanState>((set, get) => ({
  ...loadPrefs(),
  view: { scale: 50, tx: 40, ty: 40 },
  size: { w: 0, h: 0 },
  cursor: null,
  snapResult: null,
  toast: null,
  flash: null,
  setFlash: (f) => set({ flash: f ? { ...f, key: Date.now() } : null }),
  setView: (view) => set({ view }),
  setSize: (size) => set({ size }),
  setCursor: (cursor, snapResult = null) => set({ cursor, snapResult }),
  setToast: (toast) => set({ toast }),
  setPref: (key, value) => {
    set({ [key]: value } as Pick<Prefs, typeof key>);
    const {
      snapEnabled,
      gridSize,
      showGhosts,
      showAllDimensions,
      roomMode,
      zoneType,
      gateKind,
      siteVisible,
      siteLocked,
    } = get();
    savePrefs({
      snapEnabled,
      gridSize,
      showGhosts,
      showAllDimensions,
      roomMode,
      zoneType,
      gateKind,
      siteVisible,
      siteLocked,
    });
  },
}));
