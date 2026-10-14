import { getEntry, itemSize } from '../catalog';
import type { Project } from '../model/types';
import { accentSpecs } from '../present/AccentLights';
import type { LightingState } from '../scene3d/lighting';
import { kelvinToHex, lampOn, lampParams } from '../scene3d/lights';
import { windowLightSpecs } from '../scene3d/SceneLights';
import type { StudioLamp } from './protocol';

/** Luminous flux (lumens) of the soft accent lights: a ceiling glow, a light under a wall cabinet, a garden path light. */
const ACCENT_LUMENS = { room: 350, cabinet: 90, path: 120 } as const;

/**
 * The light fixtures that are on (their own switch, their room's, the master switch, then the lighting look), in physical
 * units: each bulb's lumens and colour temperature, spots with their beam. Same rules as the live 3D view, without the
 * light budget (a still render can afford every lamp).
 */
export function studioLamps(
  project: Project,
  lighting: LightingState,
  opts: { accent: boolean; kelvin?: number },
): StudioLamp[] {
  const out: StudioLamp[] = [];
  for (const item of project.items) {
    const entry = getEntry(item.catalogId);
    const level = project.levels.find((l) => l.id === item.levelId);
    if (!entry?.lamp || !level?.visible || !lampOn(project, item, lighting)) continue;
    const params = lampParams(item)!;
    const size = itemSize(entry, item.scale);
    const y = level.elevation + item.elevation + entry.lamp.y(size);
    out.push({
      id: item.id,
      position: [item.position.x, y, item.position.y],
      color: kelvinToHex(opts.kelvin ?? params.kelvin),
      lumens: params.lumens,
      beam: params.beam,
      aim: params.beam ? [item.position.x, level.elevation, item.position.y] : undefined,
      accent: false,
    });
  }
  if (opts.accent)
    for (const a of accentSpecs(project)) {
      const kind = a.id.startsWith('room:')
        ? 'room'
        : a.id.startsWith('cabinet:')
          ? 'cabinet'
          : 'path';
      out.push({
        id: a.id,
        position: a.position,
        color: a.color,
        lumens: ACCENT_LUMENS[kind],
        accent: true,
      });
    }
  return out;
}

/** Daylight windows: one soft area light per exterior window, facing inward (as in the live view). */
export const studioWindows = (project: Project) => windowLightSpecs(project);
