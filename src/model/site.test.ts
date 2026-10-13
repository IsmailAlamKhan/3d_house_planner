import { produce } from 'immer';
import { beforeEach, describe, expect, it } from 'vitest';
import { exportProjectJson, importProjectJson } from './io';
import { migrateProject } from './migrate';
import * as ops from './ops';
import { createEmptyProject } from './project';
import { createSampleProject } from './sample';
import { edit, redo, undo, useModel } from './store';
import { itemArea, isItemInBounds } from './integrity';

const plot = [
  { x: 0, y: 0 },
  { x: 30, y: 0 },
  { x: 30, y: 36 },
  { x: 0, y: 36 },
];

const villa = () =>
  produce(createEmptyProject('Villa'), (p) => {
    p.kind = 'villa';
    ops.setPlot(p, plot);
  });

describe('project kind and site', () => {
  it('files saved before villa mode load as apartments with an empty site', () => {
    const old = JSON.parse(exportProjectJson(createSampleProject())) as Record<string, unknown>;
    delete old.kind;
    delete old.site;
    const p = migrateProject(old);
    expect(p.kind).toBe('apartment');
    expect(p.site).toEqual({ plot: [], gates: [], zones: [], setback: 1.5 });
    expect(p.levels).toHaveLength(2);
  });

  it('a villa round-trips through JSON unchanged', () => {
    const p = produce(villa(), (d) => {
      ops.addZone(d, {
        type: 'pool',
        polygon: [
          { x: 5, y: 5 },
          { x: 12, y: 5 },
          { x: 12, y: 9 },
          { x: 5, y: 9 },
        ],
      });
      ops.addGate(d, { kind: 'vehicle', position: { x: 15, y: 35 } });
    });
    expect(importProjectJson(exportProjectJson(p))).toEqual(p);
  });

  it('zones take their surface from the type, and gates snap to the plot edge', () => {
    const p = produce(villa(), (d) => {
      const z = ops.addZone(d, {
        type: 'deck',
        polygon: [
          { x: 5, y: 5 },
          { x: 9, y: 5 },
          { x: 9, y: 8 },
        ],
      });
      expect(d.site.zones.find((x) => x.id === z)!.material).toBe('decking');
      ops.addGate(d, { kind: 'pedestrian', position: { x: 14, y: 33.5 } });
    });
    const gate = p.site.gates[0]!;
    expect(gate.position.y).toBeCloseTo(36);
    expect(gate.width).toBeCloseTo(1.2);
    expect(Math.sin(gate.direction)).toBeGreaterThan(0.9); // facing out through the bottom edge
  });

  it('refuses bad shapes and gates without a plot, leaving the project untouched', () => {
    const p = createEmptyProject();
    expect(() =>
      produce(p, (d) => void ops.addGate(d, { kind: 'vehicle', position: { x: 1, y: 1 } })),
    ).toThrow(/plot/i);
    expect(() =>
      produce(
        villa(),
        (d) =>
          void ops.addZone(d, {
            type: 'lawn',
            polygon: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
            ],
          }),
      ),
    ).toThrow();
    expect(() =>
      produce(
        p,
        (d) =>
          void ops.setPlot(d, [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
          ]),
      ),
    ).toThrow();
  });

  it('items may stand anywhere on the plot of a villa, but only inside the shell of an apartment', () => {
    const v = villa();
    const lvl = v.levels[0]!.id;
    expect(itemArea(v)).toEqual(plot);
    expect(isItemInBounds(v, lvl, { x: 25, y: 30 })).toBe(true);
    const a = createEmptyProject();
    expect(isItemInBounds(a, a.levels[0]!.id, { x: 25, y: 30 })).toBe(false);
  });

  it('building must stay inside the plot, set back from the boundary', () => {
    const v = produce(villa(), (d) => {
      d.shell.footprint = [
        { x: 8, y: 8 },
        { x: 22, y: 8 },
        { x: 22, y: 20 },
        { x: 8, y: 20 },
      ];
    });
    expect(ops.buildingWithinSetback(v).ok).toBe(true);
    const tight = produce(v, (d) => void (d.site.setback = 9));
    expect(ops.buildingWithinSetback(tight).ok).toBe(false);
  });
});

describe('site edits are undoable', () => {
  beforeEach(() => useModel.getState().loadProject(villa()));
  it('draws, edits and removes zones and gates with undo / redo', () => {
    edit((p) =>
      ops.addZone(p, {
        type: 'lawn',
        polygon: [
          { x: 2, y: 2 },
          { x: 8, y: 2 },
          { x: 8, y: 7 },
        ],
      }),
    );
    expect(useModel.getState().project.site.zones).toHaveLength(1);
    undo();
    expect(useModel.getState().project.site.zones).toHaveLength(0);
    redo();
    const id = useModel.getState().project.site.zones[0]!.id;
    edit((p) => ops.updateZone(p, id, { covered: true, name: 'Lawn A' }));
    expect(useModel.getState().project.site.zones[0]).toMatchObject({
      covered: true,
      name: 'Lawn A',
    });
    edit((p) => ops.deleteZone(p, id));
    expect(useModel.getState().project.site.zones).toHaveLength(0);
  });
});
