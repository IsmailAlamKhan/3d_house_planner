import { create, useStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import { createSampleProject } from './sample';
import type { Project, Selection, Tool } from './types';

export type ViewMode = '2d' | '3d' | 'split';

export interface ModelState {
  project: Project;
  selection: Selection;
  activeLevelId: string;
  tool: Tool;
  viewMode: ViewMode;
  /**
   * Runs `fn` against a draft of the project as ONE undoable step. Several ops inside one call
   * (a batch / transaction) undo together. If `fn` throws, nothing changes and the error is rethrown.
   */
  apply: <T>(fn: (draft: Project) => T) => T;
  /** Replaces the whole project (open/import) and clears undo history. */
  loadProject: (project: Project) => void;
  setSelection: (selection: Selection) => void;
  setActiveLevel: (id: string) => void;
  setTool: (tool: Tool) => void;
  setViewMode: (mode: ViewMode) => void;
}

export const NO_SELECTION: Selection = { type: null, ids: [] };

const initial = createSampleProject();

export const useModel = create<ModelState>()(
  temporal(
    immer((set) => ({
      project: initial,
      selection: NO_SELECTION,
      activeLevelId: initial.levels[0]!.id,
      tool: 'select' as Tool,
      viewMode: 'split' as ViewMode,
      apply: <T>(fn: (draft: Project) => T): T => {
        let result!: T;
        set((state) => {
          result = fn(state.project);
          state.project.updatedAt = new Date().toISOString();
        });
        return result;
      },
      loadProject: (project) => {
        set((state) => {
          state.project = project;
          state.selection = NO_SELECTION;
          state.activeLevelId = project.levels[0]?.id ?? '';
        });
        useModel.temporal.getState().clear();
      },
      setSelection: (selection) => set({ selection }),
      setActiveLevel: (activeLevelId) => set({ activeLevelId }),
      setTool: (tool) => set({ tool }),
      setViewMode: (viewMode) => set({ viewMode }),
    })),
    {
      // Undo/redo covers project mutations only — never selection, tool, camera or view.
      partialize: (s) => ({ project: s.project }),
      equality: (a, b) => a.project === b.project,
      limit: 200,
    },
  ),
);

/** Shorthand for running an edit outside React. */
export const edit = <T>(fn: (draft: Project) => T): T => useModel.getState().apply(fn);

export const undo = (): void => {
  useModel.temporal.getState().undo();
  fixupAfterHistory();
};
export const redo = (): void => {
  useModel.temporal.getState().redo();
  fixupAfterHistory();
};

/** After undo/redo the active level or selection may point at something that no longer exists. */
function fixupAfterHistory(): void {
  const { project, activeLevelId, selection } = useModel.getState();
  if (!project.levels.some((l) => l.id === activeLevelId)) {
    useModel.setState({ activeLevelId: project.levels[0]?.id ?? '' });
  }
  if (selection.type) {
    const all = new Set(
      [
        project.walls,
        project.openings,
        project.rooms,
        project.stairs,
        project.items,
        project.columns,
        project.roofs,
      ].flatMap((c) => c.map((e) => e.id)),
    );
    const ids = selection.ids.filter((id) => all.has(id));
    if (ids.length !== selection.ids.length) {
      useModel.setState({ selection: ids.length ? { type: selection.type, ids } : NO_SELECTION });
    }
  }
}

/** React hook for undo/redo availability. */
export function useHistoryState(): { canUndo: boolean; canRedo: boolean } {
  const canUndo = useStore(useModel.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useModel.temporal, (s) => s.futureStates.length > 0);
  return { canUndo, canRedo };
}
