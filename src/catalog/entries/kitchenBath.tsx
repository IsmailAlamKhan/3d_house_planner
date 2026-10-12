import { type Group } from 'three';
import { box, cyl, group, sphere } from '../three';
import { C, E, L, R, RC } from '../svg';
import type { CatalogCategory, CatalogEntry, Placement, Props, PropSpec, Size } from '../types';

const colorProp = (label: PropSpec['label'], key: string): PropSpec => ({
  key,
  label,
  kind: 'color',
});
const c = (p: Props, k: string) => String(p[k]);

interface Def {
  id: string;
  category: CatalogCategory;
  size: Size;
  placement?: Placement;
  mountHeight?: number;
  wallSnap?: boolean;
  props: PropSpec[];
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
    defaultSize: d.size,
    minScale: 0.4,
    maxScale: 3,
    props: d.props,
    defaults: d.defaults,
    build3D: (p, s) => {
      const g = group();
      d.build(g, p, s);
      return g;
    },
    draw2D: (p, s) => d.draw(p, s),
  };
}

const COUNTER = 0.04;
const frontProps = [
  colorProp('cprop.frontColor', 'front'),
  colorProp('cprop.counterColor', 'counter'),
];

const handle = (g: Group, x: number, y: number, z: number) =>
  box(g, [0.12, 0.015, 0.02], [x, y, z], '#9ca3af', 0.3, 1, 0.8);

/** Base cabinet modules (~0.6 m wide) with door fronts and handles; returns top height. */
function cabinetRun(
  g: Group,
  s: Size,
  front: string,
  withCounter: string | null,
  depthOffset = 0,
): void {
  const plinth = 0.1;
  box(
    g,
    [s.w, s.h - plinth - (withCounter ? COUNTER : 0), s.d - 0.02],
    [0, plinth, depthOffset - 0.01],
    '#e5e7eb',
    0.6,
  );
  box(g, [s.w - 0.04, plinth, s.d - 0.08], [0, 0, depthOffset - 0.03], '#27272a', 0.8);
  const n = Math.max(1, Math.round(s.w / 0.6));
  const mw = s.w / n;
  const fh = s.h - plinth - (withCounter ? COUNTER : 0) - 0.02;
  for (let i = 0; i < n; i++) {
    const x = -s.w / 2 + mw * (i + 0.5);
    box(g, [mw - 0.012, fh, 0.02], [x, plinth + 0.01, depthOffset + s.d / 2 - 0.01], front, 0.5);
    handle(g, x, plinth + fh - 0.12, depthOffset + s.d / 2 + 0.02);
  }
  if (withCounter)
    box(g, [s.w + 0.01, COUNTER, s.d + 0.02], [0, s.h - COUNTER, depthOffset], withCounter, 0.35);
}

const cabinetDraw = (s: Size, extra?: React.ReactNode) => {
  const n = Math.max(1, Math.round(s.w / 0.6));
  return (
    <g>
      <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} fill="#f1f5f9" />
      {Array.from({ length: n - 1 }, (_, i) => (
        <L
          key={i}
          x1={-s.w / 2 + (s.w / n) * (i + 1)}
          y1={-s.d / 2}
          x2={-s.w / 2 + (s.w / n) * (i + 1)}
          y2={s.d / 2}
          sw={0.6}
        />
      ))}
      {extra}
    </g>
  );
};

const baseRun = () =>
  entry({
    id: 'kitchen-base-run',
    category: 'kitchen',
    size: { w: 2.4, d: 0.6, h: 0.92 },
    props: frontProps,
    defaults: { front: '#d6d3d1', counter: '#4b5563' },
    build: (g, p, s) => cabinetRun(g, s, c(p, 'front'), c(p, 'counter')),
    draw: (_p, s) => cabinetDraw(s),
  });

const wallCabinet = () =>
  entry({
    id: 'kitchen-wall-cabinet',
    category: 'kitchen',
    size: { w: 1.2, d: 0.35, h: 0.7 },
    placement: 'wall-mounted',
    mountHeight: 1.45,
    props: [colorProp('cprop.frontColor', 'front')],
    defaults: { front: '#d6d3d1' },
    build: (g, p, s) => {
      box(g, [s.w, s.h, s.d - 0.02], [0, 0, -0.01], '#e5e7eb', 0.6);
      const n = Math.max(1, Math.round(s.w / 0.6));
      const mw = s.w / n;
      for (let i = 0; i < n; i++) {
        const x = -s.w / 2 + mw * (i + 0.5);
        box(g, [mw - 0.012, s.h - 0.02, 0.02], [x, 0.01, s.d / 2 - 0.01], c(p, 'front'), 0.5);
        handle(g, x, 0.08, s.d / 2 + 0.02);
      }
    },
    draw: (_p, s) => cabinetDraw(s),
  });

const island = () =>
  entry({
    id: 'kitchen-island',
    wallSnap: false,
    category: 'kitchen',
    size: { w: 1.8, d: 1.0, h: 0.92 },
    props: [...frontProps, { key: 'stools', label: 'cprop.stools', kind: 'boolean' }],
    defaults: { front: '#c7ccd1', counter: '#f3f4f6', stools: true },
    build: (g, p, s) => {
      const cabD = 0.65;
      const off = -s.d / 2 + cabD / 2;
      cabinetRun(g, { w: s.w, d: cabD, h: s.h }, c(p, 'front'), null, off);
      // Worktop overhangs on the stool side.
      box(g, [s.w + 0.04, COUNTER, s.d - 0.1], [0, s.h - COUNTER, -0.02], c(p, 'counter'), 0.3);
      if (p.stools) {
        for (const sx of [-0.35, 0.35]) {
          cyl(g, 0.17, 0.17, 0.04, [sx * (s.w / 1.8), 0.65, s.d / 2 - 0.12], '#334155', 0.6, 18);
          cyl(g, 0.02, 0.02, 0.65, [sx * (s.w / 1.8), 0, s.d / 2 - 0.12], '#9ca3af', 0.4, 8, 0.7);
        }
      }
    },
    draw: (p, s) => (
      <g>
        <R x={-s.w / 2 - 0.02} y={-s.d / 2} w={s.w + 0.04} h={s.d - 0.1} fill="#f8fafc" />
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={0.65} fill="#e2e8f0" />
        {p.stools &&
          [-0.35, 0.35].map((x) => (
            <C key={x} cx={x * (s.w / 1.8)} cy={s.d / 2 - 0.12} r={0.17} fill="#cbd5e1" />
          ))}
      </g>
    ),
  });

const fridge = () =>
  entry({
    id: 'fridge',
    category: 'kitchen',
    size: { w: 0.7, d: 0.7, h: 1.8 },
    props: [colorProp('cprop.color', 'color')],
    defaults: { color: '#d1d5db' },
    build: (g, p, s) => {
      box(g, [s.w, s.h, s.d - 0.02], [0, 0, -0.01], c(p, 'color'), 0.3, 1, 0.3);
      box(g, [s.w - 0.02, 0.012, 0.02], [0, s.h * 0.34, s.d / 2 - 0.005], '#6b7280', 0.5); // door split
      box(
        g,
        [0.02, 0.5, 0.03],
        [s.w / 2 - 0.06, s.h * 0.4, s.d / 2 + 0.02],
        '#9ca3af',
        0.3,
        1,
        0.8,
      );
      box(
        g,
        [0.02, 0.3, 0.03],
        [s.w / 2 - 0.06, s.h * 0.1, s.d / 2 + 0.02],
        '#9ca3af',
        0.3,
        1,
        0.8,
      );
    },
    draw: (_p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} fill="#e5e7eb" />
        <R
          x={-s.w / 2 + 0.05}
          y={-s.d / 2 + 0.05}
          w={s.w - 0.1}
          h={s.d - 0.1}
          fill="none"
          sw={0.6}
        />
        <L x1={-s.w / 2} y1={s.d / 2} x2={0} y2={0} dash="2 2" sw={0.6} />
      </g>
    ),
  });

const stove = () =>
  entry({
    id: 'stove',
    category: 'kitchen',
    size: { w: 0.6, d: 0.6, h: 0.92 },
    props: [colorProp('cprop.color', 'color')],
    defaults: { color: '#9ca3af' },
    build: (g, p, s) => {
      box(g, [s.w, s.h - 0.02, s.d - 0.02], [0, 0, -0.01], c(p, 'color'), 0.3, 1, 0.5);
      box(g, [s.w, 0.02, s.d], [0, s.h - 0.02, 0], '#111827', 0.15);
      for (const [x, z] of [
        [-0.14, -0.14],
        [0.14, -0.14],
        [-0.14, 0.14],
        [0.14, 0.14],
      ] as const)
        cyl(g, 0.07, 0.07, 0.012, [x, s.h, z], '#374151', 0.4, 20);
      box(g, [s.w - 0.1, 0.4, 0.02], [0, 0.18, s.d / 2 - 0.005], '#1f2937', 0.1, 0.8); // oven window
      box(g, [s.w - 0.1, 0.02, 0.03], [0, 0.62, s.d / 2 + 0.02], '#9ca3af', 0.3, 1, 0.8); // handle
      for (let i = 0; i < 4; i++)
        cyl(
          g,
          0.015,
          0.015,
          0.02,
          [-0.2 + i * 0.133, s.h - 0.12, s.d / 2 + 0.01],
          '#d1d5db',
          0.3,
          10,
        );
    },
    draw: (_p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} fill="#e5e7eb" />
        {[
          [-0.14, -0.12],
          [0.14, -0.12],
          [-0.14, 0.1],
          [0.14, 0.1],
        ].map(([x, y], i) => (
          <g key={i}>
            <C cx={x!} cy={y!} r={0.08} fill="#f8fafc" />
            <C cx={x!} cy={y!} r={0.035} fill="#94a3b8" />
          </g>
        ))}
      </g>
    ),
  });

const kitchenSink = () =>
  entry({
    id: 'sink-kitchen',
    category: 'kitchen',
    size: { w: 1.0, d: 0.6, h: 1.1 },
    props: frontProps,
    defaults: { front: '#d6d3d1', counter: '#4b5563' },
    build: (g, p, s) => {
      const top = 0.92; // worktop height; the extra size is the tap
      cabinetRun(g, { ...s, h: top }, c(p, 'front'), c(p, 'counter'));
      box(g, [0.5, 0.02, 0.38], [-0.1 * s.w, top, 0.02], '#cbd5e1', 0.2, 1, 0.8);
      box(g, [0.44, 0.022, 0.32], [-0.1 * s.w, top + 0.002, 0.02], '#94a3b8', 0.2, 1, 0.8);
      cyl(g, 0.015, 0.015, 0.18, [0.22 * s.w, top, -s.d / 2 + 0.07], '#e5e7eb', 0.2, 10, 0.9);
      box(g, [0.02, 0.02, 0.18], [0.22 * s.w, top + 0.17, -s.d / 2 + 0.15], '#e5e7eb', 0.2, 1, 0.9);
    },
    draw: (_p, s) =>
      cabinetDraw(
        s,
        <>
          <RC cx={-0.1 * s.w} cy={0.02} w={0.5} h={0.38} rx={0.04} fill="#e0f2fe" />
          <C cx={0.22 * s.w} cy={-s.d / 2 + 0.07} r={0.025} fill="#94a3b8" />
        </>,
      ),
  });

const oven = () =>
  entry({
    id: 'oven',
    category: 'kitchen',
    size: { w: 0.6, d: 0.6, h: 2.1 },
    props: frontProps.slice(0, 1),
    defaults: { front: '#d6d3d1' },
    build: (g, p, s) => {
      box(g, [s.w, s.h, s.d - 0.02], [0, 0, -0.01], '#e5e7eb', 0.6);
      box(g, [s.w - 0.012, 0.6, 0.02], [0, 0.02, s.d / 2 - 0.01], c(p, 'front'), 0.5); // lower drawer
      box(g, [s.w - 0.05, 0.6, 0.025], [0, 0.78, s.d / 2 - 0.005], '#111827', 0.15, 1, 0.2); // oven door
      box(g, [s.w - 0.2, 0.3, 0.03], [0, 0.93, s.d / 2 + 0.01], '#1f2937', 0.1, 0.7); // window
      box(g, [s.w - 0.1, 0.02, 0.03], [0, 1.34, s.d / 2 + 0.02], '#9ca3af', 0.3, 1, 0.8);
      box(g, [s.w - 0.05, 0.38, 0.03], [0, 1.45, s.d / 2 - 0.005], '#0f172a', 0.15, 1, 0.2); // microwave
      box(g, [s.w - 0.012, 0.25, 0.02], [0, 1.85, s.d / 2 - 0.01], c(p, 'front'), 0.5);
    },
    draw: (_p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} fill="#e2e8f0" />
        <R
          x={-s.w / 2 + 0.06}
          y={-s.d / 2 + 0.06}
          w={s.w - 0.12}
          h={s.d - 0.12}
          fill="#f1f5f9"
          sw={0.6}
        />
        <L
          x1={-s.w / 2 + 0.1}
          y1={s.d / 2 - 0.1}
          x2={s.w / 2 - 0.1}
          y2={s.d / 2 - 0.1}
          dash="2 2"
          sw={0.6}
        />
      </g>
    ),
  });

// ───────────────────────────── Bathroom ─────────────────────────────

const wc = () =>
  entry({
    id: 'wc',
    category: 'bathroom',
    size: { w: 0.4, d: 0.72, h: 0.8 },
    props: [colorProp('cprop.color', 'color')],
    defaults: { color: '#fafafa' },
    build: (g, p, s) => {
      const col = c(p, 'color');
      box(g, [s.w * 0.9, 0.35, 0.19], [0, 0.45, -s.d / 2 + 0.1], col, 0.2); // cistern
      box(g, [0.1, 0.015, 0.04], [0, 0.8, -s.d / 2 + 0.08], '#9ca3af', 0.3, 1, 0.8); // flush button
      const bowl = cyl(g, 0.5, 0.35, 0.4, [0, 0, 0], col, 0.2, 24);
      bowl.scale.set(s.w * 0.9, 1, (s.d - 0.2) * 0.95);
      bowl.position.z = 0.1;
      const seat = cyl(g, 0.5, 0.5, 0.025, [0, 0.4, 0], '#f3f4f6', 0.3, 24);
      seat.scale.set(s.w * 0.88, 1, (s.d - 0.22) * 0.92);
      seat.position.z = 0.1;
    },
    draw: (_p, s) => (
      <g>
        <R x={-s.w * 0.45} y={-s.d / 2} w={s.w * 0.9} h={0.19} rx={0.03} fill="#f1f5f9" />
        <E cx={0} cy={0.1} rx={s.w * 0.45} ry={(s.d - 0.2) * 0.475} fill="#ffffff" />
        <E cx={0} cy={0.12} rx={s.w * 0.28} ry={(s.d - 0.2) * 0.3} fill="#e2e8f0" />
      </g>
    ),
  });

const basin = () =>
  entry({
    id: 'basin',
    category: 'bathroom',
    size: { w: 0.65, d: 0.5, h: 0.85 },
    props: [colorProp('cprop.frontColor', 'front')],
    defaults: { front: '#e5e7eb' },
    build: (g, p, s) => {
      box(g, [s.w, s.h - 0.1, s.d], [0, 0, 0], c(p, 'front'), 0.5);
      box(g, [s.w + 0.02, 0.04, s.d + 0.02], [0, s.h - 0.1, 0], '#f8fafc', 0.2);
      const bowl = cyl(g, 0.5, 0.42, 0.1, [0, s.h - 0.16, 0.02], '#ffffff', 0.15, 28);
      bowl.scale.set(s.w * 0.7, 1, s.d * 0.7);
      cyl(g, 0.012, 0.012, 0.16, [0, s.h - 0.06, -s.d / 2 + 0.07], '#d1d5db', 0.2, 10, 0.9);
      box(g, [0.02, 0.02, 0.1], [0, s.h + 0.08, -s.d / 2 + 0.12], '#d1d5db', 0.2, 1, 0.9);
    },
    draw: (_p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} rx={0.03} fill="#f8fafc" />
        <E cx={0} cy={0.02} rx={s.w * 0.35} ry={s.d * 0.35} fill="#e0f2fe" />
        <C cx={0} cy={-s.d / 2 + 0.07} r={0.02} fill="#94a3b8" />
      </g>
    ),
  });

const shower = () =>
  entry({
    id: 'shower',
    category: 'bathroom',
    size: { w: 0.9, d: 0.9, h: 2.0 },
    props: [colorProp('cprop.frameColor', 'frame')],
    defaults: { frame: '#9ca3af' },
    build: (g, p, s) => {
      box(g, [s.w, 0.06, s.d], [0, 0, 0], '#f1f5f9', 0.3);
      box(g, [s.w - 0.1, 0.008, s.d - 0.1], [0, 0.06, 0], '#cbd5e1', 0.3);
      for (const [w, d, x, z] of [
        [s.w, 0.015, 0, s.d / 2 - 0.0075],
        [0.015, s.d, s.w / 2 - 0.0075, 0],
      ] as const) {
        box(g, [w, s.h - 0.06, d], [x, 0.06, z], '#a5d8ff', 0.05, 0.3);
        box(
          g,
          [w === s.w ? w : 0.03, 0.03, d === s.d ? d : 0.03],
          [x, s.h - 0.03, z],
          c(p, 'frame'),
          0.3,
          1,
          0.7,
        );
      }
      box(
        g,
        [0.03, s.h - 0.06, 0.03],
        [s.w / 2 - 0.015, 0.06, s.d / 2 - 0.015],
        c(p, 'frame'),
        0.3,
        1,
        0.7,
      );
      cyl(g, 0.012, 0.012, 0.4, [-s.w / 2 + 0.1, 1.7, -s.d / 2 + 0.06], '#d1d5db', 0.2, 8, 0.9);
      cyl(
        g,
        0.09,
        0.09,
        0.02,
        [-s.w / 2 + 0.1, 1.7, -s.d / 2 + 0.2],
        '#d1d5db',
        0.2,
        18,
        0.9,
      ).rotation.x = Math.PI / 2.6;
    },
    draw: (_p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} fill="#e0f2fe" />
        <L x1={-s.w / 2} y1={s.d / 2} x2={s.w / 2} y2={s.d / 2} sw={1.5} />
        <L x1={s.w / 2} y1={-s.d / 2} x2={s.w / 2} y2={s.d / 2} sw={1.5} />
        <L x1={-s.w / 2} y1={-s.d / 2} x2={s.w / 2} y2={s.d / 2} dash="2 3" sw={0.5} />
        <C cx={-s.w / 2 + 0.1} cy={-s.d / 2 + 0.1} r={0.05} fill="#94a3b8" />
      </g>
    ),
  });

const bathtub = () =>
  entry({
    id: 'bathtub',
    category: 'bathroom',
    size: { w: 1.7, d: 0.75, h: 0.55 },
    props: [colorProp('cprop.color', 'color')],
    defaults: { color: '#fafafa' },
    build: (g, p, s) => {
      box(g, [s.w, s.h, s.d], [0, 0, 0], c(p, 'color'), 0.2);
      box(g, [s.w - 0.14, 0.02, s.d - 0.14], [0, s.h - 0.01, 0], '#dbeafe', 0.1); // water-line basin
      cyl(g, 0.012, 0.012, 0.1, [-s.w / 2 + 0.15, s.h, 0], '#d1d5db', 0.2, 8, 0.9);
      sphere(g, 0.02, [s.w / 2 - 0.12, s.h - 0.03, 0], '#9ca3af');
    },
    draw: (_p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} rx={0.08} fill="#f8fafc" />
        <R
          x={-s.w / 2 + 0.07}
          y={-s.d / 2 + 0.07}
          w={s.w - 0.14}
          h={s.d - 0.14}
          rx={0.2}
          fill="#e0f2fe"
        />
        <C cx={s.w / 2 - 0.2} cy={0} r={0.03} fill="#94a3b8" />
      </g>
    ),
  });

const mirror = () =>
  entry({
    id: 'mirror',
    category: 'bathroom',
    size: { w: 0.6, d: 0.03, h: 0.8 },
    placement: 'wall-mounted',
    mountHeight: 1.1,
    props: [colorProp('cprop.frameColor', 'frame')],
    defaults: { frame: '#374151' },
    build: (g, p, s) => {
      box(g, [s.w, s.h, s.d], [0, 0, 0], c(p, 'frame'), 0.4);
      box(g, [s.w - 0.05, s.h - 0.05, 0.004], [0, 0.025, s.d / 2], '#dbeafe', 0.02, 0.85, 0.9);
    },
    draw: (_p, s) => <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={Math.max(s.d, 0.05)} fill="#bfdbfe" />,
  });

export const kitchenBathEntries = (): CatalogEntry[] => [
  baseRun(),
  wallCabinet(),
  island(),
  fridge(),
  stove(),
  kitchenSink(),
  oven(),
  wc(),
  basin(),
  shower(),
  bathtub(),
  mirror(),
];
