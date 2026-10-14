import { create } from 'zustand';
import { rectifyFromCorners } from '../../geometry/homography';
import type { Vec2 } from '../../geometry/vec';
import { t } from '../../i18n';
import * as ops from '../../model/ops';
import { edit, useModel } from '../../model/store';
import type { Project } from '../../model/types';
import { buildProject } from '../../reference/build';
import { forgetLocalImage, storeUnderlayImage } from '../../underlay/source';
import { ProviderError, ProviderUnreachable } from '../provider';
import { type Candidate } from './assemble';
import { type PlanRect, guessFtPerPx } from './cleanup';
import { browserVisionClient } from './client';
import { type Extraction, extract } from './extract';
import { type FoundItem, findItems } from './items';
import { type BuildMode, initialReview, specAndOrigin } from './recreate';
import { type Rectified, cropOnly, locatePlan, rectifyWithCorners } from './rectifyPicture';

const M_PER_FT = 0.3048;

export type Step = 'closed' | 'setup' | 'reading' | 'review';

interface RecreateState {
  /** The "Recreate from picture" dialog. */
  step: Step;
  file: File | null;
  /** The picture as chosen (object URL for display) and its size. */
  imageUrl: string | null;
  bitmap: ImageBitmap | null;
  width: number;
  height: number;
  /** The four corners marked on the picture (top-left, top-right, bottom-right, bottom-left), pixels. */
  corners: Vec2[];
  /** The part of the picture cut out by the automatic guess (picture pixels); null when corners were marked. */
  crop: { x: number; y: number; w: number; h: number } | null;
  /** The real size of the marked rectangle, in feet (text, so a person can type it). */
  realWidth: string;
  realDepth: string;
  withItems: boolean;
  // after reading
  rectified: Rectified | null;
  rectifiedUrl: string | null;
  ftPerPx: number;
  extraction: Extraction | null;
  rooms: PlanRect[];
  items: FoundItem[];
  selected: string | null;
  notes: string[];
  progress: { phase: string; done: number; total: number } | null;
  error: string | null;
  controller: AbortController | null;
  /** Which of the two AI tab modes is showing. */
  panelMode: 'describe' | 'recreate';

  setPanelMode: (m: 'describe' | 'recreate') => void;
  choose: (file: File) => Promise<void>;
  setCorners: (c: Vec2[]) => void;
  setReal: (w: string, d: string) => void;
  setWithItems: (b: boolean) => void;
  read: (auto: boolean) => Promise<void>;
  cancel: () => void;
  close: () => void;
  select: (id: string | null) => void;
  update: (
    id: string,
    patch: Partial<Pick<PlanRect, 'name' | 'type' | 'kind'>> & { rect?: PlanRect['rect'] },
  ) => void;
  addRoom: () => void;
  remove: (id: string) => void;
  build: (mode: BuildMode) => Promise<void>;
}

const num = (s: string): number | null => {
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : null;
};

const message = (e: unknown): string => {
  if (e instanceof ProviderUnreachable || e instanceof ProviderError) return e.message;
  return e instanceof Error ? e.message : String(e);
};

/** Puts a built project into the open one in a single undoable step (the name and id stay). */
export function replaceWithBuilt(p: Project, built: Project): void {
  const { id, name, createdAt } = p;
  Object.assign(p, structuredClone(built), { id, name, createdAt });
}

export const useRecreate = create<RecreateState>((set, get) => ({
  step: 'closed',
  file: null,
  imageUrl: null,
  bitmap: null,
  width: 0,
  height: 0,
  corners: [],
  crop: null,
  realWidth: '',
  realDepth: '',
  withItems: false,
  rectified: null,
  rectifiedUrl: null,
  ftPerPx: 0.1,
  extraction: null,
  rooms: [],
  items: [],
  selected: null,
  notes: [],
  progress: null,
  error: null,
  controller: null,
  panelMode: 'describe',

  setPanelMode: (panelMode) => set({ panelMode }),

  choose: async (file) => {
    try {
      const bitmap = await createImageBitmap(file);
      const prev = get().imageUrl;
      if (prev) URL.revokeObjectURL(prev);
      set({
        step: 'setup',
        file,
        bitmap,
        imageUrl: URL.createObjectURL(file),
        width: bitmap.width,
        height: bitmap.height,
        corners: [],
        crop: null,
        realWidth: '',
        realDepth: '',
        extraction: null,
        rooms: [],
        items: [],
        notes: [],
        error: null,
        progress: null,
      });
    } catch {
      set({ error: t('vision.badPicture') });
    }
  },

  setCorners: (corners) => set({ corners }),
  setReal: (realWidth, realDepth) => set({ realWidth, realDepth }),
  setWithItems: (withItems) => set({ withItems }),

  read: async (auto) => {
    const s = get();
    if (!s.bitmap) return;
    const controller = new AbortController();
    set({
      step: 'reading',
      error: null,
      controller,
      progress: { phase: 'locating', done: 0, total: 1 },
      notes: [],
    });
    const client = browserVisionClient();
    try {
      let rect: Rectified;
      let known = false;
      const w = num(s.realWidth);
      const d = num(s.realDepth);
      set({ crop: null });
      if (!auto && s.corners.length === 4 && w && d) {
        // the user's own four corners and real size: perspective corrected, in true feet
        rect = rectifyWithCorners(s.bitmap, s.corners, w, d);
        known = true;
      } else if (!auto && s.corners.length === 4) {
        // corners but no size: straighten to the picture's own proportions, scale from the labels later
        const cw = Math.hypot(s.corners[1]!.x - s.corners[0]!.x, s.corners[1]!.y - s.corners[0]!.y);
        const cd = Math.hypot(s.corners[3]!.x - s.corners[0]!.x, s.corners[3]!.y - s.corners[0]!.y);
        rect = rectifyWithCorners(s.bitmap, s.corners, cw / 10, cd / 10);
        rect.ftPerPx = undefined;
      } else {
        // automatic guess: ask the model where the plan is and cut the page chrome away
        const whole = cropOnly(s.bitmap, { x: 0, y: 0, w: s.width, h: s.height }, 1400);
        const box = await locatePlan(client, whole.source, controller.signal);
        const crop = {
          x: (box.x / whole.source.width) * s.width,
          y: (box.y / whole.source.height) * s.height,
          w: (box.w / whole.source.width) * s.width,
          h: (box.h / whole.source.height) * s.height,
        };
        rect = cropOnly(s.bitmap, crop);
        set({ crop });
      }
      const url = await new Promise<string>((resolve, reject) =>
        rect.canvas.toBlob(
          (b) =>
            b
              ? resolve(URL.createObjectURL(b))
              : reject(new Error('The picture could not be prepared.')),
          'image/png',
        ),
      );
      const old = get().rectifiedUrl;
      if (old) URL.revokeObjectURL(old);
      set({ rectified: rect, rectifiedUrl: url, progress: { phase: 'labels', done: 0, total: 1 } });

      const x = await extract({
        client,
        source: rect.source,
        ftPerPx: known ? rect.ftPerPx : undefined,
        signal: controller.signal,
        onProgress: (p) => set({ progress: p }),
      });
      // the scale: given by the user's real size, else the median over the labelled boxes, else 0.1 ft per pixel
      let ftPerPx = known && rect.ftPerPx ? rect.ftPerPx : guessFtPerPx(x.candidates);
      const notes = [...x.notes];
      if (!ftPerPx) {
        ftPerPx = 0.1;
        notes.push(t('vision.noScale'));
      } else if (!known) notes.push(t('vision.scaleGuessed'));
      let candidates: Candidate[] = x.candidates;
      if (!known) {
        // without a known scale label-only rooms had no box; run assemble again now that there is one
        candidates = x.candidates;
      }
      let items: FoundItem[] = [];
      if (get().withItems) {
        set({ progress: { phase: 'items', done: 0, total: candidates.length } });
        const found = await findItems(candidates, rect.source, client, {
          signal: controller.signal,
          onProgress: (done, total) => set({ progress: { phase: 'items', done, total } }),
        });
        items = found.items;
        notes.push(...found.notes);
      }
      const review = initialReview(candidates, ftPerPx);
      set({
        step: 'review',
        extraction: x,
        ftPerPx,
        rooms: review.rooms,
        items,
        notes: [...notes, ...review.notes],
        progress: null,
        controller: null,
        selected: review.rooms[0]?.id ?? null,
      });
    } catch (e) {
      if (controller.signal.aborted) set({ step: 'setup', progress: null, controller: null });
      else set({ step: 'setup', error: message(e), progress: null, controller: null });
    }
  },

  cancel: () => {
    get().controller?.abort();
    set({
      controller: null,
      progress: null,
      step: get().step === 'reading' ? 'setup' : get().step,
    });
  },

  close: () => {
    get().controller?.abort();
    const s = get();
    if (s.imageUrl) URL.revokeObjectURL(s.imageUrl);
    if (s.rectifiedUrl) URL.revokeObjectURL(s.rectifiedUrl);
    s.bitmap?.close();
    set({
      step: 'closed',
      file: null,
      imageUrl: null,
      bitmap: null,
      rectified: null,
      rectifiedUrl: null,
      extraction: null,
      rooms: [],
      items: [],
      controller: null,
      progress: null,
      error: null,
    });
  },

  select: (selected) => set({ selected }),

  update: (id, patch) =>
    set((s) => ({ rooms: s.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),

  addRoom: () =>
    set((s) => {
      const id = `new-${Date.now().toString(36)}`;
      const maxX = Math.max(0, ...s.rooms.map((r) => r.rect[0] + r.rect[2]));
      const room: PlanRect = {
        id,
        name: t('vision.newRoom'),
        kind: 'room',
        type: 'other',
        rect: [maxX + 1, 0, 10, 10],
        confidence: 1,
        source: 'box',
        pictured: [maxX + 1, 0, 10, 10],
      };
      return { rooms: [...s.rooms, room], selected: id };
    }),

  remove: (id) =>
    set((s) => ({
      rooms: s.rooms.filter((r) => r.id !== id),
      selected: s.selected === id ? null : s.selected,
    })),

  build: async (mode) => {
    const s = get();
    if (!s.rooms.length) return;
    try {
      const { spec, origin } = specAndOrigin(s.rooms, mode, { items: s.items, ftPerPx: s.ftPerPx });
      const { project: built, report } = buildProject(spec, { id: useModel.getState().project.id });
      // The picture goes under the plan as a reference picture, so it can be corrected there.
      let underlay: Parameters<typeof ops.addUnderlay>[1] | null = null;
      let stored: Awaited<ReturnType<typeof storeUnderlayImage>> | null = null;
      if (s.file && s.rectified && s.bitmap) {
        const corners: Vec2[] = s.corners.length === 4 ? s.corners : cornersOfCrop(s);
        const widthFt = s.rectified.canvas.width * s.ftPerPx;
        const depthFt = s.rectified.canvas.height * s.ftPerPx;
        const h = rectifyFromCorners(corners, widthFt * M_PER_FT, depthFt * M_PER_FT, {
          x: -origin[0] * M_PER_FT,
          y: -origin[1] * M_PER_FT,
        });
        if (h) {
          stored = await storeUnderlayImage(
            s.file,
            s.file.name.replace(/\.[^.]+$/, '') || 'Reference picture',
            { width: s.width, height: s.height },
          );
          underlay = {
            name: s.file.name.replace(/\.[^.]+$/, '') || 'Reference picture',
            source: stored,
            imageWidth: s.width,
            imageHeight: s.height,
            transform: h,
            opacity: 0.5,
            setup: {
              mode: 'corners',
              points: corners,
              size: [widthFt * M_PER_FT, depthFt * M_PER_FT],
              origin: { x: -origin[0] * M_PER_FT, y: -origin[1] * M_PER_FT },
            },
          };
        }
      }
      try {
        edit((p) => {
          replaceWithBuilt(p, built);
          if (underlay) ops.addUnderlay(p, underlay);
        });
      } catch (e) {
        if (stored) await forgetLocalImage(stored);
        throw e;
      }
      const first = useModel.getState().project.levels[0];
      if (first) useModel.getState().setActiveLevel(first.id);
      useModel.getState().setSelection({ type: null, ids: [] });
      const d = report.designs[0]!;
      set({
        step: 'closed',
        notes: [
          ...(d.unreachable.length ? [d.unreachable.join(' ')] : []),
          ...report.designs.flatMap((x) => x.warnings),
        ],
      });
      get().close();
    } catch (e) {
      set({ error: message(e) });
    }
  },
}));

/** The corners of the part of the picture the straightened picture shows, in picture pixels. */
function cornersOfCrop(s: RecreateState): Vec2[] {
  const c = s.crop ?? { x: 0, y: 0, w: s.width, h: s.height };
  return [
    { x: c.x, y: c.y },
    { x: c.x + c.w, y: c.y },
    { x: c.x + c.w, y: c.y + c.h },
    { x: c.x, y: c.y + c.h },
  ];
}
