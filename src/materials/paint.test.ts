import { produce } from 'immer';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sample';
import * as ops from '../model/ops';
import { undo, useModel } from '../model/store';
import { usePlanStore } from '../plan2d/planStore';
import { eyedrop } from './eyedropper';
import { usePaint } from './paintStore';
import { type Surface, paintSurface, readSurface } from './surfaces';

const sample = createSampleProject();
const L0 = sample.levels[0]!.id;
const room = (name: string) => sample.rooms.find((r) => r.name === name && r.levelId === L0)!;
const wall = (sx: number, sy: number, ex: number, ey: number) =>
  sample.walls.find(
    (w) =>
      w.levelId === L0 && w.start.x === sx && w.start.y === sy && w.end.x === ex && w.end.y === ey,
  )!;

describe('wall faces', () => {
  it('maps left/right to inside/outside (interior: left = inside; exterior: the face toward the shell)', () => {
    const part = wall(6, 0, 6, 7); // interior
    expect(ops.faceField(sample, part, 'left')).toBe('materialInside');
    expect(ops.faceField(sample, part, 'right')).toBe('materialOutside');
    const north = wall(0, 0, 10, 0); // exterior, shell lies to the south = left of start→end (+y)
    expect(ops.faceField(sample, north, 'left')).toBe('materialInside');
    const west = wall(0, 12, 0, 0); // heading north, left normal points east = into the shell
    expect(ops.faceField(sample, west, 'left')).toBe('materialInside');
    const east = wall(10, 0, 10, 12); // heading south, left normal points west = into the shell
    expect(ops.faceField(sample, east, 'left')).toBe('materialInside');
  });

  it('finds the room a face looks into', () => {
    const partition = wall(6, 0, 6, 7); // heading south: left normal points west (living), right points east (kitchen)
    expect(ops.roomOnSide(sample, partition, 'left')?.name).toBe('Living room');
    expect(ops.roomOnSide(sample, partition, 'right')?.name).toBe('Kitchen & dining');
  });
});

describe('painting shortcuts', () => {
  it('paints the room-facing face of every wall around one room (long walls included), nothing else', () => {
    const p = produce(sample, (d) => ops.paintRoomWalls(d, room('Living room').id, 'paint-sage'));
    const sage = (w: (typeof p.walls)[number]) =>
      [w.materialInside, w.materialOutside].filter((m) => m === 'paint-sage').length;
    // North wall, west wall, partition and the y = 7 wall run along the living room → exactly one face each.
    expect(sage(p.walls.find((w) => w.id === wall(0, 0, 10, 0).id)!)).toBe(1);
    expect(sage(p.walls.find((w) => w.id === wall(6, 0, 6, 7).id)!)).toBe(1);
    expect(sage(p.walls.find((w) => w.id === wall(0, 7, 10, 7).id)!)).toBe(1);
    expect(sage(p.walls.find((w) => w.id === wall(0, 12, 0, 0).id)!)).toBe(1);
    // The partition's kitchen side (its right face) and the north wall's exterior side stay as they were.
    expect(p.walls.find((w) => w.id === wall(6, 0, 6, 7).id)!.materialOutside).toBe('paint-white');
    expect(p.walls.find((w) => w.id === wall(0, 0, 10, 0).id)!.materialOutside).toBe('brick-red');
    expect(p.walls.filter((w) => sage(w) > 0)).toHaveLength(4);
  });

  it('paints a face on every wall of a level, and floors / ceilings of a level', () => {
    const p = produce(sample, (d) => {
      ops.paintLevelWalls(d, L0, 'materialOutside', 'brick-white');
      ops.paintLevelFloors(d, L0, 'floor-marble');
      ops.paintLevelCeilings(d, L0, 'paint-blue');
    });
    expect(
      p.walls.filter((w) => w.levelId === L0).every((w) => w.materialOutside === 'brick-white'),
    ).toBe(true);
    expect(
      p.walls.filter((w) => w.levelId !== L0).every((w) => w.materialOutside !== 'brick-white'),
    ).toBe(true);
    expect(
      p.rooms
        .filter((r) => r.levelId === L0)
        .every((r) => r.floorMaterial === 'floor-marble' && r.ceilingMaterial === 'paint-blue'),
    ).toBe(true);
  });

  it('item surfaces can be set and cleared', () => {
    const id = sample.items[0]!.id;
    const p = produce(sample, (d) => ops.paintItemSurface(d, id, 'laminate-oak'));
    expect(p.items[0]!.props.material).toBe('laminate-oak');
    expect(
      produce(p, (d) => ops.paintItemSurface(d, id, null)).items[0]!.props.material,
    ).toBeUndefined();
  });
});

describe('surfaces + eyedropper', () => {
  beforeEach(() => {
    useModel.getState().loadProject(createSampleProject());
    usePaint.getState().setHeld(null);
    usePlanStore.getState().setToast(null);
  });

  it('reads and paints each kind of surface', () => {
    const p = produce(sample, (d) => {
      const surfaces: Surface[] = [
        { type: 'wall', wallId: wall(6, 0, 6, 7).id, field: 'materialOutside' },
        { type: 'floor', roomId: room('Study').id },
        { type: 'ceiling', roomId: room('Study').id },
        { type: 'item', itemId: sample.items[0]!.id },
      ];
      surfaces.forEach((s) => paintSurface(d, s, 'paint-charcoal'));
      surfaces.forEach((s) => expect(readSurface(d, s)).toBe('paint-charcoal'));
    });
    expect(p).toBeDefined();
  });

  it('first click copies a material, later clicks paint it (each paint is one undo step); Alt picks again', () => {
    const state = () => useModel.getState();
    const inStore = (name: string) =>
      state().project.rooms.find(
        (r) => r.name === name && r.levelId === state().project.levels[0]!.id,
      )!;
    const study = inStore('Study');
    const living = inStore('Living room');
    eyedrop({ type: 'floor', roomId: study.id }, false); // copy
    expect(usePaint.getState().held).toBe(study.floorMaterial);
    expect(usePlanStore.getState().toast).toMatch(/Copied/);
    state().apply((p) => ops.updateRoom(p, living.id, { floorMaterial: 'floor-marble' }));
    eyedrop({ type: 'floor', roomId: living.id }, true); // Alt: copy marble instead
    expect(usePaint.getState().held).toBe('floor-marble');
    eyedrop({ type: 'floor', roomId: study.id }, false); // paint
    expect(state().project.rooms.find((r) => r.id === study.id)!.floorMaterial).toBe(
      'floor-marble',
    );
    expect(usePlanStore.getState().toast).toMatch(/Painted/);
    undo();
    expect(state().project.rooms.find((r) => r.id === study.id)!.floorMaterial).toBe(
      study.floorMaterial,
    );
  });

  it('refuses to copy from a surface with no library material (e.g. an item still in its default colour)', () => {
    eyedrop({ type: 'item', itemId: useModel.getState().project.items[0]!.id }, false);
    expect(usePaint.getState().held).toBeNull();
    expect(usePlanStore.getState().toast).toMatch(/can’t take/);
  });
});
