import { migrateProject } from '../model/migrate';
import { newId } from '../model/ops/common';
import type { Project } from '../model/types';
import { getBackend, type StorageBackend } from './storage';

const PREFIX = 'project:';
const LAST_KEY = 'duplex-designer:last-project';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export async function saveProject(
  project: Project,
  b: StorageBackend = getBackend(),
): Promise<void> {
  await b.set(PREFIX + project.id, project);
}

export async function loadStoredProject(
  id: string,
  b: StorageBackend = getBackend(),
): Promise<Project | null> {
  const raw = await b.get(PREFIX + id);
  return raw ? migrateProject(raw) : null;
}

export async function listProjects(b: StorageBackend = getBackend()): Promise<ProjectSummary[]> {
  const out: ProjectSummary[] = [];
  for (const [key, value] of await b.entries()) {
    if (!key.startsWith(PREFIX)) continue;
    try {
      const p = migrateProject(value);
      out.push({ id: p.id, name: p.name, updatedAt: p.updatedAt });
    } catch {
      // Skip unreadable records rather than breaking the whole list.
    }
  }
  return out.sort((a, b2) => b2.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteProject(id: string, b: StorageBackend = getBackend()): Promise<void> {
  await b.del(PREFIX + id);
}

export async function renameStoredProject(
  id: string,
  name: string,
  b: StorageBackend = getBackend(),
): Promise<void> {
  const p = await loadStoredProject(id, b);
  if (p) await saveProject({ ...p, name, updatedAt: new Date().toISOString() }, b);
}

/** Copies a project under a new id and name. */
export function cloneProject(project: Project, name = `${project.name} (copy)`): Project {
  const now = new Date().toISOString();
  return { ...structuredClone(project), id: newId(), name, createdAt: now, updatedAt: now };
}

export async function duplicateStoredProject(
  id: string,
  b: StorageBackend = getBackend(),
): Promise<Project | null> {
  const p = await loadStoredProject(id, b);
  if (!p) return null;
  const copy = cloneProject(p);
  await saveProject(copy, b);
  return copy;
}

export const getLastProjectId = (): string | null => {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
};

export const setLastProjectId = (id: string): void => {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    // Private mode etc. — remembering the last project is a nicety only.
  }
};
