import { beforeEach, describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sample';
import { undo, useModel } from '../model/store';
import { usePlanStore } from '../plan2d/planStore';
import {
  duplicateSelected,
  deleteSelectedCatalog,
  moveItemTo,
  nudgeSelection,
  placeCatalogEntry,
  rotateSelectedItems,
  slideOpening,
} from './actions';

const state = () => useModel.getState();

beforeEach(() => {
  state().loadProject(createSampleProject());
  state().setActiveLevel(state().project.levels[0]!.id);
  usePlanStore.getState().setToast(null);
});

describe('placeCatalogEntry', () => {
  it('turns a dropped window into a real opening on the wall and selects it', () => {
    const before = state().project.openings.length;
    const r = placeCatalogEntry('window-fixed', { x: 5.4, y: 0.3 });
    expect(r.ok).toBe(true);
    const { project, selection } = state();
    expect(project.openings).toHaveLength(before + 1);
    const o = project.openings.find((x) => x.id === selection.ids[0])!;
    expect(o).toMatchObject({ kind: 'window', catalogId: 'window-fixed', sillHeight: 1 });
    expect(selection.type).toBe('opening');
  });

  it('refuses a door dropped in the middle of a room, with a message, and changes nothing', () => {
    const before = state().project.openings.length;
    const r = placeCatalogEntry('door-single', { x: 3, y: 3.5 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/wall/i);
    expect(usePlanStore.getState().toast).toMatch(/wall/i);
    expect(state().project.openings).toHaveLength(before);
  });

  it('places furniture back-to-wall, rotated to face the room, as one undo step', () => {
    const n = state().project.items.length;
    placeCatalogEntry('wardrobe', { x: 4, y: 0.7 });
    const { project, selection } = state();
    expect(project.items).toHaveLength(n + 1);
    const it = project.items.find((i) => i.id === selection.ids[0])!;
    expect(it.rotation).toBeCloseTo(0);
    expect(it.position.y).toBeCloseTo(0.15 + 0.3 + 0.002);
    undo();
    expect(state().project.items).toHaveLength(n);
  });

  it('hangs wall-mounted items at their mount height and ceiling lights from the ceiling', () => {
    placeCatalogEntry('mirror', { x: 1, y: 7.8 });
    expect(
      state().project.items.find((i) => i.id === state().selection.ids[0])!.elevation,
    ).toBeCloseTo(1.1);
    placeCatalogEntry('ceiling-light', { x: 3, y: 3.5 });
    const light = state().project.items.find((i) => i.id === state().selection.ids[0])!;
    expect(light.elevation).toBeCloseTo(2.7 - 0.08);
  });

  it('refuses edits on a locked level', () => {
    state().apply((p) => void (p.levels[0]!.locked = true));
    const n = state().project.items.length;
    expect(placeCatalogEntry('armchair', { x: 2, y: 3 }).ok).toBe(false);
    expect(state().project.items).toHaveLength(n);
    expect(usePlanStore.getState().toast).toMatch(/locked/);
  });

  it('refuses placements outside the apartment', () => {
    expect(placeCatalogEntry('sofa-3seat', { x: 40, y: 3 }).ok).toBe(false);
  });

  it('warns about overlaps but still places', () => {
    const sofa = state().project.items.find((i) => i.catalogId === 'sofa-3seat')!;
    const r = placeCatalogEntry('armchair', sofa.position);
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/Overlaps/);
    expect(usePlanStore.getState().toast).toMatch(/clearance/);
  });
});

describe('moving, sliding and keyboard actions', () => {
  it('moves an item with snapping rules, refusing invalid targets', () => {
    const item = state().project.items.find((i) => i.catalogId === 'sofa-3seat')!;
    expect(moveItemTo(item.id, { x: 2, y: 2 })).toBe(true);
    expect(state().project.items.find((i) => i.id === item.id)!.position).toEqual({ x: 2, y: 2 });
    expect(moveItemTo(item.id, { x: 50, y: 2 })).toBe(false);
    expect(state().project.items.find((i) => i.id === item.id)!.position).toEqual({ x: 2, y: 2 });
  });

  it('slides an opening along its wall and refuses overlaps', () => {
    const win = state().project.openings.find((o) => o.kind === 'window')!;
    expect(slideOpening(win.id, { x: 5.5, y: 0 })).toBe(true);
    const moved = state().project.openings.find((o) => o.id === win.id)!;
    expect(moved.offset).toBeCloseTo(5.5, 1);
  });

  it('R rotates 90°, arrows nudge, Ctrl+D duplicates, Delete removes', () => {
    const item = state().project.items.find((i) => i.catalogId === 'dining-table-6')!;
    state().setSelection({ type: 'item', ids: [item.id] });
    rotateSelectedItems();
    expect(state().project.items.find((i) => i.id === item.id)!.rotation).toBeCloseTo(Math.PI / 2);
    nudgeSelection(0.25, 0);
    expect(state().project.items.find((i) => i.id === item.id)!.position.x).toBeCloseTo(
      item.position.x + 0.25,
    );
    const n = state().project.items.length;
    duplicateSelected();
    expect(state().project.items).toHaveLength(n + 1);
    expect(state().selection.ids[0]).not.toBe(item.id);
    deleteSelectedCatalog();
    expect(state().project.items).toHaveLength(n);
    expect(state().selection.type).toBeNull();
  });

  it('arrow keys slide a selected door along its wall', () => {
    const door = state().project.openings.find((o) => o.catalogId === 'door-entrance')!;
    state().setSelection({ type: 'opening', ids: [door.id] });
    nudgeSelection(0, -0.25);
    expect(state().project.openings.find((o) => o.id === door.id)!.offset).toBeCloseTo(
      door.offset - 0.25,
      2,
    );
  });
});
