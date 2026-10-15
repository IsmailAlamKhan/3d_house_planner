import { produce } from 'immer';
import { applyPlan } from '../ai/layout/apply';
import type { LayoutPlan } from '../ai/layout/plan';
import { largestInnerRect } from '../ai/layout/rect';
import type { SolveInput } from '../ai/layout/solve';
import type { Emphasis } from '../ai/layout/weights';
import type { DesignIntent } from '../ai/schemas';
import { type CheckIssue, runChecks } from '../checks';
import { polygonBounds } from '../geometry/polygon';
import type { DesignBrief, Point, Project } from '../model/types';
import { type ShellConfig, defaultConfig, projectFromConfig } from '../wizard/shell';
import { adherence } from './adherence';
import { type BriefOp, applyBriefOps, briefToIntent, hintsByName } from './brief';

const key = (s: string) => s.trim().toLowerCase();

/** What the layout solver needs to know about a project's shell. */
export type SolverBase = Omit<SolveInput, 'intent'>;

export function solverBase(project: Project): SolverBase {
  const first = project.levels[0]?.id;
  return {
    footprint: project.shell.footprint,
    entrance: project.shell.entrance,
    plumbing: project.shell.fixedPlumbingPoints,
    columns: project.columns
      .filter((c) => c.levelId === first)
      .map((c) => ({ position: c.position, size: c.size })),
    maxHeight: project.shell.maxHeight,
    plot: project.kind === 'villa' ? project.site.plot : undefined,
  };
}

/**
 * The shell a brief asks for when there is none yet: a building about as big as the program needs (circulation
 * and walls included), on the plot the person gave or a plot with room for the garden, parking and pool.
 */
export function suggestShell(brief: DesignBrief): ShellConfig {
  const levels = Math.max(1, brief.levels);
  const net = brief.program.filter((r) => r.priority === 'must').reduce((s, r) => s + r.area, 0);
  const perLevel = (net * 1.22) / levels;
  const villa = brief.kind === 'villa';
  let width: number;
  let depth: number;
  if (brief.size?.of === 'building') {
    width = brief.size.width;
    depth = brief.size.depth;
  } else {
    const ratio = villa ? 1.25 : 0.85;
    width = Math.round(Math.sqrt(perLevel * ratio) * 2) / 2;
    depth = Math.round((perLevel / width) * 2) / 2;
    width = Math.max(villa ? 12 : 7, width);
    depth = Math.max(villa ? 10 : 8, depth);
  }
  const c = defaultConfig();
  c.name = brief.title ?? (villa ? 'My Villa' : 'My Duplex Home');
  c.kind = villa ? 'villa' : 'apartment';
  c.storeys = levels;
  c.width = width;
  c.depth = depth;
  c.entrance = { position: { x: width / 2, y: depth }, direction: Math.PI / 2 };
  c.plumbing = [
    { x: 1.2, y: depth - 1 },
    { x: width - 1.2, y: 1 },
  ];
  if (villa) {
    const w = brief.size?.of === 'plot' ? brief.size.width : Math.max(28, Math.round(width * 1.9));
    const d = brief.size?.of === 'plot' ? brief.size.depth : Math.max(34, Math.round(depth * 2.4));
    c.plotW = w;
    c.plotD = d;
  }
  c.totalHeight = levels === 1 ? 3.4 : levels === 2 ? 6.2 : 9.4;
  c.groundHeight = 3.1;
  return c;
}

export const projectForBrief = (brief: DesignBrief): Project =>
  projectFromConfig(suggestShell(brief));

// ───────────────────────── solving ─────────────────────────

/** How the copilot reaches the layout engine (the worker in the browser, a direct call in tests and the eval). */
export interface SolveEnv {
  project: Project;
  solve: (input: SolveInput, count: number, signal?: AbortSignal) => Promise<LayoutPlan[]>;
}

export interface ProgressEvent {
  key: 'reading' | 'brief' | 'layouts' | 'checking' | 'fixing' | 'styling' | 'done' | 'asking';
  vars?: Record<string, string | number>;
}

export interface ProposalCandidate {
  id: string;
  /** The brief this candidate was made from (a fix may have changed room sizes). */
  brief: DesignBrief;
  intent: DesignIntent;
  plan: LayoutPlan;
  solve: SolveInput;
  /** Check errors still there after the self-fix rounds. */
  issues: CheckIssue[];
  /** How well it follows the brief (0–1) and the lines behind the score. */
  adherence: number;
  fixed: string[];
}

export interface Proposal {
  brief: DesignBrief;
  candidates: ProposalCandidate[];
  /** Fix rounds the agent ran across all candidates. */
  fixRounds: number;
  ms: number;
}

/** Centres of the locked rooms in the current design: the layout keeps them where they are. */
export function lockedHints(
  brief: DesignBrief,
  project: Project,
): Record<string, { x: number; y: number; w: number }> {
  const out: Record<string, { x: number; y: number; w: number }> = {};
  for (const r of brief.program.filter((x) => x.locked)) {
    const hit = project.rooms.find((p) => key(p.name) === key(r.name));
    if (!hit) continue;
    const b = polygonBounds(hit.polygon);
    out[key(r.name)] = { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, w: 4 };
  }
  return out;
}

function hintsFor(brief: DesignBrief, project: Project): SolveInput['hints'] {
  const out: NonNullable<SolveInput['hints']> = {};
  for (const [name, p] of Object.entries(hintsByName(brief))) out[key(name)] = { ...p, w: 1.5 };
  return { ...out, ...lockedHints(brief, project) };
}

/** Applies a plan to a copy of the project and runs the checks on the result. */
export function checkPlan(project: Project, plan: LayoutPlan, intent: DesignIntent): CheckIssue[] {
  try {
    const next = produce(project, (d) => void applyPlan(d, plan, intent.style));
    return runChecks(next).filter((i) => i.severity === 'error');
  } catch {
    return [];
  }
}

interface Fix {
  ops: BriefOp[];
  emphasis: Emphasis;
  note: string;
  bump: number;
}

/** What to change in response to a failed check: room sizes, emphasis, or just another arrangement. */
export function fixFor(issues: CheckIssue[], brief: DesignBrief, project: Project): Fix {
  const ops: BriefOp[] = [];
  const emphasis: Emphasis = {};
  const notes: string[] = [];
  for (const i of issues) {
    if (i.rule === 'bedroom-window') {
      emphasis.daylight = Math.max(emphasis.daylight ?? 1, 4);
      notes.push('more daylight for the bedrooms');
    } else if (i.rule === 'min-area') {
      const room = project.rooms.find((r) => i.target.selection?.ids.includes(r.id));
      const hit = room && brief.program.find((p) => key(p.name) === key(room.name));
      if (hit) {
        ops.push({ op: 'resizeRoom', room: hit.name, factor: 1.25 });
        notes.push(`a bigger ${hit.name}`);
      }
    } else if (i.rule === 'entrance') {
      // The front door opens into a bedroom or kitchen, or furniture stands in front of it: favour a hall, ease placement hints.
      emphasis.entrance = Math.max(emphasis.entrance ?? 1, 4);
      emphasis.placement = 0.3;
      notes.push('a clear entrance');
    } else if (i.rule === 'drain') {
      emphasis.wet = Math.max(emphasis.wet ?? 1, 3);
      notes.push('wet rooms nearer the drains');
    } else {
      emphasis.adjacency = Math.max(emphasis.adjacency ?? 1, 2);
      notes.push('a different arrangement');
    }
  }
  return { ops, emphasis, note: [...new Set(notes)].join(', '), bump: 1 };
}

/**
 * How much to scale the asked-for room sizes so the program fills the shell (the person's rooms keep their
 * proportions; a shell much bigger or smaller than the program is not filled with giant or tiny rooms).
 */
export function areaScaleFor(brief: DesignBrief, project: Project): number {
  const net = brief.program.reduce((s, r) => s + r.area, 0);
  if (!net) return 1;
  const r = largestInnerRect(project.shell.footprint).rect;
  const target = r.w * r.h * Math.max(1, brief.levels) * 0.86;
  const k = target / net;
  return k > 0.9 && k < 1.12 ? 1 : Math.min(2.2, Math.max(0.55, k));
}

let counter = 0;

/**
 * The brief → candidate designs, checked. Each candidate is applied to a scratch copy of the project and the
 * checks run; failures are fixed by changing the brief or the emphasis and solving again, up to `maxFix` rounds.
 * Nothing here touches the real project.
 */
export async function designFromBrief(
  brief: DesignBrief,
  env: SolveEnv,
  opts: {
    count?: number;
    maxFix?: number;
    emphasis?: Emphasis;
    seed?: number;
    signal?: AbortSignal;
    onProgress?: (e: ProgressEvent) => void;
  } = {},
): Promise<Proposal> {
  const t0 = performance.now();
  const count = opts.count ?? 3;
  const maxFix = opts.maxFix ?? 3;
  const base = solverBase(env.project);
  const scale = areaScaleFor(brief, env.project);
  const input = (b: DesignBrief, emphasis: Emphasis | undefined, seed: number): SolveInput => ({
    intent: { ...briefToIntent(b, { areaScale: scale }), furnish: true },
    ...base,
    hints: hintsFor(b, env.project),
    emphasis,
    seed,
  });
  opts.onProgress?.({ key: 'layouts', vars: { n: count } });
  const first = input(brief, opts.emphasis, opts.seed ?? 1);
  const plans = await env.solve(first, count, opts.signal);
  const candidates: ProposalCandidate[] = [];
  let rounds = 0;
  for (const plan of plans) {
    let cur = { brief, plan, solve: first, emphasis: opts.emphasis };
    let issues = checkPlan(env.project, cur.plan, cur.solve.intent);
    const fixed: string[] = [];
    opts.onProgress?.({ key: 'checking' });
    for (let round = 0; round < maxFix && issues.length; round++) {
      const fix = fixFor(issues, cur.brief, env.project);
      opts.onProgress?.({ key: 'fixing', vars: { what: fix.note } });
      const nextBrief = fix.ops.length ? applyBriefOps(cur.brief, fix.ops).brief : cur.brief;
      const emphasis = { ...cur.emphasis, ...fix.emphasis };
      const solve = input(nextBrief, emphasis, (cur.solve.seed ?? 1) + 7 * (round + 1));
      const retry = (await env.solve(solve, 1, opts.signal))[0];
      rounds++;
      if (!retry) break;
      const retryIssues = checkPlan(env.project, retry, solve.intent);
      if (retryIssues.length <= issues.length) {
        cur = { brief: nextBrief, plan: retry, solve, emphasis };
        if (retryIssues.length < issues.length) fixed.push(fix.note);
        issues = retryIssues;
      }
    }
    candidates.push({
      id: `p${++counter}`,
      brief: cur.brief,
      intent: cur.solve.intent,
      plan: cur.plan,
      solve: cur.solve,
      issues,
      adherence: adherence(cur.brief, cur.plan).score,
      fixed,
    });
  }
  // Best first: no failed checks, then closest to the brief.
  candidates.sort((a, b) => a.issues.length - b.issues.length || b.adherence - a.adherence);
  return { brief, candidates, fixRounds: rounds, ms: performance.now() - t0 };
}

export const planBounds = (plan: LayoutPlan): { min: Point; max: Point } => ({
  min: { x: plan.shell.x, y: plan.shell.y },
  max: { x: plan.shell.x + plan.shell.w, y: plan.shell.y + plan.shell.h },
});

export const shellOf = (project: Project) => largestInnerRect(project.shell.footprint).rect;

/** No interior yet: only the shell's own walls, no stair, no furniture (a project just made in the wizard). */
export const projectIsBlank = (p: Project): boolean =>
  p.stairs.length === 0 && p.items.length === 0 && p.walls.every((w) => w.type === 'exterior');

/**
 * Which project the design goes into. The current one when it can hold the brief; a new one when the brief needs a plot
 * the project does not have (a pool, parking and a garden need a villa project), or when the project is a blank shell that is
 * much too small or too big for the rooms asked for. A new project never replaces a designed one silently: the caller
 * saves the current project first and tells the person.
 */
export function chooseProject(
  brief: DesignBrief,
  current: Project,
): { project: Project; created: 'plot' | 'fit' | null } {
  const needsPlot = brief.kind === 'villa' && brief.features.length > 0;
  if (needsPlot && current.kind !== 'villa')
    return { project: projectForBrief(brief), created: 'plot' };
  if (projectIsBlank(current) && !shellFits(brief, current))
    return { project: projectForBrief(brief), created: 'fit' };
  return { project: current, created: null };
}

/** Does the project's shell suit the brief (not far too small or far too big for the rooms asked for)? */
export function shellFits(brief: DesignBrief, project: Project): boolean {
  const net = brief.program.filter((r) => r.priority === 'must').reduce((s, r) => s + r.area, 0);
  if (!net) return true;
  const r = largestInnerRect(project.shell.footprint).rect;
  const ratio = (r.w * r.h * Math.max(1, brief.levels)) / (net * 1.22);
  return ratio >= 0.7 && ratio <= 1.7;
}
