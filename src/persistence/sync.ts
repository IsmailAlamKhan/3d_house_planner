import { migrateProject } from '../model/migrate';
import type { Project } from '../model/types';
import { cloneProject, deleteProject, listProjects, loadStoredProject, saveProject } from './repo';
import { type StorageBackend, getBackend } from './storage';

/** What this device last agreed on with the server for one project. */
export interface SyncMeta {
  revision: number;
  /** Local edits not yet accepted by the server. */
  dirty: boolean;
}

export interface ServerInfo {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
}

export type PushResult =
  | { kind: 'ok'; revision: number }
  | { kind: 'offline' }
  | { kind: 'conflict'; revision: number; project: Project };

const metaKey = (id: string) => `sync:${id}`;

export async function getMeta(
  id: string,
  b: StorageBackend = getBackend(),
): Promise<SyncMeta | null> {
  const m = (await b.get(metaKey(id))) as SyncMeta | undefined;
  return m && typeof m.revision === 'number' ? m : null;
}
export const setMeta = (id: string, m: SyncMeta, b: StorageBackend = getBackend()) =>
  b.set(metaKey(id), m);

/**
 * Talks to the app server's `/api/projects`. The server is the source of truth; IndexedDB is an offline cache, and edits
 * made while the server cannot be reached are marked dirty and pushed later. A push names the revision it was based
 * on, so a change made on another device in the meantime shows up as a conflict instead of being overwritten.
 */
export class SyncClient {
  constructor(
    private readonly http: typeof fetch = (...a) => fetch(...a),
    private readonly backend: StorageBackend = getBackend(),
  ) {}

  private async json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
    const res = await this.http(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // not JSON (e.g. a static host answered with HTML)
    }
    return { status: res.status, body: body as T };
  }

  /** Is there an app server with a projects API here? (false on static hosting, or when offline) */
  async available(): Promise<boolean> {
    try {
      const r = await this.json<unknown>('/api/projects');
      return r.status === 200 && Array.isArray(r.body);
    } catch {
      return false;
    }
  }

  async list(): Promise<ServerInfo[]> {
    const r = await this.json<ServerInfo[]>('/api/projects');
    if (r.status !== 200 || !Array.isArray(r.body)) throw new Error('The server did not answer.');
    return r.body;
  }

  async fetchOne(id: string): Promise<{ revision: number; project: Project } | null> {
    const r = await this.json<{ revision: number; project: unknown }>(`/api/projects/${id}`);
    if (r.status !== 200) return null;
    return { revision: r.body.revision, project: migrateProject(r.body.project) };
  }

  /** Sends the local copy. Creates the project on the server the first time. */
  async push(project: Project): Promise<PushResult> {
    const meta = await getMeta(project.id, this.backend);
    try {
      if (!meta) {
        const r = await this.json<{ revision: number }>('/api/projects', {
          method: 'POST',
          body: JSON.stringify(project),
        });
        if (r.status === 201) {
          await setMeta(project.id, { revision: r.body.revision, dirty: false }, this.backend);
          return { kind: 'ok', revision: r.body.revision };
        }
        if (r.status === 409) {
          const server = await this.fetchOne(project.id);
          if (server)
            return { kind: 'conflict', revision: server.revision, project: server.project };
        }
        throw new Error(`Server answered ${r.status}`);
      }
      const r = await this.json<{ revision: number; project?: unknown; error?: string }>(
        `/api/projects/${project.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({ baseRevision: meta.revision, project }),
        },
      );
      if (r.status === 200) {
        await setMeta(project.id, { revision: r.body.revision, dirty: false }, this.backend);
        return { kind: 'ok', revision: r.body.revision };
      }
      if (r.status === 409)
        return {
          kind: 'conflict',
          revision: r.body.revision,
          project: migrateProject(r.body.project),
        };
      if (r.status === 404) {
        // Deleted elsewhere: recreate it from this device.
        await this.backend.del(metaKey(project.id));
        return this.push(project);
      }
      throw new Error(`Server answered ${r.status}`);
    } catch {
      await setMeta(project.id, { revision: meta?.revision ?? 0, dirty: true }, this.backend);
      return { kind: 'offline' };
    }
  }

  /** Brings this device up to date: downloads new/changed projects, uploads local-only ones, drops ones deleted elsewhere. */
  async pull(openId?: string): Promise<{ changedOpen: Project | null; conflicts: string[] }> {
    const server = await this.list();
    const serverIds = new Set(server.map((s) => s.id));
    let changedOpen: Project | null = null;
    const conflicts: string[] = [];
    for (const s of server) {
      const meta = await getMeta(s.id, this.backend);
      if (meta?.dirty) {
        if (s.revision > meta.revision) conflicts.push(s.id);
        continue; // our push (below or on the next save) decides
      }
      if (meta && s.revision <= meta.revision) continue;
      const got = await this.fetchOne(s.id);
      if (!got) continue;
      await saveProject(got.project, this.backend);
      await setMeta(s.id, { revision: got.revision, dirty: false }, this.backend);
      if (s.id === openId) changedOpen = got.project;
    }
    for (const local of await listProjects(this.backend)) {
      if (serverIds.has(local.id)) continue;
      const meta = await getMeta(local.id, this.backend);
      if (meta && !meta.dirty) {
        await deleteProject(local.id, this.backend); // deleted on another device
        await this.backend.del(metaKey(local.id));
      } else {
        const p = await loadStoredProject(local.id, this.backend);
        // Made here (or before the server existed). A project nobody has touched yet (the starter sample) is not worth
        // uploading: every new device would add its own copy.
        if (p && p.updatedAt !== p.createdAt) await this.push(p);
      }
    }
    return { changedOpen, conflicts };
  }

  /** Pushes every project that has unsent local edits (after the server comes back). */
  async flushDirty(): Promise<PushResult[]> {
    const out: PushResult[] = [];
    for (const l of await listProjects(this.backend)) {
      const meta = await getMeta(l.id, this.backend);
      if (!meta?.dirty) continue;
      const p = await loadStoredProject(l.id, this.backend);
      if (p) out.push(await this.push(p));
    }
    return out;
  }

  async remove(id: string): Promise<void> {
    try {
      await this.json(`/api/projects/${id}`, { method: 'DELETE' });
      await this.backend.del(metaKey(id));
    } catch {
      // offline: the project stays on the server until the next time this device deletes it
    }
  }

  /** "Overwrite the server": push again on top of the server's current revision. */
  async overwrite(project: Project, serverRevision: number): Promise<PushResult> {
    await setMeta(project.id, { revision: serverRevision, dirty: true }, this.backend);
    return this.push(project);
  }

  /** "Save as a copy": the local version becomes a new project; the original is replaced by the server's version. */
  async saveAsCopy(
    local: Project,
    server: { revision: number; project: Project },
  ): Promise<Project> {
    const copy = cloneProject(local, `${local.name} (copy)`);
    await saveProject(copy, this.backend);
    await this.push(copy);
    await saveProject(server.project, this.backend);
    await setMeta(server.project.id, { revision: server.revision, dirty: false }, this.backend);
    return copy;
  }
}
