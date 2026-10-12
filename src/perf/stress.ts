import { produce } from 'immer';
import { addItem, addLevel, addWall, syncRooms } from '../model/ops';
import { createEmptyProject } from '../model/project';
import type { Project } from '../model/types';

const CATALOG = [
  'chair',
  'sofa-3seat',
  'coffee-table',
  'plant',
  'bookshelf',
  'side-table',
  'floor-lamp',
  'armchair',
];

/**
 * A deliberately heavy project: two levels, about 150 walls (a 9 × 8 grid of 4 m rooms per level plus the shell) and
 * 300 furniture items — used to measure build and edit times.
 */
export function createStressProject(): Project {
  return produce(createEmptyProject('Stress'), (p) => {
    p.shell.footprint = [
      { x: 0, y: 0 },
      { x: 36, y: 0 },
      { x: 36, y: 32 },
      { x: 0, y: 32 },
    ];
    p.shell.maxHeight = 6;
    const upper = addLevel(p, { name: 'Upper' });
    const levels = [p.levels[0]!.id, upper];
    for (const levelId of levels) {
      const w = (sx: number, sy: number, ex: number, ey: number, type: 'exterior' | 'interior') =>
        addWall(p, {
          levelId,
          start: { x: sx, y: sy },
          end: { x: ex, y: ey },
          type,
          thickness: type === 'exterior' ? 0.3 : 0.15,
        });
      // Shell.
      w(0, 0, 36, 0, 'exterior');
      w(36, 0, 36, 32, 'exterior');
      w(36, 32, 0, 32, 'exterior');
      w(0, 32, 0, 0, 'exterior');
      // Interior grid: vertical and horizontal partitions in 4 m pieces → ≈ 90 walls a level.
      for (let x = 4; x < 36; x += 4) for (let y = 0; y < 32; y += 4) w(x, y, x, y + 4, 'interior');
      for (let y = 4; y < 32; y += 4)
        for (let x = 0; x < 36; x += 12) w(x, y, x + 12, y, 'interior');
      syncRooms(p, levelId);
    }
    let n = 0;
    for (const levelId of levels)
      for (let i = 0; i < 150; i++) {
        const x = 2 + (i % 18) * 2 + (i % 2) * 0.5;
        const y = 2 + Math.floor(i / 18) * 3.5;
        try {
          addItem(p, {
            levelId,
            catalogId: CATALOG[(i + n) % CATALOG.length]!,
            position: { x, y },
            rotation: (i % 4) * (Math.PI / 2),
          });
          n++;
        } catch {
          // an item that does not fit is skipped
        }
      }
  });
}
