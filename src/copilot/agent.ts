import { z } from 'zod';
import { floorFor } from '../ai/layout/defaults';
import type { LayoutPlan, PlannedItem } from '../ai/layout/plan';
import type { LLMProvider } from '../ai/provider';
import { jsonSchemaOf } from '../ai/schemas';
import { getEntry } from '../catalog';
import { boxCorners, overlapDepth } from '../geometry/collide';
import type { DesignBrief, Project, Selection } from '../model/types';
import { type BriefOp, applyBriefOps, describeBrief, findRoom, regularBedrooms } from './brief';
import { type Command, parseCommand } from './commands';
import {
  type ProgressEvent,
  type Proposal,
  type ProposalCandidate,
  type SolveEnv,
  checkPlan,
  designFromBrief,
} from './design';
import { BriefOpSchema, interpretCommand } from './llm';
import { STYLE_PRESETS, finishes, styleById } from './styles';

/** What a request to the copilot produced: the new brief, candidate designs, and what to tell the person. */
export interface Session {
  brief: DesignBrief;
  proposal: Proposal | null;
  /** Candidate the person (or the copilot) chose, by id. */
  chosen?: string;
  /** A clarifying question waiting for an answer. */
  pending?: { question: string; chips: string[] };
  /** A lighting preset the design goes with. */
  lighting?: 'noon' | 'evening' | 'dusk' | 'marketing';
  /** Geometric edit request to hand to the edit-operations pipeline (preview, apply, undo). */
  editRequest?: string;
  /** Plain sentences describing what happened, newest last. */
  say: string[];
  /** Things assumed because the person did not say. */
  assumed: string[];
}

export const newSession = (brief: DesignBrief): Session => ({
  brief,
  proposal: null,
  say: [],
  assumed: brief.assumptions.map((a) => a.text),
});

export interface AgentEnv extends SolveEnv {
  provider: LLMProvider | null;
  selection?: Selection;
  signal?: AbortSignal;
  onProgress?: (e: ProgressEvent) => void;
}

export interface ToolResult {
  ok: boolean;
  /** What the tool returns to the model (and what the log shows). */
  text: string;
}

export const TOOL_NAMES = [
  'get_project_summary',
  'get_brief',
  'update_brief',
  'generate_candidates',
  'apply_candidate',
  'apply_edit_ops',
  'run_checks',
  'get_scores',
  'place_items',
  'set_materials',
  'set_lighting_preset',
  'render_preview',
  'ask_user',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const key = (s: string) => s.trim().toLowerCase();

const chosenOf = (s: Session): ProposalCandidate | undefined =>
  s.proposal?.candidates.find((c) => c.id === s.chosen) ?? s.proposal?.candidates[0];

/** A flat SVG of one level of a plan: the "quick raster thumbnail" the model may ask for (the page rasterises it). */
export function previewSvg(plan: LayoutPlan, level = 0, width = 320): string {
  const s = plan.shell;
  const k = width / s.w;
  const rects = plan.rooms
    .filter((r) => r.level === level && !r.void)
    .map(
      (r) =>
        `<rect x="${((r.rect.x - s.x) * k).toFixed(1)}" y="${((r.rect.y - s.y) * k).toFixed(1)}" width="${(r.rect.w * k).toFixed(1)}" height="${(r.rect.h * k).toFixed(1)}" fill="#e2e8f0" stroke="#334155"/>` +
        `<text x="${((r.rect.x - s.x + r.rect.w / 2) * k).toFixed(1)}" y="${((r.rect.y - s.y + r.rect.h / 2) * k).toFixed(1)}" font-size="9" text-anchor="middle">${r.name.replace(/[<&>]/g, '')}</text>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${(s.h * k).toFixed(0)}">${rects}</svg>`;
}

/** Puts items into a room of a plan where they fit (inside the room, clear of everything already there). */
export function placeItems(plan: LayoutPlan, roomName: string, ids: string[]): PlannedItem[] {
  const room = plan.rooms.find((r) => key(r.name) === key(roomName) && !r.void);
  if (!room) return [];
  const placed: PlannedItem[] = [];
  const mine = () => [...plan.items, ...placed].filter((i) => i.room === room.key);
  for (const id of ids) {
    const entry = getEntry(id);
    if (!entry) continue;
    const w = entry.defaultSize.w;
    const d = entry.defaultSize.d;
    const r = room.rect;
    search: for (let gy = 0.5; gy < r.h - 0.3; gy += 0.35)
      for (let gx = 0.5; gx < r.w - 0.3; gx += 0.35) {
        const pos = { x: r.x + gx, y: r.y + gy };
        if (
          pos.x + w / 2 > r.x + r.w - 0.1 ||
          pos.y + d / 2 > r.y + r.h - 0.1 ||
          pos.x - w / 2 < r.x + 0.1 ||
          pos.y - d / 2 < r.y + 0.1
        )
          continue;
        const box = boxCorners(pos, w, d, 0);
        const clash = mine().some((i) => {
          const e = getEntry(i.catalogId);
          return (
            e &&
            i.elevation < 0.3 &&
            overlapDepth(
              box,
              boxCorners(
                i.position,
                e.defaultSize.w * i.scale.x,
                e.defaultSize.d * i.scale.z,
                i.rotation,
              ),
            ) > 0.02
          );
        });
        const door = plan.openings.some(
          (o) =>
            o.kind !== 'window' &&
            o.rooms.includes(room.key) &&
            Math.hypot(o.at.x - pos.x, o.at.y - pos.y) < 1.1,
        );
        if (clash || door) continue;
        placed.push({
          level: room.level,
          catalogId: id,
          position: pos,
          rotation: 0,
          elevation: 0,
          scale: { x: 1, y: 1, z: 1 },
          props: {},
          room: room.key,
        });
        break search;
      }
  }
  plan.items.push(...placed);
  return placed;
}

/** The tools the copilot may call. They change the *session* (a proposal); nothing touches the project until Apply. */
export class Toolbox {
  constructor(
    readonly session: Session,
    readonly env: AgentEnv,
  ) {}

  /** How many times candidates were generated in this conversation turn. */
  generations = 0;

  private async regenerate(emphasis?: Command['emphasis']): Promise<void> {
    this.generations++;
    this.env.onProgress?.({ key: 'layouts', vars: { n: 3 } });
    this.session.proposal = await designFromBrief(this.session.brief, this.env, {
      emphasis: emphasis && Object.keys(emphasis).length ? emphasis : undefined,
      signal: this.env.signal,
      onProgress: this.env.onProgress,
      seed: (this.session.proposal?.candidates[0]?.solve.seed ?? 0) + 1,
    });
    this.session.chosen = this.session.proposal.candidates[0]?.id;
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const s = this.session;
    switch (name as ToolName) {
      case 'get_project_summary': {
        const p = this.env.project;
        return {
          ok: true,
          text: `${p.name}: ${p.levels.length} level(s), ${p.rooms.length} rooms, ${p.items.length} items.`,
        };
      }
      case 'get_brief':
        return { ok: true, text: describeBrief(s.brief) };
      case 'update_brief': {
        const parsed = z.array(BriefOpSchema).safeParse(args.ops);
        if (!parsed.success)
          return { ok: false, text: `Invalid ops: ${parsed.error.issues[0]?.message}` };
        const r = applyBriefOps(s.brief, parsed.data as BriefOp[]);
        s.brief = r.brief;
        s.say.push(...r.notes);
        return { ok: true, text: r.notes.join(' ') || 'Brief updated.' };
      }
      case 'generate_candidates': {
        await this.regenerate(args.emphasis as Command['emphasis'] | undefined);
        const c = s.proposal!.candidates;
        return {
          ok: true,
          text: `${c.length} candidates; best has ${c[0]?.issues.length ?? 0} failed checks and follows the brief ${Math.round((c[0]?.adherence ?? 0) * 100)}%.`,
        };
      }
      case 'apply_candidate': {
        const id = String(args.id ?? '');
        if (!s.proposal?.candidates.some((c) => c.id === id))
          return { ok: false, text: 'No such candidate.' };
        s.chosen = id;
        return {
          ok: true,
          text: `Candidate ${id} is chosen. The client will see it and press Apply.`,
        };
      }
      case 'apply_edit_ops': {
        const command = String(args.command ?? '');
        if (!command) return { ok: false, text: 'Say what to change.' };
        s.editRequest = command;
        return { ok: true, text: 'The edit will be previewed for the client.' };
      }
      case 'run_checks': {
        const c = chosenOf(s);
        if (!c) return { ok: false, text: 'Nothing generated yet.' };
        const issues = checkPlan(this.env.project, c.plan, c.intent);
        return {
          ok: true,
          text: issues.length
            ? issues.map((i) => `${i.rule}: ${i.message}`).join('\n')
            : 'No failed checks.',
        };
      }
      case 'get_scores': {
        const c = chosenOf(s);
        return c
          ? { ok: true, text: (c.plan.breakdown ?? []).map((b) => b.text).join('\n') }
          : { ok: false, text: 'Nothing generated yet.' };
      }
      case 'place_items': {
        const c = chosenOf(s);
        if (!c) return { ok: false, text: 'Nothing generated yet.' };
        const ids = (Array.isArray(args.items) ? args.items : []).map(String);
        const placed = placeItems(c.plan, String(args.room ?? ''), ids);
        return {
          ok: placed.length > 0,
          text: placed.length ? `Placed ${placed.length} item(s).` : 'No room for them there.',
        };
      }
      case 'set_materials': {
        const style = styleById(String(args.style ?? ''));
        const r = applyBriefOps(s.brief, [
          {
            op: 'setStyle',
            preset: style?.id,
            floor: args.floor ? String(args.floor) : undefined,
            walls: args.walls ? String(args.walls) : undefined,
          },
        ]);
        s.brief = r.brief;
        const c = chosenOf(s);
        if (c && style) {
          const fin = finishes(style, s.brief.budget);
          c.intent = { ...c.intent, style: { floor: fin.floor, walls: fin.walls } };
          for (const room of c.plan.rooms) room.floorMaterial = floorFor(room.type, c.intent.style);
        }
        return { ok: true, text: style ? `Style set to ${style.id}.` : 'Materials noted.' };
      }
      case 'set_lighting_preset': {
        const mode = String(args.mode ?? '');
        if (!['noon', 'evening', 'dusk', 'marketing'].includes(mode))
          return { ok: false, text: 'Use noon, evening, dusk or marketing.' };
        s.lighting = mode as Session['lighting'];
        return { ok: true, text: `Lighting set to ${mode}.` };
      }
      case 'render_preview': {
        const c = chosenOf(s);
        return c
          ? { ok: true, text: previewSvg(c.plan, Number(args.level ?? 0)) }
          : { ok: false, text: 'Nothing generated yet.' };
      }
      case 'ask_user': {
        const question = String(args.question ?? '');
        const chips = (Array.isArray(args.chips) ? args.chips : []).map(String).slice(0, 6);
        s.pending = { question, chips };
        this.env.onProgress?.({ key: 'asking' });
        return { ok: true, text: 'Waiting for the client.' };
      }
      default:
        return { ok: false, text: `Unknown tool "${name}".` };
    }
  }
}

// ───────────────────────── the loop ─────────────────────────

const ActionSchema = z.object({
  tool: z.string().optional(),
  args: z.record(z.string(), z.unknown()).default({}),
  final: z.string().optional(),
});

const AGENT_SYSTEM = `You are a home-design copilot working with a client. You never edit geometry yourself: you call tools and the app runs and validates them.
Reply with ONE JSON object each turn: {"tool": "<name>", "args": {...}} to call a tool, or {"final": "<one or two plain sentences for the client, in the client's language>"} when you are done.
Tools:
- get_brief {} → the Design Brief
- update_brief {"ops": [BriefOp...]} → change the brief (addRoom, removeRoom, resizeRoom, setPriority, setLevels, setBedrooms, addFeature, removeFeature, setCars, setStyle, setBudget, addPriority, removePriority)
- generate_candidates {"emphasis": {"daylight":3}} → three layouts, checked and self-fixed
- run_checks {} / get_scores {} → what is still wrong / why the plan scores as it does
- apply_candidate {"id": "..."} → choose a candidate (the client presses Apply)
- apply_edit_ops {"command": "..."} → a geometry edit (move a wall, paint, move furniture) to preview
- place_items {"room": "...", "items": ["plant"]}, set_materials {"style": "tropical"}, set_lighting_preset {"mode": "dusk"}
- render_preview {"level": 0} → a small plan picture
- ask_user {"question": "...", "chips": ["...", "..."]} → ask the client one short question and stop
Style ids: ${STYLE_PRESETS.map((s) => s.id).join(', ')}. Be brief. After changing the brief, call generate_candidates.`;

export interface TurnResult {
  session: Session;
  /** What the copilot says to the person. */
  reply: string;
  source: 'model' | 'offline';
}

/**
 * One turn of conversation. With a model: a tool-calling loop (JSON protocol: the model answers with a tool and
 * arguments, the app runs it and answers with the result, up to `maxSteps`). Without one — or if the model fails —
 * a keyword reader makes the same tool calls. Either way the candidates are checked and self-fixed before showing.
 */
export async function runTurn(
  text: string,
  session: Session,
  env: AgentEnv,
  opts: { maxSteps?: number } = {},
): Promise<TurnResult> {
  const tools = new Toolbox(session, env);
  const before = session.brief;
  const selected = selectedName(env);
  const fallback = parseCommand(text, session.brief, selected);
  if (env.provider) {
    try {
      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: AGENT_SYSTEM },
        {
          role: 'user',
          content: `Brief:\n${describeBrief(session.brief)}\n${selected ? `The client points at: ${selected}\n` : ''}Client says: ${text}`,
        },
      ];
      let final = '';
      for (let step = 0; step < (opts.maxSteps ?? 8); step++) {
        const raw = await env.provider.generate({
          messages,
          schema: jsonSchemaOf(ActionSchema),
          temperature: 0.1,
          signal: env.signal,
        });
        let action: z.infer<typeof ActionSchema>;
        try {
          action = ActionSchema.parse(
            JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)),
          );
        } catch {
          messages.push(
            { role: 'assistant', content: raw.slice(0, 500) },
            {
              role: 'user',
              content:
                'That was not valid JSON. Reply with {"tool": ..., "args": ...} or {"final": ...}.',
            },
          );
          continue;
        }
        if (action.final !== undefined) {
          final = action.final;
          break;
        }
        const result = await tools.call(action.tool ?? '', action.args);
        messages.push(
          { role: 'assistant', content: JSON.stringify(action) },
          { role: 'user', content: `RESULT: ${result.text.slice(0, 1500)}` },
        );
        if (session.pending) break;
      }
      if (!session.pending && !session.editRequest) {
        // The keyword reader is the floor: what it understood but the model's changes do not show is applied now.
        const missing = fallback.ops.filter((op) => !reflects(session.brief, before, op));
        if (missing.length) {
          await tools.call('update_brief', { ops: missing });
          await tools.call('generate_candidates', { emphasis: fallback.emphasis });
        } else if (tools.generations === 0 && (session.brief !== before || !session.proposal)) {
          // The brief changed but nothing was generated (the model forgot, or ran out of steps).
          await tools.call('generate_candidates', { emphasis: fallback.emphasis });
        }
      }
      if (session.proposal || session.pending || session.editRequest)
        return { session, reply: final || (session.say.slice(-1)[0] ?? ''), source: 'model' };
    } catch (e) {
      if (env.signal?.aborted) throw e;
      // Fall through to the keyword reader.
    }
  }
  return offlineTurn(text, fallback, tools, env);
}

async function offlineTurn(
  text: string,
  fallback: Command,
  tools: Toolbox,
  env: AgentEnv,
): Promise<TurnResult> {
  const session = tools.session;
  // A model that can only read the request (not drive tools) still helps: it turns vague words into operations.
  const read = env.provider
    ? await interpretCommand(text, session.brief, {
        provider: env.provider,
        selected: selectedName(env),
        signal: env.signal,
        fallback,
      })
    : { command: fallback, say: '' };
  const command = read.command;
  if (command.geometric) {
    await tools.call('apply_edit_ops', { command: text });
    return { session, reply: '', source: env.provider ? 'model' : 'offline' };
  }
  if (command.unknown) {
    await tools.call('ask_user', { question: 'unknown', chips: [] });
    return { session, reply: '', source: 'offline' };
  }
  const r = await tools.call('update_brief', { ops: command.ops });
  await tools.call('generate_candidates', { emphasis: command.emphasis });
  return { session, reply: read.say || r.text, source: read.say ? 'model' : 'offline' };
}

/** Does the brief already show what this operation asks for (compared with the brief before the turn)? */
export function reflects(brief: DesignBrief, before: DesignBrief, op: BriefOp): boolean {
  const count = (b: DesignBrief, type: string) => b.program.filter((r) => r.type === type).length;
  switch (op.op) {
    case 'addFeature':
      return brief.features.some((f) => f.type === op.type);
    case 'removeFeature':
      return !brief.features.some((f) => f.type === op.type);
    case 'resizeFeature':
      return (
        brief.features.find((f) => f.type === op.type)?.size !==
        before.features.find((f) => f.type === op.type)?.size
      );
    case 'setCars':
      return brief.cars === op.cars;
    case 'setLevels':
      return brief.levels === op.levels;
    case 'setBedrooms':
      return regularBedrooms(brief.program).length === op.count;
    case 'setBudget':
      return brief.budget === op.budget;
    case 'setStyle':
      return !op.preset || brief.style.preset === op.preset;
    case 'addPriority':
      return brief.priorities.includes(op.priority);
    case 'removePriority':
      return !brief.priorities.includes(op.priority);
    case 'addRoom':
      return op.name
        ? brief.program.some((r) => r.name.toLowerCase() === op.name!.toLowerCase()) ||
            count(brief, op.type) > count(before, op.type)
        : count(brief, op.type) > count(before, op.type);
    case 'removeRoom':
      return findRoom(brief, op.room) === undefined;
    case 'resizeRoom':
      return findRoom(brief, op.room)?.area !== findRoom(before, op.room)?.area;
    default:
      return true;
  }
}

function selectedName(env: AgentEnv): string | undefined {
  const sel = env.selection;
  if (!sel?.type || !sel.ids.length) return undefined;
  const p: Project = env.project;
  if (sel.type === 'room') return p.rooms.find((r) => r.id === sel.ids[0])?.name;
  if (sel.type === 'item') return p.items.find((i) => i.id === sel.ids[0])?.catalogId;
  return undefined;
}
