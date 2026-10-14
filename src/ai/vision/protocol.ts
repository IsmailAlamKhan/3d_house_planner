import { z } from 'zod';

/**
 * What the picture-reading model is asked and what it may answer. Coordinates are always 0–1000 across the picture
 * it was shown (left = 0, top = 0): Qwen-VL models work in that scale, and the code turns it into pixels.
 */
const n = z.coerce.number().finite();
const coord = n.transform((v) => Math.min(1000, Math.max(0, v)));

export const LabelsAnswerSchema = z.object({
  labels: z
    .array(
      z.object({
        /** The label's text as printed, without the size ("Bedroom 1"). */
        name: z.string(),
        /** The size as printed ("14' x 12'"), when the label has one. */
        size: z.string().optional().nullable(),
        /** Where the label's text is. */
        x: coord,
        y: coord,
      }),
    )
    .default([]),
});
export type LabelsAnswer = z.infer<typeof LabelsAnswerSchema>;

export const RegionsAnswerSchema = z.object({
  regions: z
    .array(
      z.object({
        label: z.string().default(''),
        kind: z.enum(['room', 'zone']).catch('room'),
        x0: coord,
        y0: coord,
        x1: coord,
        y1: coord,
      }),
    )
    .default([]),
});
export type RegionsAnswer = z.infer<typeof RegionsAnswerSchema>;

export const ItemsAnswerSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string(),
        x: coord,
        y: coord,
        count: n.optional(),
      }),
    )
    .default([]),
});
export type ItemsAnswer = z.infer<typeof ItemsAnswerSchema>;

/** The JSON Schemas sent to Ollama as `format` (it forces the answer into this shape). */
export const LABELS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    labels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          size: { type: 'string' },
          x: { type: 'integer' },
          y: { type: 'integer' },
        },
        required: ['name', 'size', 'x', 'y'],
      },
    },
  },
  required: ['labels'],
} as const;

export const REGIONS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    regions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          kind: { type: 'string', enum: ['room', 'zone'] },
          x0: { type: 'integer' },
          y0: { type: 'integer' },
          x1: { type: 'integer' },
          y1: { type: 'integer' },
        },
        required: ['label', 'kind', 'x0', 'y0', 'x1', 'y1'],
      },
    },
  },
  required: ['regions'],
} as const;

export const ITEMS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          x: { type: 'integer' },
          y: { type: 'integer' },
          count: { type: 'integer' },
        },
        required: ['name', 'x', 'y'],
      },
    },
  },
  required: ['items'],
} as const;

export const SYSTEM_PROMPT =
  'You read architectural floor plans drawn from above. You answer only with JSON that follows the given schema. ' +
  'Copy text exactly as printed; never translate or correct it. Coordinates are integers from 0 to 1000 across the ' +
  'picture you are shown: x from the left edge, y from the top edge.';

export const LABELS_PROMPT =
  'This is a floor plan seen from above. List every text label printed on it that names a room, a garden or another ' +
  'area (for example "Kitchen", "Bedroom 2", "Infinity Pool", "Covered Car Parking"). For each give: "name" — the ' +
  'name as printed, without the size; "size" — the size printed under or beside it, copied exactly (for example ' +
  '"14\' x 12\'" or "4.2 x 3.6 m"), or an empty string if none is printed; "x" and "y" — the centre of the label\'s text. Ignore ' +
  'watermarks, buttons, captions, page chrome and the names of gates or arrows. Do not invent labels.';

export const regionsPrompt = (): string =>
  'This is part of a floor plan seen from above. List every room and every outdoor area (garden, pool, deck, ' +
  'parking, path) that is fully or partly visible in it. For each give: "label" — the name printed in or next to it ' +
  '(empty if it has none); "kind" — "room" for an enclosed indoor space, "zone" for an outdoor area; and its ' +
  'bounding box "x0", "y0" (top-left corner) and "x1", "y1" (bottom-right corner) in the 0 to 1000 scale of this ' +
  'picture. Box the floor area inside the walls, not the label text. When a room is cut off by the edge of the picture, ' +
  'box only the part you can see. Do not list furniture.';

export const itemsPrompt = (roomName: string): string =>
  `This is the room "${roomName}" of a floor plan seen from above. List the main pieces of furniture and equipment ` +
  'you can see in it (for example bed, sofa, dining table, kitchen island, bathtub, treadmill, car, trampoline, ' +
  'sun lounger, plant). For each give its "name", the centre "x", "y" of the piece in the 0 to 1000 scale of this ' +
  'picture, and "count" when several identical pieces sit together. Do not list walls, doors, windows or floors.';
