import { produce } from 'immer';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sample';
import * as ops from '../model/ops';
import { useModel } from '../model/store';
import type { Project } from '../model/types';
import { usePlanStore } from '../plan2d/planStore';
import { areaSchedule, runChecks } from './index';
import { focusIssue } from './focus';

const sample = createSampleProject();
const L0 = sample.levels[0]!.id;
const L1 = sample.levels[1]!.id;
const rules = (p: Project) => runChecks(p).map((i) => i.rule);
const issue = (p: Project, rule: string) => runChecks(p).find((i) => i.rule === rule);
const room = (p: Project, name: string, level = L0) =>
  p.rooms.find((r) => r.name === name && r.levelId === level)!;

describe('constraint checker', () => {
  it('the sample duplex passes every check', () => {
    expect(runChecks(sample)).toEqual([]);
  });

  it('flags low stair headroom (storey too low) and links to the stair', () => {
    const p = produce(sample, (d) => void ops.updateLevel(d, L0, { floorToCeiling: 2.1 }));
    const i = issue(p, 'stair-headroom')!;
    expect(i.severity).toBe('error');
    expect(i.message).toMatch(/[Hh]eadroom/);
    expect(i.target).toMatchObject({
      levelId: L0,
      selection: { type: 'stair', ids: [sample.stairs[0]!.id] },
    });
  });

  it('flags a beam that leaves less than 2.0 m over the stair', () => {
    const low = produce(
      sample,
      (d) =>
        void d.shell.beams.push({
          id: 'b1',
          start: { x: 7.2, y: 10 },
          end: { x: 9.8, y: 10 },
          width: 0.3,
          drop: 0.7,
        }),
    );
    const i = issue(low, 'beam-headroom')!;
    expect(i.message).toMatch(/beam over the stair/);
    expect(i.target.rect).toBeDefined();
    const high = produce(
      sample,
      (d) =>
        void d.shell.beams.push({
          id: 'b2',
          start: { x: 7.2, y: 7.6 },
          end: { x: 9.8, y: 7.6 },
          width: 0.3,
          drop: 0.1,
        }),
    );
    expect(rules(high)).not.toContain('beam-headroom');
    const away = produce(
      sample,
      (d) =>
        void d.shell.beams.push({
          id: 'b3',
          start: { x: 0.5, y: 1 },
          end: { x: 5.5, y: 1 },
          width: 0.3,
          drop: 0.9,
        }),
    );
    expect(rules(away)).not.toContain('beam-headroom'); // a low beam is only a problem over the stair
  });

  it('flags stair comfort problems (steep riser, short tread) and a stair outside the apartment', () => {
    const steep = produce(
      sample,
      (d) => void ops.updateStair(d, d.stairs[0]!.id, { riserHeight: 0.22 }),
    );
    expect(issue(steep, 'stair-comfort')!.message).toMatch(/Riser/);
    const short = produce(
      sample,
      (d) => void ops.updateStair(d, d.stairs[0]!.id, { treadDepth: 0.2 }),
    );
    expect(issue(short, 'stair-comfort')!.message).toMatch(/Tread/);
    const out = produce(
      sample,
      (d) => void ops.updateStair(d, d.stairs[0]!.id, { position: { x: 20, y: 5 } }),
    );
    expect(issue(out, 'stair-fit')!.severity).toBe('error');
  });

  it('flags rooms that cannot be reached from the entrance', () => {
    const study = room(sample, 'Study');
    // Remove the study's only door (on the y = 7 wall, centred at x = 5).
    const p = produce(sample, (d) => {
      const wall = d.walls.find(
        (w) => w.levelId === L0 && w.start.y === 7 && w.end.y === 7 && w.end.x === 10,
      )!;
      const door = d.openings.find((o) => o.wallId === wall.id && Math.abs(o.offset - 5) < 0.01)!;
      ops.deleteOpening(d, door.id);
    });
    const i = runChecks(p).find((x) => x.rule === 'unreachable')!;
    expect(i.severity).toBe('error');
    expect(i.message).toMatch(/Study/);
    expect(i.target).toMatchObject({ levelId: L0, selection: { type: 'room', ids: [study.id] } });
  });

  it('an unreachable upstairs shows up too (stair removed)', () => {
    const p = produce(sample, (d) => void (d.stairs = []));
    const names = runChecks(p)
      .filter((x) => x.rule === 'unreachable')
      .map((x) => x.message);
    expect(names.some((m) => /Master bedroom/.test(m))).toBe(true);
    expect(names.some((m) => /Landing/.test(m))).toBe(true);
  });

  it('flags a missing entrance door', () => {
    const p = produce(sample, (d) => {
      const door = d.openings.find((o) => o.catalogId === 'door-entrance')!;
      ops.deleteOpening(d, door.id);
    });
    expect(issue(p, 'entrance')!.message).toMatch(/no door at the entrance/);
  });

  it('flags bedrooms without a window', () => {
    const p = produce(sample, (d) => {
      const bed2 = room(d, 'Bedroom 2', L1);
      const wins = d.openings.filter(
        (o) => o.kind === 'window' && d.walls.find((w) => w.id === o.wallId)!.levelId === L1,
      );
      for (const o of wins) {
        const w = d.walls.find((x) => x.id === o.wallId)!;
        const cx =
          w.start.x +
          ((w.end.x - w.start.x) / Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y)) * o.offset;
        const cy =
          w.start.y +
          ((w.end.y - w.start.y) / Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y)) * o.offset;
        if (cx >= 6 && cx <= 10 && cy <= 0.01) ops.deleteOpening(d, o.id);
      }
      void bed2;
    });
    const i = issue(p, 'bedroom-window')!;
    expect(i.message).toMatch(/Bedroom 2 has no window/);
    expect(i.target.selection).toEqual({ type: 'room', ids: [room(sample, 'Bedroom 2', L1).id] });
  });

  it('flags wet rooms whose drain run is too long (limit is configurable)', () => {
    const far = produce(sample, (d) => {
      d.shell.fixedPlumbingPoints = [{ x: 9.8, y: 0.2 }];
    });
    const flagged = runChecks(far)
      .filter((x) => x.rule === 'drain')
      .map((x) => x.message);
    expect(flagged.some((m) => /Bathroom/.test(m))).toBe(true);
    expect(flagged.some((m) => /nearest plumbing point/.test(m))).toBe(true);
    const relaxed = produce(far, (d) => void (d.settings.checks.maxDrainRun = 40));
    expect(rules(relaxed)).not.toContain('drain');
  });

  it('flags rooms below the minimum area for their type (defaults and overrides)', () => {
    const tiny = produce(
      sample,
      (d) =>
        void ops.updateRoom(d, room(d, 'Study').id, {
          polygon: [
            { x: 3, y: 7 },
            { x: 5, y: 7 },
            { x: 5, y: 8.5 },
            { x: 3, y: 8.5 },
          ],
        }),
    );
    expect(runChecks(tiny).some((x) => x.rule === 'min-area' && /Study/.test(x.message))).toBe(
      true,
    );
    const strict = produce(sample, (d) => void (d.settings.checks.minAreas = { bedroom: 60 }));
    expect(runChecks(strict).filter((x) => x.rule === 'min-area')).toHaveLength(2);
    const lenient = produce(tiny, (d) => void (d.settings.checks.minAreas = { study: 1 }));
    expect(rules(lenient)).not.toContain('min-area');
  });

  it('flags furniture that overlaps a locked column or blocks the entrance', () => {
    const p = produce(sample, (d) => {
      ops.addItem(d, { levelId: L0, catalogId: 'plant', position: { x: 3.05, y: 3.5 } });
      ops.addItem(d, {
        levelId: L0,
        catalogId: 'wardrobe',
        position: { x: 9.3, y: 9.5 },
        rotation: Math.PI / 2,
      });
    });
    expect(
      runChecks(p).some((x) => x.rule === 'column-obstructed' && /plant/.test(x.message)),
    ).toBe(true);
    const blocked = runChecks(p).find(
      (x) => x.rule === 'entrance' && /blocks the entrance/.test(x.message),
    )!;
    expect(blocked.severity).toBe('error');
    expect(blocked.target.selection?.type).toBe('item');
  });

  it('flags door swings that hit furniture or each other', () => {
    const hit = produce(sample, (d) => {
      ops.addItem(d, { levelId: L0, catalogId: 'desk', position: { x: 4.6, y: 7.5 }, rotation: 0 });
    });
    const i = issue(hit, 'door-swing')!;
    expect(i.message).toMatch(/swings into the desk/);
    expect(i.target.selection?.type).toBe('opening');

    const doors = produce(sample, (d) => {
      const wall = d.walls.find((w) => w.levelId === L0 && w.start.y === 7 && w.end.x === 10)!;
      ops.deleteOpening(
        d,
        d.openings.find((o) => o.wallId === wall.id && Math.abs(o.offset - 5) < 0.01)!.id,
      );
      ops.addOpening(d, { wallId: wall.id, offset: 6.4, kind: 'door', swing: 'left' });
      const hall = d.walls.find(
        (w) => w.levelId === L0 && w.start.x === 7 && w.end.x === 7 && w.start.y === 7,
      )!;
      ops.addOpening(d, { wallId: hall.id, offset: 0.55, kind: 'door', swing: 'left' });
    });
    expect(
      runChecks(doors).some(
        (x) => x.rule === 'door-swing' && /swing into each other/.test(x.message),
      ),
    ).toBe(true);
  });

  it('orders errors before warnings', () => {
    const p = produce(sample, (d) => {
      ops.addItem(d, { levelId: L0, catalogId: 'plant', position: { x: 3.05, y: 3.5 } });
      d.stairs = [];
    });
    const sev = runChecks(p).map((i) => i.severity);
    expect(sev.indexOf('warning')).toBeGreaterThan(sev.lastIndexOf('error'));
  });
});

describe('click-to-highlight', () => {
  beforeEach(() => {
    useModel.getState().loadProject(createSampleProject());
    usePlanStore.getState().setSize({ w: 800, h: 600 });
    usePlanStore.getState().setFlash(null);
  });

  it('selects the offending element, switches level, shows the plan and pulses the spot', () => {
    const s = () => useModel.getState();
    s().setViewMode('3d');
    s().setActiveLevel(s().project.levels[0]!.id);
    const upper = s().project.levels[1]!.id;
    const bad = produce(s().project, (d) => {
      for (const o of [...d.openings]) {
        const w = d.walls.find((x) => x.id === o.wallId)!;
        if (w.levelId === upper && o.kind === 'window' && w.start.y === 0)
          ops.deleteOpening(d, o.id);
      }
    });
    s().loadProject(bad);
    s().setActiveLevel(s().project.levels[0]!.id);
    const i = runChecks(s().project).find((x) => x.rule === 'bedroom-window')!;
    focusIssue(i);
    expect(s().activeLevelId).toBe(upper);
    expect(s().selection).toEqual(i.target.selection);
    expect(s().viewMode).toBe('split');
    expect(usePlanStore.getState().flash).not.toBeNull();
    expect(usePlanStore.getState().view.scale).toBeGreaterThan(5);
  });

  it('highlights things that cannot be selected (a beam, the entrance) with a pulse on the plan', () => {
    const p = produce(
      createSampleProject(),
      (d) => void ops.deleteOpening(d, d.openings.find((o) => o.catalogId === 'door-entrance')!.id),
    );
    useModel.getState().loadProject(p);
    const i = runChecks(p).find((x) => x.rule === 'entrance')!;
    focusIssue(i);
    expect(usePlanStore.getState().flash).toMatchObject({ min: i.target.rect!.min });
    expect(useModel.getState().selection.type).toBeNull();
  });
});

describe('area schedule', () => {
  const s = areaSchedule(sample);
  it('lists per-level and total areas with usable vs wall area', () => {
    expect(s.levels).toHaveLength(2);
    expect(s.levels[0]!.gross).toBe(120);
    expect(s.total.gross).toBe(240);
    for (const l of s.levels) {
      expect(l.usable).toBeGreaterThan(95);
      expect(l.usable).toBeLessThan(120);
      expect(l.usable + l.walls + l.openVoid).toBeCloseTo(l.gross, 3);
    }
    expect(s.total.usable).toBeCloseTo(s.levels[0]!.usable + s.levels[1]!.usable);
    expect(s.total.walls).toBeGreaterThan(0);
  });
  it('splits usable area by room type and reports circulation', () => {
    expect(s.byType.bedroom).toBeGreaterThan(50);
    expect(s.byType.living).toBeGreaterThan(30);
    expect(s.circulationShare).toBeGreaterThan(0.05);
    expect(s.circulationShare).toBeLessThan(0.4);
  });
  it('shows the stairwell opening on the upper level and keeps wall area non-negative', () => {
    expect(s.levels[1]!.openVoid).toBeGreaterThan(3);
    expect(s.levels[0]!.openVoid).toBe(0);
  });
  it('an empty project has zero areas', () => {
    const e = areaSchedule(
      produce(sample, (d) => {
        d.rooms = [];
        d.walls = [];
      }),
    );
    expect(e.total.usable).toBe(0);
    expect(e.circulationShare).toBe(0);
  });
});
