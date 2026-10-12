import Database from 'better-sqlite3';

/** Consistent copy of a live database (SQLite's online backup API — never a raw file copy). */
export async function backupDatabase(dbFile: string, destFile: string): Promise<void> {
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    await db.backup(destFile);
  } finally {
    db.close();
  }
}

/**
 * Replaces the content of the live database with a backup, inside one transaction, so the running server (which has
 * the file open) keeps working and sees either the old or the new state, never a mix.
 */
export function restoreDatabase(
  dbFile: string,
  backupFile: string,
): { projects: number; versions: number } {
  const db = new Database(dbFile);
  try {
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS versions (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, revision INTEGER NOT NULL, saved_at TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL);
    `);
    db.prepare('ATTACH DATABASE ? AS backup').run(backupFile);
    const tx = db.transaction(() => {
      db.exec('DELETE FROM versions; DELETE FROM projects;');
      db.exec(
        'INSERT INTO projects SELECT id, name, revision, updated_at, data FROM backup.projects',
      );
      db.exec(
        'INSERT INTO versions (id, project_id, revision, saved_at, name, data) SELECT id, project_id, revision, saved_at, name, data FROM backup.versions',
      );
    });
    tx();
    const count = (t: string) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    return { projects: count('projects'), versions: count('versions') };
  } finally {
    db.close();
  }
}
