import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import * as ops from '../model/ops';
import { createEmptyProject } from '../model/project';
import type { Project } from '../model/types';
import { runChecks } from './index';
import { distanceToPolygon, parkingCapacity, polygonGap } from './site';

const sq = (x: number, y: number, w: number, d: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + d },
  { x, y: y + d },
];

const base = (): Project =>
  produce(createEmptyProject('V'), (p) => {
    p.kind = 'villa';
    ops.setPlot(p, sq(0, 0, 30, 36));
    p.shell.footprint = sq(8, 8, 14, 12);
    p.shell.entrance = { position: { x: 15, y: 20 }, direction: Math.PI / 2 };
  });
const rule = (p: Project, r: string) => runChecks(p).filter((i) => i.rule === r);

describe('site checks', () => {
  it('only run for villas', () => {
    const a = produce(base(), (p) => void (p.kind = 'apartment'));
    expect(
      runChecks(a).some((i) => ['setback', 'pool-safety', 'gate-parking'].includes(i.rule)),
    ).toBe(false);
  });

  it('building must be inside the plot, away from the boundary', () => {
    expect(rule(base(), 'setback')).toHaveLength(0);
    const close = produce(base(), (p) => void (p.shell.footprint = sq(0.5, 8, 14, 12)));
    const msg = rule(close, 'setback')[0]!.message;
    expect(msg).toMatch(/setback/);
    const outside = produce(base(), (p) => void (p.shell.footprint = sq(25, 8, 14, 12)));
    expect(rule(outside, 'setback')[0]!.severity).toBe('error');
  });

  it('a vehicle gate needs a parking zone with room for the cars', () => {
    const noParking = produce(
      base(),
      (p) => void ops.addGate(p, { kind: 'vehicle', position: { x: 20, y: 36 } }),
    );
    expect(rule(noParking, 'gate-parking')[0]!.message).toMatch(/parking/i);
    const withParking = produce(noParking, (p) => {
      ops.addZone(p, { type: 'parking', polygon: sq(17, 30.5, 5.6, 5.4) });
    });
    expect(rule(withParking, 'gate-parking')).toHaveLength(0);
    expect(parkingCapacity(withParking.site.zones[0]!)).toBe(2);
    // Three cars planned, room for two.
    const crowded = produce(withParking, (p) => {
      const lvl = p.levels[0]!.id;
      for (const x of [18, 19.5, 21])
        ops.addItem(p, { levelId: lvl, catalogId: 'car', position: { x, y: 33 } });
    });
    expect(rule(crowded, 'gate-parking')[0]!.message).toMatch(/fits 2 car/);
  });

  it('a pedestrian gate must connect to the entrance by a path', () => {
    const gate = produce(
      base(),
      (p) => void ops.addGate(p, { kind: 'pedestrian', position: { x: 15, y: 36 } }),
    );
    expect(rule(gate, 'gate-path')).toHaveLength(1);
    const path = produce(
      gate,
      (p) => void ops.addZone(p, { type: 'path', polygon: sq(14.2, 20, 1.6, 16) }),
    );
    expect(rule(path, 'gate-path')).toHaveLength(0);
  });

  it('a pool needs a fence, wall, hedge or gate within 1.2 m', () => {
    const pool = produce(
      base(),
      (p) => void ops.addZone(p, { type: 'pool', polygon: sq(12, 26, 6, 3) }),
    );
    expect(rule(pool, 'pool-safety')[0]!.message).toMatch(/Swimming pool|pool/i);
    const hedged = produce(pool, (p) => {
      ops.addItem(p, {
        levelId: p.levels[0]!.id,
        catalogId: 'hedge',
        position: { x: 15, y: 25.2 },
      });
    });
    expect(rule(hedged, 'pool-safety')).toHaveLength(0);
    const nearFence = produce(
      base(),
      (p) => void ops.addZone(p, { type: 'pool', polygon: sq(5, 1, 6, 3) }),
    );
    expect(rule(nearFence, 'pool-safety')).toHaveLength(0); // within 1.2 m of the plot boundary fence
  });

  it('a garage needs an opening to the outside', () => {
    const g = produce(base(), (p) => {
      const lvl = p.levels[0]!.id;
      const fp = sq(8, 8, 14, 12);
      fp.forEach((a, i) =>
        ops.addWall(p, {
          levelId: lvl,
          start: a,
          end: fp[(i + 1) % 4]!,
          type: 'exterior',
          thickness: 0.3,
        }),
      );
      ops.syncRooms(p, lvl);
      p.rooms[0]!.type = 'garage';
      p.rooms[0]!.name = 'Garage';
    });
    expect(rule(g, 'garage-exterior')[0]!.message).toMatch(/Garage/);
    const wall = g.walls.find((w) => w.start.y === 20 && w.end.y === 20) ?? g.walls[2]!;
    const door = produce(
      g,
      (p) =>
        void ops.addOpening(p, {
          wallId: wall.id,
          offset: 3,
          kind: 'door',
          catalogId: 'door-double',
          width: 2.4,
          height: 2.1,
        }),
    );
    expect(rule(door, 'garage-exterior')).toHaveLength(0);
  });

  it('geometry helpers', () => {
    expect(distanceToPolygon({ x: 5, y: 5 }, sq(0, 0, 10, 10))).toBe(0);
    expect(distanceToPolygon({ x: 13, y: 5 }, sq(0, 0, 10, 10))).toBeCloseTo(3);
    expect(polygonGap(sq(0, 0, 2, 2), sq(5, 0, 2, 2))).toBeCloseTo(3);
  });
});
