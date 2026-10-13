import { z } from 'zod';

export const SCHEMA_VERSION = 1;

const id = z.string().min(1);
const num = z.number();
const positive = z.number().positive();

export const PointSchema = z.object({ x: num, y: num });

export const UNITS = ['metric', 'imperial'] as const;
export const WALL_TYPES = ['exterior', 'interior', 'partition'] as const;
export const OPENING_KINDS = ['door', 'window', 'archway'] as const;
export const SWINGS = ['left', 'right', 'none'] as const;
export const ROOM_TYPES = [
  'living',
  'kitchen',
  'bedroom',
  'bathroom',
  'dining',
  'study',
  'utility',
  'balcony',
  'corridor',
  'stair',
  // Villa rooms
  'foyer',
  'walk-in-closet',
  'gym',
  'sauna',
  'spa',
  'game-room',
  'garage',
  'laundry',
  'pantry',
  'home-theatre',
  'prayer',
  'outdoor-dining',
  // Balcony, terrace or garden: no ceiling, optional parapet, outdoor floors.
  'outdoor',
  'other',
] as const;
export const ZONE_TYPES = [
  'garden',
  'lawn',
  'pool',
  'deck',
  'patio',
  'parking',
  'play',
  'path',
  'water-feature',
] as const;
export const GATE_KINDS = ['pedestrian', 'vehicle'] as const;
export const STAIR_TYPES = ['straight', 'L', 'U', 'spiral'] as const;
export const COLUMN_SHAPES = ['rect', 'round'] as const;
export const ROOF_KINDS = ['flat', 'skylight', 'void'] as const;

/** A structural beam below a slab: an annotation checked against headroom (it hangs `drop` m below the ceiling). */
export const BeamSchema = z.object({
  id,
  start: PointSchema,
  end: PointSchema,
  width: positive,
  /** How far the beam hangs below the ceiling (m). */
  drop: z.number().min(0).max(2),
});

/** A window that already exists in the facade (becomes a locked opening in the exterior wall). */
export const FacadeWindowSchema = z.object({
  id,
  /** Index of the footprint edge (edge i runs from footprint[i] to footprint[i+1]). */
  edge: z.number().int().min(0),
  /** Distance from the edge's start to the window centre (m). */
  offset: num,
  width: positive,
  height: positive,
  sillHeight: z.number().nonnegative(),
});

export const ShellSchema = z.object({
  footprint: z.array(PointSchema).min(3),
  maxHeight: positive,
  entrance: z.object({ position: PointSchema, direction: num }),
  fixedPlumbingPoints: z.array(PointSchema),
  notes: z.string(),
  beams: z.array(BeamSchema).default([]),
  windows: z.array(FacadeWindowSchema).default([]),
});

export const LevelSchema = z.object({
  id,
  name: z.string(),
  index: z.number().int(),
  elevation: num,
  floorToCeiling: positive,
  slabThickness: z.number().nonnegative(),
  visible: z.boolean(),
  locked: z.boolean(),
});

export const WallSchema = z.object({
  id,
  levelId: id,
  start: PointSchema,
  end: PointSchema,
  thickness: positive,
  height: positive.optional(),
  type: z.enum(WALL_TYPES),
  materialInside: z.string(),
  materialOutside: z.string(),
  locked: z.boolean(),
});

export const OpeningSchema = z.object({
  id,
  wallId: id,
  kind: z.enum(OPENING_KINDS),
  catalogId: z.string(),
  offset: num,
  width: positive,
  height: positive,
  sillHeight: z.number().nonnegative(),
  flip: z.boolean(),
  swing: z.enum(SWINGS),
  /** Catalog style options (e.g. frame color). */
  props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  /** Part of the existing building (facade windows): cannot be moved, resized or deleted. */
  locked: z.boolean().default(false),
});

export const RoomSchema = z.object({
  id,
  levelId: id,
  name: z.string(),
  type: z.enum(ROOM_TYPES),
  polygon: z.array(PointSchema).min(3),
  floorMaterial: z.string(),
  ceilingMaterial: z.string(),
  ceilingHeight: positive.optional(),
  doubleHeight: z.boolean(),
});

export const StairSchema = z.object({
  id,
  fromLevelId: id,
  toLevelId: id,
  type: z.enum(STAIR_TYPES),
  /** Bottom-center of the first step. */
  position: PointSchema,
  /** Direction of ascent, radians (0 = +x, π/2 = +y in plan). */
  rotation: num,
  width: positive,
  riserHeight: positive.optional(),
  treadDepth: positive.optional(),
  railing: z.boolean(),
});

export const ColumnSchema = z.object({
  id,
  levelId: id,
  position: PointSchema,
  size: z.object({ w: positive, d: positive }),
  shape: z.enum(COLUMN_SHAPES),
  structural: z.literal(true),
  locked: z.literal(true),
});

export const ItemSchema = z.object({
  id,
  levelId: id,
  catalogId: z.string(),
  position: PointSchema,
  elevation: num,
  rotation: num,
  scale: z.object({ x: positive, y: positive, z: positive }),
  props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export const RoofSchema = z.object({
  id,
  levelId: id,
  kind: z.enum(ROOF_KINDS),
  polygon: z.array(PointSchema).min(3),
});

export const MaterialOverrideSchema = z.object({
  name: z.string().optional(),
  color: z.string().optional(),
  roughness: z.number().min(0).max(1).optional(),
  metalness: z.number().min(0).max(1).optional(),
  textureId: z.string().optional(),
  textureScale: positive.optional(),
});

/** Per-project design defaults. View preferences (snap, grid, ghosts) are UI state, not project data. */
export const SettingsSchema = z.object({
  defaultWallThickness: positive,
  /** Bearing (degrees clockwise from north) of the direction the top of the plan points. Drives the sun in 3D. */
  compass: z.number().min(0).max(360).default(0),
  /** Limits used by the constraint checker. */
  checks: z
    .object({
      /** Longest comfortable drain run from a wet room to a plumbing point (m). */
      maxDrainRun: positive.default(6),
      /** Minimum area (m²) per room type; types not listed use the built-in defaults. */
      minAreas: z.record(z.string(), z.number().nonnegative()).default({}),
    })
    .default({ maxDrainRun: 6, minAreas: {} }),
});

const Vec3Schema = z.tuple([num, num, num]);

/** A named camera position ("Kitchen from living room"), with a small preview picture. */
export const SavedViewSchema = z.object({
  id,
  name: z.string().min(1),
  /** 'orbit' keeps the perspective camera; 'top' is the orthographic plan view; 'walk' is first person. */
  mode: z.enum(['orbit', 'top', 'walk']).default('orbit'),
  position: Vec3Schema,
  target: Vec3Schema,
  /** Orthographic zoom (top view only). */
  zoom: positive.optional(),
  /** The section cuts that were on when the view was saved. */
  section: z
    .object({
      horizontal: z.object({ on: z.boolean(), height: num }),
      vertical: z.object({
        on: z.boolean(),
        axis: z.enum(['x', 'z']),
        pos: num,
        flip: z.boolean(),
      }),
    })
    .optional(),
  /** Small JPEG data URL (about 160 px wide). */
  thumbnail: z.string().optional(),
});

/** A pinned comment ("Ask about window size here"): at a spot on a level, or attached to something in the model. */
export const NoteSchema = z.object({
  id,
  text: z.string(),
  resolved: z.boolean().default(false),
  createdAt: z.string(),
  levelId: id,
  /** Where the pin sits in the plan (also where it falls back to if the thing it was attached to is deleted). */
  position: PointSchema,
  /** The wall, room, door, window, furniture … the note is about. The pin follows it when it moves. */
  entity: z
    .object({
      type: z.enum(['wall', 'opening', 'room', 'stair', 'item', 'column', 'roof', 'zone', 'gate']),
      id,
    })
    .optional(),
});

/** An outdoor area on the plot (lawn, pool, deck, parking …), drawn like a room but on the ground around the building. */
export const SiteZoneSchema = z.object({
  id,
  name: z.string(),
  type: z.enum(ZONE_TYPES),
  polygon: z.array(PointSchema).min(3),
  /** Surface material key (grass, paving, decking, gravel, water, pool tile …). */
  material: z.string(),
  /** Roofed over (a covered car bay, a pergola). */
  covered: z.boolean().default(false),
});

/** A gate in the plot boundary. `direction` is the outward normal (radians). */
export const GateSchema = z.object({
  id,
  kind: z.enum(GATE_KINDS),
  position: PointSchema,
  direction: num,
  width: positive.default(1.2),
});

/** The part of a project that design options swap: everything that is "the plan", not the shell or the settings. */
export const DesignSchema = z.object({
  levels: z.array(LevelSchema),
  walls: z.array(WallSchema),
  openings: z.array(OpeningSchema),
  rooms: z.array(RoomSchema),
  stairs: z.array(StairSchema),
  items: z.array(ItemSchema),
  columns: z.array(ColumnSchema),
  roofs: z.array(RoofSchema),
  materials: z.record(z.string(), MaterialOverrideSchema),
  /** Outdoor zones and gates belong to the design too (optional: designs saved before this existed leave the site as it is). */
  zones: z.array(SiteZoneSchema).optional(),
  gates: z.array(GateSchema).optional(),
});

/** Which design is showing. `letter` null = the original ("Main design"); `name` null = use the default title. */
export const OptionMetaSchema = z.object({
  id,
  letter: z.string().nullable(),
  name: z.string().nullable(),
});

/** A design that is not currently showing (the one being edited lives in the project's own fields). */
export const DesignOptionSchema = OptionMetaSchema.extend({ design: DesignSchema });

/** The plot the building stands on (villa projects). Empty `plot` = no site (apartments). */
export const SiteSchema = z.object({
  plot: z.array(PointSchema).default([]),
  gates: z.array(GateSchema).default([]),
  zones: z.array(SiteZoneSchema).default([]),
  /** Minimum distance between the building and the plot boundary (m). */
  setback: z.number().nonnegative().default(1.5),
});

export const PROJECT_KINDS = ['apartment', 'villa'] as const;

/**
 * Which light fixtures are switched on. Saved with the project but NOT part of undo/redo (switching a lamp is not a
 * design edit). `master`: all on / all off / `auto` (follow the lighting preset: dusk and night switch lamps on).
 * An item's own switch beats its room's switch, which beats `master`.
 */
export const LightsSchema = z.object({
  master: z.enum(['auto', 'on', 'off']).default('auto'),
  rooms: z.record(z.string(), z.boolean()).default({}),
  items: z.record(z.string(), z.boolean()).default({}),
});

/** What the user fills in to price the bill of materials. Keys are the BOM line keys (see `export/bom.ts`). */
export const CostsSchema = z.object({
  currency: z.string().min(1).default('USD'),
  unitCosts: z.record(z.string(), z.number().nonnegative()).default({}),
});

export const ProjectSchema = z.object({
  id,
  name: z.string(),
  units: z.enum(UNITS),
  shell: ShellSchema,
  levels: z.array(LevelSchema),
  walls: z.array(WallSchema),
  openings: z.array(OpeningSchema),
  rooms: z.array(RoomSchema),
  stairs: z.array(StairSchema),
  items: z.array(ItemSchema),
  columns: z.array(ColumnSchema),
  roofs: z.array(RoofSchema),
  materials: z.record(z.string(), MaterialOverrideSchema),
  settings: SettingsSchema,
  views: z.array(SavedViewSchema).default([]),
  notes: z.array(NoteSchema).default([]),
  /** Other designs of the same home ("Option A", "Option B" …) kept aside while one is being edited. */
  options: z.array(DesignOptionSchema).default([]),
  kind: z.enum(PROJECT_KINDS).default('apartment'),
  lights: LightsSchema.default({ master: 'auto', rooms: {}, items: {} }),
  site: SiteSchema.default({ plot: [], gates: [], zones: [], setback: 1.5 }),
  currentOption: OptionMetaSchema.default({ id: 'main', letter: null, name: null }),
  costs: CostsSchema.default({ currency: 'USD', unitCosts: {} }),
  createdAt: z.string(),
  updatedAt: z.string(),
  schemaVersion: z.number().int(),
});
