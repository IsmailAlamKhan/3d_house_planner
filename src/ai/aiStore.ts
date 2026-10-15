import type { AiProgress } from './provider';
import { produce } from 'immer';
import { create } from 'zustand';
import { t } from '../i18n';
import { ModelError } from '../model/ops';
import { useModel } from '../model/store';
import type { Project } from '../model/types';
import { describeChanges } from './edit/diff';
import { applyEditOps } from './edit/apply';
import { EditError } from './edit/lookup';
import { autoDecorateProject } from '../present/decorate';
import { applyPlan } from './layout/apply';
import type { LayoutPlan } from './layout/plan';
import { largestInnerRect } from './layout/rect';
import { solveInWorker } from './layout/client';
import { mergeEmphasis, parseImprove } from './layout/improve';
import { type SolveInput, planDistance } from './layout/solve';
import type { Emphasis } from './layout/weights';
import { AiOutputError, type AiSource, generateIntent, interpretEdit } from './pipeline';
import { currentSettings } from './provider';
import type { DesignIntent, EditOperation } from './schemas';

export type AiMode = 'generate' | 'edit';

export interface Candidate {
  id: string;
  intent: DesignIntent;
  plan: LayoutPlan;
  /** Everything the layout engine was given, so the plan can be re-solved with what the person asks to improve. */
  solve: SolveInput;
  /** What was asked to improve so far (multipliers on score terms). */
  emphasis?: Emphasis;
  /** True while an "improve" request is being solved. */
  improving?: boolean;
  source: AiSource;
  /** What was understood / why the offline generator was used. */
  notes: string[];
  fellBack?: 'unreachable' | 'invalid';
}

export interface EditPreview {
  command: string;
  operations: EditOperation[];
  summary?: string;
  changes: string[];
  source: AiSource;
  notes: string[];
  /** Set when the command cannot be carried out (nothing is changed). */
  error?: string;
}

interface AiState {
  mode: AiMode;
  input: string;
  furnish: boolean;
  busy: boolean;
  startedAt: number | null;
  /** Where the running request is: waiting its turn on the server, or the model is writing. */
  progress: AiProgress | null;
  /** Message shown after the last successful apply. */
  done: string | null;
  error: string | null;
  candidates: Candidate[];
  preview: EditPreview | null;
  controller: AbortController | null;
  setMode: (m: AiMode) => void;
  setInput: (s: string) => void;
  setFurnish: (b: boolean) => void;
  generate: (variations: number) => Promise<void>;
  runEdit: () => Promise<void>;
  cancel: () => void;
  /** Re-solves one candidate with a request such as "more daylight" or a quick-choice emphasis. */
  improve: (id: string, request: string | Emphasis) => Promise<void>;
  applyCandidate: (id: string) => void;
  discardCandidate: (id: string) => void;
  applyEdit: () => void;
  discardEdit: () => void;
}

let counter = 0;

/** The usable rectangle of the shell and what the solver needs to know about it. */
function shellInputs(project: Project) {
  const { rect } = largestInnerRect(project.shell.footprint);
  const levels = project.levels[0]?.id;
  return {
    shell: { width: rect.w, depth: rect.h, villa: project.kind === 'villa' },
    solver: {
      footprint: project.shell.footprint,
      entrance: project.shell.entrance,
      plumbing: project.shell.fixedPlumbingPoints,
      columns: project.columns
        .filter((c) => c.levelId === levels)
        .map((c) => ({ position: c.position, size: c.size })),
      maxHeight: project.shell.maxHeight,
      plot: project.kind === 'villa' ? project.site.plot : undefined,
    },
  };
}

const message = (e: unknown): string =>
  e instanceof AiOutputError || e instanceof EditError || e instanceof ModelError
    ? e.message
    : e instanceof Error
      ? e.message
      : String(e);

export const useAi = create<AiState>((set, get) => ({
  mode: 'generate',
  input: '',
  furnish: true,
  busy: false,
  startedAt: null,
  progress: null,
  done: null,
  error: null,
  candidates: [],
  preview: null,
  controller: null,

  setMode: (mode) => set({ mode, error: null }),
  setInput: (input) => set({ input }),
  setFurnish: (furnish) => set({ furnish }),

  cancel: () => {
    get().controller?.abort();
  },

  generate: async (variations) => {
    if (get().busy) return;
    const controller = new AbortController();
    set({
      busy: true,
      startedAt: Date.now(),
      error: null,
      done: null,
      candidates: [],
      preview: null,
      controller,
    });
    const project = useModel.getState().project;
    const { shell, solver } = shellInputs(project);
    const brief = get().input;
    const settings = currentSettings();
    let useModelAgain = true;
    const spare: Candidate[] = [];
    try {
      for (let i = 0; i < variations; i++) {
        // After the model failed once, don't make the user wait for it again on the remaining variations.
        const r = await generateIntent(brief, {
          settings,
          shell,
          signal: controller.signal,
          onProgress: (p) => set({ progress: p }),
          variation: i,
          provider: useModelAgain ? undefined : null,
        });
        if (r.fellBack) useModelAgain = false;
        const intent = { ...r.intent, furnish: get().furnish };
        // Every intent gives its best distinct plans; plans are added until the wanted number is reached.
        const plans = await solveInWorker(
          { intent, ...solver, seed: i * 5 + 1 },
          Math.min(3, variations),
          controller.signal,
        );
        // A new design contributes its best plan; its other plans are kept in reserve for when the designs repeat.
        const same = JSON.stringify(intent);
        const fresh = !get().candidates.some((c) => JSON.stringify(c.intent) === same);
        plans.forEach((plan, k) => {
          const candidate: Candidate = {
            id: `c${++counter}`,
            intent,
            plan,
            solve: { intent, ...solver, seed: i * 5 + 1 },
            source: r.source,
            notes: r.notes,
            fellBack: r.fellBack,
          };
          if (k === 0 && fresh && get().candidates.length < variations)
            set((st) => ({ candidates: [...st.candidates, candidate] }));
          else spare.push(candidate);
        });
      }
      // Repeated designs: fill up with the reserve plans that are clearly unlike what is already shown.
      for (const c of spare) {
        if (get().candidates.length >= variations) break;
        if (get().candidates.some((x) => planDistance(x.plan, c.plan) < 0.3)) continue;
        set((st) => ({ candidates: [...st.candidates, c] }));
      }
    } catch (e) {
      if (!controller.signal.aborted) set({ error: message(e) });
    } finally {
      set({ busy: false, startedAt: null, controller: null, progress: null });
    }
  },

  improve: async (id, request) => {
    const c = get().candidates.find((x) => x.id === id);
    if (!c || get().busy || c.improving) return;
    const asked = typeof request === 'string' ? parseImprove(request) : request;
    if (!Object.keys(asked).length) {
      set({ error: t('layout.improve.unknown') });
      return;
    }
    const emphasis = mergeEmphasis(c.emphasis, asked);
    set((st) => ({
      error: null,
      candidates: st.candidates.map((x) => (x.id === id ? { ...x, improving: true } : x)),
    }));
    try {
      const plans = await solveInWorker({ ...c.solve, emphasis, seed: (c.solve.seed ?? 1) + 1 }, 1);
      const plan = plans[0];
      set((st) => ({
        candidates: st.candidates.map((x) =>
          x.id === id && plan
            ? {
                ...x,
                plan,
                emphasis,
                improving: false,
                solve: { ...x.solve, seed: (x.solve.seed ?? 1) + 1, emphasis },
              }
            : x.id === id
              ? { ...x, improving: false }
              : x,
        ),
      }));
    } catch (e) {
      set((st) => ({
        error: message(e),
        candidates: st.candidates.map((x) => (x.id === id ? { ...x, improving: false } : x)),
      }));
    }
  },

  runEdit: async () => {
    if (get().busy) return;
    const controller = new AbortController();
    set({
      busy: true,
      startedAt: Date.now(),
      error: null,
      done: null,
      candidates: [],
      preview: null,
      controller,
    });
    const { project, selection, activeLevelId } = useModel.getState();
    const command = get().input;
    try {
      const r = await interpretEdit(command, {
        settings: currentSettings(),
        project,
        selection,
        activeLevelId,
        signal: controller.signal,
        onProgress: (p) => set({ progress: p }),
      });
      let changes: string[] = [];
      let error: string | undefined;
      try {
        const next = produce(project, (d) => void applyEditOps(d, r.operations, { activeLevelId }));
        changes = describeChanges(project, next);
        if (!changes.length) error = t('ai.edit.nothing');
      } catch (e) {
        error = message(e);
      }
      set({
        preview: {
          command,
          operations: r.operations,
          summary: r.summary,
          changes,
          source: r.source,
          notes: r.notes,
          error,
        },
      });
    } catch (e) {
      if (!controller.signal.aborted) set({ error: message(e) });
    } finally {
      set({ busy: false, startedAt: null, controller: null, progress: null });
    }
  },

  applyCandidate: (id) => {
    const c = get().candidates.find((x) => x.id === id);
    if (!c) return;
    try {
      // One store.apply = one undo step for the whole design.
      const result = useModel.getState().apply((p) => {
        const r = applyPlan(p, c.plan, c.intent.style);
        // A furnished design is also decorated (rugs, art, plants, lamps) in the same undo step.
        if (c.intent.furnish) autoDecorateProject(p);
        return r;
      });
      const first = useModel.getState().project.levels[0];
      if (first) useModel.getState().setActiveLevel(first.id);
      useModel.getState().setSelection({ type: null, ids: [] });
      set({ candidates: [], done: t('ai.done.design'), error: result.warnings[0] ?? null });
    } catch (e) {
      set({ error: message(e) });
    }
  },
  discardCandidate: (id) => set((s) => ({ candidates: s.candidates.filter((c) => c.id !== id) })),

  applyEdit: () => {
    const pv = get().preview;
    if (!pv || pv.error) return;
    try {
      const { activeLevelId } = useModel.getState();
      useModel.getState().apply((p) => applyEditOps(p, pv.operations, { activeLevelId }));
      set({ preview: null, done: t('ai.done.edit'), input: '' });
    } catch (e) {
      set({ error: message(e), preview: null });
    }
  },
  discardEdit: () => set({ preview: null }),
}));
