import { z } from 'zod';
import { askValidated } from '../ai/pipeline';
import { jsonSchemaOf } from '../ai/schemas';
import type { AiProgress, LLMProvider } from '../ai/provider';
import { ROOM_TYPES, ZONE_TYPES, STYLE_IDS, BUDGET_LEVELS, CARE_ABOUT } from '../model/schemas';
import type { BriefFeature, BriefRoom, DesignBrief } from '../model/types';
import { type BriefOp, describeBrief } from './brief';
import type { Command } from './commands';
import { TYPE_NAME, emptyBrief, makeFeature, makeRoom } from './program';
import type { Known } from './text';
import { isBengali, textToBrief } from './text';

// ───────────────────────── brief from words, through the model ─────────────────────────

/** What the model fills in: small, flat, no ids (the app builds the brief from it). */
export const BriefDraftSchema = z.object({
  language: z.enum(['en', 'bn']).default('en'),
  levels: z.coerce.number().int().min(1).max(3).default(1),
  kind: z.enum(['duplex', 'villa']).default('duplex'),
  rooms: z
    .array(
      z.object({
        type: z.enum(ROOM_TYPES),
        name: z.string().min(1).max(60),
        area: z.coerce.number().min(2).max(150),
        level: z.coerce.number().int().min(0).max(2).nullable().optional(),
        priority: z.enum(['must', 'nice']).default('must'),
        next: z.array(z.string()).default([]),
      }),
    )
    .min(1)
    .max(40),
  features: z
    .array(
      z.object({
        type: z.enum(ZONE_TYPES),
        side: z.enum(['front', 'back', 'left', 'right']).default('back'),
        covered: z.boolean().default(false),
      }),
    )
    .default([]),
  cars: z.coerce.number().int().min(0).max(6).default(0),
  style: z.enum(STYLE_IDS).optional(),
  budget: z.enum(BUDGET_LEVELS).default('mid'),
  priorities: z.array(z.enum(CARE_ABOUT)).default([]),
});
export type BriefDraft = z.infer<typeof BriefDraftSchema>;

export const BRIEF_SYSTEM = `You are an architect's assistant. Turn the client's request into a Design Brief as JSON.
The request may be in English or Bengali: think in English, but copy room names the client typed. Set "language" to the client's language ("en" or "bn").
Rules:
- "rooms" lists every room the home needs with a realistic area in square metres (living 24-35, kitchen 12-16, dining 10-14, master bedroom 16-22, other bedrooms 11-14, bathrooms 4-7, garage 26).
- Put each bedroom's own bathroom in the bedroom's "next" list (and the bedroom in the bathroom's "next").
- "level": 0 = ground floor. Use null to let the planner decide. A room for elderly parents or guests belongs on level 0.
- "kind" is "villa" when the client wants a plot with a garden, pool, or parking; otherwise "duplex".
- "features" are outdoor areas (pool, garden, lawn, parking, deck, patio, play, water-feature); "cars" is the number of cars.
- Only include what the client asked for or what any such home needs. Answer with JSON only.`;

function fromDraft(d: BriefDraft, source: string): DesignBrief {
  const program: BriefRoom[] = d.rooms.map((r) =>
    makeRoom(r.type, {
      name: r.name,
      area: r.area,
      level: r.level ?? null,
      priority: r.priority,
      next: r.next,
    }),
  );
  const features: BriefFeature[] = d.features.map((f) =>
    makeFeature(f.type, { side: f.side, covered: f.covered }),
  );
  return emptyBrief({
    language: d.language,
    levels: d.levels,
    kind: d.kind,
    program,
    features,
    cars: d.cars,
    style: { preset: d.style, keywords: [], palette: [] },
    budget: d.budget,
    priorities: d.priorities,
    source: source.slice(0, 4000),
  });
}

/**
 * The model's brief merged with the keyword reading, which is the floor: whatever the words state outright (levels,
 * bedroom count, named rooms, outdoor features, cars, style, budget) wins; the model adds what the words do not say
 * (the rooms a vague request implies, style, priorities) and unusual rooms the keywords do not know. Room names the model
 * wrote in another script are replaced by the type's English name.
 */
export function reconcile(
  model: DesignBrief,
  words: DesignBrief,
  known: Known[] = [],
): DesignBrief {
  const k = new Set(known);
  const isAscii = (t: string) => [...t].every((c) => c.charCodeAt(0) < 128);
  const english = (r: BriefRoom): BriefRoom => ({
    ...r,
    name: !isAscii(r.name) ? (TYPE_NAME[r.type] ?? r.type) : r.name,
    next: r.next.filter((n) => isAscii(n)),
  });
  // A model that hears "garage" often invents a garage room; the brief means covered parking (an attached garage room
  // only when the words ask for one).
  const modelRooms = model.program
    .filter((r) => r.type !== 'garage' || words.program.some((w) => w.type === 'garage'))
    .map(english);
  const core = (rs: BriefRoom[]) =>
    rs.some((r) => r.type === 'living') && rs.some((r) => r.type === 'kitchen');
  const useModelProgram =
    !k.has('rooms') && core(modelRooms) && modelRooms.some((r) => r.type === 'bedroom');
  const extraRooms = (() => {
    // Rooms of a kind the words do not have, from the model (a study the keywords missed, a library).
    const extra = modelRooms.filter(
      (r) =>
        ![
          'living',
          'kitchen',
          'dining',
          'bedroom',
          'bathroom',
          'foyer',
          'walk-in-closet',
          'stair',
          'corridor',
        ].includes(r.type) &&
        !words.program.some((w) => w.type === r.type) &&
        r.area >= 3 &&
        r.area <= 60,
    );
    return extra;
  })();
  const program = useModelProgram ? modelRooms : [...words.program, ...extraRooms];
  const features = [...words.features];
  for (const f of model.features) if (!features.some((x) => x.type === f.type)) features.push(f);
  const villa = words.kind === 'villa' || model.kind === 'villa' || features.length > 0;
  return {
    ...words,
    program,
    features,
    kind: villa ? 'villa' : 'duplex',
    levels: k.has('levels') ? words.levels : model.levels,
    cars: words.features.some((f) => f.type === 'parking')
      ? words.cars || model.cars || 2
      : model.features.some((f) => f.type === 'parking')
        ? model.cars || 2
        : 0,
    style: {
      ...words.style,
      preset: k.has('style') ? words.style.preset : (model.style.preset ?? words.style.preset),
    },
    budget: k.has('budget') ? words.budget : model.budget,
    priorities: k.has('priorities')
      ? words.priorities
      : [...new Set([...words.priorities, ...model.priorities])],
    language: words.language,
    size: words.size ?? model.size,
  };
}

/** The brief for a request: the model's, reconciled with the offline reader; the offline reading alone if there is no model or it fails. */
export async function generateBrief(
  text: string,
  opts: {
    provider: LLMProvider | null;
    signal?: AbortSignal;
    onProgress?: (p: AiProgress) => void;
  },
): Promise<{
  brief: DesignBrief;
  known: ReturnType<typeof textToBrief>['known'];
  source: 'model' | 'offline';
}> {
  const words = textToBrief(text);
  if (!opts.provider) return { brief: words.brief, known: words.known, source: 'offline' };
  try {
    const draft = await askValidated(
      opts.provider,
      [
        { role: 'system', content: BRIEF_SYSTEM },
        { role: 'user', content: text },
      ],
      BriefDraftSchema,
      jsonSchemaOf(BriefDraftSchema),
      opts.signal,
      0.2,
      undefined,
      opts.onProgress,
    );
    const brief = reconcile(
      fromDraft({ ...draft, language: isBengali(text) ? 'bn' : draft.language }, text),
      words.brief,
      words.known,
    );
    return { brief, known: words.known, source: 'model' };
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    return { brief: words.brief, known: words.known, source: 'offline' };
  }
}

// ───────────────────────── change requests, through the model ─────────────────────────

/** The edit operations a model may emit (mirrors `BriefOp`). Unknown fields are rejected so mistakes show up. */
export const BriefOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('addRoom'),
    type: z.enum(ROOM_TYPES),
    name: z.string().optional(),
    area: z.coerce.number().optional(),
    level: z.coerce.number().int().min(0).max(2).nullable().optional(),
    next: z.array(z.string()).optional(),
    priority: z.enum(['must', 'nice']).optional(),
  }),
  z.object({ op: z.literal('removeRoom'), room: z.string() }),
  z.object({
    op: z.literal('resizeRoom'),
    room: z.string(),
    area: z.coerce.number().optional(),
    factor: z.coerce.number().optional(),
  }),
  z.object({ op: z.literal('setPriority'), room: z.string(), priority: z.enum(['must', 'nice']) }),
  z.object({ op: z.literal('setLevels'), levels: z.coerce.number().int().min(1).max(3) }),
  z.object({
    op: z.literal('setBedrooms'),
    count: z.coerce.number().int().min(0).max(7),
    ensuite: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('addFeature'),
    type: z.enum(ZONE_TYPES),
    side: z.enum(['front', 'back', 'left', 'right']).optional(),
    covered: z.boolean().optional(),
  }),
  z.object({ op: z.literal('removeFeature'), type: z.enum(ZONE_TYPES) }),
  z.object({ op: z.literal('setCars'), cars: z.coerce.number().int().min(0).max(6) }),
  z.object({
    op: z.literal('setStyle'),
    preset: z.enum(STYLE_IDS).optional(),
    keywords: z.array(z.string()).optional(),
  }),
  z.object({ op: z.literal('setBudget'), budget: z.enum(BUDGET_LEVELS) }),
  z.object({ op: z.literal('addPriority'), priority: z.enum(CARE_ABOUT) }),
  z.object({ op: z.literal('removePriority'), priority: z.enum(CARE_ABOUT) }),
]);

export const CommandAnswerSchema = z.object({
  ops: z.array(BriefOpSchema).max(12).default([]),
  emphasis: z
    .object({
      daylight: z.number().optional(),
      corridor: z.number().optional(),
      straight: z.number().optional(),
      privacy: z.number().optional(),
      wet: z.number().optional(),
      view: z.number().optional(),
      adjacency: z.number().optional(),
      area: z.number().optional(),
    })
    .default({}),
  /** Answer to the client, one or two plain sentences, in the client's language. */
  say: z.string().max(400).default(''),
});
export type CommandAnswer = z.infer<typeof CommandAnswerSchema>;

const COMMAND_SYSTEM = `You change a home's Design Brief for a client. Read the request (English or Bengali) and answer with JSON:
{"ops": [...], "emphasis": {...}, "say": "..."}.
Operations: addRoom{type,name?,area?,level?,next?,priority?}, removeRoom{room}, resizeRoom{room,area|factor}, setPriority{room,priority}, setLevels{levels}, setBedrooms{count,ensuite?}, addFeature{type,side?,covered?}, removeFeature{type}, setCars{cars}, setStyle{preset?,keywords?}, setBudget{budget}, addPriority{priority}, removePriority{priority}.
Emphasis (1 = normal, 3 = much more) steers the planner: daylight, corridor (less corridor), straight (simpler walls), privacy, wet (plumbing together), view (garden view), adjacency, area.
Vague wishes become priorities and emphasis ("more open" = addPriority open-plan; "more light" = addPriority light + emphasis.daylight 3; "cheaper" = setBudget one level lower).
"say" explains in one or two plain sentences what you changed and why, in the client's language. Never invent rooms the client did not ask for.`;

/** The model's reading of a change request. Falls back to the keyword reader when it cannot answer. */
export async function interpretCommand(
  text: string,
  brief: DesignBrief,
  opts: {
    provider: LLMProvider | null;
    selected?: string;
    signal?: AbortSignal;
    fallback: Command;
  },
): Promise<{ command: Command; say: string }> {
  if (!opts.provider) return { command: opts.fallback, say: '' };
  try {
    const a = await askValidated(
      opts.provider,
      [
        { role: 'system', content: COMMAND_SYSTEM },
        {
          role: 'user',
          content: `Current brief:\n${describeBrief(brief)}\n${opts.selected ? `The client points at: ${opts.selected}\n` : ''}Request: ${text}`,
        },
      ],
      CommandAnswerSchema,
      jsonSchemaOf(CommandAnswerSchema),
      opts.signal,
      0.2,
    );
    const ops = a.ops as BriefOp[];
    if (!ops.length && !Object.keys(a.emphasis).length)
      return { command: opts.fallback, say: a.say };
    // The keyword reader's edits are kept when the model missed them (it may have understood only half).
    const merged = [...ops];
    for (const o of opts.fallback.ops)
      if (!merged.some((m) => JSON.stringify(m) === JSON.stringify(o)) && o.op !== 'addPriority')
        merged.push(o);
    return {
      command: {
        ...opts.fallback,
        ops: ops.length ? ops : opts.fallback.ops,
        emphasis: { ...opts.fallback.emphasis, ...a.emphasis },
        unknown: false,
      },
      say: a.say,
    };
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    return { command: opts.fallback, say: '' };
  }
}
