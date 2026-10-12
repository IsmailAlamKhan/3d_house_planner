import { saveFile } from '../platform';
import { ProjectFormatError, migrateProject } from './migrate';
import type { Project } from './types';

export const exportProjectJson = (project: Project): string => JSON.stringify(project, null, 2);

export function importProjectJson(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFormatError('That file is not valid JSON', 'err.notJson');
  }
  return migrateProject(raw);
}

export function downloadTextFile(filename: string, text: string, mime = 'application/json'): void {
  void saveFile(filename, text, mime);
}
