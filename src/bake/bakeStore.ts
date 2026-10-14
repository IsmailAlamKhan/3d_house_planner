import { LinearFilter, SRGBColorSpace, type Texture, TextureLoader } from 'three';
import { create } from 'zustand';
import { toast } from '../catalog/actions';
import { t } from '../i18n';
import { useModel } from '../model/store';
import { type StudioHealth, type StudioJobInfo } from '../studio/protocol';
import { fetchStudioHealth } from '../studio/api';
import {
  BakeApiError,
  cancelBakeJob,
  deleteBake,
  fetchBakeUv,
  lightmapUrl,
  listBakes,
  submitBake,
  waitForBakeJob,
} from './api';
import { buildBakeBundle, packBakeBundle } from './bundle';
import type { BakeMeta, BakePreset, BakeQuality } from './protocol';

const KEY = 'duplex-designer:bake';

interface Persisted {
  /** Show baked lighting when a bake exists for the current look. */
  enabled: boolean;
  /** Bake again by itself after 2 minutes without edits. */
  auto: boolean;
  quality: BakeQuality;
}
const defaults: Persisted = { enabled: true, auto: false, quality: 'medium' };
const load = (): Persisted => {
  try {
    const raw = localStorage.getItem(KEY);
    return { ...defaults, ...(raw ? (JSON.parse(raw) as Partial<Persisted>) : {}) };
  } catch {
    return defaults;
  }
};
const save = (p: Persisted) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // a convenience only
  }
};

/** A bake that is loaded and drawn: its atlas and the lightmap UVs of each part. */
export interface AppliedBake {
  projectId: string;
  preset: BakePreset;
  key: string;
  texture: Texture;
  /** Multiply the decoded lightmap by this. */
  scale: number;
  parts: Map<string, { uv1: Float32Array; vertexCount: number; hash: string }>;
}

interface BakeState extends Persisted {
  /** Brightness of the lightmap against the studio render (1 = as calibrated; the GPU specs vary it). */
  gain: number;
  /** How strongly baked surfaces reflect the environment / their probe (0 none, 1 full). */
  reflect: number;
  /** The bakes the server holds for the open project, by preset. */
  bakes: Partial<Record<BakePreset, BakeMeta>>;
  applied: AppliedBake | null;
  /** Bumped whenever `applied` changes, so the scene re-evaluates its materials. */
  version: number;
  health: StudioHealth | null;
  busy: boolean;
  phase: 'idle' | 'preparing' | 'waiting';
  job: StudioJobInfo | null;
  error: string | null;
  controller: AbortController | null;

  patch: (p: Partial<Persisted>) => void;
  refreshHealth: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Load (or drop) the bake that suits the current look. */
  sync: (ctx: { projectId: string; preset: BakePreset; realistic: boolean }) => Promise<void>;
  start: (preset: BakePreset) => Promise<void>;
  cancel: () => Promise<void>;
  remove: (preset: BakePreset) => Promise<void>;
}

let loadingFor = '';

export const useBake = create<BakeState>((set, get) => ({
  ...load(),
  gain: 1,
  reflect: 0.6,
  bakes: {},
  applied: null,
  version: 0,
  health: null,
  busy: false,
  phase: 'idle',
  job: null,
  error: null,
  controller: null,

  patch: (p) => {
    set(p);
    const s = get();
    save({ enabled: s.enabled, auto: s.auto, quality: s.quality });
  },
  refreshHealth: async () => set({ health: await fetchStudioHealth() }),

  async refresh() {
    const projectId = useModel.getState().project.id;
    const list = await listBakes(projectId);
    const bakes: BakeState['bakes'] = {};
    for (const m of list) bakes[m.preset] = m;
    set({ bakes });
  },

  async sync({ projectId, preset, realistic }) {
    const { enabled, bakes, applied } = get();
    const meta = bakes[preset];
    const want = enabled && realistic && meta && meta.projectId === projectId ? meta : null;
    if (!want) {
      if (applied) {
        applied.texture.dispose();
        set({ applied: null, version: get().version + 1 });
      }
      return;
    }
    if (
      applied &&
      applied.preset === want.preset &&
      applied.key === want.key &&
      applied.projectId === projectId
    )
      return;
    const token = `${projectId}/${want.preset}/${want.key}`;
    if (loadingFor === token) return;
    loadingFor = token;
    try {
      const [texture, uv] = await Promise.all([
        new TextureLoader().loadAsync(lightmapUrl(projectId, want.preset, want.key)),
        fetchBakeUv(projectId, want.preset),
      ]);
      if (loadingFor !== token) return texture.dispose();
      texture.colorSpace = SRGBColorSpace;
      texture.channel = 1;
      // no mipmaps: the charts are close together and a small mip would blend neighbours into each other
      texture.generateMipmaps = false;
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
      const parts: AppliedBake['parts'] = new Map();
      let at = 0;
      for (const p of want.parts) {
        parts.set(p.id, {
          uv1: uv.subarray(at, at + p.vertexCount * 2),
          vertexCount: p.vertexCount,
          hash: p.hash,
        });
        at += p.vertexCount * 2;
      }
      get().applied?.texture.dispose();
      set({
        applied: {
          projectId,
          preset: want.preset,
          key: want.key,
          texture,
          scale: want.scale,
          parts,
        },
        version: get().version + 1,
      });
    } catch (e) {
      // the bake cannot be loaded (files missing, offline): the real-time lighting stays
      console.warn('bake: could not load the bake', e);
    } finally {
      if (loadingFor === token) loadingFor = '';
    }
  },

  async start(preset) {
    if (get().busy) return;
    const controller = new AbortController();
    set({ busy: true, phase: 'preparing', job: null, error: null, controller });
    try {
      const quality = get().quality;
      // let the interface paint "preparing" before the heavy part runs
      await new Promise((r) => setTimeout(r, 30));
      const bundle = await buildBakeBundle({ preset, quality });
      if (controller.signal.aborted) return;
      const { id } = await submitBake(packBakeBundle(bundle), {
        projectId: useModel.getState().project.id,
        quality,
        key: bundle.key,
      });
      set({ phase: 'waiting' });
      const job = await waitForBakeJob(id, (j) => set({ job: j }), controller.signal);
      if (job.status === 'error') set({ error: job.error ?? t('bake.failed') });
      if (job.status === 'done') {
        // the list changes, and BakeRuntime loads the new bake (its key differs even when the preset is the same)
        await get().refresh();
        toast(t('bake.done'));
      }
    } catch (e) {
      if (!(e instanceof BakeApiError && e.status === 499))
        set({ error: e instanceof Error ? e.message : t('bake.failed') });
    } finally {
      set({ busy: false, phase: 'idle', controller: null });
    }
  },

  async cancel() {
    const { job, controller } = get();
    controller?.abort();
    if (job) await cancelBakeJob(job.id).catch(() => undefined);
    set({ busy: false, phase: 'idle', job: null });
  },

  async remove(preset) {
    await deleteBake(useModel.getState().project.id, preset).catch(() => undefined);
    await get().refresh();
  },
}));
