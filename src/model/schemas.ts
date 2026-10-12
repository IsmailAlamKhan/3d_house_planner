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
  'other',
] as const;
export const STAIR_TYPES = ['straight', 'L', 'U', 'spiral'] as const;
export const COLUMN_SHAPES = ['rect', 'round'] as const;
export const ROOF_KINDS = ['flat', 'skylight', 'void'] as const;

export const ShellSchema = z.object({
  footprint: z.array(PointSchema).min(3),
  maxHeight: positive,
  entrance: z.object({ position: PointSchema, direction: num }),
  fixedPlumbingPoints: z.array(PointSchema),
  notes: z.string(),
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

export const SettingsSchema = z.object({
  snapEnabled: z.boolean(),
  gridSize: positive,
  defaultWallThickness: positive,
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
  createdAt: z.string(),
  updatedAt: z.string(),
  schemaVersion: z.number().int(),
});
