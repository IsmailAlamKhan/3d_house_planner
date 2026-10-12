import { produce } from 'immer';
import { createEmptyProject } from './project';
import {
  addColumn,
  addItem,
  addLevel,
  addOpening,
  addRoof,
  addRoom,
  addStair,
  addWall,
  type NewWall,
} from './ops';
import type { Project, RoomType } from './types';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** A simple two-level duplex inside a 10 × 12 m shell. */
export function createSampleProject(): Project {
  return produce(createEmptyProject('Sample duplex'), (p) => {
    const L0 = p.levels[0]!.id;
    const L1 = addLevel(p, { name: 'Upper floor' });
    p.shell.notes = 'Sample apartment: 10 × 12 m shell, entrance on the east wall.';
    p.shell.fixedPlumbingPoints = [
      { x: 1.5, y: 11.5 },
      { x: 9.5, y: 0.5 },
    ];

    const wall = (
      levelId: string,
      sx: number,
      sy: number,
      ex: number,
      ey: number,
      extra: Partial<NewWall> = {},
    ) => addWall(p, { levelId, start: { x: sx, y: sy }, end: { x: ex, y: ey }, ...extra });
    const ext = { type: 'exterior' as const, thickness: 0.3, materialOutside: 'brick-red' };

    for (const L of [L0, L1]) {
      const north = wall(L, 0, 0, 10, 0, ext);
      const east = wall(L, 10, 0, 10, 12, ext);
      const south = wall(L, 10, 12, 0, 12, ext);
      wall(L, 0, 12, 0, 0, ext);
      addOpening(p, { wallId: north, kind: 'window', offset: 3, width: 1.8 });
      addOpening(p, { wallId: north, kind: 'window', offset: 8, width: 1.2 });
      addOpening(p, {
        wallId: south,
        kind: 'window',
        offset: 8.5,
        width: 0.8,
        height: 0.9,
        sillHeight: 1.3,
      });
      if (L === L0)
        addOpening(p, {
          wallId: east,
          kind: 'door',
          offset: 9.5,
          width: 1.0,
          catalogId: 'door-entrance',
        });
      else addOpening(p, { wallId: east, kind: 'window', offset: 9.5, width: 1.2 });
      addColumn(p, { levelId: L, position: { x: 3, y: 3.5 } });
      addColumn(p, { levelId: L, position: { x: 8, y: 3.5 } });
    }

    // Ground floor partitions
    const g1 = wall(L0, 6, 0, 6, 7);
    const g2 = wall(L0, 0, 7, 10, 7);
    wall(L0, 3, 7, 3, 12);
    wall(L0, 7, 7, 7, 12);
    addOpening(p, { wallId: g1, kind: 'archway', offset: 3.5, width: 1.6 });
    addOpening(p, { wallId: g2, kind: 'door', offset: 1.5 });
    addOpening(p, { wallId: g2, kind: 'door', offset: 5 });
    addOpening(p, { wallId: g2, kind: 'door', offset: 8.5 });

    // Upper floor partitions
    const u1 = wall(L1, 6, 0, 6, 7);
    const u2 = wall(L1, 0, 7, 10, 7);
    wall(L1, 3, 7, 3, 12);
    addOpening(p, { wallId: u1, kind: 'door', offset: 5.5 });
    addOpening(p, { wallId: u2, kind: 'door', offset: 1.5 });
    addOpening(p, { wallId: u2, kind: 'door', offset: 5 });
    addOpening(p, { wallId: u2, kind: 'door', offset: 8.5 });

    const room = (
      levelId: string,
      name: string,
      type: RoomType,
      x0: number,
      y0: number,
      x1: number,
      y1: number,
    ) => addRoom(p, { levelId, name, type, polygon: rect(x0, y0, x1, y1) });
    room(L0, 'Living room', 'living', 0, 0, 6, 7);
    room(L0, 'Kitchen & dining', 'kitchen', 6, 0, 10, 7);
    room(L0, 'Bathroom', 'bathroom', 0, 7, 3, 12);
    room(L0, 'Study', 'study', 3, 7, 7, 12);
    room(L0, 'Entrance hall', 'stair', 7, 7, 10, 12);
    room(L1, 'Master bedroom', 'bedroom', 0, 0, 6, 7);
    room(L1, 'Bedroom 2', 'bedroom', 6, 0, 10, 7);
    room(L1, 'Bathroom', 'bathroom', 0, 7, 3, 12);
    room(L1, 'Landing', 'corridor', 3, 7, 10, 12);

    addStair(p, {
      fromLevelId: L0,
      toLevelId: L1,
      type: 'straight',
      position: { x: 8.5, y: 7.4 },
      rotation: Math.PI / 2,
      width: 1,
    });
    addRoof(p, { levelId: L1, kind: 'void', polygon: rect(8, 7.4, 9, 11.9) });
    addRoof(p, { levelId: L1, kind: 'flat', polygon: rect(0, 0, 10, 12) });

    addItem(p, { levelId: L0, catalogId: 'sofa-3seat', position: { x: 3, y: 5.5 } });
    addItem(p, { levelId: L0, catalogId: 'dining-table-6', position: { x: 8, y: 3 } });
    addItem(p, { levelId: L0, catalogId: 'desk', position: { x: 5, y: 11.3 } });
    addItem(p, { levelId: L1, catalogId: 'bed-queen', position: { x: 3, y: 2.5 } });
    addItem(p, {
      levelId: L1,
      catalogId: 'wardrobe',
      position: { x: 0.4, y: 5.5 },
      rotation: Math.PI / 2,
    });
  });
}
