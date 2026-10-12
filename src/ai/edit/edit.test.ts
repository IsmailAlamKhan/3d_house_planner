import { produce } from 'immer';
import { beforeEach, describe, expect, it } from 'vitest';
import { polygonArea } from '../../geometry/polygon';
import { createSampleProject } from '../../model/sample';
import { ProjectSchema } from '../../model/schemas';
import { undo, useModel } from '../../model/store';
import type { Project } from '../../model/types';
import { applyEditOps } from './apply';
import { describeChanges } from './diff';
import { EditError, findCatalogEntry, findMaterial, resolveLevel, resolveRoom } from './lookup';
import type { EditOperation } from '../schemas';

const sample = createSampleProject();
const L0 = sample.levels[0]!.id;
const run = (ops: EditOperation[], base: Project = sample) =>
  produce(base, (d) => void applyEditOps(d, ops, { activeLevelId: L0 }));
const room = (p: Project, name: string, level = 0) =>
  p.rooms.find((r) => r.name === name && r.levelId === p.levels[level]!.id)!;
const area = (p: Project, name: string, level = 0) => polygonArea(room(p, name, level).polygon);

describe('lookups', () => {
  it('finds rooms by name, partial name and type, preferring the active level', () => {
    expect(resolveRoom(sample, 'kitchen', L0).name).toBe('Kitchen & dining');
    expect(resolveRoom(sample, 'Living room', L0).name).toBe('Living room');
    expect(resolveRoom(sample, 'the living', L0).name).toBe('Living room');
    expect(resolveRoom(sample, 'bathroom', L0).levelId).toBe(L0);
    expect(resolveRoom(sample, 'bathroom', sample.levels[1]!.id).levelId).toBe(
      sample.levels[1]!.id,
    );
    expect(() => resolveRoom(sample, 'ballroom', L0)).toThrow(
      /could not find a room called "ballroom"/,
    );
  });
  it('finds levels', () => {
    expect(resolveLevel(sample, 'upstairs', L0).index).toBe(1);
    expect(resolveLevel(sample, 'ground floor', L0).index).toBe(0);
    expect(resolveLevel(sample, undefined, L0).id).toBe(L0);
    expect(() => resolveLevel(sample, 'attic', L0)).toThrow(EditError);
  });
  it('maps words to materials and catalog items', () => {
    expect(findMaterial('oak', 'floor')).toBe('floor-oak');
    expect(findMaterial('dark walnut wood', 'floor')).toBe('floor-walnut');
    expect(findMaterial('herringbone parquet', 'floor')).toBe('floor-herringbone');
    expect(findMaterial('sage green', 'walls')).toBe('paint-sage');
    expect(findMaterial('red', 'walls')).toBe('paint:#c0392b');
    expect(findMaterial('paint:#aabbcc', 'walls')).toBe('paint:#aabbcc');
    expect(findMaterial('marble', 'floor')).toBe('floor-marble');
    expect(findMaterial('white', 'walls')).toBe('paint-white');
    expect(findMaterial('lava', 'floor')).toBeNull();
    expect(findCatalogEntry('couch')?.catalogId).toBe('sofa-3seat');
    expect(findCatalogEntry('bedside table')?.catalogId).toBe('side-table');
    expect(findCatalogEntry('plant')?.catalogId).toBe('plant');
    expect(findCatalogEntry('toilet')?.catalogId).toBe('wc');
    expect(findCatalogEntry('flux capacitor')).toBeUndefined();
  });
});

describe('resizeRoom / moveWall', () => {
  it('"make the living room 1 m wider" moves the partition and grows the room', () => {
    const next = run([{ op: 'resizeRoom', room: 'Living room', dimension: 'width', delta: 1 }]);
    expect(area(next, 'Living room')).toBeCloseTo(area(sample, 'Living room') + 7, 1); // +1 m × 7 m
    expect(area(next, 'Kitchen & dining')).toBeCloseTo(area(sample, 'Kitchen & dining') - 7, 1); // the neighbour shrinks
    expect(ProjectSchema.safeParse(next).success).toBe(true);
    expect(next.rooms).toHaveLength(sample.rooms.length);
  });

  it('resizes to an absolute size, keeping the requested side fixed, and the wall under a T-junction follows', () => {
    const next = run([
      { op: 'resizeRoom', room: 'Living room', dimension: 'depth', to: 8, anchor: 'north' },
    ]);
    expect(area(next, 'Living room')).toBeCloseTo(6 * 8, 1);
    // The rooms below lose a metre.
    expect(area(next, 'Study')).toBeCloseTo(area(sample, 'Study') - 4, 1);
    // Walls that ended on the moved wall still end on it (no gaps): every ground room is still a closed room.
    expect(next.rooms.filter((r) => r.levelId === L0)).toHaveLength(
      sample.rooms.filter((r) => r.levelId === L0).length,
    );
  });

  it('moveWall pushes a side outward or inward', () => {
    const next = run([{ op: 'moveWall', room: 'Kitchen & dining', side: 'west', distance: 0.5 }]);
    expect(area(next, 'Kitchen & dining')).toBeCloseTo(area(sample, 'Kitchen & dining') + 3.5, 1);
    const inward = run([{ op: 'moveWall', room: 'Living room', side: 'east', distance: -0.5 }]);
    expect(area(inward, 'Living room')).toBeCloseTo(area(sample, 'Living room') - 3.5, 1);
  });

  it('refuses outer walls, tiny rooms and doors that would no longer fit — with a plain message and no change', () => {
    expect(() =>
      run([{ op: 'moveWall', room: 'Living room', side: 'north', distance: 1 }]),
    ).toThrow(/outer wall/);
    expect(() =>
      run([{ op: 'resizeRoom', room: 'Living room', dimension: 'width', delta: -5.5 }]),
    ).toThrow(/too small/);
    expect(() => run([{ op: 'resizeRoom', room: 'Living room', dimension: 'width' }])).toThrow(
      /by how much/,
    );
    expect(() =>
      run([{ op: 'resizeRoom', room: 'Living room', dimension: 'depth', delta: 4.5 }]),
    ).toThrow(/too small|break/);
  });

  it('a failing operation in a batch leaves the project completely unchanged', () => {
    const before = JSON.stringify(sample);
    let err: unknown;
    try {
      run([
        { op: 'renameRoom', room: 'Study', name: 'Library' },
        { op: 'moveWall', room: 'Living room', side: 'north', distance: 1 },
      ]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EditError);
    expect(JSON.stringify(sample)).toBe(before); // produce never touched the original
  });
});

describe('other operations', () => {
  it('rename, retype and materials', () => {
    const next = run([
      { op: 'renameRoom', room: 'Study', name: 'Library', type: 'study' },
      { op: 'changeMaterial', target: 'floor', room: 'Library', material: 'dark walnut' },
      { op: 'changeMaterial', target: 'walls', room: 'Living room', material: 'sage' },
      { op: 'changeMaterial', target: 'ceiling', level: 'upstairs', material: 'blue' },
    ]);
    expect(room(next, 'Library').floorMaterial).toBe('floor-walnut');
    expect(
      next.walls.filter((w) => [w.materialInside, w.materialOutside].includes('paint-sage')).length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      next.rooms
        .filter((r) => r.levelId === next.levels[1]!.id)
        .every((r) => r.ceilingMaterial === 'paint-blue'),
    ).toBe(true);
    expect(() =>
      run([{ op: 'changeMaterial', target: 'floor', room: 'Study', material: 'lava' }]),
    ).toThrow(/do not know a material/);
  });

  it('addRoom carves a new room out of an existing one and links it with a door', () => {
    const next = run([
      {
        op: 'addRoom',
        name: 'Pantry',
        type: 'utility',
        from: 'Living room',
        side: 'west',
        size: 2,
      },
    ]);
    expect(area(next, 'Pantry')).toBeCloseTo(2 * 7, 1);
    expect(area(next, 'Living room')).toBeCloseTo(area(sample, 'Living room') - 14, 1);
    expect(room(next, 'Living room').type).toBe('living');
    expect(next.openings.length).toBeGreaterThan(sample.openings.length);
    expect(() =>
      run([
        { op: 'addRoom', name: 'X', type: 'other', from: 'Living room', side: 'west', size: 6 },
      ]),
    ).toThrow(/too small/);
  });

  it('removeRoom merges the room into the neighbour it shares the longest wall with', () => {
    const next = run([{ op: 'removeRoom', room: 'Study', mergeInto: 'Entrance hall' }]);
    expect(next.rooms.some((r) => r.name === 'Study' && r.levelId === L0)).toBe(false);
    expect(area(next, 'Entrance hall')).toBeCloseTo(
      area(sample, 'Entrance hall') + area(sample, 'Study'),
      1,
    );
    const auto = run([{ op: 'removeRoom', room: 'Study' }]);
    expect(auto.rooms.some((r) => r.name === 'Study' && r.levelId === L0)).toBe(false);
    expect(ProjectSchema.safeParse(auto).success).toBe(true);
  });

  it('adds, moves and removes furniture; refuses what is not in the library or has no space', () => {
    const withPlant = run([{ op: 'addItem', catalogId: 'plant', room: 'Living room', count: 2 }]);
    expect(withPlant.items.filter((i) => i.catalogId === 'plant')).toHaveLength(2);
    const added = run([{ op: 'addItem', catalogId: 'couch', room: 'Study' }]);
    expect(
      added.items.some(
        (i) => i.catalogId === 'sofa-3seat' && room(added, 'Study').polygon.length > 0,
      ),
    ).toBe(true);
    const sofa = sample.items.find((i) => i.catalogId === 'sofa-3seat')!;
    const moved = run([
      { op: 'moveItem', catalogId: 'sofa-3seat', room: 'Living room', dx: -1, dy: -1 },
    ]);
    const after = moved.items.find((i) => i.id === sofa.id)!;
    expect(after.position.x).toBeCloseTo(sofa.position.x - 1, 1);
    const removed = run([{ op: 'removeItem', catalogId: 'sofa', room: 'Living room' }]);
    expect(removed.items.some((i) => i.catalogId === 'sofa-3seat')).toBe(false);
    expect(() => run([{ op: 'addItem', catalogId: 'flux capacitor', room: 'Study' }])).toThrow(
      /library/,
    );
    expect(() => run([{ op: 'removeItem', catalogId: 'bathtub', room: 'Study' }])).toThrow(
      /no bathtub/,
    );
    expect(() => run([{ op: 'addItem', catalogId: 'door-single', room: 'Study' }])).toThrow(
      /goes in a wall/,
    );
  });

  it('adds doors and windows to the side of a room, refusing when it does not fit', () => {
    const win = run([{ op: 'addOpening', kind: 'window', room: 'Study', side: 'south' }]);
    expect(win.openings.length).toBe(sample.openings.length + 1);
    expect(win.openings.at(-1)!).toMatchObject({ kind: 'window' });
    expect(() =>
      run([
        {
          op: 'addOpening',
          kind: 'window',
          room: 'Living room',
          side: 'south',
          catalogId: 'window-full',
        },
        {
          op: 'addOpening',
          kind: 'window',
          room: 'Living room',
          side: 'south',
          catalogId: 'window-full',
        },
      ]),
    ).toThrow();
  });

  it('changes the stair type', () => {
    expect(run([{ op: 'changeStairType', type: 'L' }]).stairs[0]!.type).toBe('L');
    expect(() =>
      run(
        [{ op: 'changeStairType', type: 'U' }],
        produce(sample, (d) => void (d.stairs = [])),
      ),
    ).toThrow(/no stair/);
  });
});

describe('preview diff', () => {
  it('describes what will change in plain words', () => {
    const next = run([
      { op: 'resizeRoom', room: 'Living room', dimension: 'width', delta: 1 },
      { op: 'changeMaterial', target: 'floor', room: 'Study', material: 'marble' },
      { op: 'addItem', catalogId: 'plant', room: 'Living room' },
      { op: 'changeStairType', type: 'L' },
    ]);
    const lines = describeChanges(sample, next);
    expect(lines).toContain('Living room 42.0 m² → 49.0 m²');
    expect(lines.some((l) => /Kitchen & dining 28\.0 m² → 21\.0 m²/.test(l))).toBe(true);
    expect(
      lines.some((l) => /Move the wall between Living room and Kitchen & dining by 1\.0 m/.test(l)),
    ).toBe(true);
    expect(lines.some((l) => /Study floor: .* → Marble/.test(l))).toBe(true);
    expect(lines).toContain('Add 1 × plant');
    expect(lines).toContain('Stair: straight → L');
    expect(describeChanges(sample, sample)).toEqual([]);
  });
});

describe('through the store: one command = one undo step', () => {
  beforeEach(() => useModel.getState().loadProject(createSampleProject()));
  it('applies several operations in a single history entry', () => {
    const s = () => useModel.getState();
    const before = s().project;
    s().apply((p) =>
      applyEditOps(
        p,
        [
          { op: 'resizeRoom', room: 'Living room', dimension: 'width', delta: 1 },
          { op: 'addItem', catalogId: 'plant', room: 'Study' },
          { op: 'changeStairType', type: 'U' },
        ],
        { activeLevelId: s().activeLevelId },
      ),
    );
    expect(s().project.stairs[0]!.type).toBe('U');
    undo();
    expect(JSON.stringify(s().project.rooms)).toBe(JSON.stringify(before.rooms));
    expect(s().project.stairs[0]!.type).toBe('straight');
    expect(s().project.items).toHaveLength(before.items.length);
  });
  it('a bad command changes nothing and adds no history', () => {
    const s = () => useModel.getState();
    expect(() =>
      s().apply((p) =>
        applyEditOps(
          p,
          [
            { op: 'renameRoom', room: 'Study', name: 'Lab' },
            { op: 'moveWall', room: 'Living room', side: 'north', distance: 2 },
          ],
          { activeLevelId: s().activeLevelId },
        ),
      ),
    ).toThrow(EditError);
    expect(s().project.rooms.some((r) => r.name === 'Lab')).toBe(false);
    expect(useModel.temporal.getState().pastStates).toHaveLength(0);
  });
});
