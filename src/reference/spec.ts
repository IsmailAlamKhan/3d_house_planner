import { z } from 'zod';
import { OPENING_KINDS, ROOM_TYPES, STAIR_TYPES, ZONE_TYPES } from '../model/schemas';

/**
 * A human-editable description of a plan that the exact builder (`build.ts`) turns into a project, with no solver and
 * no treemap: every room, door, zone and item is where the spec says it is.
 *
 * Conventions (so a person can write it by hand from a picture):
 * - All lengths are in `units` ("ft" or "m"); the builder converts to metres.
 * - Plan coordinates are `[x, y]`: x runs left → right, y runs back → front (top of the picture → bottom).
 * - A rectangle is `[x, y, width, depth]` (top-left corner first).
 * - Rotations are in degrees. For items, 0 faces +y (the front, toward the street); 90 faces −x; 180 faces −y; 270 faces +x.
 * - Stairs: `direction` is the direction of ascent in degrees (0 = +x, 90 = +y).
 */

const num = z.number().finite();
export const PtSchema = z.tuple([num, num]);
export const RectSchema = z.tuple([num, num, z.number().positive(), z.number().positive()]);
const id = z.string().min(1);
const attr = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({});

/** A shape is a rectangle or a polygon (organic pools, L-shaped rooms). */
const shape = {
  rect: RectSchema.optional(),
  polygon: z.array(PtSchema).min(3).optional(),
};
const needsShape = (v: { rect?: unknown; polygon?: unknown }) => !!v.rect !== !!v.polygon;
const shapeMessage = { message: 'give exactly one of "rect" or "polygon"' };

export const RoomSpecSchema = z
  .object({
    id,
    /** The text shown on the plan ("Bedroom 1"). */
    name: z.string().min(1),
    type: z.enum(ROOM_TYPES),
    level: id.optional(),
    ...shape,
    floor: z.string().optional(),
    ceiling: z.string().optional(),
    /** Inside paint / wall finish of this room's walls (a material id). */
    wallFinish: z.string().optional(),
    ceilingHeight: num.positive().optional(),
    doubleHeight: z.boolean().optional(),
    /** A roof terrace: a waist-high parapet instead of full walls. */
    parapet: z.boolean().optional(),
    /** The size written on the picture ("14' x 12'") as [width, depth], for the fidelity report. */
    labelSize: z.tuple([num.positive(), num.positive()]).optional(),
    /** Why this room differs from the picture or its label (shown in the fidelity report). */
    note: z.string().optional(),
  })
  .refine(needsShape, shapeMessage);

/** An extra wall that is not a room edge: a glass partition, a screen, a boundary of a terrace. */
export const WallSpecSchema = z.object({
  level: id.optional(),
  from: PtSchema,
  to: PtSchema,
  type: z.enum(['exterior', 'interior', 'partition']).default('partition'),
  thickness: num.positive().optional(),
  /** Material of both faces (`glass` for a glass partition). */
  material: z.string().optional(),
  height: num.positive().optional(),
});

/** A door, window or archway whose centre is at `at` (it is snapped onto the nearest wall). */
export const OpeningSpecSchema = z.object({
  level: id.optional(),
  at: PtSchema,
  kind: z.enum(OPENING_KINDS),
  /** Catalogue style (`door-double`, `window-full` …); a sensible default per kind otherwise. */
  style: z.string().optional(),
  width: num.positive().optional(),
  height: num.positive().optional(),
  sill: num.nonnegative().optional(),
  swing: z.enum(['left', 'right', 'none']).optional(),
  flip: z.boolean().optional(),
});

export const ZoneSpecSchema = z
  .object({
    id,
    name: z.string().min(1),
    type: z.enum(ZONE_TYPES),
    ...shape,
    /** Surface material (grass, decking, paving-stone, pool-tile …); the default of the zone type otherwise. */
    material: z.string().optional(),
    covered: z.boolean().optional(),
    labelSize: z.tuple([num.positive(), num.positive()]).optional(),
    note: z.string().optional(),
  })
  .refine(needsShape, shapeMessage);

export const GateSpecSchema = z.object({
  kind: z.enum(['pedestrian', 'vehicle']),
  at: PtSchema,
  /** The side the gate faces: a compass word or an angle in degrees. */
  facing: z.union([z.enum(['north', 'south', 'east', 'west']), num]).default('south'),
  width: num.positive().optional(),
});

export const ItemSpecSchema = z.object({
  /** Lets `lights.off` / `lights.on` refer to this item. */
  key: z.string().optional(),
  catalog: z.string().min(1),
  level: id.optional(),
  at: PtSchema,
  rotation: num.default(0),
  /** Height above the floor (for wall-hung things). */
  elevation: num.nonnegative().optional(),
  /** Wanted size [width, depth, height]; the item is scaled from its catalogue size. */
  size: z.tuple([num.positive(), num.positive(), num.positive()]).optional(),
  props: attr,
  /** The inventory element of the picture this item stands for ("Waterfall wall feature"): listed in the fidelity report. */
  inventory: z.string().optional(),
  note: z.string().optional(),
});

/** A row of identical items along a line (hedges, palms, bollards, pillar lights). */
export const ItemLineSpecSchema = z.object({
  catalog: z.string().min(1),
  level: id.optional(),
  from: PtSchema,
  to: PtSchema,
  every: num.positive(),
  /** `along` turns each item to lie along the line; a number is a fixed angle in degrees. */
  rotation: z.union([z.literal('along'), num]).default('along'),
  size: z.tuple([num.positive(), num.positive(), num.positive()]).optional(),
  props: attr,
  inventory: z.string().optional(),
  note: z.string().optional(),
});

export const StairSpecSchema = z.object({
  id,
  from: id,
  to: id,
  type: z.enum(STAIR_TYPES).default('straight'),
  /** Bottom-centre of the first step. */
  at: PtSchema,
  direction: num,
  width: num.positive(),
  railing: z.boolean().default(true),
});

export const RoofSpecSchema = z
  .object({
    level: id.optional(),
    kind: z.enum(['flat', 'skylight', 'void']).default('flat'),
    ...shape,
  })
  .refine(needsShape, shapeMessage);

export const LevelSpecSchema = z.object({
  id,
  name: z.string().min(1),
  /** Floor-to-ceiling height. */
  height: num.positive(),
});

/** Planting and lights placed automatically along the inside of the plot boundary. */
export const BoundarySpecSchema = z.object({
  hedges: z.object({ inset: num.nonnegative(), every: num.positive() }).optional(),
  palms: z.object({ inset: num.nonnegative(), every: num.positive() }).optional(),
  lights: z.object({ inset: num.nonnegative(), every: num.positive() }).optional(),
  /** Do not plant within this distance of a gate. */
  gateClearance: num.nonnegative().default(2),
});

export const ViewSpecSchema = z.object({
  name: z.string().min(1),
  mode: z.enum(['orbit', 'top', 'walk']).default('orbit'),
  /** World position [x, height, y] — x and y are plan coordinates. */
  position: z.tuple([num, num, num]),
  target: z.tuple([num, num, num]),
  zoom: num.positive().optional(),
});

/** The picture the plan was traced from, rectified onto the plan. */
export const UnderlaySpecSchema = z.object({
  /** Path of the image inside the repository (copied into the project's assets when it is built). */
  image: z.string().min(1),
  /** The four picture pixels (top-left, top-right, bottom-right, bottom-left) of a rectangle whose real size is `size`. */
  corners: z.array(PtSchema).length(4),
  size: z.tuple([num.positive(), num.positive()]),
  /** Where the rectangle's top-left corner is on the plan. */
  origin: PtSchema.default([0, 0]),
  opacity: z.number().min(0).max(1).default(0.5),
});

/** One complete arrangement of the plan. The first design is the main one, the others become design options. */
export const DesignSpecSchema = z.object({
  id,
  /** Letter shown in the options bar ("A", "B"). */
  letter: z.string().length(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  rooms: z.array(RoomSpecSchema).default([]),
  walls: z.array(WallSpecSchema).default([]),
  openings: z.array(OpeningSpecSchema).default([]),
  zones: z.array(ZoneSpecSchema).default([]),
  gates: z.array(GateSpecSchema).default([]),
  items: z.array(ItemSpecSchema).default([]),
  lines: z.array(ItemLineSpecSchema).default([]),
  stairs: z.array(StairSpecSchema).default([]),
  roofs: z.array(RoofSpecSchema).default([]),
  boundary: BoundarySpecSchema.optional(),
});

export const ReferenceSpecSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1),
    units: z.enum(['ft', 'm']),
    /** The plot polygon. */
    plot: z.array(PtSchema).min(3),
    setback: num.nonnegative().optional(),
    levels: z.array(LevelSpecSchema).min(1),
    wallThickness: z
      .object({ exterior: num.positive(), interior: num.positive(), partition: num.positive() })
      .optional(),
    /** Degrees clockwise from north that the top of the plan points to (drives the sun). */
    compass: num.optional(),
    lights: z
      .object({
        master: z.enum(['auto', 'on', 'off']).default('auto'),
        off: z.array(z.string()).default([]),
        on: z.array(z.string()).default([]),
      })
      .optional(),
    views: z.array(ViewSpecSchema).default([]),
    underlay: UnderlaySpecSchema.optional(),
    designs: z.array(DesignSpecSchema).min(1),
  })
  .superRefine((spec, ctx) => {
    const levels = new Set(spec.levels.map((l) => l.id));
    if (levels.size !== spec.levels.length)
      ctx.addIssue({ code: 'custom', message: 'level ids must be unique', path: ['levels'] });
    const designIds = new Set(spec.designs.map((d) => d.id));
    if (designIds.size !== spec.designs.length)
      ctx.addIssue({ code: 'custom', message: 'design ids must be unique', path: ['designs'] });
    spec.designs.forEach((d, di) => {
      const roomIds = new Set<string>();
      d.rooms.forEach((r, i) => {
        if (roomIds.has(r.id))
          ctx.addIssue({
            code: 'custom',
            message: `duplicate room id "${r.id}"`,
            path: ['designs', di, 'rooms', i, 'id'],
          });
        roomIds.add(r.id);
        if (r.level && !levels.has(r.level))
          ctx.addIssue({
            code: 'custom',
            message: `unknown level "${r.level}"`,
            path: ['designs', di, 'rooms', i, 'level'],
          });
      });
      const check = (lvl: string | undefined, path: (string | number)[]) => {
        if (lvl && !levels.has(lvl))
          ctx.addIssue({ code: 'custom', message: `unknown level "${lvl}"`, path });
      };
      d.walls.forEach((w, i) => check(w.level, ['designs', di, 'walls', i, 'level']));
      d.openings.forEach((o, i) => check(o.level, ['designs', di, 'openings', i, 'level']));
      d.items.forEach((o, i) => check(o.level, ['designs', di, 'items', i, 'level']));
      d.lines.forEach((o, i) => check(o.level, ['designs', di, 'lines', i, 'level']));
      d.roofs.forEach((o, i) => check(o.level, ['designs', di, 'roofs', i, 'level']));
      d.stairs.forEach((s, i) => {
        check(s.from, ['designs', di, 'stairs', i, 'from']);
        check(s.to, ['designs', di, 'stairs', i, 'to']);
      });
    });
  });

export type Pt = z.infer<typeof PtSchema>;
export type RoomSpec = z.infer<typeof RoomSpecSchema>;
export type WallSpec = z.infer<typeof WallSpecSchema>;
export type OpeningSpec = z.infer<typeof OpeningSpecSchema>;
export type ZoneSpec = z.infer<typeof ZoneSpecSchema>;
export type GateSpec = z.infer<typeof GateSpecSchema>;
export type ItemSpec = z.infer<typeof ItemSpecSchema>;
export type ItemLineSpec = z.infer<typeof ItemLineSpecSchema>;
export type StairSpec = z.infer<typeof StairSpecSchema>;
export type RoofSpec = z.infer<typeof RoofSpecSchema>;
export type ViewSpec = z.infer<typeof ViewSpecSchema>;
export type UnderlaySpec = z.infer<typeof UnderlaySpecSchema>;
export type DesignSpec = z.infer<typeof DesignSpecSchema>;
export type ReferenceSpec = z.infer<typeof ReferenceSpecSchema>;
/** What a person writes: defaults (`z.default`) may be left out. */
export type ReferenceSpecInput = z.input<typeof ReferenceSpecSchema>;

/** The corners of a rectangle `[x, y, w, d]` (clockwise from the top-left). */
export const rectToPolygon = ([x, y, w, d]: readonly [number, number, number, number]): Pt[] => [
  [x, y],
  [x + w, y],
  [x + w, y + d],
  [x, y + d],
];

/** The polygon of a room, zone or roof spec. */
export const polygonOf = (s: {
  rect?: readonly [number, number, number, number];
  polygon?: Pt[];
}): Pt[] => s.polygon ?? rectToPolygon(s.rect!);

/** Metres per spec unit. */
export const unitFactor = (units: 'ft' | 'm'): number => (units === 'ft' ? 0.3048 : 1);

/** Parses and validates; throws a readable multi-line error listing every problem. */
export function parseReferenceSpec(raw: unknown): ReferenceSpec {
  const r = ReferenceSpecSchema.safeParse(raw);
  if (r.success) return r.data;
  const lines = r.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
  throw new Error(`The reference spec is not valid:\n${lines.join('\n')}`);
}
