import { create } from 'zustand';
import { useModel } from '../model/store';
import { usePresent } from '../present/presentStore';
import { visibleLevelIds } from '../present/LabelsOverlay';
import {
  RenderApiError,
  cancelJob,
  deleteResult,
  fetchRenderHealth,
  listResults,
  submitEnhance,
  waitForJob,
} from './api';
import { buildRequest, captureEnhanceInputs, randomSeed } from './enhance';
import {
  type EnhanceParams,
  type JobInfo,
  type RenderHealth,
  type ResultMeta,
  CREATIVITY_RANGE,
} from './protocol';
import { type StylePresetId, buildPrompt } from './promptBuilder';

interface EnhanceState {
  open: boolean;
  health: RenderHealth | null;
  style: StylePresetId;
  prompt: string;
  negative: string;
  creativity: number;
  controlStrength: number;
  steps: number;
  seed: number;
  upscale: boolean;
  useEdges: boolean;
  /** The prompt was written or edited by the user: do not overwrite it when the style changes. */
  promptEdited: boolean;

  busy: boolean;
  phase: 'idle' | 'capturing' | 'waiting';
  job: JobInfo | null;
  error: string | null;
  controller: AbortController | null;

  gallery: ResultMeta[];
  selectedId: string | null;

  setOpen: (open: boolean) => void;
  patch: (p: Partial<EnhanceState>) => void;
  rebuildPrompt: () => void;
  refreshHealth: () => Promise<void>;
  loadGallery: () => Promise<void>;
  start: () => Promise<void>;
  rerun: (id: string) => Promise<void>;
  cancel: () => Promise<void>;
  remove: (id: string) => Promise<void>;
}

function params(s: EnhanceState): EnhanceParams {
  return {
    prompt: s.prompt.trim(),
    negative: s.negative.trim(),
    creativity: Math.min(CREATIVITY_RANGE.max, Math.max(CREATIVITY_RANGE.min, s.creativity)),
    controlStrength: s.controlStrength,
    seed: s.seed,
    steps: s.steps,
    upscale: s.upscale,
    style: s.style,
  };
}

const messageOf = (e: unknown): string =>
  e instanceof RenderApiError || e instanceof Error ? e.message : String(e);

export const useEnhance = create<EnhanceState>((set, get) => ({
  open: false,
  health: null,
  style: 'modern-luxury',
  prompt: '',
  negative: '',
  creativity: CREATIVITY_RANGE.default,
  controlStrength: 0.8,
  steps: 28,
  seed: randomSeed(),
  upscale: false,
  useEdges: true,
  promptEdited: false,
  busy: false,
  phase: 'idle',
  job: null,
  error: null,
  controller: null,
  gallery: [],
  selectedId: null,

  setOpen: (open) => {
    set({ open });
    if (open) {
      if (!get().promptEdited || !get().prompt) get().rebuildPrompt();
      void get().refreshHealth();
      void get().loadGallery();
    }
  },
  patch: (p) => set(p),
  rebuildPrompt: () => {
    const project = useModel.getState().project;
    const present = usePresent.getState();
    const built = buildPrompt({
      project,
      preset: present.preset,
      look: present.look,
      style: get().style,
      levelIds: visibleLevelIds(project),
    });
    set({ prompt: built.prompt, negative: built.negative, promptEdited: false });
  },
  refreshHealth: async () => set({ health: await fetchRenderHealth() }),
  loadGallery: async () => {
    try {
      const gallery = await listResults(useModel.getState().project.id);
      set((s) => ({
        gallery,
        selectedId:
          s.selectedId && gallery.some((g) => g.id === s.selectedId)
            ? s.selectedId
            : (gallery[0]?.id ?? null),
      }));
    } catch {
      set({ gallery: [] });
    }
  },

  start: async () => {
    const s = get();
    if (s.busy) return;
    const controller = new AbortController();
    set({ busy: true, phase: 'capturing', error: null, job: null, controller });
    try {
      const inputs = await captureEnhanceInputs(s.useEdges);
      const { id } = await submitEnhance(buildRequest(params(get()), inputs));
      set({
        phase: 'waiting',
        job: { id, status: 'queued', ahead: 0, gpuBusyWith: null, progress: null },
      });
      const finalJob = await waitForJob(id, (job) => set({ job }), controller.signal);
      if (finalJob.status === 'error') throw new Error(finalJob.error ?? 'The render failed.');
      if (finalJob.status === 'done') {
        await get().loadGallery();
        set({ selectedId: id, seed: randomSeed() });
      }
    } catch (e) {
      if (!(e instanceof RenderApiError && e.status === 499)) set({ error: messageOf(e) });
    } finally {
      set({ busy: false, phase: 'idle', controller: null });
    }
  },

  rerun: async (id) => {
    if (get().busy) return;
    const controller = new AbortController();
    set({ busy: true, phase: 'waiting', error: null, job: null, controller });
    try {
      const res = await fetch(`/api/render/results/${id}/rerun`, { method: 'POST', body: '{}' });
      const body = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
        code?: string;
      };
      if (!res.ok || !body.id)
        throw new RenderApiError(
          body.error ?? 'The render could not be started.',
          res.status,
          body.code,
        );
      const finalJob = await waitForJob(body.id, (job) => set({ job }), controller.signal);
      if (finalJob.status === 'error') throw new Error(finalJob.error ?? 'The render failed.');
      if (finalJob.status === 'done') {
        await get().loadGallery();
        set({ selectedId: body.id });
      }
    } catch (e) {
      if (!(e instanceof RenderApiError && e.status === 499)) set({ error: messageOf(e) });
    } finally {
      set({ busy: false, phase: 'idle', controller: null });
    }
  },

  cancel: async () => {
    const { controller, job } = get();
    controller?.abort();
    if (job && (job.status === 'queued' || job.status === 'running'))
      await cancelJob(job.id).catch(() => undefined);
    set({ busy: false, phase: 'idle', job: null, controller: null });
  },

  remove: async (id) => {
    await deleteResult(id).catch(() => undefined);
    await get().loadGallery();
  },
}));
