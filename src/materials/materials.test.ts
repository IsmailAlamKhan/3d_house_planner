import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { createSampleProject } from '../model/sample';
import {
  MATERIALS,
  customPaint,
  getMaterialDef,
  isCustomPaint,
  materialsForCategory,
  resolveDef,
} from './library';
import { resolveMaterial } from './index';
import { mulberry32, shade } from './textures';

describe('material library', () => {
  it('has unique ids, translated names, and sensible real-world scales', () => {
    const ids = MATERIALS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MATERIALS) {
      expect(en[m.nameKey], m.id).toBeTruthy();
      expect(m.textureScale).toBeGreaterThan(0.2);
      expect(m.textureScale).toBeLessThan(3);
      expect(m.categories.length).toBeGreaterThan(0);
      expect(m.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('covers every category the pickers need, incl. wood, tiles, marble, concrete, carpet, paint, brick, wallpaper, laminate, metal, glass', () => {
    for (const c of ['floor', 'wall', 'ceiling', 'surface'] as const)
      expect(materialsForCategory(c).length).toBeGreaterThan(3);
    const kinds = new Set(MATERIALS.map((m) => m.texture));
    for (const k of [
      'wood-planks',
      'herringbone',
      'tiles-square',
      'tiles-subway',
      'tiles-large',
      'marble',
      'concrete',
      'carpet',
      'brick',
      'wallpaper-stripes',
      'wallpaper-damask',
      'wallpaper-dots',
      'laminate',
      'metal-brushed',
    ] as const) {
      expect(kinds.has(k), k).toBe(true);
    }
    expect(getMaterialDef('glass')?.opacity).toBeLessThan(1);
    expect(
      materialsForCategory('floor').some((m) => m.id.includes('oak')) &&
        materialsForCategory('floor').some((m) => m.id.includes('walnut')),
    ).toBe(true);
  });

  it('every material used by the sample project resolves to a library entry', () => {
    const p = createSampleProject();
    const used = new Set<string>([
      ...p.walls.flatMap((w) => [w.materialInside, w.materialOutside]),
      ...p.rooms.flatMap((r) => [r.floorMaterial, r.ceilingMaterial]),
    ]);
    for (const id of used) expect(getMaterialDef(id), id).toBeDefined();
  });

  it('custom paint accepts any colour; unknown ids fall back to a flat grey', () => {
    expect(isCustomPaint(customPaint('#AA33cc'))).toBe(true);
    expect(isCustomPaint('paint:red')).toBe(false);
    expect(resolveDef(customPaint('#aa33cc')).color).toBe('#aa33cc');
    expect(resolveDef('nonsense').color).toBe('#cbd5e1');
  });

  it('applies per-project colour overrides', () => {
    expect(resolveMaterial('paint-white', { 'paint-white': { color: '#ff0000' } }).color).toBe(
      '#ff0000',
    );
    expect(resolveMaterial('glass').opacity).toBeLessThan(1);
  });
});

describe('texture helpers', () => {
  it('PRNG is deterministic and shade clamps', () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(shade('#ffffff', 2)).toBe('rgb(255,255,255)');
    expect(shade('#808080', 0.5)).toBe('rgb(64,64,64)');
  });
});
