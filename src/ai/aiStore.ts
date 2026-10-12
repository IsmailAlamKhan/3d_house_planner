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
import { applyPlan } from './layout/apply';
import type { LayoutPlan } from './layout/plan';
import { largestInnerRect } from './layout/rect';
import { solveLayout } from './layout/solve';
import { AiOutputError, type AiSource, generateIntent, interpretEdit } from './pipeline';
import { currentSettings } from './provider';
import type { DesignIntent, EditOperation } from './schemas';

export type AiMode = 'generate' | 'edit';

export interface Candidate {
  id: string;
  intent: DesignIntent;
  plan: LayoutPlan;
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
    shell: { width: rect.w, depth: rect.h },
    solver: {
      footprint: project.shell.footprint,
      entrance: project.shell.entrance,
      plumbing: project.shell.fixedPlumbingPoints,
      columns: project.columns
        .filter((c) => c.levelId === levels)
        .map((c) => ({ position: c.position, size: c.size })),
      maxHeight: project.shell.maxHeight,
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
        const plan = solveLayout({ intent, ...solver, seed: i + 1 });
        const candidate: Candidate = {
          id: `c${++counter}`,
          intent,
          plan,
          source: r.source,
          notes: r.notes,
          fellBack: r.fellBack,
        };
        set((s) => ({ candidates: [...s.candidates, candidate] }));
      }
    } catch (e) {
      if (!controller.signal.aborted) set({ error: message(e) });
    } finally {
      set({ busy: false, startedAt: null, controller: null, progress: null });
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
      const result = useModel.getState().apply((p) => applyPlan(p, c.plan, c.intent.style));
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
