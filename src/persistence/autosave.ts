import type { StoreApi } from 'zustand';
import type { ModelState } from '../model/store';
import type { Project } from '../model/types';
import { saveSnapshot } from './history';
import { loadStoredProject, saveProject, setLastProjectId } from './repo';
import type { StorageBackend } from './storage';

let unsaved = false;

/** True when the stored copy is exactly this project (a project that was only opened, not edited). */
async function unchanged(project: Project, backend?: StorageBackend): Promise<boolean> {
  try {
    const stored = await loadStoredProject(project.id, backend);
    return !!stored && JSON.stringify(stored) === JSON.stringify(project);
  } catch {
    return false;
  }
}

/** True while a change is waiting to be written (or the last write failed). */
export const hasUnsavedChanges = (): boolean => unsaved;

/**
 * Saves the project to storage 1 s after the last change (and keeps its last 20 versions). Returns a stop function
 * that flushes any pending save. While a save is pending, closing the tab asks for confirmation.
 */
export function startAutosave(
  store: Pick<StoreApi<ModelState>, 'getState' | 'subscribe'>,
  backend?: StorageBackend,
  delayMs = 1000,
  /** Called after each save has been written locally (the app uses it to sync with the server). */
  onSaved?: () => void | Promise<void>,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    const { project } = store.getState();
    setLastProjectId(project.id);
    // Opening a project (at start-up, from the list, after a reload from the server) replaces the store's project too, but
    // changes nothing: writing it back would only bump the server revision and make other devices see a false conflict.
    unchanged(project, backend)
      .then((same) => {
        if (same) return;
        return saveProject(project, backend)
          .then(() => saveSnapshot(project, backend))
          .then(() => onSaved?.());
      })
      .then(() => {
        if (store.getState().project === project) unsaved = false;
      })
      .catch((e) => {
        unsaved = true; // could not write: keep warning before the tab closes
        console.error('Autosave failed', e);
      });
  };
  let last = store.getState().project;
  const unsub = store.subscribe((s) => {
    if (s.project === last) return;
    last = s.project;
    unsaved = true;
    clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  });
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!unsaved) return;
    flush(); // best effort
    e.preventDefault();
    e.returnValue = '';
  };
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', onBeforeUnload);
  return () => {
    unsub();
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', onBeforeUnload);
    if (timer !== undefined) {
      clearTimeout(timer);
      flush();
    }
  };
}

/** Saves the open project right now (Ctrl/Cmd+S) and returns once it is stored. */
export async function saveNow(backend?: StorageBackend): Promise<void> {
  const { useModel } = await import('../model/store');
  const { project } = useModel.getState();
  setLastProjectId(project.id);
  await saveProject(project, backend);
  await saveSnapshot(project, backend, Date.now(), true);
  unsaved = false;
}
