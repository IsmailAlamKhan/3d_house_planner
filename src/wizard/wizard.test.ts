import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { runChecks } from '../checks';
import { createSampleProject } from '../model/sample';
import { ProjectSchema } from '../model/schemas';
import { copyWallsFromBelow, deleteOpening, updateOpening, ModelError } from '../model/ops';
import { doubleHeightVoids } from '../scene3d/generators/voids';
import { generateVoidBalustrade } from '../scene3d/generators/balustrade';
import { generateBeam } from '../scene3d/generators/floors';
import { TEMPLATES } from '../templates';
import { projectWithTemplate } from './finish';
import {
  defaultConfig,
  footprintOf,
  planHeights,
  projectFromConfig,
  validateFootprint,
  type ShellConfig,
} from './shell';

const cfg = (patch: Partial<ShellConfig>): ShellConfig => ({ ...defaultConfig(), ...patch });

describe('shell wizard', () => {
  it('rectangle and L footprints are valid polygons', () => {
    expect(validateFootprint(footprintOf(cfg({})))).toEqual([]);
    for (const corner of ['ne', 'nw', 'se', 'sw'] as const) {
      const fp = footprintOf(cfg({ shape: 'L', notchCorner: corner }));
      expect(fp).toHaveLength(6);
      expect(validateFootprint(fp)).toEqual([]);
    }
  });

  it('rejects a self-crossing outline and tiny shells', () => {
    const bow = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(validateFootprint(bow).length).toBeGreaterThan(0);
    expect(
      validateFootprint([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ]).length,
    ).toBeGreaterThan(0);
  });

  it('warns when the storey heights fall under 2.4 m', () => {
    expect(planHeights(5.8).ok).toBe(true);
    const low = planHeights(4.8);
    expect(low.ok).toBe(false);
    expect(low.warnings.length).toBeGreaterThan(0);
  });

  it('builds a valid two-level project with locked facade windows', () => {
    const p = projectFromConfig(
      cfg({
        windows: [{ id: 'w1', edge: 0, offset: 3, width: 1.2, height: 1.2, sillHeight: 0.9 }],
      }),
    );
    expect(ProjectSchema.safeParse(p).success).toBe(true);
    expect(p.levels).toHaveLength(2);
    const locked = p.openings.filter((o) => o.locked);
    expect(locked).toHaveLength(2);
    expect(() => deleteOpening(p, locked[0]!.id)).toThrow(ModelError);
  });

  it('locked windows cannot be moved but can be restyled', () => {
    const p = projectFromConfig(
      cfg({
        windows: [{ id: 'w1', edge: 0, offset: 3, width: 1.2, height: 1.2, sillHeight: 0.9 }],
      }),
    );
    const o = p.openings.find((x) => x.locked)!;
    const d = structuredClone(p);
    expect(() => updateOpening(d, o.id, { offset: o.offset + 1 })).toThrow(ModelError);
    expect(() => updateOpening(d, o.id, { catalogId: 'window-fixed' })).not.toThrow();
  });

  it.each([
    ['rectangle 10x12', cfg({})],
    ['small rectangle 7x9', cfg({ width: 7, depth: 9 })],
    ['wide rectangle 14x9', cfg({ width: 14, depth: 9 })],
    ['L-shape', cfg({ shape: 'L', width: 12, depth: 12, notchW: 4, notchD: 5 })],
  ])('every template fits %s without overlapping walls', (_n, c) => {
    const base = projectFromConfig(c);
    for (const tpl of TEMPLATES) {
      const p = projectWithTemplate(base, tpl);
      expect(ProjectSchema.safeParse(p).success).toBe(true);
      expect(p.rooms.length).toBeGreaterThan(3);
      expect(p.stairs.length).toBe(1);
      // Walls on one level never overlap each other on the same line.
      for (const level of p.levels) {
        const ws = p.walls.filter((w) => w.levelId === level.id);
        for (let i = 0; i < ws.length; i++)
          for (let j = i + 1; j < ws.length; j++) {
            const a = ws[i]!;
            const b = ws[j]!;
            const same =
              (a.start.x === b.start.x &&
                a.start.y === b.start.y &&
                a.end.x === b.end.x &&
                a.end.y === b.end.y) ||
              (a.start.x === b.end.x &&
                a.start.y === b.end.y &&
                a.end.x === b.start.x &&
                a.end.y === b.start.y);
            expect(same).toBe(false);
          }
      }
    }
  });

  it('the double-height template makes a void on the upper level with a guard rail', () => {
    const base = projectFromConfig(cfg({ width: 11, depth: 13 }));
    const p = projectWithTemplate(
      base,
      TEMPLATES.find((t) => t.id === 'open-double-height')!,
    );
    expect(p.rooms.some((r) => r.doubleHeight)).toBe(true);
    const upper = p.levels[1]!;
    const voids = doubleHeightVoids(p, upper);
    expect(voids.length).toBe(1);
    const v = voids[0]!;
    // The planned void keeps its walls as a guard; with no wall along an edge a glass guard is generated.
    expect(generateVoidBalustrade('t', v.polygon, [], v.roomId).length).toBeGreaterThan(0);
    const upperWalls = p.walls.filter((w) => w.levelId === upper.id);
    expect(generateVoidBalustrade('t', v.polygon, upperWalls, v.roomId).length).toBeLessThanOrEqual(
      2,
    );
    expect(runChecks(p).filter((i) => i.severity === 'error' && i.rule === 'unreachable')).toEqual(
      [],
    );
  });
});

describe('beams', () => {
  it('a beam is a box hanging below the ceiling', () => {
    const p = projectFromConfig(cfg({}));
    const level = p.levels[0]!;
    const part = generateBeam(
      { id: 'b', start: { x: 0, y: 5 }, end: { x: 10, y: 5 }, width: 0.3, drop: 0.4 },
      level,
    );
    part.geometry.computeBoundingBox();
    const box = part.geometry.boundingBox!;
    expect(box.max.y).toBeCloseTo(level.floorToCeiling, 5);
    expect(box.min.y).toBeCloseTo(level.floorToCeiling - 0.4, 5);
    expect(box.max.x - box.min.x).toBeCloseTo(10, 5);
  });
});

describe('copy walls from below', () => {
  it('adds only the missing walls and is idempotent', () => {
    const base = createSampleProject();
    const p = produce(base, (d) => {
      d.walls = d.walls.filter((w) => w.levelId === d.levels[0]!.id);
      const n = copyWallsFromBelow(d, d.levels[1]!.id);
      expect(n).toBeGreaterThan(0);
      expect(copyWallsFromBelow(d, d.levels[1]!.id)).toBe(0);
    });
    expect(p.walls.filter((w) => w.levelId === p.levels[1]!.id).length).toBeGreaterThan(0);
  });
});
