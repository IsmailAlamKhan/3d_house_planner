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
import { listStudioResults } from '../studio/api';
import { buildRequest, captureEnhanceInputs, currentLabels, randomSeed } from './enhance';
import { type EnhancePresetId, PRESET_SETTINGS } from './presets';
import { fileStyle, isReferenceProject, referenceStyle } from './styleRef';
import {
  type EnhanceParams,
  type EnhanceRequest,
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
  // ── Enhance v2 ──
  preset: EnhancePresetId;
  /** Where the picture comes from: the latest studio render (default), or the live view. */
  source: 'studio' | 'live';
  /** The style reference: none, the reference villa picture, or an uploaded file. */
  styleRef: 'none' | 'reference' | 'upload';
  styleUpload: string | null;
  ipWeight: number;
  edgeStrength: number;
  regions: boolean;
  tiledUpscale: 0 | 2 | 3;
  checkpoint: string;
  layoutCheck: boolean;
  /** A note about what the last run did (for example that no studio render was found). */
  note: string | null;
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
  applyPreset: (id: EnhancePresetId) => void;
  chooseStyleFile: (file: File) => Promise<void>;
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
    pipeline: PRESET_SETTINGS[s.preset].pipeline,
    preset: s.preset,
    ipWeight: s.styleRef === 'none' ? 0 : s.ipWeight,
    edgeStrength: s.edgeStrength,
    regions: s.regions,
    tiledUpscale: s.tiledUpscale,
    checkpoint: s.checkpoint || undefined,
    layoutCheck: s.layoutCheck,
  };
}

/** The style picture the settings ask for (none, the reference villa picture, or an uploaded one). */
async function styleOf(s: EnhanceState): Promise<string | undefined> {
  if (s.styleRef === 'reference') return referenceStyle();
  if (s.styleRef === 'upload') return s.styleUpload ?? undefined;
  return undefined;
}

/**
 * The v2 request: the latest studio render of the project (its picture, depth and region passes stay on the server, nothing
 * big is sent), or, when there is none, the live view's pictures as before.
 */
async function buildV2Request(s: EnhanceState, p: EnhanceParams): Promise<EnhanceRequest> {
  const project = useModel.getState().project;
  const style = p.ipWeight > 0 ? await styleOf(s) : undefined;
  const studio = s.source === 'studio' ? (await listStudioResults(project.id))[0] : undefined;
  if (studio) {
    useEnhance.setState({ note: null });
    return {
      projectId: project.id,
      projectName: project.name,
      params: p,
      source: { kind: 'studio', id: studio.id },
      style,
      view: {
        viewProjection:
          studio.viewProjection.length === 16 ? studio.viewProjection : new Array(16).fill(0),
        width: studio.width,
        height: studio.height,
      },
      labels: currentLabels(),
    };
  }
  useEnhance.setState({ note: s.source === 'studio' ? 'noStudio' : null });
  const inputs = await captureEnhanceInputs(false);
  const req = buildRequest(p, inputs);
  return { ...req, images: { ...req.images!, style } };
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
  preset: 'reference',
  source: 'studio',
  styleRef: isReferenceProject(useModel.getState().project) ? 'reference' : 'none',
  styleUpload: null,
  ipWeight: PRESET_SETTINGS.reference.ipWeight,
  edgeStrength: PRESET_SETTINGS.reference.edgeStrength,
  regions: PRESET_SETTINGS.reference.regions,
  tiledUpscale: 0,
  checkpoint: '',
  layoutCheck: true,
  note: null,
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
  applyPreset: (id) => {
    const p = PRESET_SETTINGS[id];
    set({
      preset: id,
      creativity: p.creativity,
      controlStrength: p.controlStrength,
      edgeStrength: p.edgeStrength,
      ipWeight: p.ipWeight > 0 ? p.ipWeight : get().ipWeight,
      styleRef:
        p.ipWeight === 0
          ? 'none'
          : get().styleRef === 'none'
            ? isReferenceProject(useModel.getState().project)
              ? 'reference'
              : get().styleUpload
                ? 'upload'
                : 'none'
            : get().styleRef,
      regions: p.regions,
      tiledUpscale: p.tiledUpscale,
      steps: p.steps,
      layoutCheck: p.layoutCheck,
      useEdges: id === 'classic',
    });
  },
  chooseStyleFile: async (file) => {
    try {
      set({ styleUpload: await fileStyle(file), styleRef: 'upload', error: null });
    } catch {
      set({ error: 'That picture could not be read.' });
    }
  },
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
      const p = params(get());
      let request;
      if (p.pipeline === 'v2') request = await buildV2Request(get(), p);
      else {
        const inputs = await captureEnhanceInputs(s.useEdges);
        request = buildRequest(p, inputs);
      }
      const { id } = await submitEnhance(request);
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
