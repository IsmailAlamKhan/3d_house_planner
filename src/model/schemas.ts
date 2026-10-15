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
  /** Villas: the building outline and the entrance are part of the design too (an apartment's shell is shared). */
  footprint: z.array(PointSchema).min(3).optional(),
  entrance: ShellSchema.shape.entrance.optional(),
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

/**
 * A picture the plan is traced from (a photo or render of a floor plan), laid under (or over) the plan. `transform` is
 * the homography picture pixels → plan metres found when the picture was rectified; `offset` and `rotation` (about the
 * picture's centre on the plan) are the fine adjustments the user makes afterwards.
 */
export const UnderlaySchema = z.object({
  id,
  name: z.string(),
  /** Level it is shown on; absent = every level. */
  levelId: z.string().optional(),
  /** Where the picture lives: an uploaded asset on the app server, a copy in this browser, or a plain URL. */
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('asset'), assetId: z.string().min(1) }),
    z.object({ kind: z.literal('local'), key: z.string().min(1) }),
    z.object({ kind: z.literal('url'), url: z.string().min(1) }),
  ]),
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  /** 3 × 3 matrix (row-major): picture pixel → plan metre. */
  transform: z.tuple([num, num, num, num, num, num, num, num, num]),
  /** How the matrix was found, so the setup can be reopened: 4 corners + real size, 2 points + distance, or manual scale. */
  setup: z
    .object({
      mode: z.enum(['corners', 'two-point', 'scale']),
      points: z.array(PointSchema).max(4).default([]),
      /** corners: [width, depth] of the marked rectangle (m); two-point: [distance]; scale: [metres per pixel]. */
      size: z.array(num).default([]),
      origin: PointSchema.default({ x: 0, y: 0 }),
    })
    .optional(),
  offset: PointSchema.default({ x: 0, y: 0 }),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(0.5),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  /** Draw over the plan (to check alignment) instead of under it. */
  onTop: z.boolean().default(false),
  /** Also show as a faint decal on the ground in 3D. */
  show3d: z.boolean().default(false),
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

/** How firmly a wish is held. */
export const BRIEF_PRIORITIES = ['must', 'nice'] as const;
export const BUDGET_LEVELS = ['low', 'mid', 'high', 'luxury'] as const;
export const STYLE_IDS = [
  'modern-luxury',
  'warm-minimal',
  'tropical',
  'classic',
  'industrial',
] as const;
export const CARE_ABOUT = ['light', 'privacy', 'open-plan', 'storage', 'garden', 'cost'] as const;

/** One room the home should have. */
export const BriefRoomSchema = z.object({
  id,
  type: z.enum(ROOM_TYPES),
  name: z.string().min(1).max(60),
  /** Wanted floor area (m²). */
  area: z.number().min(2).max(150),
  /** Level index (0 = ground) or `null` to let the planner decide. */
  level: z.number().int().min(0).max(2).nullable().default(null),
  priority: z.enum(BRIEF_PRIORITIES).default('must'),
  /** Names of rooms this one wants to be next to (a bathroom beside its bedroom …). */
  next: z.array(z.string()).default([]),
  /** Kept as it is when the design is regenerated. */
  locked: z.boolean().default(false),
  /** Wants an outside wall (windows). */
  light: z.boolean().default(true),
});

/** An outdoor feature of the plot. */
export const BriefFeatureSchema = z.object({
  type: z.enum(ZONE_TYPES),
  name: z.string().max(60).optional(),
  side: z.enum(['front', 'back', 'left', 'right']).default('back'),
  covered: z.boolean().default(false),
  priority: z.enum(BRIEF_PRIORITIES).default('must'),
  /** 1 = the usual size; 0.7 = a smaller pool, 1.3 = a bigger one. */
  size: z.number().min(0.4).max(2).default(1),
});

/**
 * The Design Brief: everything the layout engine is asked for, in words a person can read and edit. Every way of
 * starting a design (a sentence, an interview, a sketch, "like this but …", mood pictures) produces one; the layout
 * engine reads only this.
 */
export const DesignBriefSchema = z.object({
  title: z.string().max(80).optional(),
  language: z.enum(['en', 'bn']).default('en'),
  levels: z.number().int().min(1).max(3).default(1),
  kind: z.enum(['duplex', 'villa']).default('duplex'),
  /** Plot or building size the person gave (m); the app can offer to make a matching shell. */
  size: z.object({ width: z.number().positive(), depth: z.number().positive(), of: z.enum(['plot', 'building']) }).optional(),
  program: z.array(BriefRoomSchema).max(40).default([]),
  features: z.array(BriefFeatureSchema).max(12).default([]),
  cars: z.number().int().min(0).max(6).default(0),
  style: z
    .object({
      preset: z.enum(STYLE_IDS).optional(),
      floor: z.string().optional(),
      walls: z.string().optional(),
      keywords: z.array(z.string().max(40)).max(12).default([]),
      palette: z.array(z.string()).max(8).default([]),
    })
    .default({ keywords: [], palette: [] }),
  budget: z.enum(BUDGET_LEVELS).default('mid'),
  priorities: z.array(z.enum(CARE_ABOUT)).max(6).default([]),
  household: z
    .object({
      adults: z.number().int().min(0).max(12).default(2),
      children: z.number().int().min(0).max(12).default(0),
      elderly: z.number().int().min(0).max(6).default(0),
      guests: z.boolean().default(false),
      help: z.boolean().default(false),
    })
    .optional(),
  /** Where the person dragged room bubbles to (plan metres, room id → centre): placement hints for the optimiser. */
  hints: z.record(z.string(), PointSchema).default({}),
  /** What the copilot assumed because the person did not say (shown with one-tap corrections). */
  assumptions: z.array(z.object({ key: z.string(), text: z.string() })).default([]),
  /** The original wording of the request, kept for the record. */
  source: z.string().max(4000).optional(),
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
  /** The Design Brief this design was made from (the copilot edits it and regenerates). */
  brief: DesignBriefSchema.optional(),
  /** Reference pictures the plan is traced from, back-most first. */
  underlays: z.array(UnderlaySchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  schemaVersion: z.number().int(),
});
