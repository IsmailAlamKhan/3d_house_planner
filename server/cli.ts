/**
 * Maintenance commands, run inside the app container:
 *   node cli.mjs backup  <file>     consistent copy of the database
 *   node cli.mjs restore <file>     put a backup back (while the app keeps running)
 */
import { join } from 'node:path';
import { backupDatabase, restoreDatabase } from './backup';
import { loadConfig } from './config';

const [cmd, file] = process.argv.slice(2);
const db = join(loadConfig().dataDir, 'app.db');

if (cmd === 'backup' && file) {
  await backupDatabase(db, file);
  console.log(`Backed up ${db} -> ${file}`);
} else if (cmd === 'restore' && file) {
  const r = restoreDatabase(db, file);
  console.log(`Restored ${r.projects} project(s) and ${r.versions} version(s) from ${file}`);
} else {
  console.error('Usage: node cli.mjs backup <file> | restore <file>');
  process.exit(2);
}
