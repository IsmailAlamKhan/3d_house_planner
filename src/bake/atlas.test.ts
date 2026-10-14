import { BoxGeometry, ExtrudeGeometry, Path, PlaneGeometry, Shape } from 'three';
import { describe, expect, it } from 'vitest';
import { buildLightmapAtlas, deindex, geometryHash, withUv1 } from './atlas';

describe('lightmap atlas', () => {
  it('de-indexes without changing the shape or the material groups', () => {
    const box = new BoxGeometry(2, 1, 3);
    const flat = deindex(box);
    expect(flat.index).toBeNull();
    expect(flat.getAttribute('position').count).toBe(box.index!.count);
    expect(flat.groups).toHaveLength(box.groups.length);
    // vertex 5 of the flat geometry is the vertex the index points at
    const i = box.index!.getX(5);
    expect(flat.getAttribute('position').getX(5)).toBe(box.getAttribute('position').getX(i));
  });

  it('gives each face of a box its own chart and keeps every UV inside the atlas', () => {
    const box = new BoxGeometry(1, 1, 1);
    const a = buildLightmapAtlas([{ id: 'box', geometry: box }], { texelsPerMetre: 16 });
    const uv = a.uv1.get('box')!;
    expect(uv.length).toBe(box.index!.count * 2);
    for (const v of uv) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // texel rectangles of the six faces (a face = a pair of triangles = one material group) never overlap
    const rects = box.groups.map((g) => {
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let i = g.start; i < g.start + g.count; i++) {
        const x = uv[i * 2]! * a.width;
        const y = uv[i * 2 + 1]! * a.height;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      return { x0, x1, y0, y1 };
    });
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const p = rects[i]!;
        const q = rects[j]!;
        const overlap = p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
        expect(overlap, `faces ${i} and ${j}`).toBe(false);
      }
  });

  it('uses the asked density: a 4 × 2 m wall at 16 texels per metre is about 64 × 32 texels', () => {
    const wall = new PlaneGeometry(4, 2);
    const a = buildLightmapAtlas([{ id: 'w', geometry: wall }], { texelsPerMetre: 16 });
    const uv = a.uv1.get('w')!;
    const xs = Array.from({ length: uv.length / 2 }, (_, i) => uv[i * 2]! * a.width);
    const ys = Array.from({ length: uv.length / 2 }, (_, i) => uv[i * 2 + 1]! * a.height);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(64, 0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(32, 0);
    expect(a.texelsPerMetre).toBe(16);
  });

  it('a floor slab with a hole: the top face is one chart, so its texels are contiguous and cover the whole outline', () => {
    const shape = new Shape();
    shape.moveTo(0, 0).lineTo(6, 0).lineTo(6, 4).lineTo(0, 4).closePath();
    const hole = new Path();
    hole.moveTo(2, 1).lineTo(2, 3).lineTo(4, 3).lineTo(4, 1).closePath();
    shape.holes.push(hole);
    const slab = new ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false });
    const a = buildLightmapAtlas([{ id: 'f', geometry: slab }], { texelsPerMetre: 8 });
    const uv = a.uv1.get('f')!;
    // one UV pair per vertex of the de-indexed geometry
    expect(slab.index).toBeNull(); // extrusions are not indexed: the triangle order is the vertex order
    expect(uv.length).toBe(slab.getAttribute('position').count * 2);
    // the 6 × 4 m top is laid out at 8 texels per metre: its chart is 48 × 32 texels, in one piece
    const top: number[] = [];
    const pos = slab.getAttribute('position');
    for (let t = 0; t < pos.count; t += 3)
      if ([0, 1, 2].every((k) => pos.getZ(t + k) > 0.19)) top.push(t, t + 1, t + 2);
    const xs = top.map((i) => uv[i * 2]! * a.width);
    const ys = top.map((i) => uv[i * 2 + 1]! * a.height);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(48, 0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(32, 0);
  });

  it('is deterministic and lowers the density when 4096 × 4096 is not enough', () => {
    const big = new PlaneGeometry(400, 400);
    const one = buildLightmapAtlas([{ id: 'g', geometry: big }], { texelsPerMetre: 16 });
    const two = buildLightmapAtlas([{ id: 'g', geometry: big }], { texelsPerMetre: 16 });
    expect(Array.from(two.uv1.get('g')!)).toEqual(Array.from(one.uv1.get('g')!));
    expect(one.width).toBeLessThanOrEqual(4096);
    expect(one.height).toBeLessThanOrEqual(4096);
    expect(one.texelsPerMetre).toBeLessThan(16);
  });

  it('packs several meshes into one atlas without sharing texels', () => {
    const meshes = [0, 1, 2, 3].map((i) => ({ id: `m${i}`, geometry: new PlaneGeometry(3, 3) }));
    const a = buildLightmapAtlas(meshes, { texelsPerMetre: 8 });
    const boxes = meshes.map((m) => {
      const uv = a.uv1.get(m.id)!;
      const xs = Array.from({ length: uv.length / 2 }, (_, i) => uv[i * 2]!);
      const ys = Array.from({ length: uv.length / 2 }, (_, i) => uv[i * 2 + 1]!);
      return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] as const;
    });
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const p = boxes[i]!;
        const q = boxes[j]!;
        expect(p[0] < q[1] && q[0] < p[1] && p[2] < q[3] && q[2] < p[3]).toBe(false);
      }
  });

  it('attaches the second UV set and hashes the shape', () => {
    const plane = new PlaneGeometry(1, 1);
    const a = buildLightmapAtlas([{ id: 'p', geometry: plane }], { texelsPerMetre: 8 });
    const g = withUv1(plane, a.uv1.get('p')!);
    expect(g.getAttribute('uv1').count).toBe(g.getAttribute('position').count);
    expect(geometryHash(plane)).toBe(geometryHash(new PlaneGeometry(1, 1)));
    expect(geometryHash(plane)).not.toBe(geometryHash(new PlaneGeometry(1, 1.001)));
  });
});
