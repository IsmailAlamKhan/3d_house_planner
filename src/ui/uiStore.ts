import { create } from 'zustand';

export type LeftTab = 'library' | 'levels' | 'ai';

interface UiState {
  leftTab: LeftTab;
  projectsOpen: boolean;
  setProjectsOpen: (o: boolean) => void;
  leftDrawerOpen: boolean;
  rightDrawerOpen: boolean;
  setLeftTab: (t: LeftTab) => void;
  setLeftDrawerOpen: (o: boolean) => void;
  setRightDrawerOpen: (o: boolean) => void;
}

/** Ephemeral UI state only — never design state (that lives in the project model). */
export const useUiStore = create<UiState>((set) => ({
  leftTab: 'library',
  projectsOpen: false,
  setProjectsOpen: (projectsOpen) => set({ projectsOpen }),
  leftDrawerOpen: false,
  rightDrawerOpen: false,
  setLeftTab: (leftTab) => set({ leftTab }),
  setLeftDrawerOpen: (leftDrawerOpen) => set({ leftDrawerOpen }),
  setRightDrawerOpen: (rightDrawerOpen) => set({ rightDrawerOpen }),
}));
