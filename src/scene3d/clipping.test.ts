import { MeshStandardMaterial, Plane, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { registerClippable, setSectionPlanes } from './clipping';

describe('section clipping of model materials', () => {
  it('applies the active planes to every registered material, including ones created later', () => {
    const a = registerClippable(new MeshStandardMaterial());
    expect(a.clippingPlanes).toBeNull();
    setSectionPlanes([{ normal: [0, -1, 0], constant: 1.5 }]);
    expect(a.clippingPlanes).toHaveLength(1);
    const b = registerClippable(new MeshStandardMaterial());
    expect(b.clippingPlanes).toHaveLength(1);
    expect(b.clippingPlanes![0]!.constant).toBe(1.5);
    // Moving the cut changes the plane in place; no material needs touching.
    setSectionPlanes([{ normal: [0, -1, 0], constant: 2 }]);
    expect(a.clippingPlanes![0]!.constant).toBe(2);
    setSectionPlanes([]);
    expect(a.clippingPlanes).toBeNull();
    expect(b.clippingPlanes).toBeNull();
  });

  it('keeps a material’s own plane (walls cut at 1.2 m) alongside the section planes', () => {
    const own = new Plane(new Vector3(0, -1, 0), 1.2);
    const m = registerClippable(new MeshStandardMaterial(), own);
    expect(m.clippingPlanes).toEqual([own]);
    setSectionPlanes([{ normal: [-1, 0, 0], constant: 4 }]);
    expect(m.clippingPlanes).toHaveLength(2);
    expect(m.clippingPlanes![0]).toBe(own);
    setSectionPlanes([]);
    expect(m.clippingPlanes).toEqual([own]);
  });
});
