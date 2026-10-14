import { create } from 'zustand';
import { toast } from '../catalog/actions';
import { t } from '../i18n';
import { useModel } from '../model/store';
import { withScene } from '../export/scene';
import {
  StudioApiError,
  cancelStudioJob,
  deleteStudioResult,
  fetchStudioHealth,
  listStudioResults,
  submitStudio,
  waitForStudioJob,
} from './api';
import { buildStudioBundle, packBundle } from './bundle';
import type { StudioHealth, StudioJobInfo, StudioQuality, StudioResultMeta } from './protocol';
import { applyReferenceLook } from './referenceLook';

interface StudioState {
  open: boolean;
  health: StudioHealth | null;
  quality: StudioQuality;
  busy: boolean;
  phase: 'idle' | 'preparing' | 'waiting';
  job: StudioJobInfo | null;
  error: string | null;
  controller: AbortController | null;
  gallery: StudioResultMeta[];
  selectedId: string | null;

  setOpen: (open: boolean) => void;
  patch: (p: Partial<StudioState>) => void;
  refreshHealth: () => Promise<void>;
  loadGallery: () => Promise<void>;
  /** Renders the 3D view as it is now, or with the Reference look (dusk, all lights, plan view) applied first. */
  start: (look: 'current' | 'reference') => Promise<void>;
  cancel: () => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useStudio = create<StudioState>((set, get) => ({
  open: false,
  health: null,
  quality: 'standard',
  busy: false,
  phase: 'idle',
  job: null,
  error: null,
  controller: null,
  gallery: [],
  selectedId: null,

  setOpen: (open) => {
    set({ open });
    if (open) void get().refreshHealth();
  },
  patch: (p) => set(p),
  refreshHealth: async () => set({ health: await fetchStudioHealth() }),
  loadGallery: async () => {
    const gallery = await listStudioResults(useModel.getState().project.id).catch(() => []);
    set((s) => ({ gallery, selectedId: s.selectedId ?? gallery[0]?.id ?? null }));
  },

  async start(look) {
    if (get().busy) return;
    const controller = new AbortController();
    set({ busy: true, phase: 'preparing', job: null, error: null, controller });
    try {
      const quality = get().quality;
      const bundle = await withScene(async () => {
        const options = look === 'reference' ? applyReferenceLook(quality) : { quality };
        // let the view settle on the look (camera flight, lights) before it is read
        await new Promise((r) => setTimeout(r, look === 'reference' ? 2500 : 200));
        return buildStudioBundle(options);
      });
      if (controller.signal.aborted) return;
      const { id } = await submitStudio(packBundle(bundle), quality);
      set({ phase: 'waiting' });
      const job = await waitForStudioJob(id, (j) => set({ job: j }), controller.signal);
      if (job.status === 'error') set({ error: job.error ?? t('studio.failed') });
      if (job.status === 'done') {
        await get().loadGallery();
        set({ selectedId: id });
        toast(t('studio.done'));
      }
    } catch (e) {
      if (!(e instanceof StudioApiError && e.status === 499))
        set({ error: e instanceof Error ? e.message : t('studio.failed') });
    } finally {
      set({ busy: false, phase: 'idle', controller: null });
    }
  },

  async cancel() {
    const { job, controller } = get();
    controller?.abort();
    if (job) await cancelStudioJob(job.id).catch(() => undefined);
    set({ busy: false, phase: 'idle', job: null });
  },

  async remove(id) {
    await deleteStudioResult(id).catch(() => undefined);
    await get().loadGallery();
    set((s) => ({
      selectedId: s.gallery.some((g) => g.id === s.selectedId)
        ? s.selectedId
        : (s.gallery[0]?.id ?? null),
    }));
  },
}));
