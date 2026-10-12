import { produce } from 'immer';
import { beforeEach, describe, expect, it } from 'vitest';
import { exportProjectJson, importProjectJson } from './io';
import { ProjectFormatError, migrateProject } from './migrate';
import { createEmptyProject } from './project';
import { createSampleProject } from './sample';
import { ProjectSchema } from './schemas';
import { edit, redo, undo, useModel } from './store';
import * as ops from './ops';
import { isItemInBounds, openingFitsWall, openingsOverlap } from './integrity';

const run = <T>(p: ReturnType<typeof createEmptyProject>, fn: (d: typeof p) => T) => {
  let out!: T;
  const next = produce(p, (d) => {
    out = fn(d);
  });
  return { next, out };
};

describe('schemas & sample', () => {
  it('sample project validates and round-trips through JSON unchanged', () => {
    const sample = createSampleProject();
    expect(ProjectSchema.safeParse(sample).success).toBe(true);
    expect(sample.levels).toHaveLength(2);
    expect(sample.levels[1]!.elevation).toBeCloseTo(2.9);
    const again = importProjectJson(exportProjectJson(sample));
    expect(again).toEqual(sample);
  });
  it('rejects invalid and too-new data', () => {
    expect(() => importProjectJson('nope')).toThrow(ProjectFormatError);
    expect(() => migrateProject({ ...createEmptyProject(), walls: 5 })).toThrow(ProjectFormatError);
    expect(() => migrateProject({ ...createEmptyProject(), schemaVersion: 99 })).toThrow(/newer/);
  });
});

describe('integrity rules', () => {
  it('checks opening fit and overlap', () => {
    expect(openingFitsWall(4, 2, 0.9)).toBe(true);
    expect(openingFitsWall(4, 0.2, 0.9)).toBe(false);
    expect(openingsOverlap({ offset: 1, width: 1 }, { offset: 1.9, width: 1 })).toBe(true);
    expect(openingsOverlap({ offset: 1, width: 1 }, { offset: 2, width: 1 })).toBe(false);
  });
  it('keeps items inside the shell', () => {
    const p = createEmptyProject();
    const lvl = p.levels[0]!.id;
    expect(isItemInBounds(p, lvl, { x: 5, y: 5 })).toBe(true);
    expect(isItemInBounds(p, lvl, { x: 50, y: 5 })).toBe(false);
    expect(isItemInBounds(p, 'missing', { x: 5, y: 5 })).toBe(false);
  });
});

describe('operations', () => {
  const base = createEmptyProject();
  const L = base.levels[0]!.id;
  const w = { levelId: L, start: { x: 0, y: 0 }, end: { x: 4, y: 0 } };

  it('rejects zero-length walls', () => {
    expect(() => run(base, (d) => ops.addWall(d, { ...w, end: { x: 0, y: 0 } }))).toThrow(
      /at least/,
    );
  });

  it('validates and prevents overlapping openings', () => {
    const { next, out: wallId } = run(base, (d) => ops.addWall(d, w));
    const a = run(next, (d) => ops.addOpening(d, { wallId, offset: 2 }));
    expect(() => run(a.next, (d) => ops.addOpening(d, { wallId, offset: 2.5 }))).toThrow(/taken/);
    expect(() => run(a.next, (d) => ops.addOpening(d, { wallId, offset: 0.1 }))).toThrow(/fit/);
    expect(() => run(a.next, (d) => ops.addOpening(d, { wallId, offset: 3, height: 5 }))).toThrow(
      /taller/,
    );
    const ok = run(a.next, (d) => ops.addOpening(d, { wallId, offset: 3.2, kind: 'window' }));
    expect(ok.next.openings).toHaveLength(2);
  });

  it('splits walls and redistributes openings; deleting a wall deletes its openings', () => {
    const s = run(base, (d) => {
      const wallId = ops.addWall(d, w);
      ops.addOpening(d, { wallId, offset: 0.8 });
      ops.addOpening(d, { wallId, offset: 3 });
      return wallId;
    });
    const wallId = s.out;
    expect(() => run(s.next, (d) => ops.splitWall(d, wallId, 3))).toThrow(/through/);
    const split = run(s.next, (d) => ops.splitWall(d, wallId, 2));
    const [first, second] = split.out;
    expect(split.next.walls).toHaveLength(2);
    expect(split.next.openings.find((o) => o.wallId === second)!.offset).toBeCloseTo(1);
    expect(split.next.openings.find((o) => o.wallId === first)!.offset).toBeCloseTo(0.8);
    const del = run(split.next, (d) => ops.deleteWall(d, second));
    expect(del.next.walls).toHaveLength(1);
    expect(del.next.openings).toHaveLength(1);
  });

  it('manages levels and elevations', () => {
    const { next, out } = run(base, (d) => ops.addLevel(d, { name: 'Top' }));
    expect(next.levels[1]!.elevation).toBeCloseTo(2.9);
    const re = run(next, (d) => ops.reorderLevels(d, [out, L]));
    expect(re.next.levels[0]!.id).toBe(out);
    expect(re.next.levels[0]!.elevation).toBe(0);
    expect(() => run(next, (d) => ops.reorderLevels(d, [L]))).toThrow();
  });

  it('adds/moves/rotates items within bounds and duplicates/deletes selections', () => {
    const r = run(base, (d) => {
      const id = ops.addItem(d, { levelId: L, catalogId: 'sofa', position: { x: 2, y: 2 } });
      ops.moveItem(d, id, { x: 3, y: 3 });
      ops.rotateItem(d, id, 1);
      return id;
    });
    expect(r.next.items[0]).toMatchObject({ position: { x: 3, y: 3 }, rotation: 1 });
    expect(() => run(r.next, (d) => ops.moveItem(d, r.out, { x: 99, y: 3 }))).toThrow(/outside/);
    const dup = run(r.next, (d) => ops.duplicate(d, { type: 'item', ids: [r.out] }));
    expect(dup.next.items).toHaveLength(2);
    const del = run(dup.next, (d) =>
      ops.deleteSelection(d, { type: 'item', ids: [r.out, dup.out[0]!] }),
    );
    expect(del.next.items).toHaveLength(0);
  });

  it('does not delete locked columns', () => {
    const r = run(base, (d) => ops.addColumn(d, { levelId: L, position: { x: 1, y: 1 } }));
    const del = run(r.next, (d) => ops.deleteSelection(d, { type: 'column', ids: [r.out] }));
    expect(del.next.columns).toHaveLength(1);
  });
});

describe('store undo/redo', () => {
  beforeEach(() => {
    useModel.getState().loadProject(createEmptyProject());
  });

  it('undoes and redoes individual edits', () => {
    const L = useModel.getState().project.levels[0]!.id;
    edit((p) => ops.addWall(p, { levelId: L, start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }));
    edit((p) => ops.addWall(p, { levelId: L, start: { x: 1, y: 0 }, end: { x: 1, y: 1 } }));
    expect(useModel.getState().project.walls).toHaveLength(2);
    undo();
    expect(useModel.getState().project.walls).toHaveLength(1);
    redo();
    expect(useModel.getState().project.walls).toHaveLength(2);
  });

  it('undoes a batch in one step', () => {
    const L = useModel.getState().project.levels[0]!.id;
    edit((p) => {
      const a = ops.addWall(p, { levelId: L, start: { x: 0, y: 0 }, end: { x: 4, y: 0 } });
      ops.addOpening(p, { wallId: a, offset: 2 });
      ops.addWall(p, { levelId: L, start: { x: 4, y: 0 }, end: { x: 4, y: 4 } });
    });
    expect(useModel.getState().project.walls).toHaveLength(2);
    undo();
    const s = useModel.getState().project;
    expect(s.walls).toHaveLength(0);
    expect(s.openings).toHaveLength(0);
  });

  it('a failing batch changes nothing and adds no history', () => {
    const L = useModel.getState().project.levels[0]!.id;
    expect(() =>
      edit((p) => {
        ops.addWall(p, { levelId: L, start: { x: 0, y: 0 }, end: { x: 4, y: 0 } });
        ops.addWall(p, { levelId: L, start: { x: 0, y: 0 }, end: { x: 0, y: 0 } });
      }),
    ).toThrow();
    expect(useModel.getState().project.walls).toHaveLength(0);
    expect(useModel.temporal.getState().pastStates).toHaveLength(0);
  });

  it('selection and tool changes are not in history', () => {
    useModel.getState().setTool('wall');
    useModel.getState().setSelection({ type: 'wall', ids: ['x'] });
    expect(useModel.temporal.getState().pastStates).toHaveLength(0);
  });
});
