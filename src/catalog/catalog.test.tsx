import { renderToStaticMarkup } from 'react-dom/server';
import { Box3, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import {
  CATALOG,
  CATEGORIES,
  entriesByCategory,
  getEntry,
  openingStyles,
  withDefaults,
} from './index';

const REQUIRED = [
  'door-single',
  'door-double',
  'door-sliding',
  'door-pocket',
  'door-entrance',
  'window-casement',
  'window-sliding',
  'window-fixed',
  'window-full',
  'window-bay',
  'sofa-2seat',
  'sofa-3seat',
  'sofa-l',
  'armchair',
  'coffee-table',
  'tv-unit',
  'bookshelf',
  'dining-table-4',
  'dining-table-6',
  'dining-table-8',
  'bed-single',
  'bed-double',
  'bed-queen',
  'bed-king',
  'wardrobe',
  'side-table',
  'dresser',
  'kitchen-base-run',
  'kitchen-wall-cabinet',
  'kitchen-island',
  'fridge',
  'stove',
  'sink-kitchen',
  'oven',
  'wc',
  'basin',
  'shower',
  'bathtub',
  'mirror',
  'desk',
  'office-chair',
  'washing-machine',
  'plant',
  'rug',
  'ceiling-light',
  'pendant-light',
  'floor-lamp',
];

describe('catalog registry', () => {
  it('contains every required item with unique ids', () => {
    const ids = CATALOG.map((e) => e.catalogId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of REQUIRED) expect(getEntry(id), id).toBeDefined();
  });

  it('has a translated name for every entry and category, and labels for every property', () => {
    for (const e of CATALOG) {
      expect(en[e.nameKey], e.catalogId).toBeTruthy();
      for (const p of e.props) {
        expect(en[p.label], `${e.catalogId}.${p.key}`).toBeTruthy();
        if (p.kind === 'select') p.options.forEach((o) => expect(en[o.label]).toBeTruthy());
      }
    }
    for (const c of CATEGORIES) expect(en[`cat.${c}` as keyof typeof en]).toBeTruthy();
    // "My items" is filled by the user, so it is empty by default.
    expect(
      CATEGORIES.filter((c) => c !== 'custom').every((c) => entriesByCategory(c).length > 0),
    ).toBe(true);
  });

  it('every wall entry is a door, window or archway; styles group by kind', () => {
    expect(openingStyles('door').length).toBeGreaterThanOrEqual(5);
    expect(openingStyles('window').length).toBeGreaterThanOrEqual(5);
    for (const e of CATALOG.filter((x) => x.placement === 'wall'))
      expect(e.openingKind).toBeDefined();
  });
});

describe('procedural models', () => {
  for (const e of CATALOG) {
    it(`${e.catalogId}: builds a tidy 3D model that matches its size, and a 2D symbol`, () => {
      const p = withDefaults(e, {});
      const g = e.build3D(p, e.defaultSize, { swing: 'left', open: true, outward: -1 });
      let meshes = 0;
      g.traverse((o) => o instanceof Mesh && meshes++);
      if (e.catalogId === 'archway') {
        expect(meshes).toBe(0);
      } else {
        expect(meshes).toBeGreaterThanOrEqual(2);
        const b = new Box3().setFromObject(g);
        const { w, d, h } = e.defaultSize;
        expect(b.min.y).toBeGreaterThanOrEqual(-0.12);
        expect(b.max.y).toBeLessThanOrEqual(h + 0.15);
        // Pocket doors slide into the wall, beyond the opening.
        const xLimit = e.catalogId === 'door-pocket' ? w * 1.5 : w / 2 + 0.2;
        expect(Math.abs(b.max.x)).toBeLessThanOrEqual(xLimit);
        expect(Math.abs(b.min.x)).toBeLessThanOrEqual(xLimit);
        expect(Math.max(Math.abs(b.min.z), Math.abs(b.max.z))).toBeLessThanOrEqual(d / 2 + 0.6);
        // Not tiny either: fills a good part of its stated size.
        expect(b.max.x - b.min.x).toBeGreaterThan(w * 0.5);
      }
      const svg = renderToStaticMarkup(<svg>{e.draw2D(p, e.defaultSize, { swing: 'left' })}</svg>);
      expect(svg.length).toBeGreaterThan(20);
    });
  }

  it('rebuilds to any size without distortion artefacts', () => {
    const e = getEntry('sofa-3seat')!;
    const g = e.build3D(withDefaults(e, {}), { w: 3, d: 1.2, h: 1 });
    const b = new Box3().setFromObject(g);
    expect(b.max.x - b.min.x).toBeCloseTo(3, 1);
    expect(b.max.y).toBeCloseTo(1, 1);
  });

  it('adjustable props change the model', () => {
    const e = getEntry('coffee-table')!;
    const a = new Box3().setFromObject(e.build3D({ ...e.defaults, shape: 'rect' }, e.defaultSize));
    const r = new Box3().setFromObject(e.build3D({ ...e.defaults, shape: 'round' }, e.defaultSize));
    expect(a.max.x).toBeCloseTo(r.max.x, 1);
    const dining = getEntry('dining-table-6')!;
    let meshes4 = 0;
    getEntry('dining-table-4')!
      .build3D(withDefaults(dining, {}), { w: 1.2, d: 1.5, h: 0.75 })
      .traverse((o) => o instanceof Mesh && meshes4++);
    let meshes8 = 0;
    getEntry('dining-table-8')!
      .build3D(withDefaults(dining, {}), { w: 2.4, d: 1.7, h: 0.75 })
      .traverse((o) => o instanceof Mesh && meshes8++);
    expect(meshes8).toBeGreaterThan(meshes4);
  });
});
