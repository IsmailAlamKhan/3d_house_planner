import { getEntry } from '../catalog';
import type { Project } from '../model/types';
import { lampOn } from '../scene3d/lights';
import type { LightingState } from '../scene3d/lighting';
import { PRESET_TIME } from '../scene3d/lighting';
import type { BakePreset } from './protocol';

/** The lighting state each baked preset stands for. */
export const lightingForPreset = (preset: BakePreset): LightingState => {
  const mode = preset === 'day' ? 'noon' : preset;
  return { mode, time: PRESET_TIME[mode] };
};

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`;
}

/** Two 32-bit FNV-1a style hashes of a string, as 16 hex digits. */
export function hash16(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ (c + i), 0x85ebca6b);
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * The revision a bake is made for: everything that changes the static lighting of a preset, and nothing else. The static
 * geometry (levels, walls, openings, rooms and their finishes, stairs, columns, roofs, the plot and its zones, material
 * overrides), the sky direction, and the light fixtures with whether each is on in this preset. Furniture is not part of
 * it (it moves and gets real-time light), so rearranging furniture never makes a bake stale.
 */
export function bakeKey(project: Project, preset: BakePreset): string {
  const lighting = lightingForPreset(preset);
  const lamps = project.items
    .filter((i) => getEntry(i.catalogId)?.lamp)
    .map((i) => ({
      id: i.id,
      c: i.catalogId,
      l: i.levelId,
      p: i.position,
      e: i.elevation,
      s: i.scale,
      r: i.rotation,
      props: i.props,
      on: lampOn(project, i, lighting),
    }));
  return hash16(
    stable({
      preset,
      levels: project.levels,
      shell: project.shell,
      walls: project.walls,
      openings: project.openings,
      rooms: project.rooms,
      stairs: project.stairs,
      columns: project.columns,
      roofs: project.roofs,
      site: project.site,
      materials: project.materials,
      compass: project.settings.compass,
      lamps,
    }),
  );
}
