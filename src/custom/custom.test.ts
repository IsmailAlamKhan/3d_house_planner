import { Box3, Group, Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CATALOG, entryName, getEntry, registerCustomEntries } from '../catalog';
import {
  customTextureVersion,
  getSwatchUrl,
  materialDefName,
  materialsForCategory,
  customTextureDefs,
  registerCustomTextures,
  resolveDef,
} from '../materials';
import { guessUnitFactor } from './AddModelDialog';
import { customEntry } from './entries';
import { fitModel, measureModel, parseGlb } from './glb';
import { minimalGlb } from './minimalGlb';
import {
  type AssetMeta,
  assetFileUrl,
  assetOf,
  customItemId,
  customTextureId,
  isCustomItemId,
  isCustomTextureId,
} from './protocol';

const ID = '0123456789abcdef';
/** The bytes as a standalone ArrayBuffer (what a File would give us). */
const buf = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer;
const model = (over: Partial<NonNullable<AssetMeta['model']>> = {}): AssetMeta => ({
  id: ID,
  kind: 'model',
  name: 'Velvet armchair',
  ext: 'glb',
  size: 100,
  createdAt: '2026-01-01T00:00:00Z',
  model: { category: 'living', placement: 'floor', w: 0.9, d: 0.8, h: 0.85, ...over },
});

describe('ids', () => {
  it('builds and recognises custom item and texture ids', () => {
    expect(customItemId(ID)).toBe(`custom:${ID}`);
    expect(customTextureId(ID)).toBe(`tex:${ID}`);
    expect(isCustomItemId(`custom:${ID}`)).toBe(true);
    expect(isCustomItemId('custom:../x')).toBe(false);
    expect(isCustomTextureId(`tex:${ID}`)).toBe(true);
    expect(isCustomTextureId('floor-oak')).toBe(false);
    expect(assetOf(`tex:${ID}`)).toBe(ID);
    expect(assetFileUrl(ID)).toBe(`/api/assets/${ID}/file`);
  });
});

describe('3D models', () => {
  it('reads a real .glb and measures it', async () => {
    const bytes = minimalGlb(2, 1, 0.5);
    const root = await parseGlb(buf(bytes));
    const s = measureModel(root);
    expect(s.w).toBeCloseTo(2, 5);
    expect(s.h).toBeCloseTo(1, 5);
    expect(s.d).toBeCloseTo(0.5, 5);
  });

  it('refuses files that are not models, with a readable message', async () => {
    await expect(
      parseGlb(new TextEncoder().encode('not a model at all, just text!!').buffer),
    ).rejects.toThrow(/\.glb/);
  });

  it('fits a model to the wanted size, standing on the floor and centred', async () => {
    const bytes = minimalGlb(2, 1, 0.5);
    const root = await parseGlb(buf(bytes));
    const out = fitModel(root, { w: 0.9, h: 0.85, d: 0.8 });
    out.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(out);
    const size = box.getSize(new Vector3());
    expect(size.x).toBeCloseTo(0.9, 5);
    expect(size.y).toBeCloseTo(0.85, 5);
    expect(size.z).toBeCloseTo(0.8, 5);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 5);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 5);
  });

  it('gives each copy its own geometry (the scene builder disposes geometry on rebuild)', async () => {
    const bytes = minimalGlb();
    const root = await parseGlb(buf(bytes));
    const geometries = (g: Group) => {
      const list: unknown[] = [];
      g.traverse((o) => o instanceof Mesh && list.push(o.geometry));
      return list;
    };
    const a = geometries(fitModel(root, { w: 1, h: 1, d: 1 }));
    const b = geometries(fitModel(root, { w: 1, h: 1, d: 1 }));
    expect(a.length).toBeGreaterThan(0);
    expect(a[0]).not.toBe(b[0]);
  });

  it('guesses centimetre and millimetre models', () => {
    expect(guessUnitFactor({ w: 0.9, h: 0.85, d: 0.8 })).toBe(1);
    expect(guessUnitFactor({ w: 90, h: 85, d: 80 })).toBe(0.01);
    expect(guessUnitFactor({ w: 900, h: 850, d: 800 })).toBe(0.001);
    expect(guessUnitFactor({ w: 0.005, h: 0.004, d: 0.003 })).toBe(100);
  });
});

describe('catalogue entries', () => {
  it("registers a model like a built-in item, with the user's own name", () => {
    const entry = customEntry(model());
    expect(entry.catalogId).toBe(`custom:${ID}`);
    expect(entry.defaultSize).toEqual({ w: 0.9, d: 0.8, h: 0.85 });
    expect(entry.placement).toBe('floor');
    expect(entry.category).toBe('living');
    registerCustomEntries([entry]);
    expect(getEntry(`custom:${ID}`)).toBe(entry);
    expect(entryName(entry)).toBe('Velvet armchair');
    expect(entryName(getEntry('sofa-2seat')!)).toBe('Sofa (2-seat)'); // built-ins still use the translation
    registerCustomEntries([]);
    expect(getEntry(`custom:${ID}`)).toBeUndefined();
    expect(CATALOG.some((e) => e.catalogId.startsWith('custom:'))).toBe(false);
  });

  it('keeps wall-mounted models at their mount height and unknown categories under "My items"', () => {
    const wall = customEntry(model({ placement: 'wall-mounted', mountHeight: 1.6 }));
    expect(wall.placement).toBe('wall-mounted');
    expect(wall.mountHeight).toBe(1.6);
    expect(customEntry(model({ category: 'nonsense' })).category).toBe('custom');
  });

  it('shows a placeholder box straight away and draws a 2D footprint', () => {
    const entry = customEntry(model());
    const g = entry.build3D({}, { w: 0.9, d: 0.8, h: 0.85 });
    let boxes = 0;
    g.traverse((o) => o instanceof Mesh && boxes++);
    expect(boxes).toBe(1);
    expect(entry.draw2D({}, { w: 0.9, d: 0.8, h: 0.85 })).toBeTruthy();
  });
});

describe('uploaded textures', () => {
  it('become materials usable on any surface', () => {
    const before = customTextureVersion();
    registerCustomTextures([
      { id: customTextureId(ID), name: 'Walnut parquet', url: assetFileUrl(ID), scale: 0.6 },
    ]);
    expect(customTextureVersion()).toBe(before + 1);
    const def = resolveDef(`tex:${ID}`);
    expect(def.name).toBe('Walnut parquet');
    expect(materialDefName(def)).toBe('Walnut parquet');
    expect(def.textureScale).toBe(0.6);
    expect(def.textureUrl).toBe(`/api/assets/${ID}/file`);
    expect(getSwatchUrl(def)).toBe(`/api/assets/${ID}/file`);
    expect(customTextureDefs().map((d) => d.id)).toEqual([`tex:${ID}`]);
    // They are offered in their own section, not inside every built-in category.
    expect(materialsForCategory('floor').some((m) => m.id === `tex:${ID}`)).toBe(false);

    registerCustomTextures([]);
    // A texture that is gone falls back to a neutral grey instead of breaking the surface.
    expect(resolveDef(`tex:${ID}`).color).toBe('#cbd5e1');
    expect(materialDefName(resolveDef('floor-oak'))).toBe('Light oak planks');
  });
});
