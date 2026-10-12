import type { Vec2 } from '../geometry/vec';
import { t, tf } from '../i18n';
import * as ops from '../model/ops';
import { ModelError } from '../model/ops';
import { edit, useModel } from '../model/store';
import type { Item, Opening, Project } from '../model/types';
import { usePlanStore } from '../plan2d/planStore';
import { carriedId, useCatalogDrag } from './dragStore';
import { getEntry, type CatalogEntry } from './index';
import {
  type ItemPlacement,
  type WallPlacement,
  normalizeAngle,
  placeExistingItem,
  placeItem,
  placeOnWall,
} from './placement';

export type Evaluation =
  | { ok: true; kind: 'wall'; placement: WallPlacement }
  | { ok: true; kind: 'item'; placement: ItemPlacement }
  | { ok: false; message: string };

/** Shows a short message over the canvas (shared by the 2D and 3D views). */
export function toast(message: string, ms = 4000): void {
  const s = usePlanStore.getState();
  s.setToast(message);
  setTimeout(() => {
    if (usePlanStore.getState().toast === message) usePlanStore.getState().setToast(null);
  }, ms);
}

/** What would happen if `entry` were dropped at `point` on the given level. Pure (reads the project only). */
export function evaluateDrop(
  project: Project,
  levelId: string,
  entry: CatalogEntry,
  point: Vec2,
  opts: { snapWalls?: boolean } = {},
): Evaluation {
  if (entry.placement === 'wall') {
    const r = placeOnWall(project, levelId, entry, point);
    return r.ok ? { ok: true, kind: 'wall', placement: r } : r;
  }
  const r = placeItem(project, levelId, entry, point, { snapWalls: opts.snapWalls });
  return r.ok ? { ok: true, kind: 'item', placement: r } : r;
}

export function activeEditableLevel(): { id: string } | null {
  const { project, activeLevelId } = useModel.getState();
  const level = project.levels.find((l) => l.id === activeLevelId);
  if (!level) return null;
  if (level.locked) {
    toast(tf('msg.levelLocked', { level: level.name }));
    return null;
  }
  return level;
}

const selectNew = (type: 'opening' | 'item', id: string) =>
  useModel.getState().setSelection({ type, ids: [id] });

export interface PlaceOutcome {
  ok: boolean;
  message?: string;
  warnings: string[];
}

/** Adds a catalog entry to the active level at `point` (a door/window becomes an opening, anything else an item). */
export function placeCatalogEntry(
  catalogId: string,
  point: Vec2,
  opts: { snapWalls?: boolean } = {},
): PlaceOutcome {
  const entry = getEntry(catalogId);
  const level = activeEditableLevel();
  if (!entry || !level) return { ok: false, warnings: [] };
  const ev = evaluateDrop(useModel.getState().project, level.id, entry, point, opts);
  if (!ev.ok) {
    toast(ev.message);
    return { ok: false, message: ev.message, warnings: [] };
  }
  try {
    if (ev.kind === 'wall') {
      const p = ev.placement;
      const id = edit((d) =>
        ops.addOpening(d, {
          wallId: p.wallId,
          offset: p.offset,
          width: p.width,
          height: p.height,
          sillHeight: p.sillHeight,
          kind: entry.openingKind ?? 'door',
          catalogId,
          swing: entry.openingKind === 'door' ? 'left' : 'none',
        }),
      );
      selectNew('opening', id);
      return { ok: true, warnings: [] };
    }
    const p = ev.placement;
    const id = edit((d) =>
      ops.addItem(d, {
        levelId: level.id,
        catalogId,
        position: p.position,
        rotation: p.rotation,
        elevation: p.elevation,
      }),
    );
    selectNew('item', id);
    if (p.warnings.length) toast(tf('msg.placedWarn', { warnings: p.warnings.join(' ') }));
    return { ok: true, warnings: p.warnings };
  } catch (e) {
    const message = e instanceof ModelError ? e.message : String(e);
    toast(message);
    return { ok: false, message, warnings: [] };
  }
}

/** Moves an existing item to `point` (snapping rules apply). Returns false and explains if it can't go there. */
export function moveItemTo(
  id: string,
  point: Vec2,
  opts: { rotation?: number; snapWalls?: boolean } = {},
): boolean {
  const { project } = useModel.getState();
  const item = project.items.find((i) => i.id === id);
  if (!item) return false;
  const r = placeExistingItem(project, item, point, opts);
  if (!r.ok) {
    toast(r.message);
    return false;
  }
  try {
    edit((d) =>
      ops.updateItem(d, id, { position: r.position, rotation: r.rotation, elevation: r.elevation }),
    );
  } catch (e) {
    toast(e instanceof ModelError ? e.message : String(e));
    return false;
  }
  if (r.warnings.length) toast(r.warnings.join(' '));
  return true;
}

/** Slides a door/window along its wall (or onto another wall) toward `point`. */
export function slideOpening(id: string, point: Vec2): boolean {
  if (!activeEditableLevel()) return false;
  const { project, activeLevelId } = useModel.getState();
  const o = project.openings.find((x) => x.id === id);
  if (!o) return false;
  const r = evaluateOpeningMove(project, activeLevelId, o, point);
  if (!r.ok) {
    toast(r.message);
    return false;
  }
  try {
    edit((d) => ops.updateOpening(d, id, { wallId: r.wallId, offset: r.offset }));
    return true;
  } catch (e) {
    toast(e instanceof ModelError ? e.message : String(e));
    return false;
  }
}

export function evaluateOpeningMove(project: Project, levelId: string, o: Opening, point: Vec2) {
  const entry =
    getEntry(o.catalogId) ?? getEntry(o.kind === 'window' ? 'window-casement' : 'door-single')!;
  return placeOnWall(project, levelId, entry, point, {
    width: o.width,
    height: o.height,
    sillHeight: o.sillHeight,
    excludeOpeningId: o.id,
  });
}

// ───────────── keyboard-driven manipulation of the current selection ─────────────

/** Rotates the selected item(s) by 90°. */
export function rotateSelectedItems(delta = Math.PI / 2): void {
  if (!activeEditableLevel()) return;
  const { selection } = useModel.getState();
  if (selection.type !== 'item') return;
  try {
    edit((d) =>
      selection.ids.forEach((id) =>
        ops.rotateItem(
          d,
          id,
          normalizeAngle((d.items.find((i) => i.id === id)?.rotation ?? 0) + delta),
        ),
      ),
    );
  } catch (e) {
    toast(e instanceof ModelError ? e.message : String(e));
  }
}

/** Nudges selected items (plan metres) or slides selected doors/windows along their wall (dx = along). */
export function nudgeSelection(dx: number, dy: number): void {
  if (!activeEditableLevel()) return;
  const { selection } = useModel.getState();
  try {
    if (selection.type === 'item') {
      edit((d) =>
        selection.ids.forEach((id) => {
          const it = d.items.find((i) => i.id === id);
          if (it) ops.moveItem(d, id, { x: it.position.x + dx, y: it.position.y + dy });
        }),
      );
    } else if (selection.type === 'stair') {
      edit((d) =>
        selection.ids.forEach((id) => {
          const st = d.stairs.find((x) => x.id === id);
          if (st)
            ops.updateStair(d, id, { position: { x: st.position.x + dx, y: st.position.y + dy } });
        }),
      );
    } else if (selection.type === 'opening') {
      const along = dx !== 0 ? dx : dy;
      edit((d) =>
        selection.ids.forEach((id) => {
          const o = d.openings.find((x) => x.id === id);
          if (o) ops.updateOpening(d, id, { offset: Math.round((o.offset + along) * 100) / 100 });
        }),
      );
    }
  } catch (e) {
    toast(e instanceof ModelError ? e.message : t('msg.outside'));
  }
}

/** Deletes selected items / doors / windows. */
export function deleteSelectedCatalog(): void {
  if (!activeEditableLevel()) return;
  const { selection } = useModel.getState();
  if (selection.type !== 'item' && selection.type !== 'opening' && selection.type !== 'stair')
    return;
  try {
    edit((d) => ops.deleteSelection(d, selection));
  } catch (e) {
    toast(e instanceof ModelError ? e.message : String(e));
    return;
  }
  useModel.getState().setSelection({ type: null, ids: [] });
}

/** Duplicates the current selection (items offset by half a metre) and selects the copies. */
export function duplicateSelected(): void {
  if (!activeEditableLevel()) return;
  const { selection } = useModel.getState();
  if (!selection.type) return;
  try {
    const ids = edit((d) => ops.duplicate(d, selection));
    if (ids.length) useModel.getState().setSelection({ type: selection.type, ids });
  } catch (e) {
    toast(e instanceof ModelError ? e.message : String(e));
  }
}

export type { Item };

/** Snaps a free (not wall-bound) placement point to the grid when snapping is on. */
export function freePoint(p: Vec2): Vec2 {
  const { snapEnabled, gridSize } = usePlanStore.getState();
  return snapEnabled
    ? { x: Math.round(p.x / gridSize) * gridSize, y: Math.round(p.y / gridSize) * gridSize }
    : p;
}

/** Updates the ghost / message shown while a library item is carried over the plan or the 3D view. */
export function updateCatalogHover(w: Vec2, alt: boolean): void {
  const id = carriedId(useCatalogDrag.getState());
  const entry = id ? getEntry(id) : undefined;
  if (!entry) return;
  const { project, activeLevelId } = useModel.getState();
  const point = entry.placement === 'wall' ? w : freePoint(w);
  useCatalogDrag.getState().setHover({
    point,
    evaluation: evaluateDrop(project, activeLevelId, entry, point, { snapWalls: !alt }),
  });
}
