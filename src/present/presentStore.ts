import { create } from 'zustand';
import { DEFAULT_LABEL_STYLE, type LabelStyle } from './labels';
import type { PresentLook, PresentPreset } from './presets';

const KEY = 'duplex-designer:present';

interface Persisted {
  look: PresentLook;
  accent: boolean;
  fx: boolean;
  labels: LabelStyle;
  /** Rooms whose label is switched off. */
  hiddenLabels: string[];
}

const defaults: Persisted = {
  look: 'dusk',
  accent: true,
  fx: true,
  labels: DEFAULT_LABEL_STYLE,
  hiddenLabels: [],
};

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
    return { ...defaults, ...p, labels: { ...DEFAULT_LABEL_STYLE, ...(p.labels ?? {}) } };
  } catch {
    return defaults;
  }
}

export interface PathTraceState {
  running: boolean;
  samples: number;
  target: number;
  /** Set when the path tracer could not run and the normal render was used instead. */
  fallback: string | null;
}

interface PresentState extends Persisted {
  /** Presentation mode is on: cutaway view, chosen look, post-processing and labels. */
  active: boolean;
  preset: PresentPreset | null;
  /** Scene settings to put back when presentation mode is switched off. */
  restore: Record<string, unknown> | null;
  pathTrace: PathTraceState;
  setActive: (
    active: boolean,
    preset?: PresentPreset | null,
    restore?: Record<string, unknown> | null,
  ) => void;
  patch: (p: Partial<Persisted>) => void;
  setLabels: (p: Partial<LabelStyle>) => void;
  toggleRoomLabel: (roomId: string) => void;
  setPathTrace: (p: Partial<PathTraceState>) => void;
}

const persist = (s: Persisted) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage may be unavailable; the settings simply are not remembered.
  }
};
const pick = (s: PresentState): Persisted => ({
  look: s.look,
  accent: s.accent,
  fx: s.fx,
  labels: s.labels,
  hiddenLabels: s.hiddenLabels,
});

export const usePresent = create<PresentState>((set, get) => ({
  ...load(),
  active: false,
  preset: null,
  restore: null,
  pathTrace: { running: false, samples: 0, target: 200, fallback: null },
  setActive: (active, preset = null, restore = null) =>
    set((s) => ({
      active,
      preset: active ? preset : null,
      restore: active ? (restore ?? s.restore) : null,
    })),
  patch: (p) => {
    set(p);
    persist(pick(get()));
  },
  setLabels: (p) => {
    set((s) => ({ labels: { ...s.labels, ...p } }));
    persist(pick(get()));
  },
  toggleRoomLabel: (roomId) => {
    set((s) => ({
      hiddenLabels: s.hiddenLabels.includes(roomId)
        ? s.hiddenLabels.filter((i) => i !== roomId)
        : [...s.hiddenLabels, roomId],
    }));
    persist(pick(get()));
  },
  setPathTrace: (p) => set((s) => ({ pathTrace: { ...s.pathTrace, ...p } })),
}));
