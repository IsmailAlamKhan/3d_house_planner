import { type Group } from 'three';
import { box, cyl, group, sphere } from '../three';
import { C, L, R, RC } from '../svg';
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
const TRUNK = '#6b4f2a';

// ───────────────────────────── Plants ─────────────────────────────

const broadTree = () =>
  entry({
    id: 'tree-broad',
    category: 'outdoor',
    size: { w: 3, d: 3, h: 5 },
    defaults: { color: '#3f8f4f' },
    props: [colorProp('cprop.foliageColor')],
    build: (g, p, s) => {
      cyl(g, 0.12 * (s.w / 3), 0.18 * (s.w / 3), s.h * 0.45, [0, 0, 0], TRUNK, 0.9, 10);
      const r = s.w * 0.32;
      for (const [x, y, z, k] of [
        [0, 0.68, 0, 1.15],
        [0.28, 0.58, 0.1, 0.85],
        [-0.26, 0.6, -0.12, 0.85],
        [0.05, 0.82, -0.2, 0.7],
        [-0.1, 0.56, 0.28, 0.75],
      ] as const)
        sphere(g, r * k, [x * s.w, y * s.h, z * s.d], c(p), 1);
    },
    draw: (p, s) => (
      <g>
        <C cx={0} cy={0} r={s.w / 2} fill="#bbf7d0" />
        <C cx={0.15 * s.w} cy={-0.1 * s.w} r={s.w / 3.4} fill="#86efac" />
        <C cx={-0.12 * s.w} cy={0.12 * s.w} r={s.w / 4} fill={c(p)} />
        <C cx={0} cy={0} r={0.1} fill={TRUNK} />
      </g>
    ),
  });

const palm = () =>
  entry({
    id: 'tree-palm',
    category: 'outdoor',
    size: { w: 2.4, d: 2.4, h: 5.5 },
    defaults: { color: '#4d9a4f' },
    props: [colorProp('cprop.foliageColor')],
    build: (g, p, s) => {
      cyl(g, 0.09, 0.15, s.h * 0.9, [0, 0, 0], '#8b6b3e', 0.9, 10);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const leaf = box(
          g,
          [s.w * 0.5, 0.04, 0.22],
          [Math.cos(a) * s.w * 0.22, s.h * 0.88, Math.sin(a) * s.w * 0.22],
          c(p),
          1,
        );
        leaf.rotation.y = -a;
        leaf.rotation.z = -0.35;
      }
      sphere(g, 0.18, [0, s.h * 0.9, 0], '#7c5a2c');
    },
    draw: (p, s) => (
      <g>
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return (
            <L
              key={i}
              x1={0}
              y1={0}
              x2={Math.cos(a) * s.w * 0.5}
              y2={Math.sin(a) * s.w * 0.5}
              sw={2}
            />
          );
        })}
        <C cx={0} cy={0} r={0.14} fill={c(p)} />
      </g>
    ),
  });

const conifer = () =>
  entry({
    id: 'tree-conifer',
    category: 'outdoor',
    size: { w: 1.6, d: 1.6, h: 4 },
    defaults: { color: '#2f6f46' },
    props: [colorProp('cprop.foliageColor')],
    build: (g, p, s) => {
      cyl(g, 0.08, 0.1, s.h * 0.2, [0, 0, 0], TRUNK, 0.9, 8);
      for (let i = 0; i < 4; i++) {
        const k = 1 - i * 0.22;
        cyl(g, 0.02, (s.w / 2) * k, s.h * 0.3, [0, s.h * (0.16 + i * 0.16), 0], c(p), 1, 14);
      }
    },
    draw: (p, s) => (
      <g>
        <C cx={0} cy={0} r={s.w / 2} fill="#86efac" />
        <C cx={0} cy={0} r={s.w / 3.2} fill={c(p)} />
        <C cx={0} cy={0} r={s.w / 8} fill="#14532d" />
      </g>
    ),
  });

const shrub = () =>
  entry({
    id: 'shrub',
    category: 'outdoor',
    size: { w: 0.9, d: 0.9, h: 0.8 },
    defaults: { color: '#4f9a52' },
    props: [colorProp('cprop.foliageColor')],
    build: (g, p, s) => {
      for (const [x, z, k] of [
        [0, 0, 1],
        [0.25, 0.1, 0.7],
        [-0.22, -0.1, 0.75],
        [0.05, -0.25, 0.6],
      ] as const)
        sphere(g, (s.w / 2) * k, [x * s.w, (s.h / 2) * k, z * s.d], c(p), 1);
    },
    draw: (p, s) => (
      <g>
        <C cx={0} cy={0} r={s.w / 2} fill="#bbf7d0" />
        <C cx={0.1 * s.w} cy={0.05 * s.w} r={s.w / 4} fill={c(p)} />
      </g>
    ),
  });

const hedge = () =>
  entry({
    id: 'hedge',
    category: 'outdoor',
    size: { w: 3, d: 0.6, h: 1.1 },
    defaults: { color: '#3d8a48' },
    props: [colorProp('cprop.foliageColor')],
    build: (g, p, s) => {
      box(g, [s.w - 0.1, 0.12, s.d - 0.1], [0, 0, 0], '#5b4a35', 1);
      box(g, [s.w, s.h - 0.12, s.d], [0, 0.12, 0], c(p), 1);
    },
    draw: (p, s) => <RC cx={0} cy={0} w={s.w} h={s.d} fill={c(p)} rx={0.12} />,
  });

const flowerBed = () =>
  entry({
    id: 'flower-bed',
    category: 'outdoor',
    size: { w: 2, d: 0.9, h: 0.35 },
    defaults: { color: '#e11d74' },
    props: [colorProp('cprop.flowerColor')],
    build: (g, p, s) => {
      box(g, [s.w, 0.18, s.d], [0, 0, 0], '#7c5a3a', 1);
      for (let i = 0; i < 9; i++)
        sphere(
          g,
          0.09,
          [((i % 5) / 4 - 0.5) * (s.w - 0.3), 0.26, (Math.floor(i / 5) - 0.5) * (s.d - 0.3)],
          i % 2 ? c(p) : '#facc15',
          0.9,
        );
    },
    draw: (p, s) => (
      <g>
        <RC cx={0} cy={0} w={s.w} h={s.d} fill="#d6c3a8" rx={0.1} />
        {Array.from({ length: 6 }, (_, i) => (
          <C
            key={i}
            cx={((i % 3) / 2 - 0.5) * s.w * 0.7}
            cy={(Math.floor(i / 3) - 0.5) * s.d * 0.5}
            r={0.1}
            fill={i % 2 ? c(p) : '#facc15'}
          />
        ))}
      </g>
    ),
  });

// ───────────────────────────── Outdoor furniture ─────────────────────────────

const loungeSet = () =>
  entry({
    id: 'lounge-set',
    category: 'outdoor',
    size: { w: 2.6, d: 2.2, h: 0.8 },
    defaults: { color: '#d6d3d1' },
    build: (g, p, s) => {
      box(g, [s.w, 0.4, 0.8], [0, 0, -s.d / 2 + 0.4], c(p), 0.95);
      box(g, [s.w, 0.45, 0.2], [0, 0.4, -s.d / 2 + 0.1], c(p), 0.95);
      box(g, [0.8, 0.4, s.d - 0.8], [-s.w / 2 + 0.4, 0, 0.4], c(p), 0.95);
      box(g, [0.9, 0.3, 0.9], [0.4, 0, 0.3], '#57534e', 0.6);
      box(g, [0.95, 0.04, 0.95], [0.4, 0.3, 0.3], '#a8a29e', 0.3);
    },
    draw: (p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={0.8} fill={c(p)} rx={0.08} />
        <R x={-s.w / 2} y={-s.d / 2 + 0.8} w={0.8} h={s.d - 0.8} fill={c(p)} rx={0.08} />
        <RC cx={0.4} cy={0.3} w={0.9} h={0.9} fill="#a8a29e" />
      </g>
    ),
  });

const outdoorDining = () =>
  entry({
    id: 'outdoor-dining',
    category: 'outdoor',
    size: { w: 2.6, d: 1.2, h: 0.8 },
    defaults: { color: '#8b5e34' },
    build: (g, p, s) => {
      box(g, [s.w - 0.8, 0.06, 0.9], [0, 0.72, 0], c(p), 0.7);
      for (const x of [-1, 1])
        for (const z of [-1, 1])
          box(g, [0.06, 0.72, 0.06], [x * (s.w / 2 - 0.5), 0, z * 0.38], '#44403c', 0.6);
      for (let i = 0; i < 3; i++)
        for (const z of [-1, 1]) {
          box(g, [0.42, 0.05, 0.42], [(i - 1) * 0.75, 0.44, z * 0.62], '#d6d3d1', 0.8);
          box(g, [0.42, 0.4, 0.05], [(i - 1) * 0.75, 0.46, z * 0.82], '#d6d3d1', 0.8);
        }
    },
    draw: (p, s) => (
      <g>
        <RC cx={0} cy={0} w={s.w - 0.8} h={0.9} fill={c(p)} rx={0.05} />
        {[-1, 0, 1].flatMap((i) =>
          [-1, 1].map((z) => (
            <RC key={`${i}${z}`} cx={i * 0.75} cy={z * 0.62} w={0.42} h={0.42} fill="#e7e5e4" />
          )),
        )}
      </g>
    ),
  });

const sunLounger = () =>
  entry({
    id: 'sun-lounger',
    category: 'outdoor',
    size: { w: 0.7, d: 2, h: 0.75 },
    defaults: { color: '#f5f5f4' },
    build: (g, p, s) => {
      box(g, [s.w, 0.1, s.d * 0.65], [0, 0.2, s.d * 0.17], c(p), 0.9);
      const back = box(g, [s.w, 0.08, s.d * 0.38], [0, 0.4, -s.d * 0.32], c(p), 0.9);
      back.rotation.x = -0.6;
      for (const x of [-1, 1])
        cyl(g, 0.03, 0.03, 0.2, [x * (s.w / 2 - 0.05), 0, s.d * 0.4], '#44403c', 0.5, 8);
    },
    draw: (p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} fill={c(p)} rx={0.08} />
        <L x1={-s.w / 2} y1={-s.d * 0.12} x2={s.w / 2} y2={-s.d * 0.12} />
      </g>
    ),
  });

const trampoline = () =>
  entry({
    id: 'trampoline',
    category: 'outdoor',
    size: { w: 3, d: 3, h: 0.9 },
    defaults: { color: '#1e3a8a' },
    build: (g, p, s) => {
      cyl(g, s.w / 2, s.w / 2, 0.06, [0, 0.75, 0], '#1f2937', 0.5, 28);
      cyl(g, s.w / 2 - 0.2, s.w / 2 - 0.2, 0.04, [0, 0.78, 0], c(p), 0.9, 28);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        cyl(
          g,
          0.03,
          0.03,
          0.75,
          [Math.cos(a) * (s.w / 2 - 0.1), 0, Math.sin(a) * (s.w / 2 - 0.1)],
          '#52525b',
          0.5,
          8,
        );
      }
    },
    draw: (p, s) => (
      <g>
        <C cx={0} cy={0} r={s.w / 2} fill="#1f2937" />
        <C cx={0} cy={0} r={s.w / 2 - 0.2} fill={c(p)} />
      </g>
    ),
  });

const playFrame = () =>
  entry({
    id: 'play-frame',
    category: 'outdoor',
    size: { w: 3, d: 2.2, h: 2.2 },
    defaults: { color: '#f59e0b' },
    build: (g, p, s) => {
      for (const x of [-1, 1])
        for (const z of [-1, 1])
          cyl(g, 0.05, 0.05, s.h, [x * (s.w / 2 - 0.4), 0, z * 0.5], '#8b5e34', 0.8, 8);
      box(g, [s.w - 0.8, 0.06, 1.2], [0, s.h - 0.06, 0], '#8b5e34', 0.8);
      box(g, [1.2, 0.04, 1.2], [-(s.w / 2 - 1), 1.0, 0], c(p), 0.8);
      const slide = box(g, [0.55, 0.05, 2], [s.w / 2 - 0.25, 0.5, 0], '#ef4444', 0.5);
      slide.rotation.z = 0.55;
      box(g, [s.w - 1.2, 0.06, 0.06], [-0.1, s.h - 0.4, 0], '#52525b', 0.5);
      box(g, [0.4, 0.04, 0.2], [0.2, 0.6, 0], c(p), 0.8);
    },
    draw: (p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w - 1.1} h={s.d} fill="#d6b88a" rx={0.05} />
        <R x={s.w / 2 - 1.1} y={-0.3} w={1.1} h={0.6} fill={c(p)} rx={0.08} />
        <C cx={-0.4} cy={0} r={0.18} fill="#ef4444" />
      </g>
    ),
  });

const fountain = () =>
  entry({
    id: 'fountain',
    category: 'outdoor',
    size: { w: 2, d: 2, h: 1.6 },
    defaults: { color: '#d6d3d1' },
    build: (g, p, s) => {
      cyl(g, s.w / 2, s.w / 2, 0.35, [0, 0, 0], c(p), 0.8, 32);
      cyl(g, s.w / 2 - 0.12, s.w / 2 - 0.12, 0.02, [0, 0.33, 0], '#38bdf8', 0.1, 32);
      cyl(g, 0.12, 0.18, 0.9, [0, 0.35, 0], c(p), 0.8, 16);
      cyl(g, 0.5, 0.3, 0.12, [0, 1.15, 0], c(p), 0.8, 24);
      cyl(g, 0.06, 0.12, 0.3, [0, 1.27, 0], '#bae6fd', 0.1, 12);
    },
    draw: (p, s) => (
      <g>
        <C cx={0} cy={0} r={s.w / 2} fill={c(p)} />
        <C cx={0} cy={0} r={s.w / 2 - 0.12} fill="#7dd3fc" />
        <C cx={0} cy={0} r={0.45} fill={c(p)} />
        <C cx={0} cy={0} r={0.12} fill="#bae6fd" />
      </g>
    ),
  });

const pergolaItem = () =>
  entry({
    id: 'pergola',
    category: 'outdoor',
    size: { w: 4, d: 3, h: 2.6 },
    defaults: { color: '#8b5e34' },
    build: (g, p, s) => {
      for (const x of [-1, 1])
        for (const z of [-1, 1])
          box(g, [0.18, s.h, 0.18], [x * (s.w / 2 - 0.09), 0, z * (s.d / 2 - 0.09)], c(p), 0.8);
      for (const z of [-1, 1])
        box(g, [s.w, 0.18, 0.14], [0, s.h - 0.18, z * (s.d / 2 - 0.07)], c(p), 0.8);
      for (let x = -s.w / 2 + 0.2; x <= s.w / 2 - 0.1; x += 0.4)
        box(g, [0.07, 0.1, s.d], [x, s.h, 0], c(p), 0.8);
    },
    draw: (p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} fill="none" dash="4 3" />
        {Array.from({ length: 9 }, (_, i) => (
          <L
            key={i}
            x1={-s.w / 2 + (i + 0.5) * (s.w / 9)}
            y1={-s.d / 2}
            x2={-s.w / 2 + (i + 0.5) * (s.w / 9)}
            y2={s.d / 2}
            dash="2 3"
          />
        ))}
        {[-1, 1].flatMap((x) =>
          [-1, 1].map((z) => (
            <RC
              key={`${x}${z}`}
              cx={x * (s.w / 2 - 0.09)}
              cy={z * (s.d / 2 - 0.09)}
              w={0.18}
              h={0.18}
              fill={c(p)}
            />
          )),
        )}
      </g>
    ),
  });

const parasol = () =>
  entry({
    id: 'parasol',
    category: 'outdoor',
    size: { w: 2.6, d: 2.6, h: 2.4 },
    defaults: { color: '#f5e6c8' },
    build: (g, p, s) => {
      cyl(g, 0.025, 0.025, s.h, [0, 0, 0], '#52525b', 0.5, 8);
      cyl(g, 0.03, s.w / 2, 0.45, [0, s.h - 0.45, 0], c(p), 0.9, 20);
    },
    draw: (p, s) => (
      <g>
        <C cx={0} cy={0} r={s.w / 2} fill={c(p)} />
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return (
            <L key={i} x1={0} y1={0} x2={Math.cos(a) * (s.w / 2)} y2={Math.sin(a) * (s.w / 2)} />
          );
        })}
      </g>
    ),
  });

const bbq = () =>
  entry({
    id: 'bbq',
    category: 'outdoor',
    size: { w: 1.2, d: 0.6, h: 1.1 },
    defaults: { color: '#27272a' },
    build: (g, p, s) => {
      box(g, [s.w, 0.5, s.d], [0, 0.4, 0], c(p), 0.5);
      box(g, [s.w + 0.1, 0.08, s.d + 0.05], [0, 0.9, 0], '#52525b', 0.4, 1, 0.5);
      for (const x of [-1, 1])
        for (const z of [-1, 1])
          cyl(
            g,
            0.02,
            0.02,
            0.4,
            [x * (s.w / 2 - 0.05), 0, z * (s.d / 2 - 0.05)],
            '#71717a',
            0.5,
            8,
          );
    },
    draw: (p, s) => (
      <g>
        <RC cx={0} cy={0} w={s.w} h={s.d} fill={c(p)} rx={0.04} />
        <C cx={-0.2} cy={0} r={0.16} fill="#f97316" />
        <C cx={0.2} cy={0} r={0.16} fill="#f97316" />
      </g>
    ),
  });

const car = () =>
  entry({
    id: 'car',
    category: 'outdoor',
    size: { w: 1.85, d: 4.5, h: 1.45 },
    defaults: { color: '#e5e7eb' },
    build: (g, p, s) => {
      box(g, [s.w, 0.6, s.d], [0, 0.28, 0], c(p), 0.35, 1, 0.4);
      box(g, [s.w - 0.2, 0.5, s.d * 0.5], [0, 0.88, -s.d * 0.04], c(p), 0.35, 1, 0.4);
      box(g, [s.w - 0.18, 0.4, s.d * 0.46], [0, 0.92, -s.d * 0.04], '#1e293b', 0.15, 0.9);
      for (const x of [-1, 1])
        for (const z of [-1, 1]) {
          const w = cyl(
            g,
            0.34,
            0.34,
            0.22,
            [x * (s.w / 2 - 0.05), 0.02, z * s.d * 0.3],
            '#18181b',
            0.9,
            16,
          );
          w.rotation.z = Math.PI / 2;
          w.position.y = 0.34;
        }
      box(g, [0.3, 0.1, 0.04], [-0.6, 0.55, s.d / 2], '#fef9c3', 0.2);
      box(g, [0.3, 0.1, 0.04], [0.6, 0.55, s.d / 2], '#fef9c3', 0.2);
    },
    draw: (p, s) => (
      <g>
        <RC cx={0} cy={0} w={s.w} h={s.d} fill={c(p)} rx={0.3} />
        <RC cx={0} cy={-s.d * 0.04} w={s.w - 0.3} h={s.d * 0.4} fill="#94a3b8" rx={0.15} />
      </g>
    ),
  });

const gardenLight = () =>
  entry({
    id: 'garden-light',
    category: 'outdoor',
    size: { w: 0.2, d: 0.2, h: 0.9 },
    lamp: { y: (s) => s.h - 0.1, lumens: 300, kelvin: 2700 },
    defaults: { color: '#fff1c4' },
    props: [colorProp('cprop.lightColor')],
    build: (g, p, s) => {
      cyl(g, 0.025, 0.035, s.h - 0.15, [0, 0, 0], '#27272a', 0.5, 8);
      cyl(g, 0.09, 0.07, 0.15, [0, s.h - 0.15, 0], c(p), 0.2, 12).userData.lamp = true;
    },
    draw: (p) => (
      <g>
        <C cx={0} cy={0} r={0.1} fill={c(p)} />
        <C cx={0} cy={0} r={0.035} fill="#27272a" />
      </g>
    ),
  });

const poolLadder = () =>
  entry({
    id: 'pool-ladder',
    category: 'outdoor',
    size: { w: 0.5, d: 0.5, h: 1.0 },
    defaults: { color: '#cbd5e1' },
    build: (g, p, s) => {
      for (const x of [-1, 1]) {
        cyl(g, 0.02, 0.02, s.h, [x * 0.18, 0, 0], c(p), 0.2, 8, 0.8);
        const top = box(g, [0.04, 0.04, 0.3], [x * 0.18, s.h - 0.04, 0.12], c(p), 0.2, 1, 0.8);
        top.rotation.x = 0.2;
      }
      for (let i = 0; i < 3; i++)
        box(g, [0.36, 0.025, 0.08], [0, 0.25 + i * 0.25, 0.04], c(p), 0.2, 1, 0.8);
    },
    draw: (p) => (
      <g>
        <RC cx={0} cy={0} w={0.36} h={0.3} fill={c(p)} />
        <L x1={-0.18} y1={0} x2={0.18} y2={0} />
      </g>
    ),
  });

const carBay = () =>
  entry({
    id: 'car-bay',
    category: 'outdoor',
    size: { w: 2.7, d: 5.2, h: 0.02 },
    defaults: { color: '#f8fafc' },
    build: (g, p, s) => {
      for (const x of [-1, 1]) box(g, [0.1, 0.02, s.d], [x * (s.w / 2 - 0.05), 0, 0], c(p), 0.9);
      box(g, [s.w, 0.02, 0.1], [0, 0, -s.d / 2 + 0.05], c(p), 0.9);
    },
    draw: (_p, s) => <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} fill="none" dash="6 4" />,
  });

// ───────────────────────────── Villa interiors ─────────────────────────────

const treadmill = () =>
  entry({
    id: 'treadmill',
    category: 'other',
    size: { w: 0.8, d: 1.8, h: 1.4 },
    defaults: { color: '#27272a' },
    build: (g, p, s) => {
      box(g, [s.w, 0.15, s.d], [0, 0.1, 0], c(p), 0.6);
      box(g, [s.w - 0.2, 0.03, s.d - 0.35], [0, 0.25, 0.1], '#3f3f46', 0.9);
      for (const x of [-1, 1])
        cyl(g, 0.02, 0.02, 1.1, [x * (s.w / 2 - 0.05), 0.25, -s.d / 2 + 0.2], '#71717a', 0.4, 8);
      box(g, [s.w, 0.25, 0.1], [0, 1.2, -s.d / 2 + 0.2], '#111827', 0.4);
    },
    draw: (p, s) => (
      <g>
        <RC cx={0} cy={0} w={s.w} h={s.d} fill={c(p)} rx={0.05} />
        <RC cx={0} cy={0.1} w={s.w - 0.25} h={s.d - 0.5} fill="#52525b" />
        <RC cx={0} cy={-s.d / 2 + 0.2} w={s.w} h={0.15} fill="#111827" />
      </g>
    ),
  });

const gymBench = () =>
  entry({
    id: 'gym-bench',
    category: 'other',
    size: { w: 0.55, d: 1.4, h: 0.5 },
    defaults: { color: '#1f2937' },
    build: (g, p, s) => {
      box(g, [s.w * 0.6, 0.1, s.d], [0, 0.4, 0], c(p), 0.8);
      for (const z of [-1, 1])
        box(g, [s.w, 0.05, 0.08], [0, 0, z * (s.d / 2 - 0.1)], '#52525b', 0.5);
      for (const z of [-1, 1])
        box(g, [0.05, 0.4, 0.05], [0, 0, z * (s.d / 2 - 0.1)], '#52525b', 0.5);
    },
    draw: (p, s) => <RC cx={0} cy={0} w={s.w * 0.6} h={s.d} fill={c(p)} rx={0.06} />,
  });

const gymRack = () =>
  entry({
    id: 'gym-rack',
    category: 'other',
    size: { w: 1.4, d: 1.2, h: 2.3 },
    defaults: { color: '#3f3f46' },
    build: (g, p, s) => {
      for (const x of [-1, 1])
        for (const z of [-1, 1])
          box(
            g,
            [0.06, s.h, 0.06],
            [x * (s.w / 2 - 0.03), 0, z * (s.d / 2 - 0.03)],
            c(p),
            0.5,
            1,
            0.5,
          );
      for (const z of [-1, 1])
        box(g, [s.w, 0.06, 0.06], [0, s.h - 0.06, z * (s.d / 2 - 0.03)], c(p), 0.5, 1, 0.5);
      const bar = cyl(g, 0.015, 0.015, s.w + 0.3, [0, 0, -s.d / 2 + 0.1], '#a1a1aa', 0.3, 8, 0.8);
      bar.rotation.z = Math.PI / 2;
      bar.position.y = 1.35;
      for (const x of [-1, 1])
        cyl(
          g,
          0.22,
          0.22,
          0.05,
          [x * (s.w / 2 + 0.1), 1.2, -s.d / 2 + 0.1],
          '#111827',
          0.7,
          16,
        ).rotation.z = Math.PI / 2;
    },
    draw: (p, s) => (
      <g>
        <RC cx={0} cy={0} w={s.w} h={s.d} fill="none" sw={2} />
        <L
          x1={-s.w / 2 - 0.15}
          y1={-s.d / 2 + 0.1}
          x2={s.w / 2 + 0.15}
          y2={-s.d / 2 + 0.1}
          sw={2}
        />
        <C cx={0} cy={0} r={0.05} fill={c(p)} />
      </g>
    ),
  });

const saunaBench = () =>
  entry({
    id: 'sauna-bench',
    category: 'other',
    size: { w: 2, d: 1.2, h: 1.1 },
    defaults: { color: '#c58b4e' },
    build: (g, p, s) => {
      box(g, [s.w, 0.06, 0.5], [0, 0.45, -s.d / 2 + 0.25], c(p), 0.7);
      box(g, [s.w, 0.06, 0.5], [0, 0.85, -s.d / 2 + 0.55 - 0.1], c(p), 0.7);
      box(g, [s.w, 0.45, 0.06], [0, 0, -s.d / 2 + 0.45], c(p), 0.7);
      box(g, [0.5, 0.5, 0.5], [s.w / 2 - 0.3, 0, s.d / 2 - 0.3], '#27272a', 0.6);
    },
    draw: (p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={0.5} fill={c(p)} />
        <R x={-s.w / 2} y={-s.d / 2 + 0.5} w={s.w} h={0.4} fill={c(p)} />
        <RC cx={s.w / 2 - 0.3} cy={s.d / 2 - 0.3} w={0.5} h={0.5} fill="#52525b" />
      </g>
    ),
  });

const hotTub = () =>
  entry({
    id: 'hot-tub',
    category: 'bathroom',
    size: { w: 2, d: 2, h: 0.85 },
    defaults: { color: '#cbd5e1' },
    build: (g, p, s) => {
      cyl(g, s.w / 2, s.w / 2, s.h, [0, 0, 0], c(p), 0.4, 32);
      cyl(g, s.w / 2 - 0.15, s.w / 2 - 0.15, 0.02, [0, s.h - 0.06, 0], '#7dd3fc', 0.1, 32);
    },
    draw: (p, s) => (
      <g>
        <C cx={0} cy={0} r={s.w / 2} fill={c(p)} />
        <C cx={0} cy={0} r={s.w / 2 - 0.15} fill="#7dd3fc" />
      </g>
    ),
  });

const gamingDesk = () =>
  entry({
    id: 'gaming-desk',
    category: 'living',
    size: { w: 1.8, d: 0.8, h: 1.2 },
    defaults: { color: '#111827' },
    build: (g, p, s) => {
      box(g, [s.w, 0.05, s.d], [0, 0.72, 0], c(p), 0.4);
      for (const x of [-1, 1])
        box(g, [0.05, 0.72, s.d - 0.1], [x * (s.w / 2 - 0.05), 0, 0], '#27272a', 0.5);
      for (const x of [-0.6, 0, 0.6]) {
        const m = box(g, [0.55, 0.32, 0.03], [x, 0.9, -s.d / 2 + 0.2], '#0f172a', 0.2);
        m.rotation.y = -x * 0.35;
        box(g, [0.5, 0.28, 0.01], [x, 0.92, -s.d / 2 + 0.22], '#38bdf8', 0.1);
      }
      box(g, [0.5, 0.02, 0.2], [0, 0.77, 0.1], '#1f2937', 0.5);
    },
    draw: (p, s) => (
      <g>
        <RC cx={0} cy={0} w={s.w} h={s.d} fill={c(p)} rx={0.03} />
        {[-0.6, 0, 0.6].map((x) => (
          <RC key={x} cx={x} cy={-s.d / 2 + 0.2} w={0.55} h={0.05} fill="#38bdf8" />
        ))}
      </g>
    ),
  });

const theatreSofa = () =>
  entry({
    id: 'theatre-sofa',
    category: 'living',
    size: { w: 3, d: 1, h: 0.9 },
    defaults: { color: '#3b1f1f' },
    build: (g, p, s) => {
      box(g, [s.w, 0.4, s.d], [0, 0, 0], c(p), 0.9);
      box(g, [s.w, 0.5, 0.25], [0, 0.4, -s.d / 2 + 0.12], c(p), 0.9);
      for (const x of [-1, 0, 1])
        box(
          g,
          [0.08, 0.5, s.d - 0.2],
          [x * (s.w / 3) + (x === 1 ? -0.5 : x === -1 ? 0.5 : 0) * 0, 0.3, 0.05],
          '#1c1917',
          0.9,
        );
    },
    draw: (p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} fill={c(p)} rx={0.1} />
        <L x1={-s.w / 6} y1={-s.d / 2 + 0.25} x2={-s.w / 6} y2={s.d / 2} />
        <L x1={s.w / 6} y1={-s.d / 2 + 0.25} x2={s.w / 6} y2={s.d / 2} />
      </g>
    ),
  });

const theatreScreen = () =>
  entry({
    id: 'theatre-screen',
    category: 'living',
    size: { w: 3, d: 0.1, h: 1.7 },
    placement: 'wall-mounted',
    wallSnap: true,
    defaults: { color: '#0b0f19' },
    build: (g, p, s) => {
      box(g, [s.w + 0.1, s.h + 0.1, 0.05], [0, 0, 0], '#1f2937', 0.5);
      box(g, [s.w, s.h, 0.03], [0, 0.05, s.d / 2 - 0.01], c(p), 0.2);
    },
    draw: (_p, s) => <RC cx={0} cy={0} w={s.w} h={s.d} fill="#111827" />,
  });

const closetShelving = () =>
  entry({
    id: 'closet-shelving',
    category: 'bedroom',
    size: { w: 2, d: 0.55, h: 2.2 },
    defaults: { color: '#e7d9c4' },
    build: (g, p, s) => {
      for (const x of [-1, 1]) box(g, [0.03, s.h, s.d], [x * (s.w / 2 - 0.015), 0, 0], c(p), 0.7);
      for (let i = 0; i < 6; i++) box(g, [s.w, 0.03, s.d], [0, 0.35 + i * 0.35, 0], c(p), 0.7);
      const rail = cyl(g, 0.012, 0.012, s.w, [0, 0, 0], '#a1a1aa', 0.3, 8, 0.8);
      rail.position.y = 1.8;
      rail.rotation.z = Math.PI / 2;
    },
    draw: (p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} fill={c(p)} />
        <L x1={-s.w / 2} y1={0} x2={s.w / 2} y2={0} dash="3 2" />
      </g>
    ),
  });

export const outdoorEntries = (): CatalogEntry[] => [
  broadTree(),
  palm(),
  conifer(),
  shrub(),
  hedge(),
  flowerBed(),
  loungeSet(),
  outdoorDining(),
  sunLounger(),
  trampoline(),
  playFrame(),
  fountain(),
  pergolaItem(),
  parasol(),
  bbq(),
  car(),
  gardenLight(),
  poolLadder(),
  carBay(),
  treadmill(),
  gymBench(),
  gymRack(),
  saunaBench(),
  hotTub(),
  gamingDesk(),
  theatreSofa(),
  theatreScreen(),
  closetShelving(),
];
