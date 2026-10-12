import { migrateProject } from '../model/migrate';
import type { Project } from '../model/types';
import { type StorageBackend, getBackend } from './storage';

const KEY = 'history:';
/** How many versions are kept per project. */
export const MAX_SNAPSHOTS = 20;
/** Autosaves closer together than this replace the newest version instead of adding a new one. */
export const MIN_GAP_MS = 30_000;

interface Stored {
  savedAt: string;
  project: unknown;
}

export interface SnapshotInfo {
  index: number;
  savedAt: string;
  name: string;
  rooms: number;
  walls: number;
  items: number;
}

const read = async (id: string, b: StorageBackend): Promise<Stored[]> => {
  const raw = await b.get(KEY + id);
  return Array.isArray(raw) ? (raw as Stored[]) : [];
};

/**
 * Remembers the project as one of its last 20 versions. Quick successive saves overwrite the newest version, so the
 * history spans a useful stretch of time instead of the last few seconds.
 */
export async function saveSnapshot(
  project: Project,
  b: StorageBackend = getBackend(),
  now = Date.now(),
  force = false,
): Promise<void> {
  const list = await read(project.id, b);
  const entry: Stored = { savedAt: new Date(now).toISOString(), project };
  const last = list[list.length - 1];
  if (last && !force && now - Date.parse(last.savedAt) < MIN_GAP_MS) list[list.length - 1] = entry;
  else list.push(entry);
  await b.set(KEY + project.id, list.slice(-MAX_SNAPSHOTS));
}

/** Versions of a project, newest first. */
export async function listSnapshots(
  id: string,
  b: StorageBackend = getBackend(),
): Promise<SnapshotInfo[]> {
  const list = await read(id, b);
  return list
    .map((s, index): SnapshotInfo | null => {
      try {
        const p = migrateProject(s.project);
        return {
          index,
          savedAt: s.savedAt,
          name: p.name,
          rooms: p.rooms.length,
          walls: p.walls.length,
          items: p.items.length,
        };
      } catch {
        return null; // a damaged version is skipped, not fatal
      }
    })
    .filter((x): x is SnapshotInfo => x !== null)
    .reverse();
}

export async function loadSnapshot(
  id: string,
  index: number,
  b: StorageBackend = getBackend(),
): Promise<Project | null> {
  const s = (await read(id, b))[index];
  return s ? migrateProject(s.project) : null;
}

export async function deleteHistory(id: string, b: StorageBackend = getBackend()): Promise<void> {
  await b.del(KEY + id);
}
