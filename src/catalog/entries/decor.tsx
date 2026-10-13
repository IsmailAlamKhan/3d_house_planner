import { type Group, Shape, ExtrudeGeometry, Mesh } from 'three';
import { box, cyl, group, sphere, mat } from '../three';
import { C, E, L, R, RC } from '../svg';
import type { CatalogCategory, CatalogEntry, Placement, Props, PropSpec, Size } from '../types';

const colorProp = (label: PropSpec['label'] = 'cprop.color', key = 'color'): PropSpec => ({
  key,
  label,
  kind: 'color',
});

interface Def {
  id: string;
  category: CatalogCategory;
  size: Size;
  placement?: Placement;
  mountHeight?: number;
  wallSnap?: boolean;
  lamp?: CatalogEntry['lamp'];
  props?: PropSpec[];
  defaults: Props;
  build: (g: Group, p: Props, s: Size) => void;
  draw: (p: Props, s: Size) => React.ReactNode;
}

function entry(d: Def): CatalogEntry {
  return {
    catalogId: d.id,
    nameKey: `catalog.${d.id}` as CatalogEntry['nameKey'],
    category: d.category,
    placement: d.placement ?? 'floor',
    mountHeight: d.mountHeight,
    wallSnap: d.wallSnap,
    lamp: d.lamp,
    defaultSize: d.size,
    minScale: 0.4,
    maxScale: 3,
    props: d.props ?? [colorProp()],
    defaults: d.defaults,
    build3D: (p, s) => {
      const g = group();
      d.build(g, p, s);
      return g;
    },
    draw2D: (p, s) => d.draw(p, s),
  };
}

const c = (p: Props, k = 'color') => String(p[k]);
const POT = '#a8643a';

// ───────────────────────────── Plants (3 sizes × 4 species) ─────────────────────────────

const SPECIES: PropSpec = {
  key: 'species',
  label: 'cprop.species',
  kind: 'select',
  options: [
    { value: 'fern', label: 'cprop.fern' },
    { value: 'palm', label: 'cprop.palmPlant' },
    { value: 'rubber', label: 'cprop.rubber' },
    { value: 'succulent', label: 'cprop.succulent' },
  ],
};

/** Foliage for a potted plant in one of four styles, scaled to the item's size. */
function plantBuild(g: Group, p: Props, s: Size): void {
  const leaf = c(p);
  const potH = Math.min(0.4, s.h * 0.28);
  cyl(g, s.w * 0.36, s.w * 0.26, potH, [0, 0, 0], c(p, 'potColor'), 0.8, 20);
  const top = s.h - potH;
  switch (String(p.species)) {
    case 'palm': {
      cyl(g, s.w * 0.04, s.w * 0.05, top * 0.7, [0, potH, 0], '#7a5a30', 0.9, 8);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const f = box(
          g,
          [s.w * 0.7, 0.025, s.w * 0.13],
          [Math.cos(a) * s.w * 0.28, potH + top * 0.75, Math.sin(a) * s.w * 0.28],
          leaf,
          0.9,
        );
        f.rotation.y = -a;
        f.rotation.z = -0.5;
      }
      break;
    }
    case 'rubber': {
      cyl(g, s.w * 0.035, s.w * 0.045, top * 0.8, [0, potH, 0], '#6b4f2a', 0.9, 8);
      for (let i = 0; i < 9; i++) {
        const y = potH + top * (0.35 + 0.65 * (i / 9));
        const a = i * 2.4;
        const l = sphere(
          g,
          s.w * 0.16,
          [Math.cos(a) * s.w * 0.2, y, Math.sin(a) * s.w * 0.2],
          leaf,
          0.5,
        );
        l.scale.set(1, 0.7, 0.45);
      }
      break;
    }
    case 'succulent': {
      for (let ring = 0; ring < 3; ring++)
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + ring * 0.5;
          const r = s.w * (0.07 + ring * 0.07);
          const l = sphere(
            g,
            s.w * 0.1,
            [Math.cos(a) * r, potH + top * (0.2 + ring * 0.12), Math.sin(a) * r],
            leaf,
            0.7,
          );
          l.scale.set(0.6, 1.4, 0.6);
        }
      break;
    }
    default: {
      // fern: a fountain of thin fronds
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const f = box(
          g,
          [s.w * 0.7, 0.012, s.w * 0.08],
          [Math.cos(a) * s.w * 0.22, potH + top * 0.55, Math.sin(a) * s.w * 0.22],
          leaf,
          1,
        );
        f.rotation.y = -a;
        f.rotation.z = 0.8 - (i % 3) * 0.3;
      }
    }
  }
}

const plantEntry = (id: string, size: Size, label: string) =>
  entry({
    id,
    category: 'decor',
    size,
    wallSnap: false,
    defaults: { color: '#3f8f4f', potColor: POT, species: 'fern' },
    props: [colorProp('cprop.foliageColor'), colorProp('cprop.potColor', 'potColor'), SPECIES],
    build: plantBuild,
    draw: (p, s) => (
      <g data-label={label}>
        <C cx={0} cy={0} r={s.w / 2} fill="#bbf7d0" />
        <C cx={s.w * 0.1} cy={-s.w * 0.08} r={s.w / 3.2} fill={c(p)} />
        <C cx={0} cy={0} r={s.w * 0.12} fill={c(p, 'potColor')} />
      </g>
    ),
  });

// ───────────────────────────── Indoor decor ─────────────────────────────

const wallArt = () =>
  entry({
    id: 'wall-art',
    category: 'decor',
    size: { w: 0.9, d: 0.04, h: 0.65 },
    placement: 'wall-mounted',
    mountHeight: 1.35,
    defaults: { color: '#2f6f8f', frame: '#1f1f1f', style: 'abstract' },
    props: [
      colorProp('cprop.artColor'),
      colorProp('cprop.frameColor', 'frame'),
      {
        key: 'style',
        label: 'cprop.artStyle',
        kind: 'select',
        options: [
          { value: 'abstract', label: 'cprop.abstract' },
          { value: 'landscape', label: 'cprop.landscape' },
          { value: 'botanical', label: 'cprop.botanical' },
        ],
      },
    ],
    build: (g, p, s) => {
      box(g, [s.w, s.h, 0.04], [0, 0, 0], c(p, 'frame'), 0.5);
      box(g, [s.w - 0.1, s.h - 0.1, 0.02], [0, 0.05, 0.012], '#f4efe6', 0.9);
      const w = s.w - 0.18;
      const h = s.h - 0.18;
      if (p.style === 'landscape') {
        box(g, [w, h * 0.5, 0.01], [0, 0.09, 0.024], '#a9d3ec', 1);
        box(g, [w, h * 0.5, 0.012], [0, 0.09 + h * 0.5 - 0.02, 0.026], c(p), 1);
      } else if (p.style === 'botanical') {
        cyl(g, 0.006, 0.006, h * 0.9, [0, 0.09, 0.03], '#4d7c3a', 1, 6);
        for (let i = 0; i < 5; i++)
          sphere(g, 0.05, [i % 2 ? 0.07 : -0.07, 0.15 + i * h * 0.17, 0.03], c(p), 0.9);
      } else {
        box(g, [w * 0.6, h * 0.7, 0.01], [-w * 0.1, 0.09, 0.025], c(p), 0.9);
        sphere(g, h * 0.22, [w * 0.18, 0.09 + h * 0.4, 0.03], '#e9b44c', 0.9);
      }
    },
    draw: (p, s) => (
      <g>
        <RC cx={0} cy={0} w={s.w} h={Math.max(s.d, 0.05)} fill={c(p, 'frame')} />
        <RC cx={0} cy={0} w={s.w - 0.1} h={Math.max(s.d - 0.02, 0.02)} fill={c(p)} />
      </g>
    ),
  });

const tableLamp = () =>
  entry({
    id: 'table-lamp',
    category: 'decor',
    size: { w: 0.32, d: 0.32, h: 0.5 },
    wallSnap: false,
    lamp: { y: (s) => s.h - 0.12, color: '#ffd9a0', intensity: 8 },
    defaults: { color: '#fff1c9', base: '#8a6a4a' },
    props: [colorProp('cprop.shadeColor'), colorProp('cprop.baseColor', 'base')],
    build: (g, p, s) => {
      cyl(g, s.w * 0.28, s.w * 0.32, 0.04, [0, 0, 0], c(p, 'base'), 0.5, 20);
      cyl(g, 0.018, 0.018, s.h * 0.5, [0, 0.04, 0], c(p, 'base'), 0.5, 8);
      const shade = cyl(g, s.w * 0.3, s.w * 0.5, s.h * 0.36, [0, s.h * 0.55, 0], c(p), 0.9, 24);
      shade.userData.lamp = true;
    },
    draw: (p, s) => (
      <g>
        <C cx={0} cy={0} r={s.w / 2} fill={c(p)} />
        <C cx={0} cy={0} r={s.w * 0.12} fill={c(p, 'base')} />
      </g>
    ),
  });

const vaseBowl = () =>
  entry({
    id: 'vase-bowl',
    category: 'decor',
    size: { w: 0.28, d: 0.28, h: 0.4 },
    wallSnap: false,
    defaults: { color: '#d9d4c8', accent: '#3f8f4f', kind: 'vase' },
    props: [
      colorProp('cprop.vaseColor'),
      colorProp('cprop.foliageColor', 'accent'),
      {
        key: 'kind',
        label: 'cprop.decorKind',
        kind: 'select',
        options: [
          { value: 'vase', label: 'cprop.vase' },
          { value: 'bowl', label: 'cprop.bowl' },
        ],
      },
    ],
    build: (g, p, s) => {
      if (p.kind === 'bowl') {
        cyl(g, s.w * 0.5, s.w * 0.25, s.h * 0.4, [0, 0, 0], c(p), 0.4, 24);
        for (let i = 0; i < 5; i++)
          sphere(
            g,
            s.w * 0.1,
            [Math.cos(i * 1.3) * s.w * 0.15, s.h * 0.4, Math.sin(i * 1.3) * s.w * 0.15],
            c(p, 'accent'),
            0.6,
          );
      } else {
        cyl(g, s.w * 0.22, s.w * 0.4, s.h * 0.55, [0, 0, 0], c(p), 0.4, 20);
        for (let i = 0; i < 5; i++) {
          const st = cyl(g, 0.004, 0.004, s.h * 0.45, [0, s.h * 0.5, 0], '#4d7c3a', 1, 5);
          st.rotation.z = (i - 2) * 0.28;
          st.position.x = (i - 2) * 0.03;
          sphere(g, 0.035, [(i - 2) * 0.1, s.h * 0.95, 0], c(p, 'accent'), 0.8);
        }
      }
    },
    draw: (p, s) => (
      <g>
        <C cx={0} cy={0} r={s.w / 2} fill={c(p)} />
        <C cx={0} cy={0} r={s.w / 4} fill={c(p, 'accent')} />
      </g>
    ),
  });

const tvWallUnit = () =>
  entry({
    id: 'tv-wall-unit',
    category: 'living',
    size: { w: 2.6, d: 0.42, h: 2.1 },
    defaults: { color: '#5a4636', accent: '#e9b44c' },
    props: [colorProp('cprop.woodColor'), colorProp('cprop.accentColor', 'accent')],
    build: (g, p, s) => {
      box(g, [s.w, 0.5, s.d], [0, 0, 0], c(p), 0.6);
      box(g, [s.w * 0.82, s.h - 0.7, 0.05], [0, 0.6, -s.d / 2 + 0.03], '#2b2b2f', 0.7);
      box(g, [s.w * 0.7, s.h - 1.1, 0.04], [0, 0.82, -s.d / 2 + 0.07], '#050608', 0.15);
      for (const x of [-1, 1]) {
        box(g, [s.w * 0.1, s.h - 0.55, s.d * 0.7], [x * (s.w / 2 - s.w * 0.05), 0.5, 0], c(p), 0.6);
        box(
          g,
          [s.w * 0.1 - 0.04, 0.02, s.d * 0.5],
          [x * (s.w / 2 - s.w * 0.05), 1.4, 0.04],
          c(p, 'accent'),
          0.3,
        ).userData.lamp = true;
      }
    },
    draw: (p, s) => (
      <g>
        <RC cx={0} cy={0} w={s.w} h={s.d} fill={c(p)} />
        <RC cx={0} cy={-s.d / 2 + 0.05} w={s.w * 0.7} h={0.05} fill="#111827" />
      </g>
    ),
  });

const spaTub = () =>
  entry({
    id: 'spa-tub',
    category: 'bathroom',
    size: { w: 1.9, d: 1.0, h: 0.62 },
    defaults: { color: '#f4f4f1', water: '#bfe3ee' },
    props: [colorProp('cprop.tubColor'), colorProp('cprop.waterColor', 'water')],
    build: (g, p, s) => {
      box(g, [s.w, s.h, s.d], [0, 0, 0], c(p), 0.25);
      const inner = box(
        g,
        [s.w - 0.24, 0.05, s.d - 0.24],
        [0, s.h - 0.06, 0],
        c(p, 'water'),
        0.1,
        0.7,
      );
      inner.userData.water = true;
      for (const x of [-1, 1])
        cyl(
          g,
          0.02,
          0.02,
          0.14,
          [x * (s.w / 2 - 0.14), s.h, s.d / 2 - 0.1],
          '#a1a1aa',
          0.3,
          8,
          0.8,
        );
    },
    draw: (p, s) => (
      <g>
        <RC cx={0} cy={0} w={s.w} h={s.d} fill={c(p)} rx={0.18} />
        <RC cx={0} cy={0} w={s.w - 0.24} h={s.d - 0.24} fill={c(p, 'water')} rx={0.14} />
      </g>
    ),
  });

// ───────────────────────────── Outdoor, terrace, balcony ─────────────────────────────

const planterBox = () =>
  entry({
    id: 'planter-box',
    category: 'outdoor',
    size: { w: 1.2, d: 0.4, h: 0.7 },
    wallSnap: false,
    defaults: { color: '#6b4f2a', leaf: '#4f9a52' },
    props: [colorProp('cprop.woodColor'), colorProp('cprop.foliageColor', 'leaf')],
    build: (g, p, s) => {
      box(g, [s.w, s.h * 0.55, s.d], [0, 0, 0], c(p), 0.8);
      for (let i = 0; i < 6; i++)
        sphere(
          g,
          s.d * 0.4,
          [-s.w / 2 + (i + 0.5) * (s.w / 6), s.h * 0.55 + s.d * 0.18, ((i % 2) - 0.5) * 0.08],
          c(p, 'leaf'),
          1,
        );
    },
    draw: (p, s) => (
      <g>
        <RC cx={0} cy={0} w={s.w} h={s.d} fill={c(p)} />
        <RC cx={0} cy={0} w={s.w - 0.08} h={s.d - 0.08} fill={c(p, 'leaf')} />
      </g>
    ),
  });

const smallTree = () =>
  entry({
    id: 'tree-small',
    category: 'outdoor',
    size: { w: 1.4, d: 1.4, h: 2.4 },
    wallSnap: false,
    defaults: { color: '#4f9a52' },
    props: [colorProp('cprop.foliageColor')],
    build: (g, p, s) => {
      cyl(g, 0.04, 0.07, s.h * 0.5, [0, 0, 0], '#6b4f2a', 0.9, 8);
      sphere(g, s.w * 0.4, [0, s.h * 0.68, 0], c(p), 1);
      sphere(g, s.w * 0.28, [s.w * 0.22, s.h * 0.55, 0.1], c(p), 1);
      sphere(g, s.w * 0.26, [-s.w * 0.2, s.h * 0.58, -0.1], c(p), 1);
    },
    draw: (p, s) => (
      <g>
        <C cx={0} cy={0} r={s.w / 2} fill="#bbf7d0" />
        <C cx={s.w * 0.1} cy={-s.w * 0.1} r={s.w / 3.5} fill={c(p)} />
      </g>
    ),
  });

const grassPatch = () =>
  entry({
    id: 'grass-patch',
    category: 'outdoor',
    size: { w: 2, d: 2, h: 0.05 },
    wallSnap: false,
    defaults: { color: '#5fae4a' },
    build: (g, p, s) => {
      cyl(g, 0.5, 0.5, s.h, [0, 0, 0], c(p), 1, 28).scale.set(s.w, 1, s.d);
      for (let i = 0; i < 14; i++) {
        const a = i * 2.4;
        const r = 0.35 * (((i * 37) % 10) / 10 + 0.3);
        box(
          g,
          [0.02, 0.1, 0.02],
          [Math.cos(a) * r * s.w, s.h, Math.sin(a) * r * s.d],
          '#3f8f3a',
          1,
        );
      }
    },
    draw: (p, s) => <E cx={0} cy={0} rx={s.w / 2} ry={s.d / 2} fill={c(p)} />,
  });

const firePit = () =>
  entry({
    id: 'fire-pit',
    category: 'outdoor',
    size: { w: 1.0, d: 1.0, h: 0.7 },
    wallSnap: false,
    lamp: { y: (s) => s.h, color: '#ff9a4d', intensity: 12 },
    defaults: { color: '#6b6b6b' },
    build: (g, p, s) => {
      cyl(g, s.w / 2, s.w / 2, 0.4, [0, 0, 0], c(p), 0.9, 24);
      cyl(g, s.w / 2 - 0.1, s.w / 2 - 0.1, 0.02, [0, 0.4, 0], '#1a1a1a', 1, 24);
      for (let i = 0; i < 3; i++) {
        const f = cyl(
          g,
          0.02,
          0.1 - i * 0.015,
          0.28 - i * 0.05,
          [(i - 1) * 0.07, 0.4, (i % 2) * 0.05],
          '#ff8a2b',
          0.4,
          8,
        );
        f.userData.lamp = true;
      }
    },
    draw: (p, s) => (
      <g>
        <C cx={0} cy={0} r={s.w / 2} fill={c(p)} />
        <C cx={0} cy={0} r={s.w / 3} fill="#1f2937" />
        <C cx={0} cy={0} r={s.w / 6} fill="#fb923c" />
      </g>
    ),
  });

/** A small plunge pool: a rectangle or an organic (rounded, kidney-like) outline with a water surface. */
const plungePool = () =>
  entry({
    id: 'plunge-pool',
    category: 'outdoor',
    size: { w: 3.2, d: 2.0, h: 0.5 },
    wallSnap: false,
    defaults: { color: '#e5e7eb', water: '#3aa9d6', shape: 'organic' },
    props: [
      colorProp('cprop.copingColor'),
      colorProp('cprop.waterColor', 'water'),
      {
        key: 'shape',
        label: 'cprop.shape',
        kind: 'select',
        options: [
          { value: 'organic', label: 'cprop.organic' },
          { value: 'rect', label: 'cprop.rect' },
        ],
      },
    ],
    build: (g, p, s) => {
      const outline = (w: number, d: number): Shape => {
        const sh = new Shape();
        if (p.shape === 'rect') {
          sh.moveTo(-w / 2, -d / 2);
          sh.lineTo(w / 2, -d / 2);
          sh.lineTo(w / 2, d / 2);
          sh.lineTo(-w / 2, d / 2);
          sh.closePath();
        } else {
          sh.moveTo(-w / 2, 0);
          sh.bezierCurveTo(-w / 2, -d * 0.7, -w * 0.1, -d * 0.55, w * 0.1, -d * 0.4);
          sh.bezierCurveTo(w * 0.4, -d * 0.25, w / 2, -d * 0.55, w / 2, 0);
          sh.bezierCurveTo(w / 2, d * 0.6, w * 0.1, d * 0.55, -w * 0.15, d * 0.45);
          sh.bezierCurveTo(-w * 0.45, d * 0.35, -w / 2, d * 0.5, -w / 2, 0);
        }
        return sh;
      };
      const slab = (sh: Shape, depth: number, y: number, color: string, opacity = 1) => {
        const geo = new ExtrudeGeometry(sh, { depth, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        const m = new Mesh(geo, mat(color, 0.4, 0, opacity));
        m.position.y = y;
        m.receiveShadow = true;
        g.add(m);
        return m;
      };
      slab(outline(s.w, s.d), 0.06, s.h - 0.06, c(p));
      const water = slab(outline(s.w - 0.4, s.d - 0.4), 0.02, s.h - 0.1, c(p, 'water'), 0.75);
      water.userData.water = true;
    },
    draw: (p, s) =>
      p.shape === 'rect' ? (
        <g>
          <RC cx={0} cy={0} w={s.w} h={s.d} fill={c(p)} />
          <RC cx={0} cy={0} w={s.w - 0.4} h={s.d - 0.4} fill={c(p, 'water')} />
        </g>
      ) : (
        <g>
          <E cx={0} cy={0} rx={s.w / 2} ry={s.d / 2} fill={c(p)} />
          <E cx={0} cy={0} rx={s.w / 2 - 0.2} ry={s.d / 2 - 0.2} fill={c(p, 'water')} />
        </g>
      ),
  });

const balustrade = () =>
  entry({
    id: 'balustrade',
    category: 'outdoor',
    size: { w: 2.0, d: 0.08, h: 1.05 },
    wallSnap: false,
    defaults: { color: '#b9d8e0', rail: '#a1a1aa', style: 'glass' },
    props: [
      colorProp('cprop.glassColor'),
      colorProp('cprop.railColor', 'rail'),
      {
        key: 'style',
        label: 'cprop.balustradeStyle',
        kind: 'select',
        options: [
          { value: 'glass', label: 'cprop.glass' },
          { value: 'bars', label: 'cprop.bars' },
        ],
      },
    ],
    build: (g, p, s) => {
      box(g, [s.w, 0.05, 0.08], [0, s.h - 0.05, 0], c(p, 'rail'), 0.3, 1, 0.8);
      if (p.style === 'bars') {
        const n = Math.max(2, Math.round(s.w / 0.12));
        for (let i = 0; i <= n; i++)
          cyl(
            g,
            0.01,
            0.01,
            s.h - 0.05,
            [-s.w / 2 + (i * s.w) / n, 0, 0],
            c(p, 'rail'),
            0.3,
            6,
            0.8,
          );
      } else {
        box(g, [s.w - 0.04, s.h - 0.2, 0.02], [0, 0.1, 0], c(p), 0.1, 0.35);
        for (const x of [-1, 1])
          cyl(g, 0.02, 0.02, 0.14, [x * (s.w / 2 - 0.03), 0, 0], c(p, 'rail'), 0.3, 8, 0.8);
      }
    },
    draw: (p, s) => <RC cx={0} cy={0} w={s.w} h={Math.max(s.d, 0.06)} fill={c(p)} />,
  });

const gatePedestrian = () =>
  entry({
    id: 'gate-pedestrian',
    category: 'outdoor',
    size: { w: 1.2, d: 0.08, h: 1.6 },
    wallSnap: false,
    defaults: { color: '#3b2f25' },
    build: (g, p, s) => {
      for (const x of [-1, 1])
        box(g, [0.14, s.h + 0.1, 0.14], [x * (s.w / 2 + 0.06), 0, 0], '#9ca3af', 0.8);
      box(g, [s.w, s.h, 0.05], [0, 0.05, 0], c(p), 0.6);
      for (let i = 1; i < 6; i++)
        box(g, [0.02, s.h - 0.1, 0.06], [-s.w / 2 + (i * s.w) / 6, 0.08, 0], '#1f1a15', 0.6);
    },
    draw: (p, s) => (
      <g>
        <RC cx={0} cy={0} w={s.w} h={Math.max(s.d, 0.06)} fill={c(p)} />
        <L x1={-s.w / 2} y1={0} x2={-s.w / 2 + s.w * 0.9} y2={-s.w * 0.4} dash="3 2" />
      </g>
    ),
  });

const gateVehicle = () =>
  entry({
    id: 'gate-vehicle',
    category: 'outdoor',
    size: { w: 3.6, d: 0.1, h: 1.5 },
    wallSnap: false,
    defaults: { color: '#2b2b30' },
    build: (g, p, s) => {
      for (const x of [-1, 1])
        box(g, [0.28, s.h + 0.1, 0.28], [x * (s.w / 2 + 0.04), 0, 0], '#9ca3af', 0.8);
      box(g, [s.w, s.h, 0.06], [0, 0.08, 0.1], c(p), 0.4, 1, 0.3);
      for (let i = 1; i < 12; i++)
        box(g, [0.025, s.h - 0.12, 0.08], [-s.w / 2 + (i * s.w) / 12, 0.12, 0.1], '#111114', 0.5);
      box(g, [s.w, 0.04, 0.05], [0, 0.04, 0.1], '#6b7280', 0.5);
    },
    draw: (p, s) => (
      <g>
        <RC cx={0} cy={0} w={s.w} h={Math.max(s.d, 0.08)} fill={c(p)} />
        <L x1={-s.w / 2} y1={0.12} x2={s.w * 1.0} y2={0.12} dash="4 3" />
        <R x={-s.w / 2 - 0.3} y={-0.15} w={0.3} h={0.3} fill="#9ca3af" />
      </g>
    ),
  });

export const decorEntries = (): CatalogEntry[] => [
  plantEntry('plant-small', { w: 0.3, d: 0.3, h: 0.6 }, 'small'),
  plantEntry('plant-medium', { w: 0.5, d: 0.5, h: 1.15 }, 'medium'),
  plantEntry('plant-large', { w: 0.8, d: 0.8, h: 1.9 }, 'large'),
  wallArt(),
  tableLamp(),
  vaseBowl(),
  tvWallUnit(),
  spaTub(),
  planterBox(),
  smallTree(),
  grassPatch(),
  firePit(),
  plungePool(),
  balustrade(),
  gatePedestrian(),
  gateVehicle(),
];
