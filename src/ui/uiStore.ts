import { create } from 'zustand';

export type LeftTab = 'library' | 'levels' | 'ai' | 'checks' | 'notes';

interface UiState {
  leftTab: LeftTab;
  projectsOpen: boolean;
  setProjectsOpen: (o: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (o: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (o: boolean) => void;
  compareOpen: boolean;
  setCompareOpen: (o: boolean) => void;
  /** The note being shown/edited (notes panel and pins). */
  activeNoteId: string | null;
  setActiveNoteId: (id: string | null) => void;
  exportOpen: boolean;
  setExportOpen: (o: boolean) => void;
  wizardOpen: boolean;
  setWizardOpen: (o: boolean) => void;
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
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  compareOpen: false,
  setCompareOpen: (compareOpen) => set({ compareOpen }),
  activeNoteId: null,
  setActiveNoteId: (activeNoteId) => set({ activeNoteId }),
  exportOpen: false,
  setExportOpen: (exportOpen) => set({ exportOpen }),
  wizardOpen: false,
  setWizardOpen: (wizardOpen) => set({ wizardOpen }),
  leftDrawerOpen: false,
  rightDrawerOpen: false,
  setLeftTab: (leftTab) => set({ leftTab }),
  setLeftDrawerOpen: (leftDrawerOpen) => set({ leftDrawerOpen }),
  setRightDrawerOpen: (rightDrawerOpen) => set({ rightDrawerOpen }),
}));
