import { create } from 'zustand';

/** Transient switches the 3D view obeys while a picture is being taken. */
interface ExportFlags {
  /** Clean look: no grid, helpers, selection highlight or measurement marks. */
  presentation: boolean;
  /** No sky: the picture keeps an alpha channel. */
  transparent: boolean;
  set: (patch: Partial<Pick<ExportFlags, 'presentation' | 'transparent'>>) => void;
}

export const useExportFlags = create<ExportFlags>((set) => ({
  presentation: false,
  transparent: false,
  set: (patch) => set(patch),
}));
