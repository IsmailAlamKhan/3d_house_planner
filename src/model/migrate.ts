import { ProjectSchema, SCHEMA_VERSION } from './schemas';
import type { Project } from './types';

type Raw = Record<string, unknown>;

/** Migrations keyed by the version they upgrade FROM. Add an entry when SCHEMA_VERSION is bumped. */
const migrations: Record<number, (raw: Raw) => Raw> = {};

export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFormatError';
  }
}

/** Upgrades raw data to the current schema version and validates it with Zod. */
export function migrateProject(raw: unknown): Project {
  if (typeof raw !== 'object' || raw === null) throw new ProjectFormatError('Not a project file');
  let data = raw as Raw;
  let version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 1;
  if (version > SCHEMA_VERSION) {
    throw new ProjectFormatError('This project was made with a newer version of the app');
  }
  while (version < SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) throw new ProjectFormatError(`No migration from version ${version}`);
    data = { ...step(data), schemaVersion: version + 1 };
    version += 1;
  }
  const result = ProjectSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ProjectFormatError(`Invalid project: ${issue?.path.join('.')} ${issue?.message}`);
  }
  return result.data;
}
