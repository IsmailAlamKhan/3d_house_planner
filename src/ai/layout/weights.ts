/**
 * Every number the layout optimiser trades off, in one place. Each term is a penalty added to a candidate's score:
 * **lower is better**, and 0 means nothing to complain about. A term of 40 is "a wish was not met"; 100 is "a room
 * cannot be reached". Change a weight here and `npm run eval:layout` shows what it did to the 30 sample briefs.
 */
export const LAYOUT_WEIGHTS = {
  // ── Hard-ish constraints (large, so the optimiser only trades them off when nothing else fits) ──
  /** A room narrower than its minimum width: base + perMetre × the shortfall. */
  narrowBase: 50,
  narrowPerMetre: 25,
  /** A room below the minimum area for its type: base + perM2 × the shortfall. */
  minAreaBase: 40,
  minAreaPerM2: 8,
  /** A room that cannot be reached from the entrance through doors. */
  unreachable: 100,
  /** A bedroom or bathroom that can only be reached through another bedroom. */
  throughBedroom: 45,

  // ── Quality terms ──
  /** Relative distance from the wanted area: |area − wanted| / wanted × this. */
  area: 12,
  /** Rooms thinner than 1 : AR_LIMIT: (aspect − limit) × this. */
  aspect: 16,
  /** A wished adjacency (shared wall long enough for a door) that is missing. */
  adjacencyMiss: 40,
  /** A bedroom whose own bathroom is not beside it: worse than other missed wishes. */
  ensuiteMiss: 70,
  /** An open-plan link (wide opening) whose shared wall is too short for an archway. */
  adjacencyShortOpen: 8,
  /** The main entrance door would open into a bedroom, kitchen or other private room. */
  entranceRoom: 30,
  /** Bedrooms near the entrance / living areas far from it (ground floor), per room, scaled 0–1. */
  zoning: 7,
  /** No outside wall at all for a room that needs one: required / preferred / merely nice. */
  noWindowRequired: 35,
  noWindowPreferred: 24,
  /** A living, sleeping or working room with no outside wall at all. */
  noWindowHabitable: 45,
  noWindowNice: 10,
  /** Outside wall shorter than the daylight rule asks (0.12 m of wall per m² of floor), scaled 0–1. */
  daylightShortfall: 10,
  /** Corridors, halls and stairs above 14 % of the floor, per percentage point. */
  corridor: 1.6,
  /** …and a small cost for every percentage point of circulation, so plans never waste floor on it. */
  corridorBase: 1.0,
  /** Wet rooms away from the shell's plumbing points, per metre. */
  plumbing: 1.1,
  /** Bathrooms not above the ones below, per metre. */
  stacking: 3,
  /** …plus this when an upstairs bathroom does not overlap the one below at all. */
  stackingMiss: 12,
  /** A wet room that shares no wall with another wet room (so pipes run together). */
  wetGroup: 4,
  /** The living room has no outside wall on the garden side (villas). */
  view: 7,
  /** Every distinct partition line costs this: fewer, straighter, longer walls. */
  straightWalls: 5,
  /** An optional orientation preference is not met (off unless the brief sets one). */
  orientation: 6,
} as const;

/** Thinner than this (long side : short side) is penalised; wet service rooms may be a little thinner. */
export const AR_LIMIT = 1.8;
export const AR_LIMIT_SERVICE = 2.4;
/** Circulation should stay under this share of the floor. */
export const CORRIDOR_TARGET = 0.14;
/** Glazing wanted per m² of floor (m of outside wall). */
export const WALL_PER_M2 = 0.12;
/** A shared wall must be at least this long for a door (m). */
export const DOOR_WALL = 1.1;
/** …and this long to count as connected when walking through the plan (m). */
export const WALK_WALL = 0.9;

/** What a person can ask to improve; each multiplies the weights of the terms it names (default 1 = no change). */
export type Emphasis = Partial<
  Record<
    'daylight' | 'corridor' | 'straight' | 'privacy' | 'wet' | 'view' | 'adjacency' | 'area',
    number
  >
>;

export const EMPHASIS_TERMS: Record<keyof Emphasis, (keyof typeof LAYOUT_WEIGHTS)[]> = {
  daylight: ['daylightShortfall', 'noWindowPreferred', 'noWindowNice', 'noWindowHabitable'],
  corridor: ['corridor', 'corridorBase'],
  straight: ['straightWalls', 'aspect'],
  privacy: ['zoning', 'throughBedroom'],
  wet: ['wetGroup', 'stacking', 'stackingMiss', 'plumbing'],
  view: ['view'],
  adjacency: ['adjacencyMiss', 'ensuiteMiss'],
  area: ['area'],
};

export type Weights = { -readonly [K in keyof typeof LAYOUT_WEIGHTS]: number };

/** The weights with a person's "improve" requests applied. */
export function weightsFor(emphasis?: Emphasis): Weights {
  const out: Weights = { ...LAYOUT_WEIGHTS };
  for (const [key, factor] of Object.entries(emphasis ?? {}) as [keyof Emphasis, number][])
    for (const term of EMPHASIS_TERMS[key]) out[term] *= factor;
  return out;
}
