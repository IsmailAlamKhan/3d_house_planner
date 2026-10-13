import { type Group } from 'three';
import { box, cyl, group, sphere } from '../three';
import { C, L, R, RC } from '../svg';
import type { CatalogCategory, CatalogEntry, Props, PropSpec, Size } from '../types';

/**
 * Procedural pieces that the reference villa needs and the basic catalogue did not have: a waterfall wall, a fire-pit
 * deck, a floor medallion, a neon strip, a U-shaped and a curved sofa, a lit gate pillar, a planted island and a
 * square fountain. They are ordinary catalogue entries (library, 2D symbol, 3D model, colour property).
 */

const colorProp = (label: PropSpec['label'] = 'cprop.color', key = 'color'): PropSpec => ({
  key,
  label,
  kind: 'color',
});

interface Def {
  id: string;
  category: CatalogCategory;
  size: Size;
  placement?: CatalogEntry['placement'];
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
    wallSnap: d.wallSnap ?? false,
    lamp: d.lamp,
    defaultSize: d.size,
    minScale: 0.4,
    maxScale: 4,
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

const waterfallWall = () =>
  entry({
    id: 'waterfall-wall',
    category: 'outdoor',
    size: { w: 2.2, d: 0.45, h: 2.3 },
    wallSnap: true,
    defaults: { color: '#6b7280' },
    props: [colorProp()],
    build: (g, p, s) => {
      box(g, [s.w, s.h, 0.22], [0, 0, -s.d / 2 + 0.11], c(p), 0.9);
      for (const x of [-1, 1])
        box(g, [0.12, s.h + 0.1, 0.3], [x * (s.w / 2 - 0.06), 0, -s.d / 2 + 0.15], '#374151', 0.8);
      // the falling sheet of water
      box(g, [s.w - 0.4, s.h - 0.25, 0.04], [0, 0.1, -s.d / 2 + 0.25], '#bae6fd', 0.05, 0.6);
      // the spout and the basin below
      box(g, [s.w - 0.3, 0.06, 0.12], [0, s.h - 0.1, -s.d / 2 + 0.25], '#9ca3af', 0.4, 1, 0.5);
      box(g, [s.w, 0.16, s.d - 0.2], [0, 0, 0.05], '#9ca3af', 0.8);
      box(g, [s.w - 0.2, 0.02, s.d - 0.32], [0, 0.15, 0.05], '#38bdf8', 0.05, 0.8).userData.lamp =
        true;
    },
    draw: (p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} fill="#9ca3af" />
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={0.22} fill={c(p)} />
        {[-0.7, -0.35, 0, 0.35, 0.7].map((x) => (
          <L
            key={x}
            x1={x * (s.w / 2)}
            y1={-s.d / 2 + 0.22}
            x2={x * (s.w / 2)}
            y2={s.d / 2}
            dash="2 2"
          />
        ))}
      </g>
    ),
  });

const firePitDeck = () =>
  entry({
    id: 'fire-pit-deck',
    category: 'outdoor',
    size: { w: 3.2, d: 3.2, h: 0.75 },
    defaults: { color: '#8b5e34' },
    props: [colorProp('cprop.woodColor')],
    build: (g, p, s) => {
      box(g, [s.w, 0.12, s.d], [0, 0, 0], c(p), 0.85);
      for (let i = 1; i < 8; i++)
        box(g, [s.w, 0.005, 0.015], [0, 0.12, -s.d / 2 + (i * s.d) / 8], '#5b3b1c', 0.9);
      // stone fire bowl in the middle
      box(g, [1.3, 0.34, 1.3], [0, 0.12, 0], '#78716c', 0.9);
      box(g, [1.0, 0.04, 1.0], [0, 0.44, 0], '#1c1917', 0.9);
      cyl(g, 0.0, 0.2, 0.34, [0, 0.46, 0], '#fb923c', 0.4, 10).userData.lamp = true;
      cyl(g, 0.0, 0.1, 0.22, [0, 0.5, 0], '#fde047', 0.4, 10).userData.lamp = true;
    },
    draw: (p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} fill={c(p)} />
        {[-3, -2, -1, 0, 1, 2, 3].map((i) => (
          <L key={i} x1={-s.w / 2} y1={(i * s.d) / 8} x2={s.w / 2} y2={(i * s.d) / 8} />
        ))}
        <RC cx={0} cy={0} w={1.3} h={1.3} fill="#78716c" />
        <C cx={0} cy={0} r={0.33} fill="#fb923c" />
      </g>
    ),
  });

const floorMedallion = () =>
  entry({
    id: 'floor-medallion',
    category: 'decor',
    size: { w: 1.7, d: 1.7, h: 0.02 },
    defaults: { color: '#b08d57' },
    props: [colorProp()],
    build: (g, p, s) => {
      cyl(g, s.w / 2, s.w / 2, 0.012, [0, 0, 0], '#e7e0d3', 0.5, 40);
      cyl(g, s.w / 2 - 0.05, s.w / 2 - 0.05, 0.016, [0, 0, 0], c(p), 0.4, 40);
      cyl(g, s.w / 2 - 0.12, s.w / 2 - 0.12, 0.02, [0, 0, 0], '#efe7da', 0.5, 40);
      cyl(g, s.w * 0.28, s.w * 0.28, 0.024, [0, 0, 0], c(p), 0.4, 32);
      cyl(g, s.w * 0.22, s.w * 0.22, 0.028, [0, 0, 0], '#3b2f23', 0.5, 32);
      cyl(g, s.w * 0.09, s.w * 0.09, 0.032, [0, 0, 0], c(p), 0.4, 24);
    },
    draw: (p, s) => (
      <g>
        <C cx={0} cy={0} r={s.w / 2} fill="#e7e0d3" />
        <C cx={0} cy={0} r={s.w / 2 - 0.05} fill={c(p)} />
        <C cx={0} cy={0} r={s.w / 2 - 0.12} fill="#efe7da" />
        <C cx={0} cy={0} r={s.w * 0.28} fill={c(p)} />
        <C cx={0} cy={0} r={s.w * 0.22} fill="#3b2f23" />
      </g>
    ),
  });

const neonStrip = () =>
  entry({
    id: 'neon-strip',
    category: 'decor',
    size: { w: 2, d: 0.05, h: 0.08 },
    placement: 'wall-mounted',
    wallSnap: true,
    lamp: { y: () => 0, lumens: 400, kelvin: 6500 },
    defaults: { color: '#ff2bd6' },
    props: [colorProp('cprop.lightColor')],
    build: (g, p, s) => {
      box(g, [s.w + 0.04, s.h + 0.02, 0.02], [0, -0.01, 0], '#111827', 0.6);
      box(g, [s.w, s.h * 0.5, 0.03], [0, s.h * 0.2, s.d / 2 - 0.01], c(p), 0.2).userData.lamp =
        true;
    },
    draw: (p, s) => <RC cx={0} cy={0} w={s.w} h={s.d} fill={c(p)} />,
  });

const sofaU = () =>
  entry({
    id: 'sofa-u',
    category: 'living',
    size: { w: 3.4, d: 2.8, h: 0.85 },
    defaults: { color: '#d8cdbd' },
    build: (g, p, s) => {
      const arm = 0.95;
      // back of the U along the far side (−z), arms reaching forward (+z)
      box(g, [s.w, 0.42, arm], [0, 0, -s.d / 2 + arm / 2], c(p), 0.9);
      box(g, [s.w, 0.45, 0.22], [0, 0.4, -s.d / 2 + 0.11], c(p), 0.9);
      for (const x of [-1, 1]) {
        box(g, [arm, 0.42, s.d - arm], [x * (s.w / 2 - arm / 2), 0, arm / 2 - 0.0], c(p), 0.9);
        box(g, [0.2, 0.45, s.d - arm], [x * (s.w / 2 - 0.1), 0.4, arm / 2], c(p), 0.9);
        box(
          g,
          [arm - 0.15, 0.12, s.d - arm - 0.2],
          [x * (s.w / 2 - arm / 2 - 0.05), 0.42, arm / 2],
          '#efe7da',
          0.95,
        );
      }
      box(
        g,
        [s.w - 2 * arm - 0.1, 0.12, arm - 0.2],
        [0, 0.42, -s.d / 2 + arm / 2],
        '#efe7da',
        0.95,
      );
    },
    draw: (p, s) => {
      const arm = 0.95;
      return (
        <g>
          <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={arm} fill={c(p)} rx={0.08} />
          <R x={-s.w / 2} y={-s.d / 2} w={arm} h={s.d} fill={c(p)} rx={0.08} />
          <R x={s.w / 2 - arm} y={-s.d / 2} w={arm} h={s.d} fill={c(p)} rx={0.08} />
          <L x1={-s.w / 2 + arm} y1={-s.d / 2 + arm} x2={s.w / 2 - arm} y2={-s.d / 2 + arm} />
        </g>
      );
    },
  });

const sofaCurved = () =>
  entry({
    id: 'sofa-curved',
    category: 'outdoor',
    size: { w: 2.6, d: 1.4, h: 0.8 },
    defaults: { color: '#7c5a3a' },
    props: [colorProp()],
    build: (g, p, s) => {
      // a quarter-turn bench built from short blocks laid on an arc (the garden sofa of the picture)
      const n = 9;
      const r = s.w / 2;
      for (let i = 0; i < n; i++) {
        const a = (i / (n - 1)) * Math.PI * 0.9 + Math.PI * 0.05;
        const x = Math.cos(a) * (r - 0.3);
        const z = Math.sin(a) * (s.d - 0.4) * 0.9 - s.d / 2 + 0.25;
        const seat = box(g, [0.5, 0.4, 0.62], [x, 0, z], c(p), 0.9);
        seat.rotation.y = -a + Math.PI / 2;
        const back = box(
          g,
          [0.5, 0.42, 0.14],
          [Math.cos(a) * (r - 0.02), 0.3, Math.sin(a) * (s.d - 0.4) * 0.9 - s.d / 2 + 0.25 + 0.0],
          '#5b3f27',
          0.9,
        );
        back.rotation.y = -a + Math.PI / 2;
      }
    },
    draw: (p, s) => (
      <g>
        <path
          d={`M ${-s.w / 2 + 0.3} ${-s.d / 2 + 0.2} A ${s.w / 2 - 0.2} ${s.d - 0.3} 0 0 0 ${s.w / 2 - 0.3} ${-s.d / 2 + 0.2}`}
          fill="none"
          stroke={c(p)}
          strokeWidth={0.55}
          strokeLinecap="round"
        />
      </g>
    ),
  });

const pillarLight = () =>
  entry({
    id: 'pillar-light',
    category: 'outdoor',
    size: { w: 0.5, d: 0.5, h: 1.6 },
    lamp: { y: (s) => s.h - 0.14, lumens: 450, kelvin: 2700 },
    defaults: { color: '#ffe8b0' },
    props: [colorProp('cprop.lightColor')],
    build: (g, p, s) => {
      box(g, [s.w, s.h - 0.28, s.d], [0, 0, 0], '#d6d3d1', 0.9);
      box(g, [s.w + 0.08, 0.08, s.d + 0.08], [0, s.h - 0.28, 0], '#a8a29e', 0.8);
      box(g, [s.w * 0.55, 0.16, s.d * 0.55], [0, s.h - 0.2, 0], c(p), 0.2).userData.lamp = true;
      box(g, [s.w * 0.7, 0.05, s.d * 0.7], [0, s.h - 0.04, 0], '#78716c', 0.8);
    },
    draw: (p, s) => (
      <g>
        <RC cx={0} cy={0} w={s.w} h={s.d} fill="#d6d3d1" />
        <RC cx={0} cy={0} w={s.w * 0.5} h={s.d * 0.5} fill={c(p)} />
      </g>
    ),
  });

const plantedIsland = () =>
  entry({
    id: 'planted-island',
    category: 'outdoor',
    size: { w: 1.5, d: 1.2, h: 1.1 },
    defaults: { color: '#3f8f4f' },
    props: [colorProp('cprop.foliageColor')],
    build: (g, p, s) => {
      cyl(g, s.w / 2, s.w / 2 + 0.05, 0.3, [0, 0, 0], '#9ca3af', 0.9, 20);
      cyl(g, s.w / 2 - 0.08, s.w / 2 - 0.08, 0.04, [0, 0.3, 0], '#4b3621', 0.95, 20);
      for (const [x, z, k] of [
        [0, 0, 1],
        [0.28, 0.12, 0.7],
        [-0.3, -0.1, 0.75],
        [0.05, -0.3, 0.6],
      ] as const)
        sphere(g, 0.28 * k * (s.w / 1.5), [x * s.w, 0.34 + 0.28 * k, z * s.d], c(p), 1);
      cyl(g, 0.03, 0.04, 0.5, [0, 0.3, 0], '#6b4f2a', 0.9, 8);
    },
    draw: (p, s) => (
      <g>
        <C cx={0} cy={0} r={s.w / 2} fill="#9ca3af" />
        <C cx={0} cy={0} r={s.w / 2 - 0.08} fill="#a7f3d0" />
        <C cx={0.1} cy={0.05} r={s.w * 0.22} fill={c(p)} />
        <C cx={-0.2} cy={-0.08} r={s.w * 0.17} fill="#86efac" />
      </g>
    ),
  });

const fountainSquare = () =>
  entry({
    id: 'fountain-square',
    category: 'outdoor',
    size: { w: 2.4, d: 2.4, h: 1.5 },
    defaults: { color: '#d6d3d1' },
    build: (g, p, s) => {
      box(g, [s.w, 0.4, s.d], [0, 0, 0], c(p), 0.8);
      box(g, [s.w - 0.26, 0.02, s.d - 0.26], [0, 0.39, 0], '#38bdf8', 0.05, 0.85).userData.lamp =
        true;
      cyl(g, 0.16, 0.22, 0.7, [0, 0.4, 0], c(p), 0.8, 16);
      cyl(g, 0.55, 0.32, 0.12, [0, 1.05, 0], c(p), 0.8, 24);
      cyl(g, 0.05, 0.1, 0.34, [0, 1.17, 0], '#bae6fd', 0.1, 12, 0, 0.8);
    },
    draw: (p, s) => (
      <g>
        <RC cx={0} cy={0} w={s.w} h={s.d} fill={c(p)} />
        <RC cx={0} cy={0} w={s.w - 0.26} h={s.d - 0.26} fill="#7dd3fc" />
        <C cx={0} cy={0} r={0.5} fill={c(p)} />
        <C cx={0} cy={0} r={0.12} fill="#bae6fd" />
      </g>
    ),
  });

export const referenceEntries = (): CatalogEntry[] => [
  waterfallWall(),
  firePitDeck(),
  floorMedallion(),
  neonStrip(),
  sofaU(),
  sofaCurved(),
  pillarLight(),
  plantedIsland(),
  fountainSquare(),
];
