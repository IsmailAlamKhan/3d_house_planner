import type { StoreApi } from 'zustand';
import type { ModelState } from '../model/store';
import { saveProject, setLastProjectId } from './repo';
import type { StorageBackend } from './storage';

/** Saves the project to storage 1 s after the last change. Returns a stop function that flushes any pending save. */
export function startAutosave(
  store: Pick<StoreApi<ModelState>, 'getState' | 'subscribe'>,
  backend?: StorageBackend,
  delayMs = 1000,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    const { project } = store.getState();
    setLastProjectId(project.id);
    void saveProject(project, backend);
  };
  let last = store.getState().project;
  const unsub = store.subscribe((s) => {
    if (s.project === last) return;
    last = s.project;
    clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  });
  return () => {
    unsub();
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
}
