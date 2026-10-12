import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { migrateProject } from '../src/model/migrate';
import type { Project } from '../src/model/types';

export const MAX_VERSIONS = 20;
/** Saves closer together than this replace the newest version instead of adding another. */
export const VERSION_GAP_MS = 30_000;

export interface ProjectInfo {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
}

export interface VersionInfo {
  id: number;
  revision: number;
  savedAt: string;
  name: string;
}

export type SaveResult =
  { ok: true; revision: number } | { ok: false; conflict: { revision: number; project: Project } };

/**
 * Projects in SQLite. Every write is validated with the same Zod schema the browser uses (`migrateProject`), and an
 * update must name the revision it was based on, so two devices editing at once cannot silently overwrite each other.
 */
export class ProjectStore {
  readonly db: Database.Database;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, revision INTEGER NOT NULL,
        saved_at TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS versions_by_project ON versions(project_id, id);
    `);
  }

  close(): void {
    this.db.close();
  }

  list(): ProjectInfo[] {
    return this.db
      .prepare(
        'SELECT id, name, revision, updated_at AS updatedAt FROM projects ORDER BY updated_at DESC',
      )
      .all() as ProjectInfo[];
  }

  get(id: string): { revision: number; project: Project } | null {
    const row = this.db.prepare('SELECT revision, data FROM projects WHERE id = ?').get(id) as
      { revision: number; data: string } | undefined;
    return row ? { revision: row.revision, project: migrateProject(JSON.parse(row.data)) } : null;
  }

  /** Throws `ProjectFormatError` if the data is not a valid project. */
  create(raw: unknown): { id: string; revision: number } | 'exists' {
    const project = migrateProject(raw);
    if (this.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(project.id)) return 'exists';
    this.db
      .prepare('INSERT INTO projects (id, name, revision, updated_at, data) VALUES (?, ?, 1, ?, ?)')
      .run(project.id, project.name, project.updatedAt, JSON.stringify(project));
    this.snapshot(project, 1, Date.now(), true);
    return { id: project.id, revision: 1 };
  }

  update(id: string, baseRevision: number, raw: unknown, now = Date.now()): SaveResult | 'missing' {
    const project = migrateProject(raw);
    const tx = this.db.transaction((): SaveResult | 'missing' => {
      const cur = this.db.prepare('SELECT revision FROM projects WHERE id = ?').get(id) as
        { revision: number } | undefined;
      if (!cur) return 'missing';
      if (cur.revision !== baseRevision) {
        const server = this.get(id)!;
        return { ok: false, conflict: { revision: server.revision, project: server.project } };
      }
      const revision = cur.revision + 1;
      const saved = { ...project, id };
      this.db
        .prepare(
          'UPDATE projects SET name = ?, revision = ?, updated_at = ?, data = ? WHERE id = ?',
        )
        .run(saved.name, revision, saved.updatedAt, JSON.stringify(saved), id);
      this.snapshot(saved, revision, now, false);
      return { ok: true, revision };
    });
    return tx();
  }

  delete(id: string): boolean {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM versions WHERE project_id = ?').run(id);
      return this.db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
    });
    return tx();
  }

  private snapshot(project: Project, revision: number, now: number, force: boolean): void {
    const last = this.db
      .prepare(
        'SELECT id, saved_at AS savedAt FROM versions WHERE project_id = ? ORDER BY id DESC LIMIT 1',
      )
      .get(project.id) as { id: number; savedAt: string } | undefined;
    const data = JSON.stringify(project);
    const at = new Date(now).toISOString();
    if (last && !force && now - Date.parse(last.savedAt) < VERSION_GAP_MS)
      this.db
        .prepare('UPDATE versions SET revision = ?, saved_at = ?, name = ?, data = ? WHERE id = ?')
        .run(revision, at, project.name, data, last.id);
    else
      this.db
        .prepare(
          'INSERT INTO versions (project_id, revision, saved_at, name, data) VALUES (?, ?, ?, ?, ?)',
        )
        .run(project.id, revision, at, project.name, data);
    this.db
      .prepare(
        'DELETE FROM versions WHERE project_id = ? AND id NOT IN (SELECT id FROM versions WHERE project_id = ? ORDER BY id DESC LIMIT ?)',
      )
      .run(project.id, project.id, MAX_VERSIONS);
  }

  versions(id: string): VersionInfo[] {
    return this.db
      .prepare(
        'SELECT id, revision, saved_at AS savedAt, name FROM versions WHERE project_id = ? ORDER BY id DESC',
      )
      .all(id) as VersionInfo[];
  }

  /** Makes an earlier version the current one (as a NEW revision, so devices see it as a normal change). */
  restore(id: string, versionId: number): { revision: number; project: Project } | null {
    const row = this.db
      .prepare('SELECT data FROM versions WHERE project_id = ? AND id = ?')
      .get(id, versionId) as { data: string } | undefined;
    const cur = this.db.prepare('SELECT revision FROM projects WHERE id = ?').get(id) as
      { revision: number } | undefined;
    if (!row || !cur) return null;
    const project = migrateProject(JSON.parse(row.data));
    const stamped = { ...project, updatedAt: new Date().toISOString() };
    const r = this.update(id, cur.revision, stamped, Date.now() + VERSION_GAP_MS + 1);
    return r !== 'missing' && r.ok ? { revision: r.revision, project: stamped } : null;
  }
}
