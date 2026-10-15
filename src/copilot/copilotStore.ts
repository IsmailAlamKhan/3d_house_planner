import { create } from 'zustand';
import type { Rect } from '../ai/layout/plan';
import { largestInnerRect } from '../ai/layout/rect';
import { applyPlan } from '../ai/layout/apply';
import { solveInWorker } from '../ai/layout/client';
import { useAi } from '../ai/aiStore';
import { currentSettings, providerFor } from '../ai/provider';
import { browserVisionClient } from '../ai/vision/client';
import { getLanguage, t as tApp, tIn } from '../i18n';
import { duplicateDesign } from '../model/ops';
import { useModel } from '../model/store';
import type { DesignBrief, Project } from '../model/types';
import { saveProject } from '../persistence/repo';
import { autoDecorateProject } from '../present/decorate';
import { useSceneStore } from '../scene3d/sceneStore';
import { useUiStore } from '../ui/uiStore';
import { type AgentEnv, type Session, newSession, runTurn } from './agent';
import { applyStylePreset } from './applyStyle';
import { type BriefOp, applyBriefOps } from './brief';
import { CHAT_CHIPS } from './commands';
import {
  type ProgressEvent,
  type Proposal,
  type ProposalCandidate,
  designFromBrief,
  chooseProject,
} from './design';
import {
  type InterviewState,
  type Question,
  answer as answerQuestion,
  newInterview,
  nextQuestion,
} from './interview';
import { generateBrief } from './llm';
import { baseBrief, likeThisBut } from './likeThis';
import { type MoodResult, moodFromImages } from './mood';
import { emptyBrief, ensureProgram } from './program';
import { type SketchBox, readSketchPhoto, sketchToBrief } from './sketch';
import type { Known } from './text';
import { textToBrief, understood } from './text';

export type Stage = 'start' | 'interview' | 'brief' | 'results';
export type StartMode = 'describe' | 'sketch' | 'like' | 'mood';

export interface ChatMessage {
  role: 'user' | 'copilot';
  text: string;
  /** Quick answers to a clarifying question. */
  chips?: string[];
}

interface CopilotState {
  stage: Stage;
  startMode: StartMode;
  input: string;
  brief: DesignBrief | null;
  known: Known[];
  interview: InterviewState;
  question: Question | null;
  session: Session | null;
  proposal: Proposal | null;
  chosen: string | null;
  busy: boolean;
  progress: ProgressEvent | null;
  startedAt: number | null;
  /** How long the first design took (ms). */
  firstDesignMs: number | null;
  error: string | null;
  chat: ChatMessage[];
  applied: boolean;
  /** The brief's source of the current design (for "What I assumed"). */
  controller: AbortController | null;

  setInput: (s: string) => void;
  setStartMode: (m: StartMode) => void;
  reset: () => void;
  cancel: () => void;
  /** Describe it: free text (any length, English or Bengali) → brief. */
  describe: (text?: string) => Promise<void>;
  startInterview: () => void;
  answer: (chips: string[], text?: string) => void;
  /** "Skip, just design it": uses what is known and assumes the rest. */
  skipAndDesign: () => Promise<void>;
  fromSketchBoxes: (boxes: SketchBox[]) => Promise<void>;
  fromSketchPhoto: (canvas: HTMLCanvasElement) => Promise<void>;
  fromLike: (base: 'project' | 'reference' | string, request: string) => Promise<void>;
  fromMood: (images: string[], palettes: string[][]) => Promise<MoodResult | null>;
  editBrief: (ops: BriefOp[]) => void;
  setBrief: (b: DesignBrief) => void;
  design: () => Promise<void>;
  choose: (id: string) => void;
  applyChosen: () => void;
  applyStyle: (styleId: string) => void;
  send: (text: string) => Promise<void>;
  chip: (id: string) => Promise<void>;
  makeVersions: (room: string, count: number) => Promise<void>;
}

/** The copilot's words, in the language the person wrote in (the UI language when no brief is open yet). */
const t = (key: Parameters<typeof tApp>[0]): string =>
  tIn(useCopilot.getState().brief?.language ?? getLanguage(), key);

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const envFor = (signal?: AbortSignal, onProgress?: (e: ProgressEvent) => void): AgentEnv => ({
  project: useModel.getState().project,
  solve: (input, count, sig) => solveInWorker(input, count, sig ?? signal),
  provider: providerFor(currentSettings()),
  selection: useModel.getState().selection,
  signal,
  onProgress,
});

export const useCopilot = create<CopilotState>((set, get) => {
  /** Runs `fn` as a busy job with a cancel button and progress. */
  const job = async (fn: (ctl: AbortController) => Promise<void>) => {
    if (get().busy) return;
    const controller = new AbortController();
    set({ busy: true, error: null, controller, startedAt: Date.now(), progress: null });
    try {
      await fn(controller);
    } catch (e) {
      if (!controller.signal.aborted) set({ error: message(e) });
    } finally {
      set({ busy: false, controller: null, progress: null });
    }
  };

  const say = (text: string, chips?: string[]) =>
    set((s) => ({ chat: [...s.chat, { role: 'copilot', text, chips }] }));

  return {
    stage: 'start',
    startMode: 'describe',
    input: '',
    brief: null,
    known: [],
    interview: newInterview(),
    question: null,
    session: null,
    proposal: null,
    chosen: null,
    busy: false,
    progress: null,
    startedAt: null,
    firstDesignMs: null,
    error: null,
    chat: [],
    applied: false,
    controller: null,

    setInput: (input) => set({ input }),
    setStartMode: (startMode) => set({ startMode, error: null }),
    reset: () =>
      set({
        stage: 'start',
        brief: null,
        known: [],
        interview: newInterview(),
        question: null,
        session: null,
        proposal: null,
        chosen: null,
        chat: [],
        applied: false,
        error: null,
        firstDesignMs: null,
      }),
    cancel: () => get().controller?.abort(),

    describe: async (text) => {
      const words = (text ?? get().input).trim();
      if (!words) return;
      await job(async (ctl) => {
        set({ progress: { key: 'reading' } });
        const r = await generateBrief(words, {
          provider: providerFor(currentSettings()),
          signal: ctl.signal,
        });
        set({
          brief: r.brief,
          known: r.known,
          stage: 'brief',
          session: newSession(r.brief),
          proposal: null,
          chat: [{ role: 'user', text: words }],
        });
        say(t('copilot.understood').replace('{what}', understood(r.brief).join(', ')));
      });
    },

    startInterview: () => {
      const text = get().input.trim();
      const read = text ? textToBrief(text) : null;
      const brief = read?.brief ?? emptyBrief();
      const interview = newInterview(read?.known ?? []);
      const question = nextQuestion(interview, brief);
      set({
        brief,
        known: read?.known ?? [],
        interview,
        question,
        stage: question ? 'interview' : 'brief',
        session: newSession(brief),
      });
    },

    answer: (chips, text) => {
      const { brief, interview, question } = get();
      if (!brief || !question) return;
      const r = answerQuestion(interview, brief, question, chips, text);
      const next = nextQuestion(r.state, r.brief);
      // When the questions are done the home gets the rooms every home needs.
      const brief2 = next ? r.brief : ensureProgram(r.brief);
      set({
        brief: brief2,
        interview: r.state,
        question: next,
        stage: next ? 'interview' : 'brief',
        session: newSession(brief2),
      });
    },

    skipAndDesign: async () => {
      const { brief } = get();
      if (!brief) return;
      const full = ensureProgram(brief);
      set({ brief: full, session: newSession(full), question: null, stage: 'brief' });
      await get().design();
    },

    fromSketchBoxes: async (boxes) => {
      const project = useModel.getState().project;
      const shell = shellRect(project);
      const { brief, notes } = sketchToBrief(boxes, shell, { villa: project.kind === 'villa' });
      set({
        brief,
        known: ['rooms', 'levels'],
        stage: 'brief',
        session: newSession(brief),
        chat: [],
      });
      say(t('copilot.sketchRead').replace('{n}', String(brief.program.length)));
      for (const n of notes) say(n);
    },

    fromSketchPhoto: async (canvas) => {
      await job(async (ctl) => {
        set({ progress: { key: 'reading' } });
        const r = await readSketchPhoto(canvas, browserVisionClient(), ctl.signal);
        if (!r.boxes.length) throw new Error(t('copilot.sketchNothing'));
        await get().fromSketchBoxes(r.boxes);
      });
    },

    fromLike: async (base, request) => {
      const project = useModel.getState().project;
      const start =
        base === 'project'
          ? baseBrief('project', { project })
          : base === 'reference'
            ? baseBrief('reference')
            : baseBrief('template', { templateId: base });
      const r = likeThisBut(start, request);
      set({
        brief: r.brief,
        known: ['levels', 'rooms', 'features', 'style', 'budget', 'priorities'],
        stage: 'brief',
        session: newSession(r.brief),
        chat: [{ role: 'user', text: request }],
      });
      say(r.understood ? r.notes.join(' ') || t('copilot.sameAsBase') : t('copilot.likeUnknown'));
    },

    fromMood: async (images, palettes) => {
      let result: MoodResult | null = null;
      await job(async (ctl) => {
        result = await moodFromImages(images, palettes, {
          client: browserVisionClient(),
          signal: ctl.signal,
        });
        const brief = get().brief ?? emptyBrief();
        const next = applyBriefOps(brief, result.ops).brief;
        set({
          brief: next,
          session: newSession(next),
          stage: get().stage === 'start' ? 'brief' : get().stage,
        });
      });
      return result;
    },

    editBrief: (ops) => {
      const { brief } = get();
      if (!brief) return;
      const r = applyBriefOps(brief, ops);
      set({ brief: r.brief, session: newSession(r.brief) });
    },
    setBrief: (brief) => set({ brief, session: newSession(brief) }),

    design: async () => {
      const brief = get().brief;
      if (!brief) return;
      await job(async (ctl) => {
        const t0 = performance.now();
        // A blank project gets a shell that fits the brief (the person can still change it afterwards).
        // The design goes into the current project when it can hold it; otherwise into a new one (the old one is saved).
        const chosen = chooseProject(brief, useModel.getState().project);
        if (chosen.created) {
          await saveProject(useModel.getState().project);
          useModel.getState().loadProject(chosen.project);
          await saveProject(chosen.project);
          say(t(chosen.created === 'plot' ? 'copilot.newPlot' : 'copilot.newShell'));
        }
        const env = envFor(ctl.signal, (e) => set({ progress: e }));
        const proposal = await designFromBrief(brief, env, {
          signal: ctl.signal,
          onProgress: env.onProgress,
        });
        const session = {
          ...(get().session ?? newSession(brief)),
          brief,
          proposal,
          chosen: proposal.candidates[0]?.id,
        };
        set({
          proposal,
          session,
          chosen: proposal.candidates[0]?.id ?? null,
          stage: 'results',
          firstDesignMs: get().firstDesignMs ?? performance.now() - t0,
        });
        const best = proposal.candidates[0];
        say(
          best && best.issues.length === 0
            ? t('copilot.ready').replace('{n}', String(proposal.candidates.length))
            : t('copilot.readyIssues').replace('{n}', String(best?.issues.length ?? 0)),
        );
        if (proposal.fixRounds > 0)
          say(t('copilot.fixed').replace('{n}', String(proposal.fixRounds)));
      });
    },

    choose: (id) => set({ chosen: id }),

    applyChosen: () => {
      const { proposal, chosen } = get();
      const c: ProposalCandidate | undefined =
        proposal?.candidates.find((x) => x.id === chosen) ?? proposal?.candidates[0];
      if (!c) return;
      try {
        // One store.apply = one undo step for the whole design (the brief goes with it).
        useModel.getState().apply((p) => {
          applyPlan(p, c.plan, c.intent.style);
          p.brief = c.brief;
          if (c.intent.furnish) autoDecorateProject(p);
        });
        const first = useModel.getState().project.levels[0];
        if (first) useModel.getState().setActiveLevel(first.id);
        useModel.getState().setSelection({ type: null, ids: [] });
        set({ applied: true, brief: c.brief });
        say(t('copilot.applied'));
      } catch (e) {
        set({ error: message(e) });
      }
    },

    applyStyle: (styleId) => {
      const brief = get().brief;
      if (!brief) return;
      try {
        let lighting: string | undefined;
        useModel.getState().apply((p) => {
          const r = applyStylePreset(p, styleId, brief.budget);
          lighting = r.lighting;
          p.brief = {
            ...(p.brief ?? brief),
            style: {
              ...(p.brief ?? brief).style,
              preset: styleId as DesignBrief['style']['preset'],
            },
          };
        });
        const scene = useSceneStore.getState();
        if (lighting) scene.setPref('lighting', { mode: lighting as 'noon', time: 13 });
        set({
          brief: {
            ...brief,
            style: { ...brief.style, preset: styleId as DesignBrief['style']['preset'] },
          },
        });
        say(t('copilot.styled'));
      } catch (e) {
        set({ error: message(e) });
      }
    },

    send: async (text) => {
      const words = text.trim();
      const { brief } = get();
      if (!words || !brief) return;
      set((s) => ({ chat: [...s.chat, { role: 'user', text: words }] }));
      await job(async (ctl) => {
        const session = get().session ?? newSession(brief);
        session.brief = brief;
        const env = envFor(ctl.signal, (e) => set({ progress: e }));
        const r = await runTurn(words, session, env);
        if (r.session.editRequest) {
          // A geometry edit: the existing edit pipeline previews it (Apply / Discard, one undo).
          useAi.getState().setMode('edit');
          useAi.getState().setInput(r.session.editRequest);
          r.session.editRequest = undefined;
          await useAi.getState().runEdit();
          say(t('copilot.editPreview'));
          return;
        }
        if (r.session.pending) {
          const q = r.session.pending;
          r.session.pending = undefined;
          say(q.question === 'unknown' ? t('copilot.dontKnow') : q.question, q.chips);
          return;
        }
        set({
          brief: r.session.brief,
          session: r.session,
          proposal: r.session.proposal,
          chosen: r.session.chosen ?? null,
          stage: r.session.proposal ? 'results' : get().stage,
        });
        say(r.reply || t('copilot.changed'));
        if (r.session.proposal && r.session.proposal.candidates[0]?.issues.length)
          say(
            t('copilot.readyIssues').replace(
              '{n}',
              String(r.session.proposal.candidates[0].issues.length),
            ),
          );
      });
    },

    chip: async (id) => {
      const c = CHAT_CHIPS.find((x) => x.id === id);
      if (c) await get().send(c.request);
    },

    makeVersions: async (room, count) => {
      const brief = get().brief;
      if (!brief) return;
      await job(async (ctl) => {
        // Keep every other room where it is; ask for different arrangements of this one.
        const locked = applyBriefOps(
          brief,
          brief.program
            .filter((r) => r.name.toLowerCase() !== room.toLowerCase())
            .map((r) => ({ op: 'lockRoom' as const, room: r.name, locked: true })),
        ).brief;
        const env = envFor(ctl.signal, (e) => set({ progress: e }));
        const proposal = await designFromBrief(locked, env, {
          count: count,
          signal: ctl.signal,
          onProgress: env.onProgress,
        });
        const plans = proposal.candidates.slice(0, count);
        const m = useModel.getState();
        for (const c of plans.slice(1)) {
          m.apply((p) => {
            applyPlan(p, c.plan, c.intent.style);
            duplicateDesign(p);
          });
        }
        if (plans[0]) m.apply((p) => void applyPlan(p, plans[0]!.plan, plans[0]!.intent.style));
        useUiStore.getState().setCompareOpen(true);
        say(t('copilot.versions').replace('{n}', String(plans.length)));
      });
    },
  };
});

function shellRect(p: Project): Rect {
  return largestInnerRect(p.shell.footprint).rect;
}
