import { getEntry } from '../catalog';
import { pointInPolygon } from '../geometry/polygon';
import type { Item, Project, Room, RoomType } from '../model/types';
import type { LightingState } from './lighting';

/** Colour of a lamp from its colour temperature (Tanner Helland's approximation, 1000–40000 K), as `#rrggbb`. */
export function kelvinToHex(kelvin: number): string {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v)));
  return `#${[c(r), c(g), c(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Luminous intensity (candela) of a point source emitting `lumens` in all directions. */
export const lumensToCandela = (lumens: number): number => lumens / (4 * Math.PI);

/** Rooms where the evening look keeps the lights off (bedrooms and wet rooms): "living areas and kitchen on". */
const QUIET_ROOMS = new Set<RoomType>([
  'bedroom',
  'bathroom',
  'walk-in-closet',
  'laundry',
  'pantry',
  'utility',
]);

/** Does the lighting preset want the lamps in a room of this type on? (`null` = outdoors, no room.) */
export function presetWantsLamp(state: LightingState, roomType: RoomType | null): boolean {
  switch (state.mode) {
    case 'night':
    case 'dusk':
    case 'marketing':
      return true;
    case 'evening':
      return roomType === null || !QUIET_ROOMS.has(roomType);
    case 'custom':
      return state.time >= 18.5;
    default:
      return false;
  }
}

/** The room (on the item's level) whose outline contains the item, if any. */
export function roomOfItem(project: Project, item: Item): Room | undefined {
  return project.rooms.find(
    (r) =>
      r.levelId === item.levelId &&
      r.name !== 'Open to below' &&
      pointInPolygon(item.position, r.polygon),
  );
}

/** Is a light fixture switched on? The fixture's own switch, then its room's, then the master switch, then the preset. */
export function lampOn(
  project: Project,
  item: Item,
  lighting: LightingState,
  room = roomOfItem(project, item),
): boolean {
  const own = project.lights.items[item.id];
  if (own !== undefined) return own;
  if (room) {
    const r = project.lights.rooms[room.id];
    if (r !== undefined) return r;
  }
  if (project.lights.master === 'on') return true;
  if (project.lights.master === 'off') return false;
  return presetWantsLamp(lighting, room?.type ?? null);
}

export interface LampParams {
  lumens: number;
  kelvin: number;
  /** Spotlight beam angle in degrees (`undefined` for a point light). */
  beam?: number;
}

/** Brightness, colour temperature and beam of a fixture: the item's own settings over the catalog defaults. */
export function lampParams(item: Item): LampParams | null {
  const lamp = getEntry(item.catalogId)?.lamp;
  if (!lamp) return null;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const beam = item.props.beam !== undefined ? num(item.props.beam, lamp.beam ?? 0) : lamp.beam;
  return {
    lumens: Math.max(0, num(item.props.lumens, lamp.lumens)),
    kelvin: num(item.props.kelvin, lamp.kelvin),
    beam: beam && beam > 0 ? beam : undefined,
  };
}

/** Is every fixture of the home off right now (used by the "All lights" switch label)? */
export function anyLampOn(project: Project, lighting: LightingState): boolean {
  return project.items.some((i) => getEntry(i.catalogId)?.lamp && lampOn(project, i, lighting));
}

/** How bright the sky is (0 night … 1 high noon), from the sun's height; moonlight counts for a little. */
export function daylightLevel(lighting: LightingState, sun: { elevation: number }): number {
  if (lighting.mode === 'night') return 0.012;
  return Math.min(
    1,
    Math.pow(Math.min(1, Math.max(0, Math.sin(sun.elevation) * 1.15)), 0.7) + 0.03,
  );
}
