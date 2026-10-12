import { create } from 'zustand';
import { toast } from '../catalog/actions';
import { t } from '../i18n';
import { useModel } from '../model/store';
import type { Project } from '../model/types';
import { hasUnsavedChanges } from './autosave';
import { listProjects, loadStoredProject } from './repo';
import { SyncClient, getMeta } from './sync';

export type SyncStatus = 'local' | 'synced' | 'offline' | 'saving';

interface Conflict {
  projectId: string;
  revision: number;
  project: Project;
}

interface SyncState {
  status: SyncStatus;
  conflict: Conflict | null;
  setStatus: (s: SyncStatus) => void;
  setConflict: (c: Conflict | null) => void;
}

export const useSync = create<SyncState>((set) => ({
  status: 'local',
  conflict: null,
  setStatus: (status) => set({ status }),
  setConflict: (conflict) => set({ conflict }),
}));

let client: SyncClient | null = null;
let serverMode = false;
const TICK_MS = 10_000;

export const syncClient = (): SyncClient | null => (serverMode ? client : null);

/** Sends the open project to the server (called after each local autosave). */
export async function pushOpenProject(): Promise<void> {
  if (!serverMode || !client) return;
  const project = useModel.getState().project;
  if (useSync.getState().conflict?.projectId === project.id) return; // wait for the person to decide
  useSync.getState().setStatus('saving');
  const r = await client.push(project);
  if (r.kind === 'ok') useSync.getState().setStatus('synced');
  else if (r.kind === 'offline') useSync.getState().setStatus('offline');
  else
    useSync
      .getState()
      .setConflict({ projectId: project.id, revision: r.revision, project: r.project });
}

/** Periodic catch-up: retry unsent edits, then pick up what other devices changed. */
async function tick(): Promise<void> {
  if (!client || document.hidden) return;
  try {
    const open = useModel.getState().project;
    const untouched = open.updatedAt === open.createdAt && !(await getMeta(open.id));
    for (const r of await client.flushDirty())
      if (r.kind === 'conflict')
        useSync
          .getState()
          .setConflict({ projectId: open.id, revision: r.revision, project: r.project });
    const { changedOpen, conflicts } = await client.pull(open.id);
    if (conflicts.includes(open.id) && !useSync.getState().conflict) await pushOpenProject(); // surfaces the conflict
    // A change from another device is shown at once only if nothing here is waiting to be saved.
    if (changedOpen && !hasUnsavedChanges() && useModel.getState().project === open) {
      useModel.getState().loadProject(changedOpen);
      toast(t('sync.updated'), 3500);
    }
    // A fresh device starts on the untouched sample: show the newest shared project instead.
    if (untouched && !hasUnsavedChanges() && useModel.getState().project === open) {
      const newest = (await listProjects()).find((p) => p.id !== open.id && p.id !== undefined);
      const shared =
        newest && (await getMeta(newest.id)) ? await loadStoredProject(newest.id) : null;
      if (shared) useModel.getState().loadProject(shared);
    }
    useSync.getState().setStatus((await getMeta(open.id))?.dirty ? 'offline' : 'synced');
  } catch {
    useSync.getState().setStatus('offline');
  }
}

/** Starts syncing if an app server with the projects API is there; otherwise the app stays purely local. */
export async function startSync(http?: typeof fetch): Promise<() => void> {
  client = new SyncClient(http);
  if (!(await client.available())) {
    serverMode = false;
    useSync.getState().setStatus('local');
    return () => undefined;
  }
  serverMode = true;
  useSync.getState().setStatus('synced');
  await tick();
  const id = setInterval(() => void tick(), TICK_MS);
  const onOnline = () => void tick();
  window.addEventListener('online', onOnline);
  return () => {
    clearInterval(id);
    window.removeEventListener('online', onOnline);
  };
}
