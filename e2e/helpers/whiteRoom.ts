import { produce } from 'immer';
import * as ops from '../../src/model/ops';
import { createEmptyProject } from '../../src/model/project';
import type { Project } from '../../src/model/types';

/**
 * The test scene for the lighting checks: a villa plot (so there is unroofed outdoor ground in the picture) with one
 * room — white walls, white floor, a white sofa against the north wall, one window in the south wall and one ceiling
 * light in the middle.
 */
export const ROOM = { x0: 7, y0: 5, w: 6, d: 5 } as const;
export const SOFA = { x: 10, y: 5.7, w: 2.2, d: 0.95, h: 0.85 } as const;
export const WINDOW = { x: 8.6, y: ROOM.y0 + ROOM.d } as const;

export function whiteRoomProject(): Project {
  return produce(createEmptyProject('White room'), (p) => {
    const L = p.levels[0]!.id;
    p.kind = 'villa';
    const { x0, y0, w, d } = ROOM;
    const fp = [
      { x: x0, y: y0 },
      { x: x0 + w, y: y0 },
      { x: x0 + w, y: y0 + d },
      { x: x0, y: y0 + d },
    ];
    p.shell.footprint = fp;
    p.shell.entrance = { position: { x: x0 + w / 2, y: y0 + d }, direction: Math.PI / 2 };
    ops.setPlot(p, [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 15 },
      { x: 0, y: 15 },
    ]);
    const walls = fp.map((a, i) =>
      ops.addWall(p, {
        levelId: L,
        start: a,
        end: fp[(i + 1) % 4]!,
        type: 'exterior',
        thickness: 0.3,
        materialInside: 'paint-white',
        materialOutside: 'paint-white',
      }),
    );
    ops.syncRooms(p, L);
    const room = p.rooms[0]!;
    room.name = 'White room';
    room.type = 'living';
    room.floorMaterial = 'laminate-white';
    room.ceilingMaterial = 'paint-white';
    // South wall = the wall along y = y0 + d (index 2): one window near its west end.
    ops.addOpening(p, {
      wallId: walls[2]!,
      offset: w - (WINDOW.x - x0) /* the wall runs east→west */,
      kind: 'window',
      catalogId: 'window-casement',
      width: 1.6,
      height: 1.4,
      sillHeight: 0.9,
    });
    ops.addItem(p, {
      levelId: L,
      catalogId: 'sofa-3seat',
      position: { x: SOFA.x, y: SOFA.y },
      rotation: 0, // back to the north wall (y = 5), seat facing south
      props: { color: '#ffffff' },
    });
    ops.addItem(p, {
      levelId: L,
      catalogId: 'ceiling-light',
      position: { x: x0 + w / 2, y: y0 + d / 2 },
      elevation: p.levels[0]!.floorToCeiling - 0.08, // fixed to the ceiling
    });
    ops.addRoof(p, { levelId: L, kind: 'flat', polygon: fp });
  });
}
