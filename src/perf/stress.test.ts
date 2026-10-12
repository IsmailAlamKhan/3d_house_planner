import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { detectRoomPolygons } from '../geometry/rooms';
import { runChecks } from '../checks';
import { syncRooms, updateWall } from '../model/ops';
import { DEFAULT_CUT_HEIGHT, SceneBuilder } from '../scene3d/sceneModel';
import { createStressProject } from './stress';

const time = <T>(f: () => T): [T, number] => {
  const t0 = performance.now();
  const r = f();
  return [r, performance.now() - t0];
};

// Code-coverage instrumentation slows everything down; the budgets are for normal runs.
const slack = import.meta.env.VITE_COVERAGE ? 10 : 1;

describe('stress project', () => {
  const project = createStressProject();
  const opts = { wallMode: 'up' as const, cutHeight: DEFAULT_CUT_HEIGHT, doorsOpen: true };

  it('is as heavy as advertised', () => {
    expect(project.levels).toHaveLength(2);
    expect(project.walls.length).toBeGreaterThanOrEqual(140);
    expect(project.items.length).toBeGreaterThanOrEqual(280);
  });

  it('measures build / edit / rooms / checks (printed)', () => {
    const builder = new SceneBuilder();
    const [, first] = time(() => builder.build(project, opts));
    const wall = project.walls.find((w) => w.type === 'interior')!;
    const edited = produce(project, (d) => void updateWall(d, wall.id, { thickness: 0.2 }));
    const [, rebuild] = time(() => builder.build(edited, opts));
    const [, rooms] = time(() => produce(project, (d) => void syncRooms(d, project.levels[0]!.id)));
    const [, detect] = time(() =>
      detectRoomPolygons(project.walls.filter((w) => w.levelId === project.levels[0]!.id)),
    );
    console.log(`PERF detect ${detect.toFixed(0)} ms`);
    const [, checks] = time(() => runChecks(project));
    console.log(
      `PERF first build ${first.toFixed(0)} ms · edit rebuild ${rebuild.toFixed(0)} ms · syncRooms ${rooms.toFixed(0)} ms · checks ${checks.toFixed(0)} ms`,
    );
    // Budgets: an edit must feel instant (the goal is edit-to-render under 50 ms).
    expect(rebuild).toBeLessThan(50 * slack);
    expect(rooms).toBeLessThan(50 * slack);
    expect(checks).toBeLessThan(50 * slack);
    expect(detect).toBeLessThan(50 * slack);
    expect(first).toBeLessThan(2000 * slack);
  });
});

describe('layout solver', () => {
  it('measures a full design (printed)', async () => {
    const { solveLayout } = await import('../ai/layout/solve');
    const { TEMPLATES } = await import('../templates');
    const { createSampleProject } = await import('../model/sample');
    const s = createSampleProject();
    const times = TEMPLATES.map((t) => {
      const t0 = performance.now();
      solveLayout({
        intent: t.intent,
        footprint: s.shell.footprint,
        entrance: s.shell.entrance,
        plumbing: s.shell.fixedPlumbingPoints,
        columns: [],
        maxHeight: s.shell.maxHeight,
      });
      return performance.now() - t0;
    });
    console.log(`PERF solver ms per template: ${times.map((x) => x.toFixed(0)).join(', ')}`);
    expect(Math.max(...times)).toBeLessThan(2000);
  });
});
