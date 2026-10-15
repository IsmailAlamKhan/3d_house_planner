import { z } from 'zod';
import { ROOM_TYPES, STAIR_TYPES, ZONE_TYPES } from '../model/schemas';

/** Everything the language model may say is validated against these schemas before anything touches the project. */

export const SIDES = ['north', 'south', 'east', 'west'] as const;
export type Side = (typeof SIDES)[number];

const area = z.coerce.number().min(2).max(120);
const nonEmpty = z.string().trim().min(1).max(60);

export const AdjacencySchema = z.object({
  /** Name of another room on the same level. */
  room: nonEmpty,
  /** `door` = separate rooms joined by a door; `open` = open plan (wide opening, no door). */
  connection: z.enum(['door', 'open']).default('door'),
});

export const RoomIntentSchema = z.object({
  type: z.enum(ROOM_TYPES),
  name: nonEmpty,
  /** Wanted floor area in m². The solver scales areas to fill the shell. */
  targetArea: area,
  /** Narrowest the room may be (m). */
  minWidth: z.coerce.number().min(0.8).max(10).optional(),
  adjacency: z.array(AdjacencySchema).max(6).default([]),
  /** Does the room want an outside wall (windows)? */
  exteriorWall: z.enum(['required', 'preferred', 'none']).default('preferred'),
  needsWindow: z.boolean().optional(),
  needsPlumbing: z.boolean().optional(),
  /** Name of a room on the level below this one should sit under (e.g. stack bathrooms). */
  above: nonEmpty.optional(),
  /** A tall, open space (ground floor only): no floor above it; it takes a whole region of the plan. */
  doubleHeight: z.boolean().optional(),
});

export const LevelIntentSchema = z.object({
  name: nonEmpty,
  rooms: z.array(RoomIntentSchema).min(1).max(20),
});

export const STAIR_POSITIONS = ['near-entrance', 'back', 'left', 'right', 'center'] as const;

export const StairIntentSchema = z.object({
  type: z.enum(STAIR_TYPES).default('straight'),
  position: z.enum(STAIR_POSITIONS).default('near-entrance'),
});

export const FLOOR_STYLES = [
  'light-wood',
  'dark-wood',
  'herringbone',
  'tile-grey',
  'tile-white',
  'concrete',
  'marble',
] as const;
export const WALL_STYLES = [
  'white',
  'cream',
  'grey',
  'sage',
  'blue',
  'terracotta',
  'charcoal',
] as const;

export const StyleIntentSchema = z.object({
  floor: z.enum(FLOOR_STYLES).optional(),
  walls: z.enum(WALL_STYLES).optional(),
  mood: z.string().max(80).optional(),
});

export const SITE_SIDES = ['front', 'back', 'left', 'right'] as const;
export type SiteSide = (typeof SITE_SIDES)[number];

/** An outdoor area to create around the building (villa mode). */
export const SiteZoneIntentSchema = z.object({
  type: z.enum(ZONE_TYPES),
  name: z.string().trim().min(1).max(60).optional(),
  /** Which side of the building it goes on (the entrance side is the front). */
  side: z.enum(SITE_SIDES).default('back'),
  covered: z.boolean().optional(),
  /** Relative size (1 = usual): a smaller pool or a bigger lawn. */
  scale: z.number().min(0.4).max(2).optional(),
});

export const SiteIntentSchema = z.object({
  zones: z.array(SiteZoneIntentSchema).max(12).default([]),
  /** Cars the parking area must hold (default 2 when there is a parking zone). */
  cars: z.coerce.number().int().min(0).max(6).optional(),
});

export const LAYOUT_STRATEGIES = ['duplex', 'wings'] as const;

export const DesignIntentSchema = z.object({
  title: z.string().max(80).optional(),
  /** Ground level first. */
  levels: z.array(LevelIntentSchema).min(1).max(3),
  stair: StairIntentSchema.default({ type: 'straight', position: 'near-entrance' }),
  style: StyleIntentSchema.optional(),
  /** Add default furniture to every room. */
  furnish: z.boolean().default(true),
  /** `wings`: one level with a central open hall and a wing of rooms on each side (villas). */
  strategy: z.enum(LAYOUT_STRATEGIES).default('duplex'),
  /** Outdoor zones to create on the plot (villa projects). */
  site: SiteIntentSchema.optional(),
});

export type RoomIntent = z.infer<typeof RoomIntentSchema>;
export type LevelIntent = z.infer<typeof LevelIntentSchema>;
export type DesignIntent = z.infer<typeof DesignIntentSchema>;
export type SiteIntent = z.infer<typeof SiteIntentSchema>;
export type SiteZoneIntent = z.infer<typeof SiteZoneIntentSchema>;
export type StairIntent = z.infer<typeof StairIntentSchema>;

// ───────────────────────── Edit operations ─────────────────────────

const roomRef = nonEmpty.describe('Name of a room (as listed in the project summary).');
const side = z.enum(SIDES);

export const EditOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('resizeRoom'),
    room: roomRef,
    dimension: z.enum(['width', 'depth']).describe('width = east–west, depth = north–south'),
    delta: z.coerce
      .number()
      .min(-10)
      .max(10)
      .optional()
      .describe('Metres to add (negative to shrink).'),
    to: z.coerce.number().min(1).max(30).optional().describe('Or the new size in metres.'),
    /** Which side of the room stays where it is. */
    anchor: side.optional(),
  }),
  z.object({
    op: z.literal('moveWall'),
    room: roomRef,
    side,
    /** Metres to push the wall on that side of the room outward (negative = inward). */
    distance: z.coerce.number().min(-10).max(10),
  }),
  z.object({
    op: z.literal('addRoom'),
    name: nonEmpty,
    type: z.enum(ROOM_TYPES),
    /** Existing room to carve the new room out of. */
    from: roomRef,
    side,
    /** Depth of the new room (m) measured from that side. */
    size: z.coerce.number().min(1).max(10),
  }),
  z.object({ op: z.literal('removeRoom'), room: roomRef, mergeInto: roomRef.optional() }),
  z.object({
    op: z.literal('renameRoom'),
    room: roomRef,
    name: nonEmpty.optional(),
    type: z.enum(ROOM_TYPES).optional(),
  }),
  z.object({
    op: z.literal('changeMaterial'),
    target: z.enum(['floor', 'walls', 'ceiling']),
    room: roomRef.optional().describe('Omit to change every room on the level (or all levels).'),
    level: nonEmpty.optional(),
    material: nonEmpty.describe(
      'A material id such as floor-oak, paint-sage, brick-red, floor-tile-grey or paint:#aabbcc.',
    ),
  }),
  z.object({
    op: z.literal('addItem'),
    catalogId: nonEmpty.describe('Catalog id such as sofa-3seat, bed-queen, desk, plant.'),
    room: roomRef,
    count: z.coerce.number().int().min(1).max(6).optional(),
  }),
  z.object({ op: z.literal('removeItem'), catalogId: nonEmpty, room: roomRef.optional() }),
  z.object({
    op: z.literal('moveItem'),
    catalogId: nonEmpty,
    room: roomRef.optional(),
    dx: z.coerce.number().min(-10).max(10).optional(),
    dy: z.coerce.number().min(-10).max(10).optional(),
  }),
  z.object({
    op: z.literal('addOpening'),
    kind: z.enum(['door', 'window', 'archway']),
    room: roomRef,
    side,
    catalogId: nonEmpty.optional(),
  }),
  z.object({ op: z.literal('changeStairType'), type: z.enum(STAIR_TYPES) }),
]);

export const EditResponseSchema = z.object({
  /** One short sentence describing what will change. */
  summary: z.string().max(200).optional(),
  operations: z.array(EditOperationSchema).min(1).max(12),
});

export type EditOperation = z.infer<typeof EditOperationSchema>;
export type EditResponse = z.infer<typeof EditResponseSchema>;

/** JSON Schema for Ollama's constrained decoding (`format`). Inputs are described, so defaulted fields stay optional. */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
  delete js.$schema;
  return js;
}
