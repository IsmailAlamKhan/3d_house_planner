import { largestInnerRect } from '../ai/layout/rect';
import { solveCandidates } from '../ai/layout/solve';
import type { LLMProvider } from '../ai/provider';
import { ROOM_TYPES } from '../model/schemas';
import type { DesignBrief, Project } from '../model/types';
import { createSampleProject } from '../model/sample';
import { defaultConfig, projectFromConfig } from '../wizard/shell';
import { adherence } from './adherence';
import { type Session, newSession, runTurn } from './agent';
import { regularBedrooms } from './brief';
import {
  type Proposal,
  type SolveEnv,
  chooseProject,
  designFromBrief,
  projectForBrief,
} from './design';
import { answer as answerQuestion, newInterview, nextQuestion } from './interview';
import { baseBrief, likeThisBut } from './likeThis';
import { generateBrief } from './llm';
import { type Expect, type Scenario } from './scenarios';
import { sketchToBrief } from './sketch';
import { emptyBrief, ensureProgram } from './program';
import { textToBrief } from './text';

export interface ScenarioResult {
  id: string;
  kind: Scenario['kind'];
  ms: number;
  /** Share of the scenario's expectations met (0–1). */
  expectation: number;
  /** Share of the brief-vs-plan checks met (requested rooms, sizes, features). */
  brief: number;
  /** Combined brief adherence. */
  adherence: number;
  /** Check errors left on the best design after the self-fix loop. */
  hardFailures: number;
  /** The failed checks left on the best design (rule: message). */
  issues: string[];
  fixRounds: number;
  turns: number;
  failures: string[];
}

const key = (s: string) => s.toLowerCase();

/** Checks the plan of the best candidate against what the scenario said it must show. */
export function checkExpect(
  e: Expect,
  proposal: Proposal,
): { passed: number; total: number; failures: string[] } {
  const c = proposal.candidates[0];
  const failures: string[] = [];
  let total = 0;
  const need = (ok: boolean, what: string) => {
    total++;
    if (!ok) failures.push(what);
  };
  if (!c) return { passed: 0, total: 1, failures: ['no design was produced'] };
  const plan = c.plan;
  const rooms = plan.rooms.filter(
    (r) => !r.void && r.type !== 'stair' && r.type !== 'corridor' && r.type !== 'outdoor',
  );
  const has = (token: string) =>
    (ROOM_TYPES as readonly string[]).includes(token)
      ? rooms.some((r) => r.type === token)
      : rooms.some((r) => key(r.name).includes(key(token)));
  const roomsOf = (token: string) =>
    (ROOM_TYPES as readonly string[]).includes(token)
      ? rooms.filter((r) => r.type === token)
      : rooms.filter((r) => key(r.name).includes(key(token)));
  if (e.levels !== undefined)
    need(plan.levelNames.length === e.levels, `${e.levels} levels (got ${plan.levelNames.length})`);
  if (e.bedrooms !== undefined) {
    const n = regularBedrooms(rooms).length;
    need(n === e.bedrooms, `${e.bedrooms} bedrooms (got ${n})`);
  }
  for (const r of e.rooms ?? []) need(has(r), `has ${r}`);
  for (const r of e.absent ?? []) need(!has(r), `no ${r}`);
  for (const r of e.ground ?? [])
    need(
      roomsOf(r).some((x) => x.level === 0),
      `${r} on the ground floor`,
    );
  for (const f of e.features ?? [])
    need(plan.site?.zones.some((z) => z.type === f) ?? false, `${f} on the plot`);
  for (const f of e.noFeatures ?? [])
    need(!(plan.site?.zones.some((z) => z.type === f) ?? false), `no ${f}`);
  if (e.cars !== undefined) {
    const n = plan.site?.items.filter((i) => i.catalogId === 'car').length ?? 0;
    need(n >= e.cars, `${e.cars} cars fit (got ${n})`);
  }
  if (e.style !== undefined)
    need(c.brief.style.preset === e.style, `style ${e.style} (got ${c.brief.style.preset})`);
  if (e.budget !== undefined)
    need(c.brief.budget === e.budget, `budget ${e.budget} (got ${c.brief.budget})`);
  return { passed: total - failures.length, total, failures };
}

export interface RunOptions {
  provider?: LLMProvider | null;
  solve?: SolveEnv['solve'];
}

/** The brief a scenario starts from, and how many turns the person needed to get it. */
async function briefFor(
  sc: Scenario,
  o: RunOptions,
): Promise<{ brief: DesignBrief; turns: number; project: Project | null; session?: Session }> {
  const provider = o.provider ?? null;
  switch (sc.kind) {
    case 'text': {
      const r = await generateBrief(sc.text, { provider });
      return { brief: r.brief, turns: 1, project: null };
    }
    case 'interview': {
      const read = sc.text ? textToBrief(sc.text) : null;
      let brief = read?.brief ?? emptyBrief();
      let state = newInterview(read?.known ?? []);
      let turns = sc.text ? 1 : 0;
      for (const a of sc.answers) {
        const q = nextQuestion(state, brief);
        if (!q) break;
        const r = answerQuestion(state, brief, q, a.chips, a.text);
        brief = r.brief;
        state = r.state;
        turns++;
      }
      return { brief: ensureProgram(brief), turns, project: null };
    }
    case 'sketch': {
      const project = projectFromConfig(defaultConfig());
      const shell = largestInnerRect(project.shell.footprint).rect;
      return { brief: sketchToBrief(sc.boxes, shell).brief, turns: 1, project };
    }
    case 'like': {
      const sample = createSampleProject();
      const base =
        sc.base === 'reference'
          ? baseBrief('reference')
          : sc.base === 'project'
            ? baseBrief('project', { project: sample })
            : baseBrief('template', { templateId: sc.base });
      return {
        brief: likeThisBut(base, sc.request).brief,
        turns: 1,
        project: sc.base === 'project' ? sample : null,
      };
    }
    case 'refine': {
      const r = await generateBrief(sc.text, { provider });
      return { brief: r.brief, turns: 2, project: null };
    }
  }
}

/** Runs one scenario end to end the way the app does (brief → three checked layouts → refinement) and scores it. */
export async function runScenario(sc: Scenario, o: RunOptions = {}): Promise<ScenarioResult> {
  const t0 = performance.now();
  const solve = o.solve ?? (async (input, count) => solveCandidates(input, count));
  const start = await briefFor(sc, o);
  const brief = start.brief;
  const turns = start.turns;
  const project = chooseProject(
    brief,
    start.project ?? projectForBrief({ ...brief, features: [], kind: 'duplex' }),
  ).project;
  const env: SolveEnv = { project, solve };
  let proposal = await designFromBrief(brief, env);
  if (sc.kind === 'refine') {
    const session = newSession(brief);
    session.proposal = proposal;
    const r = await runTurn(sc.command, session, { ...env, provider: o.provider ?? null });
    if (r.session.proposal) proposal = r.session.proposal;
  }
  const check = checkExpect(sc.expect, proposal);
  const best = proposal.candidates[0];
  const brf = best ? adherence(best.brief, best.plan) : { score: 0, checks: [] };
  const expectation = check.total ? check.passed / check.total : 1;
  return {
    id: sc.id,
    kind: sc.kind,
    ms: performance.now() - t0,
    expectation,
    brief: brf.score,
    adherence: (expectation + brf.score) / 2,
    hardFailures: best?.issues.length ?? 1,
    issues: (best?.issues ?? []).map((i) => `${i.rule}: ${i.message}`),
    fixRounds: proposal.fixRounds,
    turns,
    failures: [...check.failures, ...brf.checks.filter((c) => !c.ok).map((c) => c.text)],
  };
}
