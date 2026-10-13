import { produce } from 'immer';
import { Box3 } from 'three';
import { describe, expect, it } from 'vitest';
import * as ops from '../../model/ops';
import { createEmptyProject } from '../../model/project';
import { createSampleProject } from '../../model/sample';
import { SceneBuilder } from '../sceneModel';
import { generateSite } from './site';

const sq = (x: number, y: number, w: number, d: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + d },
  { x, y: y + d },
];

const villa = () =>
  produce(createEmptyProject('V'), (p) => {
    p.kind = 'villa';
    ops.setPlot(p, sq(0, 0, 30, 36));
    ops.addZone(p, { type: 'pool', polygon: sq(5, 5, 8, 4) });
    ops.addZone(p, { type: 'deck', polygon: sq(14, 5, 5, 4), covered: true });
    ops.addZone(p, { type: 'parking', polygon: sq(10, 28, 6, 5.4), covered: true });
    ops.addZone(p, { type: 'lawn', polygon: sq(20, 20, 8, 8) });
    ops.addGate(p, { kind: 'vehicle', position: { x: 13, y: 36 } });
    ops.addGate(p, { kind: 'pedestrian', position: { x: 4, y: 36 } });
  });

describe('site generator', () => {
  it('makes nothing for an apartment', () => {
    expect(generateSite(createSampleProject())).toEqual([]);
    expect(
      new SceneBuilder().build(createSampleProject(), {
        wallMode: 'up',
        cutHeight: 1.2,
        doorsOpen: false,
      }).site,
    ).toEqual([]);
  });

  it('builds ground, zone surfaces, a pool with water and coping, a pergola, a fence and gate leaves', () => {
    const parts = generateSite(villa());
    const ids = parts.map((p) => p.id);
    expect(ids).toContain('site:ground');
    expect(ids).toContain('site:surround');
    expect(ids).toContain('site:fence');
    expect(ids.filter((i) => i.startsWith('gate:'))).toHaveLength(2);
    const pool = parts.filter(
      (p) => p.id.includes(':water') || p.id.includes(':basin') || p.id.includes(':coping'),
    );
    expect(pool).toHaveLength(3);
    expect(parts.some((p) => p.id.endsWith(':pergola'))).toBe(true); // covered deck
    expect(parts.some((p) => p.id.endsWith(':roof'))).toBe(true); // covered parking
    for (const p of parts) {
      expect(p.layer).toBe('site');
      const pos = p.geometry.getAttribute('position');
      expect(pos.count).toBeGreaterThan(0);
      for (let i = 0; i < pos.count; i++)
        expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
    }
    // Zone and gate parts can be selected.
    expect(parts.find((p) => p.id === `gate:${villa().site.gates[0]!.id}`)).toBeUndefined(); // ids are per-project
    expect(parts.filter((p) => p.entity?.type === 'zone').length).toBeGreaterThanOrEqual(4);
    expect(parts.filter((p) => p.entity?.type === 'gate')).toHaveLength(2);
  });

  it('the pool is a hole in the ground and the water sits below the rim', () => {
    const parts = generateSite(villa());
    const water = parts.find((p) => p.id.endsWith(':water'))!;
    const b = new Box3().setFromBufferAttribute(water.geometry.getAttribute('position') as never);
    expect(b.max.y).toBeLessThan(0);
    const basin = parts.find((p) => p.id.endsWith(':basin'))!;
    expect(
      new Box3().setFromBufferAttribute(basin.geometry.getAttribute('position') as never).min.y,
    ).toBeLessThan(-1);
    // Ground vertices never fall inside the pool rectangle at y = 0 (it is cut out).
    const ground = parts.find((p) => p.id === 'site:ground')!;
    const pos = ground.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      expect(x > 5.01 && x < 12.99 && z > 5.01 && z < 8.99).toBe(false);
    }
  });

  it('the fence has gaps where the gates are', () => {
    const p = villa();
    const parts = generateSite(p);
    const fence = parts.find((x) => x.id === 'site:fence')!;
    const pos = fence.geometry.getAttribute('position');
    // Nothing of the fence lies in the vehicle gate opening (x 11.25–14.75 on the bottom edge).
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      expect(z > 35.8 && x > 11.4 && x < 14.6).toBe(false);
    }
  });

  it('is cached: rebuilding an unchanged site gives the same parts', () => {
    const b = new SceneBuilder();
    const p = villa();
    const a = b.build(p, { wallMode: 'up', cutHeight: 1.2, doorsOpen: false }).site;
    const c = b.build(p, { wallMode: 'up', cutHeight: 1.2, doorsOpen: false }).site;
    expect(c[0]).toBe(a[0]);
    expect(a.length).toBeGreaterThan(10);
  });
});
