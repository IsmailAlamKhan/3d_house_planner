import { create } from 'zustand';

export type ViewMode = '2d' | '3d' | 'split';
export type LeftTab = 'library' | 'levels' | 'ai';

interface UiState {
  viewMode: ViewMode;
  leftTab: LeftTab;
  leftDrawerOpen: boolean;
  rightDrawerOpen: boolean;
  setViewMode: (m: ViewMode) => void;
  setLeftTab: (t: LeftTab) => void;
  setLeftDrawerOpen: (o: boolean) => void;
  setRightDrawerOpen: (o: boolean) => void;
}

/** Ephemeral UI state only — never design state (that lives in the project model). */
export const useUiStore = create<UiState>((set) => ({
  viewMode: 'split',
  leftTab: 'library',
  leftDrawerOpen: false,
  rightDrawerOpen: false,
  setViewMode: (viewMode) => set({ viewMode }),
  setLeftTab: (leftTab) => set({ leftTab }),
  setLeftDrawerOpen: (leftDrawerOpen) => set({ leftDrawerOpen }),
  setRightDrawerOpen: (rightDrawerOpen) => set({ rightDrawerOpen }),
}));
