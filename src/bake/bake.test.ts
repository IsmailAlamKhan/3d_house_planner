import { produce } from 'immer';
import { PlaneGeometry } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import * as ops from '../model/ops';
import { createEmptyProject } from '../model/project';
import type { Part } from '../scene3d/generators/common';
import { buildLightmapAtlas, geometryHash } from './atlas';
import { bakeKey } from './bakeKey';
import { useBake } from './bakeStore';
import { staticBakeMeshes } from './bundle';
import { BAKE_DENSITY, presetOfMode } from './protocol';
import { bakedGeometry } from './runtime';

const room = () =>
  produce(createEmptyProject('bake'), (p) => {
    const L = p.levels[0]!.id;
    const sq = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 4 },
      { x: 0, y: 4 },
    ];
    for (let i = 0; i < 4; i++)
      ops.addWall(p, {
        levelId: L,
        start: sq[i]!,
        end: sq[(i + 1) % 4]!,
        type: 'exterior',
        thickness: 0.3,
      });
    ops.syncRooms(p, L);
    ops.addItem(p, {
      levelId: L,
      catalogId: 'ceiling-light',
      position: { x: 2.5, y: 2 },
      elevation: 2.6,
    });
    ops.addItem(p, { levelId: L, catalogId: 'sofa-3seat', position: { x: 3, y: 1 } });
  });

describe('bake revision key', () => {
  it('is stable, and different for each lighting preset', () => {
    const p = room();
    expect(bakeKey(p, 'dusk')).toBe(bakeKey(p, 'dusk'));
    expect(bakeKey(p, 'dusk')).toMatch(/^[a-f0-9]{16}$/);
    expect(bakeKey(p, 'dusk')).not.toBe(bakeKey(p, 'day'));
  });

  it('does not change when furniture moves (it gets real-time light), but does when a wall or a lamp does', () => {
    const p = room();
    const before = bakeKey(p, 'dusk');
    const sofa = p.items.find((i) => i.catalogId === 'sofa-3seat')!;
    const moved = produce(p, (d) => {
      d.items.find((i) => i.id === sofa.id)!.position = { x: 1, y: 3 };
    });
    expect(bakeKey(moved, 'dusk')).toBe(before);

    const wall = produce(p, (d) => {
      d.walls[0]!.end = { x: 5.5, y: 0 };
    });
    expect(bakeKey(wall, 'dusk')).not.toBe(before);

    const lamp = p.items.find((i) => i.catalogId === 'ceiling-light')!;
    const lampMoved = produce(p, (d) => {
      d.items.find((i) => i.id === lamp.id)!.position = { x: 1, y: 1 };
    });
    expect(bakeKey(lampMoved, 'dusk')).not.toBe(before);
  });

  it('changes when a light is switched off (the lighting differs)', () => {
    const p = room();
    const lamp = p.items.find((i) => i.catalogId === 'ceiling-light')!;
    const off = produce(p, (d) => {
      d.lights.items[lamp.id] = false;
    });
    expect(bakeKey(off, 'dusk')).not.toBe(bakeKey(p, 'dusk'));
  });
});

describe('baked presets and quality', () => {
  it('maps lighting looks to the three presets', () => {
    expect(presetOfMode('noon', 13)).toBe('day');
    expect(presetOfMode('morning', 8)).toBe('day');
    expect(presetOfMode('dusk', 19.4)).toBe('dusk');
    expect(presetOfMode('evening', 18)).toBe('dusk');
    expect(presetOfMode('marketing', 19)).toBe('dusk');
    expect(presetOfMode('night', 22)).toBe('night');
    expect(presetOfMode('custom', 19)).toBe('dusk');
    expect(presetOfMode('custom', 12)).toBe('day');
  });

  it('Low / Medium / High are 8 / 16 / 32 texels per metre', () => {
    expect(BAKE_DENSITY.low.texelsPerMetre).toBe(8);
    expect(BAKE_DENSITY.medium.texelsPerMetre).toBe(16);
    expect(BAKE_DENSITY.high.texelsPerMetre).toBe(32);
  });

  it('lightmaps the walls, floors and ceilings of a room and leaves furniture out', () => {
    const meshes = staticBakeMeshes(room());
    const ids = meshes.map((m) => m.id);
    expect(ids.some((i) => i.startsWith('wall:'))).toBe(true);
    expect(ids.every((i) => !i.startsWith('item:'))).toBe(true);
    const atlas = buildLightmapAtlas(meshes, { texelsPerMetre: 16 });
    expect(atlas.uv1.size).toBe(meshes.length);
    for (const m of meshes) m.geometry.dispose();
  });
});

describe('baked parts in the scene', () => {
  afterEach(() => useBake.setState({ applied: null }));

  const part = (geometry: PlaneGeometry): Part => ({
    id: 'wall:w1',
    layer: 'wall',
    geometry,
    materials: ['paint-white'],
  });
  const apply = (g: PlaneGeometry) => {
    const a = buildLightmapAtlas([{ id: 'wall:w1', geometry: g }], { texelsPerMetre: 8 });
    const uv1 = a.uv1.get('wall:w1')!;
    useBake.setState({
      applied: {
        projectId: 'p',
        preset: 'dusk',
        key: 'k',
        texture: {} as never,
        scale: 1,
        parts: new Map([['wall:w1', { uv1, vertexCount: uv1.length / 2, hash: geometryHash(g) }]]),
      },
    });
  };

  it('a part with a valid bake gets its lightmap UVs', () => {
    const g = new PlaneGeometry(3, 2);
    apply(g);
    const baked = bakedGeometry(part(g));
    expect(baked).not.toBeNull();
    expect(baked!.getAttribute('uv1').count).toBe(baked!.getAttribute('position').count);
  });

  it('a part whose shape changed since the bake falls back to real-time lighting; so does one that was never baked', () => {
    apply(new PlaneGeometry(3, 2));
    expect(bakedGeometry(part(new PlaneGeometry(3.5, 2)))).toBeNull();
    expect(bakedGeometry({ ...part(new PlaneGeometry(3, 2)), id: 'wall:other' })).toBeNull();
  });

  it('nothing is baked when no bake is loaded', () => {
    expect(bakedGeometry(part(new PlaneGeometry(3, 2)))).toBeNull();
  });
});
