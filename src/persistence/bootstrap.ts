import { useModel } from '../model/store';
import { getLastProjectId, listProjects, loadStoredProject, saveProject } from './repo';

/** On startup: reopen the last project (or the most recent), otherwise keep and store the sample project. */
export async function bootstrapProject(): Promise<void> {
  try {
    const lastId = getLastProjectId();
    const list = await listProjects();
    const id = list.find((p) => p.id === lastId)?.id ?? list[0]?.id;
    const stored = id ? await loadStoredProject(id) : null;
    if (stored) useModel.getState().loadProject(stored);
    else await saveProject(useModel.getState().project);
  } catch (e) {
    console.error('Could not load saved projects; starting with the sample project.', e);
  }
}
