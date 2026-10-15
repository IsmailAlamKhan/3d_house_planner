import { describe, expect, it, vi } from 'vitest';

// Designing runs the layout search (seconds, not milliseconds), more so when the whole suite is running.
vi.setConfig({ testTimeout: 90_000 });
import { solveCandidates } from '../ai/layout/solve';
import type { LLMProvider } from '../ai/provider';
import { createSampleProject } from '../model/sample';
import { adherence } from './adherence';
import { Toolbox, newSession, runTurn } from './agent';
import {
  applyBriefOps,
  briefToIntent,
  hintsByName,
  projectToBrief,
  regularBedrooms,
} from './brief';
import { CHAT_CHIPS, parseCommand, roomTypeOfLabel } from './commands';
import {
  areaScaleFor,
  chooseProject,
  designFromBrief,
  projectForBrief,
  projectIsBlank,
  shellFits,
  suggestShell,
} from './design';
import { QUESTIONS, answer, newInterview, nextQuestion } from './interview';
import { baseBrief, likeThisBut, referenceBrief } from './likeThis';
import { generateBrief, reconcile } from './llm';
import { dominantColors, moodFromImages, styleFromPalette } from './mood';
import { ensureProgram, fitProgramToSize } from './program';
import { SCENARIOS } from './scenarios';
import { sketchToBrief } from './sketch';
import { STYLE_PRESETS, finishes } from './styles';
import { textToBrief, toEnglish } from './text';
import { encodeWav, resample } from './voice';
import { runScenario } from './evalRun';
import { largestInnerRect } from '../ai/layout/rect';

const solve = async (i: Parameters<typeof solveCandidates>[0], n: number) => solveCandidates(i, n);

describe('reading words into a brief', () => {
  it('reads English: levels, bedrooms, features, style, budget', () => {
    const { brief, known } = textToBrief(
      'luxury villa with pool, garden, 2-car garage, gym and sauna',
    );
    expect(brief.kind).toBe('villa');
    expect(brief.features.map((f) => f.type)).toEqual(
      expect.arrayContaining(['pool', 'garden', 'parking']),
    );
    expect(brief.cars).toBe(2);
    expect(brief.program.map((r) => r.type)).toEqual(expect.arrayContaining(['gym', 'sauna']));
    expect(brief.budget).toBe('luxury');
    expect(brief.style.preset).toBe('modern-luxury');
    expect(known).toEqual(expect.arrayContaining(['features', 'style', 'budget']));
  });

  it('puts a room for parents on the ground floor, with its bathroom', () => {
    const { brief } = textToBrief('3 bedroom duplex with a room for my mother downstairs');
    const intent = briefToIntent(brief);
    expect(intent.levels).toHaveLength(2);
    const ground = intent.levels[0]!.rooms.map((r) => r.name);
    expect(ground).toContain('Parents room');
    expect(intent.levels[1]!.rooms.filter((r) => r.type === 'bedroom')).toHaveLength(3);
    expect(regularBedrooms(brief.program)).toHaveLength(3);
  });

  it('reads Bengali the same way as the English words', () => {
    expect(toEnglish('৪ বেডরুমের ভিলা সুইমিং পুল ও বাগান সহ')).toContain('4 bedroom');
    const bn = textToBrief('৪ বেডরুমের ভিলা সুইমিং পুল ও বাগান সহ');
    const en = textToBrief('4 bedroom villa with a pool and a garden');
    expect(bn.brief.language).toBe('bn');
    expect(bn.brief.program.map((r) => r.name)).toEqual(en.brief.program.map((r) => r.name));
    expect(bn.brief.features.map((f) => f.type).sort()).toEqual(
      en.brief.features.map((f) => f.type).sort(),
    );
    expect(textToBrief('পার্কিং সহ ডুপ্লেক্স বাড়ি, ২টি গাড়ি').brief.cars).toBe(2);
  });

  it('writes down what it assumed', () => {
    const { brief } = textToBrief('duplex');
    expect(brief.assumptions.map((a) => a.key)).toEqual(
      expect.arrayContaining(['bedrooms', 'budget']),
    );
  });

  it('reads a plot size in feet', () => {
    expect(textToBrief('villa on a 40 x 60 ft plot').brief.size).toMatchObject({ of: 'plot' });
  });
});

describe('editing the brief', () => {
  it('sets the number of bedrooms, with their bathrooms, and takes them away again', () => {
    const { brief } = textToBrief('2 bedroom duplex');
    const more = applyBriefOps(brief, [{ op: 'setBedrooms', count: 4 }]).brief;
    expect(regularBedrooms(more.program)).toHaveLength(4);
    const fewer = applyBriefOps(more, [{ op: 'setBedrooms', count: 3 }]).brief;
    expect(regularBedrooms(fewer.program)).toHaveLength(3);
    expect(fewer.program.filter((r) => r.type === 'bathroom').length).toBeLessThan(
      more.program.filter((r) => r.type === 'bathroom').length + 1,
    );
  });

  it('lock, hint and remove keep the references straight', () => {
    const b = referenceBrief();
    const gym = b.program.find((r) => r.type === 'gym')!;
    const out = applyBriefOps(b, [
      { op: 'lockRoom', room: gym.id, locked: true },
      { op: 'setHint', room: 'Gym', at: { x: 3, y: 4 } },
      { op: 'removeRoom', room: 'Sauna' },
    ]).brief;
    expect(out.program.find((r) => r.id === gym.id)!.locked).toBe(true);
    expect(hintsByName(out)).toEqual({ Gym: { x: 3, y: 4 } });
    expect(out.program.some((r) => r.type === 'sauna')).toBe(false);
  });

  it('makes a smaller pool', () => {
    const b = referenceBrief();
    const out = applyBriefOps(b, [{ op: 'resizeFeature', type: 'pool', factor: 0.75 }]).brief;
    expect(out.features.find((f) => f.type === 'pool')!.size).toBeCloseTo(0.75);
    expect(briefToIntent(out).site!.zones.find((z) => z.type === 'pool')!.scale).toBeCloseTo(0.75);
  });

  it('turns a project back into a brief', () => {
    const b = projectToBrief(createSampleProject());
    expect(b.levels).toBe(2);
    expect(b.program.length).toBeGreaterThan(4);
  });
});

describe('change requests', () => {
  const ref = referenceBrief();
  it('reads several wishes in one sentence', () => {
    const c = parseCommand('2 storeys, 4 bedrooms, no gaming room, smaller pool', ref);
    expect(c.ops).toEqual(
      expect.arrayContaining([
        { op: 'setLevels', levels: 2 },
        { op: 'setBedrooms', count: 4, ensuite: undefined },
        { op: 'removeRoom', room: 'Gaming room' },
        { op: 'resizeFeature', type: 'pool', factor: 0.75 },
      ]),
    );
  });
  it('carries "remove" over to the next room in a list', () => {
    expect(
      parseCommand('remove the gym and sauna', ref).ops.map(
        (o) => o.op + (o.op === 'removeRoom' ? o.room : ''),
      ),
    ).toEqual(['removeRoomGym', 'removeRoomSauna']);
  });
  it('understands vague wishes, budget and points at things', () => {
    expect(parseCommand('make it cheaper', ref).ops).toEqual(
      expect.arrayContaining([{ op: 'setBudget', budget: 'mid' }]),
    );
    expect(parseCommand('more light in the bedrooms', ref).emphasis).toEqual({ daylight: 3 });
    const sel = parseCommand('make this bigger', ref, 'Kitchen');
    expect(sel.ops[0]).toMatchObject({ op: 'resizeRoom', room: 'Kitchen' });
    expect(parseCommand('xyzzy', ref).unknown).toBe(true);
  });
  it('knows a room for a mother is on the ground floor with its own bath', () => {
    const c = parseCommand(
      'add a room for my mother on the ground floor with its own bathroom',
      ref,
    );
    expect(c.ops[0]).toMatchObject({ op: 'addRoom', type: 'bedroom', level: 0 });
    expect(c.ops[1]).toMatchObject({ op: 'addRoom', type: 'bathroom', level: 0 });
  });
  it('every chip is understood', () => {
    for (const c of CHAT_CHIPS) expect(parseCommand(c.request, ref).unknown).toBe(false);
  });
  it('names sketch labels', () => {
    expect(roomTypeOfLabel('Master BR')).toBe('bedroom');
    expect(roomTypeOfLabel('Living')).toBe('living');
    expect(roomTypeOfLabel('WC')).toBe('bathroom');
  });
});

describe('interview', () => {
  it('skips what was already said and ends within a handful of taps', () => {
    const read = textToBrief('a 2 level villa for a family with a pool, modern style, high budget');
    let state = newInterview(read.known);
    let brief = read.brief;
    let asked = 0;
    for (let q = nextQuestion(state, brief); q; q = nextQuestion(state, brief)) {
      expect(['levels', 'household', 'features', 'style', 'budget']).not.toContain(q.id);
      const r = answer(
        state,
        brief,
        q,
        q.chips.slice(0, 1).map((c) => c.id),
      );
      state = r.state;
      brief = r.brief;
      asked++;
    }
    expect(asked).toBeLessThanOrEqual(QUESTIONS.length - 4);
  });
  it('a chip changes the brief, a size picks the bedrooms of a home that did not say', () => {
    const read = textToBrief('a house');
    const q = QUESTIONS.find((x) => x.id === 'size')!;
    const r = answer(newInterview(), read.brief, q, ['large']);
    expect(r.brief.size).toMatchObject({ width: 16, depth: 18 });
    expect(regularBedrooms(r.brief.program).length).toBeGreaterThanOrEqual(4);
  });
  it('a home made of chips gets the rooms every home needs', () => {
    const b = ensureProgram(applyBriefOps(textToBrief('x').brief, []).brief);
    expect(b.program.map((r) => r.type)).toEqual(
      expect.arrayContaining(['living', 'kitchen', 'dining']),
    );
    expect(ensureProgram(b)).toBe(b);
    expect(fitProgramToSize(b)).toBe(b);
  });
});

describe('designing from a brief', () => {
  it('gives three checked, different layouts for a villa, the best one without failed checks', async () => {
    const { brief } = textToBrief('I want a 4-bedroom villa with a pool for my family');
    const project = projectForBrief(brief);
    expect(projectIsBlank(project)).toBe(true);
    const p = await designFromBrief(brief, { project, solve });
    expect(p.candidates).toHaveLength(3);
    expect(p.candidates[0]!.issues).toEqual([]);
    expect(p.candidates[0]!.adherence).toBeGreaterThan(0.9);
    expect(p.candidates[0]!.plan.site!.zones.some((z) => z.type === 'pool')).toBe(true);
  });

  it('keeps a dragged bubble nearer where it was dropped', async () => {
    const { brief } = textToBrief('3 bedroom villa');
    const project = projectForBrief(brief);
    const shell = largestInnerRect(project.shell.footprint).rect;
    const gym = applyBriefOps(brief, [{ op: 'addRoom', type: 'gym', name: 'Gym' }]).brief;
    const dist = async (x: number) => {
      const b = applyBriefOps(gym, [
        {
          op: 'setHint',
          room: 'Gym',
          at: { x: shell.x + shell.w * x, y: shell.y + shell.h * 0.5 },
        },
      ]).brief;
      const p = await designFromBrief(b, { project, solve }, { count: 1 });
      const r = p.candidates[0]!.plan.rooms.find((q) => q.name === 'Gym')!;
      return r.rect.x + r.rect.w / 2 - shell.x;
    };
    expect(await dist(0.1)).toBeLessThan(await dist(0.9));
  });

  it('puts a project with no plot into a new villa project when the brief needs a plot', () => {
    const { brief } = textToBrief('villa with pool and 2 car parking');
    const chosen = chooseProject(brief, createSampleProject());
    expect(chosen.created).toBe('plot');
    expect(chosen.project.kind).toBe('villa');
    expect(
      chooseProject(textToBrief('2 bedroom duplex').brief, createSampleProject()).created,
    ).toBe(null);
  });

  it('sizes the shell from the rooms and scales rooms to fill a given shell', () => {
    const { brief } = textToBrief('4 bedroom duplex');
    const cfg = suggestShell(brief);
    expect(cfg.width * cfg.depth * 2).toBeGreaterThan(
      brief.program.reduce((s, r) => s + r.area, 0),
    );
    const project = projectForBrief(brief);
    expect(shellFits(brief, project)).toBe(true);
    expect(areaScaleFor(brief, project)).toBeGreaterThan(0.7);
    expect(areaScaleFor(brief, project)).toBeLessThan(1.5);
  });

  it('fixes its own failed checks (the entrance must stay clear)', async () => {
    const project = projectForBrief(textToBrief('2 bedroom duplex').brief);
    const shell = largestInnerRect(project.shell.footprint).rect;
    const boxes = [
      { name: 'Kitchen', x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { name: 'Living', x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
      { name: 'Bedroom', x: 0, y: 0, w: 0.5, h: 0.5 },
      { name: 'Bath', x: 0.5, y: 0, w: 0.5, h: 0.5 },
    ];
    const { brief } = sketchToBrief(boxes, shell);
    const p = await designFromBrief(brief, { project, solve });
    expect(p.candidates[0]!.issues).toEqual([]);
  });
});

describe('start options', () => {
  it('a sketch keeps the arrangement as placement hints and proportions as areas', () => {
    const shell = { x: 0, y: 0, w: 10, h: 12 };
    const { brief } = sketchToBrief(
      [
        { name: 'Living', x: 0, y: 0.5, w: 1, h: 0.5 },
        { name: 'Master BR', x: 0, y: 0, w: 0.5, h: 0.5 },
        { name: 'Kitchen', x: 0.5, y: 0, w: 0.5, h: 0.5 },
      ],
      shell,
    );
    const hints = hintsByName(briefToIntentProgram(brief));
    expect(hints.Living!.y).toBeGreaterThan(hints.Kitchen!.y);
    expect(hints['Master BR']!.x).toBeLessThan(hints.Kitchen!.x);
    const living = brief.program.find((r) => r.name === 'Living')!;
    expect(living.area).toBeGreaterThan(
      brief.program.find((r) => r.name === 'Kitchen')!.area * 1.5,
    );
    expect(brief.program.some((r) => r.type === 'bathroom')).toBe(true);
  });

  it('"like the reference villa but 2 storeys and 4 bedrooms" keeps its outdoor features and style', () => {
    const r = likeThisBut(
      baseBrief('reference'),
      'but 2 storeys, 4 bedrooms, no gaming room, smaller pool',
    );
    expect(r.brief.levels).toBe(2);
    expect(regularBedrooms(r.brief.program)).toHaveLength(4);
    expect(r.brief.program.some((x) => x.type === 'game-room')).toBe(false);
    expect(r.brief.features.map((f) => f.type)).toEqual(
      expect.arrayContaining(['pool', 'parking', 'garden', 'patio']),
    );
    expect(r.brief.style.preset).toBe('modern-luxury');
    expect(r.brief.cars).toBe(2);
  });

  it('mood pictures: colours decide the style when there is no vision model; a model can read more', async () => {
    const green = new Array(400).fill(0).flatMap(() => [60, 160, 90, 255]);
    expect(styleFromPalette(dominantColors(green))).toBe('tropical');
    const dark = new Array(400).fill(0).flatMap(() => [60, 60, 62, 255]);
    expect(styleFromPalette(dominantColors(dark))).toBe('industrial');
    const r = await moodFromImages([], [dominantColors(green)], { client: null });
    expect(r.source).toBe('colours');
    expect(r.ops[0]).toMatchObject({ op: 'setStyle', preset: 'tropical' });
    const fake = {
      ask: async () =>
        JSON.stringify({
          style: 'classic',
          keywords: ['oak floor'],
          palette: ['#c8a165'],
          materials: ['oak'],
          features: ['courtyard'],
        }),
    };
    const m = await moodFromImages(['x'], [], { client: fake });
    expect(m.source).toBe('model');
    expect(applyBriefOps(textToBrief('villa').brief, m.ops).brief.style.preset).toBe('classic');
  });
});

describe('the agent', () => {
  const env = (project = projectForBrief(textToBrief('3 bedroom villa').brief)) => ({
    project,
    solve,
    provider: null,
  });

  it('without a model, a request becomes brief edits and new checked layouts', async () => {
    const { brief } = textToBrief('3 bedroom villa with garden');
    const session = newSession(brief);
    const r = await runTurn('add a pool', session, env());
    expect(r.session.brief.features.some((f) => f.type === 'pool')).toBe(true);
    expect(r.session.proposal!.candidates.length).toBe(3);
    expect(r.source).toBe('offline');
  });

  it('a geometry request goes to the edit pipeline, an unclear one becomes a question', async () => {
    const { brief } = textToBrief('3 bedroom villa');
    expect((await runTurn('rotate the sofa', newSession(brief), env())).session.editRequest).toBe(
      'rotate the sofa',
    );
    const q = await runTurn('xyzzy', newSession(brief), env());
    expect(q.session.pending?.question).toBe('unknown');
  });

  it('with a model it drives the tools and never edits geometry itself', async () => {
    const script = [
      { tool: 'update_brief', args: { ops: [{ op: 'addFeature', type: 'pool' }] } },
      { tool: 'generate_candidates', args: {} },
      { tool: 'get_scores', args: {} },
      { final: 'Added a pool and made three layouts.' },
    ];
    let i = 0;
    const calls: string[] = [];
    const provider: LLMProvider = {
      id: 'ollama',
      async generate(req) {
        calls.push(req.messages[req.messages.length - 1]!.content.slice(0, 40));
        return JSON.stringify(script[Math.min(i++, script.length - 1)]);
      },
    };
    const { brief } = textToBrief('3 bedroom villa');
    const r = await runTurn('please add a pool', newSession(brief), { ...env(), provider });
    expect(r.source).toBe('model');
    expect(r.reply).toBe('Added a pool and made three layouts.');
    expect(r.session.brief.features.some((f) => f.type === 'pool')).toBe(true);
    expect(r.session.proposal?.candidates.length).toBe(3);
    expect(calls.some((c) => c.startsWith('RESULT:'))).toBe(true);
  });

  it('falls back to the keyword reader when the model answers nonsense', async () => {
    const provider: LLMProvider = { id: 'ollama', generate: async () => 'not json at all' };
    const { brief } = textToBrief('3 bedroom villa');
    const r = await runTurn(
      'bigger kitchen',
      newSession(brief),
      { ...env(), provider },
      { maxSteps: 2 },
    );
    expect(r.session.proposal).not.toBeNull();
  });

  it('tools refuse bad input and ask_user stops the turn', async () => {
    const { brief } = textToBrief('3 bedroom villa');
    const tools = new Toolbox(newSession(brief), env());
    expect((await tools.call('update_brief', { ops: [{ op: 'explode' }] })).ok).toBe(false);
    expect((await tools.call('apply_candidate', { id: 'nope' })).ok).toBe(false);
    expect((await tools.call('set_lighting_preset', { mode: 'midnight' })).ok).toBe(false);
    expect(
      (await tools.call('ask_user', { question: 'Garden at the back?', chips: ['yes', 'no'] })).ok,
    ).toBe(true);
    expect(tools.session.pending!.chips).toEqual(['yes', 'no']);
    await tools.call('generate_candidates');
    expect((await tools.call('render_preview', { level: 0 })).text).toContain('<svg');
    expect((await tools.call('place_items', { room: 'Living room', items: ['plant'] })).ok).toBe(
      true,
    );
    expect((await tools.call('set_materials', { style: 'tropical' })).ok).toBe(true);
  });

  it('a model brief is held to what the words say', async () => {
    const provider: LLMProvider = {
      id: 'ollama',
      generate: async () =>
        JSON.stringify({
          language: 'en',
          levels: 1,
          kind: 'duplex',
          rooms: [
            { type: 'living', name: 'Living', area: 25 },
            { type: 'kitchen', name: 'Kitchen', area: 12 },
          ],
          features: [],
          cars: 0,
          budget: 'mid',
          priorities: [],
        }),
    };
    const r = await generateBrief('4 bedroom villa with a pool, 2 car garage, gym', { provider });
    expect(r.source).toBe('model');
    expect(regularBedrooms(r.brief.program)).toHaveLength(4);
    expect(r.brief.features.map((f) => f.type)).toEqual(
      expect.arrayContaining(['pool', 'parking']),
    );
    expect(r.brief.program.some((x) => x.type === 'gym')).toBe(true);
    expect(
      reconcile(r.brief, textToBrief('4 bedroom villa with a pool').brief).program.length,
    ).toBe(r.brief.program.length);
  });
});

describe('style, voice, scenarios', () => {
  it('low budgets drop marble for tile and every style has finishes', () => {
    for (const s of STYLE_PRESETS) expect(finishes(s, 'mid').floor).toBeTruthy();
    expect(
      finishes(
        STYLE_PRESETS.find((s) => s.id === 'modern-luxury')!,
        'low',
      ).floor,
    ).toBe('tile-grey');
  });
  it('makes a 16 kHz mono WAV for the speech service', () => {
    const wav = new DataView(encodeWav(new Float32Array(1600).fill(0.5)));
    expect(
      String.fromCharCode(wav.getUint8(0), wav.getUint8(1), wav.getUint8(2), wav.getUint8(3)),
    ).toBe('RIFF');
    expect(wav.getUint32(24, true)).toBe(16000);
    expect(wav.byteLength).toBe(44 + 3200);
    expect(resample(new Float32Array(48000), 48000).length).toBe(16000);
  });
  it('the evaluation has 40 scenarios in the five kinds', () => {
    expect(SCENARIOS).toHaveLength(40);
    expect(new Set(SCENARIOS.map((s) => s.kind))).toEqual(
      new Set(['text', 'interview', 'sketch', 'like', 'refine']),
    );
    expect(SCENARIOS.filter((s) => s.kind === 'text' && s.note === 'Bengali')).toHaveLength(4);
  });
  it('runs scenarios end to end with high adherence and no failed checks', async () => {
    for (const id of ['t-mother', 'b-duplex', 's-six', 'r-pool']) {
      const r = await runScenario(SCENARIOS.find((s) => s.id === id)!);
      expect(r.adherence).toBeGreaterThanOrEqual(0.9);
      expect(r.hardFailures).toBe(0);
    }
  });
  it('adherence reports a missing room', async () => {
    const { brief } = textToBrief('3 bedroom duplex');
    const p = await designFromBrief(
      brief,
      { project: projectForBrief(brief), solve },
      { count: 1 },
    );
    const wrong = applyBriefOps(brief, [{ op: 'addRoom', type: 'sauna' }]).brief;
    const r = adherence(wrong, p.candidates[0]!.plan);
    expect(r.checks.find((c) => c.text.includes('missing'))).toBeTruthy();
    expect(r.score).toBeLessThan(1);
  });
});

/** The brief's hints need rooms on levels: reuse the brief as is. */
function briefToIntentProgram<T>(b: T): T {
  return b;
}
