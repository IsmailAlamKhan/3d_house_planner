/** Pure sun / sky maths for the 3D scene (no three.js, so it is easy to test). */

export type LightingPreset = 'morning' | 'noon' | 'evening' | 'night' | 'marketing';
export type LightingMode = LightingPreset | 'custom';

export const DAY_START = 6;
export const DAY_END = 20;
const MAX_ELEVATION = (62 * Math.PI) / 180;

/** Clock time (hours) the day presets use. Night has no sun, so its time is only a label. */
export const PRESET_TIME: Record<LightingPreset, number> = {
  morning: 8,
  noon: 13,
  evening: 19,
  night: 22,
  /** Golden hour with every interior and garden light on — for showing a design off. */
  marketing: 17.8,
};

export interface LightingState {
  mode: LightingMode;
  /** Hours 6–20; used by the daylight presets and "custom". */
  time: number;
}

export interface Sun {
  /** Unit vector pointing from the scene towards the sun, in world axes (plan x → +x, plan y → +z, up = +y). */
  direction: [number, number, number];
  elevation: number;
  /** Compass bearing in degrees clockwise from true north. */
  azimuth: number;
  intensity: number;
  color: string;
}

export interface Sky {
  top: string;
  horizon: string;
  ground: string;
  /** Strength of the soft sky light (hemisphere light). */
  ambient: number;
  /** Strength of image-based light from the local environment map. */
  environment: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(lerp((pa >> shift) & 255, (pb >> shift) & 255, t));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/**
 * The sun for a clock time and building orientation.
 * It rises in the east at 06:00, is due south at 13:00 and sets in the west at 20:00.
 * `compass` is the bearing (degrees clockwise from north) of the plan's "up" direction (−y):
 * 0 = the top of the plan points north.
 */
export function sunAt(time: number, compass: number): Sun {
  const frac = clamp01((time - DAY_START) / (DAY_END - DAY_START));
  const elevation = MAX_ELEVATION * Math.sin(Math.PI * frac);
  const azimuth = 90 + 180 * frac;
  const rel = ((azimuth - compass) * Math.PI) / 180;
  const horizontal = Math.cos(elevation);
  const direction: [number, number, number] = [
    Math.sin(rel) * horizontal,
    Math.sin(elevation),
    -Math.cos(rel) * horizontal,
  ];
  const high = clamp01(elevation / ((35 * Math.PI) / 180));
  return {
    direction,
    elevation,
    azimuth: ((azimuth % 360) + 360) % 360,
    intensity: 0.15 + 2.1 * Math.pow(clamp01(Math.sin(elevation) * 1.15), 0.7),
    color: mix('#ff9a5a', '#fff3df', high),
  };
}

/** Moonlight for the night preset: weak, blue, from above and to one side. */
export function moonAt(compass: number): Sun {
  const rel = ((300 - compass) * Math.PI) / 180;
  const elevation = (48 * Math.PI) / 180;
  return {
    direction: [
      Math.sin(rel) * Math.cos(elevation),
      Math.sin(elevation),
      -Math.cos(rel) * Math.cos(elevation),
    ],
    elevation,
    azimuth: 300,
    intensity: 0.28,
    color: '#8da5ff',
  };
}

/** Sky gradient and soft light strength for the lighting state. */
export function skyFor(state: LightingState, sun: Sun): Sky {
  if (state.mode === 'night') {
    return {
      top: '#0a1026',
      horizon: '#1d2a4a',
      ground: '#0e1119',
      ambient: 0.16,
      environment: 0.12,
    };
  }
  if (state.mode === 'marketing') {
    // Warm dusk with the garden still readable: the lit house stands out against a brighter sky and lawn.
    return {
      top: '#3d4c80',
      horizon: '#ffb384',
      ground: '#5a5348',
      ambient: 1.3,
      environment: 0.7,
    };
  }
  const k = clamp01(sun.elevation / ((40 * Math.PI) / 180));
  return {
    top: mix('#46517f', '#6fa8dc', k),
    horizon: mix('#ffb88a', '#dbe9f6', k),
    ground: mix('#4a4540', '#8b95a1', k),
    ambient: 0.28 + 0.5 * k,
    environment: 0.2 + 0.55 * k,
  };
}

/** Interior lamps are switched on for the evening and night looks (and late custom times). */
export function interiorLightsOn(state: LightingState): boolean {
  return (
    state.mode === 'night' ||
    state.mode === 'evening' ||
    state.mode === 'marketing' ||
    (state.mode === 'custom' && state.time >= 18.5)
  );
}

/** The sun is below the horizon only in night mode. */
export const sunVisible = (state: LightingState): boolean => state.mode !== 'night';

/** Effective clock time for a state (presets use their own time). */
export const timeOf = (state: LightingState): number =>
  state.mode === 'custom' ? state.time : PRESET_TIME[state.mode];

export function formatTime(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  const hh = m === 60 ? h + 1 : h;
  return `${String(hh).padStart(2, '0')}:${String(m === 60 ? 0 : m).padStart(2, '0')}`;
}
