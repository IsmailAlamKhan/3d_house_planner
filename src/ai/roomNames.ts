import type { Project } from '../model/types';
import { EditError, resolveRoom } from './edit/lookup';

/** The exact name of the room a phrase refers to, or undefined (no throw). */
export function resolveRoomName(project: Project, phrase: string): string | undefined {
  try {
    return resolveRoom(project, phrase, project.levels[0]?.id ?? '').name;
  } catch (e) {
    if (e instanceof EditError) return undefined;
    throw e;
  }
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Only a room whose full name equals the phrase. */
export function exactRoomName(project: Project, phrase: string): string | undefined {
  const q = norm(phrase.replace(/^the\s+/, ''));
  return project.rooms.find((r) => norm(r.name) === q)?.name;
}
