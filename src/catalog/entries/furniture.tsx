import { type Group } from 'three';
import { box, cyl, group, sphere } from '../three';
import { C, E, L, P, R, RC } from '../svg';
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

function legs(
  g: Group,
  w: number,
  d: number,
  inset: number,
  h: number,
  color: string,
  r = 0.02,
): void {
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      cyl(g, r, r, h, [sx * (w / 2 - inset), 0, sz * (d / 2 - inset)], color, 0.6, 8);
}

// ───────────────────────────── Living ─────────────────────────────

function sofaBuild(g: Group, color: string, s: Size, seats: number): void {
  const arm = 0.16;
  const back = 0.2;
  legs(g, s.w, s.d, 0.08, 0.1, '#3f3f46');
  box(g, [s.w, 0.18, s.d], [0, 0.1, 0], color, 0.9);
  const inner = s.w - 2 * arm;
  const cw = inner / seats;
  for (let i = 0; i < seats; i++) {
    const x = -inner / 2 + cw * (i + 0.5);
    box(g, [cw - 0.02, 0.14, s.d - back - 0.02], [x, 0.28, back / 2], color, 1);
    box(g, [cw - 0.02, s.h - 0.42, 0.14], [x, 0.4, -s.d / 2 + back - 0.05], color, 1);
  }
  box(g, [s.w, s.h - 0.3, 0.08], [0, 0.28, -s.d / 2 + 0.04], color, 0.9);
  for (const sx of [-1, 1])
    box(g, [arm, 0.32, s.d], [sx * (s.w / 2 - arm / 2), 0.28, 0], color, 0.9);
}

function sofa(id: string, seats: number, size: Size): CatalogEntry {
  return entry({
    id,
    category: 'living',
    size,
    defaults: { color: '#8b9db3' },
    build: (g, p, s) => sofaBuild(g, c(p), s, seats),
    draw: (_p, s) => {
      const arm = 0.16;
      const back = 0.2;
      const inner = s.w - 2 * arm;
      return (
        <g>
          <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} rx={0.05} fill="#e2e8f0" />
          <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={back} rx={0.05} fill="#cbd5e1" />
          <R x={-s.w / 2} y={-s.d / 2} w={arm} h={s.d} rx={0.05} fill="#cbd5e1" />
          <R x={s.w / 2 - arm} y={-s.d / 2} w={arm} h={s.d} rx={0.05} fill="#cbd5e1" />
          {Array.from({ length: seats - 1 }, (_, i) => (
            <L
              key={i}
              x1={-inner / 2 + (inner / seats) * (i + 1)}
              y1={-s.d / 2 + back}
              x2={-inner / 2 + (inner / seats) * (i + 1)}
              y2={s.d / 2}
            />
          ))}
        </g>
      );
    },
  });
}

function sofaL(): CatalogEntry {
  return entry({
    id: 'sofa-l',
    category: 'living',
    size: { w: 2.6, d: 1.7, h: 0.85 },
    defaults: { color: '#7d8f7a' },
    build: (g, p, s) => {
      const col = c(p);
      const mainD = 0.95;
      const main = group();
      sofaBuild(main, col, { w: s.w, d: mainD, h: s.h }, 3);
      main.position.z = -s.d / 2 + mainD / 2;
      g.add(main);
      // Chaise under the right end, extending toward the front.
      const cd = s.d - mainD;
      box(g, [1.0, 0.18, cd], [s.w / 2 - 0.5, 0.1, s.d / 2 - cd / 2], col, 0.9);
      box(g, [0.84, 0.14, cd - 0.02], [s.w / 2 - 0.5 - 0.08, 0.28, s.d / 2 - cd / 2], col, 1);
      box(g, [0.16, 0.32, cd], [s.w / 2 - 0.08, 0.28, s.d / 2 - cd / 2], col, 0.9);
    },
    draw: (_p, s) => {
      const w = s.w / 2;
      const h = s.d / 2;
      const md = 0.95;
      return (
        <g>
          <P d={`M ${-w},${-h} H ${w} V ${h} H ${w - 1.0} V ${-h + md} H ${-w} Z`} fill="#e2e8f0" />
          <R x={-w} y={-h} w={s.w} h={0.2} fill="#cbd5e1" />
          <R x={-w} y={-h} w={0.16} h={md} fill="#cbd5e1" />
          <R x={w - 0.16} y={-h} w={0.16} h={s.d} fill="#cbd5e1" />
          <L x1={w - 1.0} y1={-h + 0.2} x2={w - 1.0} y2={-h + md} />
        </g>
      );
    },
  });
}

function coffeeTable(): CatalogEntry {
  return entry({
    id: 'coffee-table',
    wallSnap: false,
    category: 'living',
    size: { w: 1.0, d: 0.6, h: 0.42 },
    props: [
      colorProp(),
      {
        key: 'shape',
        label: 'cprop.shape',
        kind: 'select',
        options: [
          { value: 'rect', label: 'cprop.rect' },
          { value: 'round', label: 'cprop.round' },
        ],
      },
    ],
    defaults: { color: '#a07850', shape: 'rect' },
    build: (g, p, s) => {
      if (p.shape === 'round') {
        const top = cyl(g, 0.5, 0.5, 0.04, [0, s.h - 0.04, 0], c(p), 0.6, 32);
        top.scale.set(s.w, 1, s.d);
        cyl(g, 0.04, 0.04, s.h - 0.04, [0, 0, 0], '#3f3f46', 0.5, 12);
        const base = cyl(g, 0.3, 0.3, 0.02, [0, 0, 0], '#3f3f46', 0.5, 24);
        base.scale.set(s.w, 1, s.d);
      } else {
        box(g, [s.w, 0.04, s.d], [0, s.h - 0.04, 0], c(p), 0.6);
        legs(g, s.w, s.d, 0.05, s.h - 0.04, '#3f3f46', 0.025);
      }
    },
    draw: (p, s) =>
      p.shape === 'round' ? (
        <E cx={0} cy={0} rx={s.w / 2} ry={s.d / 2} fill="#f1e4d3" />
      ) : (
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} rx={0.03} fill="#f1e4d3" />
      ),
  });
}

function tvUnit(): CatalogEntry {
  return entry({
    id: 'tv-unit',
    category: 'living',
    size: { w: 1.6, d: 0.4, h: 1.0 },
    defaults: { color: '#6b5444' },
    build: (g, p, s) => {
      const uh = 0.45;
      box(g, [s.w, uh, s.d], [0, 0.05, 0], c(p), 0.6);
      legs(g, s.w, s.d, 0.05, 0.05, '#27272a');
      for (const sx of [-1, 1])
        box(
          g,
          [s.w / 2 - 0.04, uh - 0.1, 0.01],
          [sx * (s.w / 4), 0.08, s.d / 2 + 0.005],
          '#52403a',
          0.6,
        );
      box(g, [0.5, 0.03, 0.2], [0, 0.05 + uh, 0], '#18181b', 0.4); // TV stand
      box(g, [s.w * 0.62, s.h - uh - 0.12, 0.04], [0, 0.05 + uh + 0.05, 0], '#0f172a', 0.2, 1, 0.3);
    },
    draw: (_p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} fill="#e7e5e4" />
        <R x={-s.w * 0.31} y={-0.03} w={s.w * 0.62} h={0.05} fill="#1e293b" />
        <L x1={0} y1={-s.d / 2} x2={0} y2={s.d / 2} />
      </g>
    ),
  });
}

function bookshelf(): CatalogEntry {
  const bookColors = ['#b45309', '#1d4ed8', '#15803d', '#b91c1c', '#6d28d9', '#0f766e'];
  return entry({
    id: 'bookshelf',
    category: 'living',
    size: { w: 0.9, d: 0.32, h: 2.0 },
    defaults: { color: '#8b6b4a' },
    build: (g, p, s) => {
      const t = 0.03;
      for (const sx of [-1, 1]) box(g, [t, s.h, s.d], [sx * (s.w / 2 - t / 2), 0, 0], c(p), 0.7);
      box(g, [s.w, s.h, 0.012], [0, 0, -s.d / 2 + 0.006], c(p), 0.7);
      const shelves = 5;
      for (let i = 0; i <= shelves; i++)
        box(g, [s.w - 2 * t, t, s.d - 0.012], [0, (i * (s.h - t)) / shelves, 0.006], c(p), 0.7);
      for (let i = 0; i < shelves; i++) {
        let x = -s.w / 2 + t + 0.03;
        let k = i;
        const limit = s.w / 2 - t - (i % 2 === 0 ? 0.08 : 0.2);
        while (x < limit) {
          const bw = 0.025 + ((k * 7) % 4) * 0.008;
          const bh = 0.2 + ((k * 5) % 4) * 0.025;
          box(
            g,
            [bw, bh, s.d * 0.7],
            [x + bw / 2, (i * (s.h - t)) / shelves + t, 0.02],
            bookColors[k % bookColors.length]!,
            0.8,
          );
          x += bw + 0.004;
          k++;
        }
      }
    },
    draw: (_p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} fill="#e7e0d6" />
        <L x1={-s.w / 2 + 0.03} y1={-s.d / 2 + 0.03} x2={s.w / 2 - 0.03} y2={-s.d / 2 + 0.03} />
      </g>
    ),
  });
}

// ───────────────────────────── Dining ─────────────────────────────

function chairBuild(g: Group, color: string, size = 0.44): void {
  legs(g, size, size, 0.03, 0.44, color, 0.018);
  box(g, [size, 0.04, size], [0, 0.44, 0], color, 0.6);
  box(g, [size, 0.46, 0.03], [0, 0.48, -size / 2 + 0.015], color, 0.6);
}

function diningTable(seats: 4 | 6 | 8, size: Size): CatalogEntry {
  const draw2d = (s: Size) => {
    const td = s.d - 0.7;
    const per = seats / 2;
    return (
      <g>
        {[-1, 1].flatMap((side) =>
          Array.from({ length: per }, (_, i) => (
            <RC
              key={`${side}${i}`}
              cx={-s.w / 2 + (s.w * (i + 0.5)) / per}
              cy={side * (td / 2 + 0.17)}
              w={0.42}
              h={0.4}
              rx={0.04}
              fill="#e7e5e4"
            />
          )),
        )}
        <R x={-s.w / 2} y={-td / 2} w={s.w} h={td} rx={0.04} fill="#f5ead9" />
      </g>
    );
  };
  return entry({
    id: `dining-table-${seats}`,
    wallSnap: false,
    category: 'dining',
    size,
    props: [colorProp('cprop.tableColor'), colorProp('cprop.chairColor', 'chairColor')],
    defaults: { color: '#9c7a54', chairColor: '#d6d3d1' },
    build: (g, p, s) => {
      const td = s.d - 0.7;
      box(g, [s.w, 0.04, td], [0, 0.71, 0], c(p), 0.55);
      legs(g, s.w, td, 0.07, 0.71, '#4b3b2a', 0.035);
      const per = seats / 2;
      for (const side of [-1, 1]) {
        for (let i = 0; i < per; i++) {
          const ch = group();
          ch.position.set(-s.w / 2 + (s.w * (i + 0.5)) / per, 0, side * (td / 2 + 0.05));
          if (side > 0) ch.rotation.y = Math.PI;
          chairBuild(ch, c(p, 'chairColor'));
          g.add(ch);
        }
      }
    },
    draw: (_p, s) => draw2d(s),
  });
}

function diningChair(): CatalogEntry {
  return entry({
    id: 'chair',
    wallSnap: false,
    category: 'dining',
    size: { w: 0.44, d: 0.46, h: 0.9 },
    defaults: { color: '#b08968' },
    build: (g, p, s) => chairBuild(g, c(p), s.w),
    draw: (_p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} rx={0.04} fill="#f1f5f9" />
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={0.05} fill="#cbd5e1" />
      </g>
    ),
  });
}

// ───────────────────────────── Bedroom ─────────────────────────────

function bed(id: string, width: number): CatalogEntry {
  const pillows = width > 1 ? 2 : 1;
  return entry({
    id,
    category: 'bedroom',
    size: { w: width, d: 2.05, h: 0.95 },
    props: [colorProp('cprop.bedding'), colorProp('cprop.frameColor', 'frameColor')],
    defaults: { color: '#cbd5e1', frameColor: '#8a6a4a' },
    build: (g, p, s) => {
      box(g, [s.w, 0.28, s.d], [0, 0.08, 0], c(p, 'frameColor'), 0.6);
      box(g, [s.w, s.h - 0.1, 0.08], [0, 0.0, -s.d / 2 + 0.04], c(p, 'frameColor'), 0.6);
      box(g, [s.w - 0.08, 0.22, s.d - 0.12], [0, 0.36, 0.02], '#f8fafc', 0.9);
      box(g, [s.w - 0.06, 0.06, s.d * 0.62], [0, 0.5, s.d * 0.17], c(p), 0.9);
      for (let i = 0; i < pillows; i++) {
        const pw = (s.w - 0.2) / pillows - 0.06;
        box(
          g,
          [pw, 0.12, 0.38],
          [-s.w / 2 + 0.1 + ((s.w - 0.2) / pillows) * (i + 0.5), 0.58, -s.d / 2 + 0.34],
          '#ffffff',
          1,
        );
      }
    },
    draw: (_p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} rx={0.03} fill="#f1f5f9" />
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={0.08} fill="#cbd5e1" />
        {Array.from({ length: pillows }, (_, i) => (
          <R
            key={i}
            x={-s.w / 2 + 0.1 + ((s.w - 0.2) / pillows) * i + 0.03}
            y={-s.d / 2 + 0.14}
            w={(s.w - 0.2) / pillows - 0.06}
            h={0.36}
            rx={0.05}
            fill="#ffffff"
          />
        ))}
        <L x1={-s.w / 2} y1={-s.d / 2 + s.d * 0.4} x2={s.w / 2} y2={-s.d / 2 + s.d * 0.4} />
      </g>
    ),
  });
}

function wardrobe(): CatalogEntry {
  return entry({
    id: 'wardrobe',
    category: 'bedroom',
    size: { w: 1.8, d: 0.6, h: 2.2 },
    defaults: { color: '#e5e1d8' },
    build: (g, p, s) => {
      box(g, [s.w, s.h - 0.06, s.d], [0, 0.06, 0], c(p), 0.6);
      const doors = Math.max(2, Math.round(s.w / 0.6));
      const dw = s.w / doors;
      for (let i = 0; i < doors; i++) {
        const x = -s.w / 2 + dw * (i + 0.5);
        box(g, [dw - 0.01, s.h - 0.1, 0.012], [x, 0.08, s.d / 2 + 0.004], c(p), 0.5);
        box(
          g,
          [0.015, 0.22, 0.02],
          [x + (i % 2 === 0 ? 1 : -1) * (dw / 2 - 0.06), s.h / 2 - 0.1, s.d / 2 + 0.02],
          '#9ca3af',
          0.3,
          1,
          0.8,
        );
      }
      box(g, [s.w - 0.1, 0.06, s.d - 0.1], [0, 0, 0], '#44403c', 0.8);
    },
    draw: (_p, s) => {
      const doors = Math.max(2, Math.round(s.w / 0.6));
      return (
        <g>
          <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} fill="#ece7dc" />
          {Array.from({ length: doors - 1 }, (_, i) => (
            <L
              key={i}
              x1={-s.w / 2 + (s.w / doors) * (i + 1)}
              y1={-s.d / 2}
              x2={-s.w / 2 + (s.w / doors) * (i + 1)}
              y2={s.d / 2}
            />
          ))}
          <L x1={-s.w / 2} y1={-s.d / 2} x2={s.w / 2} y2={s.d / 2} dash="2 3" />
        </g>
      );
    },
  });
}

function drawerUnit(
  id: string,
  size: Size,
  rows: number,
  label: CatalogCategory = 'bedroom',
): CatalogEntry {
  return entry({
    id,
    category: label,
    size,
    defaults: { color: '#a58a6d' },
    build: (g, p, s) => {
      box(g, [s.w, s.h - 0.08, s.d], [0, 0.08, 0], c(p), 0.6);
      legs(g, s.w, s.d, 0.04, 0.08, '#3f3f46', 0.02);
      for (let r = 0; r < rows; r++) {
        const ry = 0.1 + ((s.h - 0.14) / rows) * r;
        box(
          g,
          [s.w - 0.05, (s.h - 0.14) / rows - 0.02, 0.012],
          [0, ry, s.d / 2 + 0.004],
          '#bfa888',
          0.5,
        );
        box(
          g,
          [Math.min(0.14, s.w * 0.3), 0.015, 0.02],
          [0, ry + (s.h - 0.14) / rows / 2 - 0.01, s.d / 2 + 0.02],
          '#6b7280',
          0.3,
          1,
          0.8,
        );
      }
    },
    draw: (_p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} fill="#ece4d6" />
        <L x1={-s.w / 2} y1={s.d / 2 - 0.05} x2={s.w / 2} y2={s.d / 2 - 0.05} />
      </g>
    ),
  });
}

// ───────────────────────────── Other ─────────────────────────────

function desk(): CatalogEntry {
  return entry({
    id: 'desk',
    category: 'other',
    size: { w: 1.4, d: 0.7, h: 0.75 },
    defaults: { color: '#c9b79c' },
    build: (g, p, s) => {
      box(g, [s.w, 0.04, s.d], [0, s.h - 0.04, 0], c(p), 0.55);
      for (const sx of [-1, 1])
        box(g, [0.04, s.h - 0.04, s.d - 0.06], [sx * (s.w / 2 - 0.05), 0, 0], '#52525b', 0.5);
      box(g, [s.w - 0.1, 0.3, 0.02], [0, 0.35, -s.d / 2 + 0.06], '#52525b', 0.5);
      box(g, [0.35, 0.5, 0.45], [s.w / 2 - 0.3, s.h - 0.04 - 0.5, 0.0], '#d6c7ad', 0.6); // drawer block
      box(g, [0.5, 0.01, 0.34], [-0.2, s.h, 0.05], '#1f2937', 0.4); // laptop base
    },
    draw: (_p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} fill="#f1ebe0" />
        <R x={s.w / 2 - 0.5} y={-s.d / 2 + 0.05} w={0.35} h={0.45} fill="#e7dcc7" />
        <R x={-0.45} y={-0.12} w={0.5} h={0.34} fill="#cbd5e1" />
      </g>
    ),
  });
}

function officeChair(): CatalogEntry {
  return entry({
    id: 'office-chair',
    wallSnap: false,
    category: 'other',
    size: { w: 0.6, d: 0.6, h: 1.05 },
    defaults: { color: '#334155' },
    build: (g, p, s) => {
      cyl(g, 0.03, 0.03, 0.3, [0, 0.08, 0], '#9ca3af', 0.4, 10, 0.7);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const leg = box(
          g,
          [0.3, 0.025, 0.04],
          [Math.cos(a) * 0.15, 0.06, Math.sin(a) * 0.15],
          '#1f2937',
          0.5,
        );
        leg.rotation.y = -a;
        sphere(g, 0.03, [Math.cos(a) * 0.3, 0.03, Math.sin(a) * 0.3], '#111827');
      }
      box(g, [0.5, 0.08, 0.48], [0, 0.42, 0.02], c(p), 0.9);
      box(g, [0.46, 0.5, 0.07], [0, 0.52, -0.2], c(p), 0.9);
      for (const sx of [-1, 1])
        box(g, [0.04, 0.03, 0.3], [sx * 0.27, 0.62 - 0.12, 0.02], '#1f2937', 0.5);
      void s;
    },
    draw: () => (
      <g>
        <C cx={0} cy={0.02} r={0.26} fill="#cbd5e1" />
        <R x={-0.23} y={-0.28} w={0.46} h={0.08} rx={0.03} fill="#94a3b8" />
        <C cx={0} cy={0} r={0.06} fill="#64748b" />
      </g>
    ),
  });
}

function washingMachine(): CatalogEntry {
  return entry({
    id: 'washing-machine',
    category: 'other',
    size: { w: 0.6, d: 0.6, h: 0.85 },
    defaults: { color: '#f5f5f4' },
    build: (g, p, s) => {
      box(g, [s.w, s.h, s.d], [0, 0, 0], c(p), 0.4);
      const door = cyl(g, 0.21, 0.21, 0.04, [0, 0, 0], '#475569', 0.2, 28);
      door.rotation.x = Math.PI / 2;
      door.position.set(0, s.h * 0.45, s.d / 2 + 0.005);
      const glass = cyl(g, 0.16, 0.16, 0.05, [0, 0, 0], '#93c5fd', 0.05, 28, 0, 0.6);
      glass.rotation.x = Math.PI / 2;
      glass.position.set(0, s.h * 0.45, s.d / 2 + 0.01);
      box(g, [s.w - 0.1, 0.08, 0.012], [0, s.h - 0.11, s.d / 2 + 0.003], '#d6d3d1', 0.4);
    },
    draw: (_p, s) => (
      <g>
        <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} fill="#f8fafc" />
        <C cx={0} cy={s.d * 0.1} r={0.2} fill="#e0f2fe" />
        <C cx={0} cy={s.d * 0.1} r={0.12} fill="#bae6fd" />
      </g>
    ),
  });
}

function plant(): CatalogEntry {
  return entry({
    id: 'plant',
    category: 'other',
    size: { w: 0.45, d: 0.45, h: 1.1 },
    defaults: { color: '#3f8f4f', potColor: '#b45309' },
    props: [colorProp('cprop.leafColor'), colorProp('cprop.potColor', 'potColor')],
    build: (g, p, s) => {
      cyl(g, 0.2, 0.14, 0.28, [0, 0, 0], c(p, 'potColor'), 0.8, 18);
      cyl(g, 0.02, 0.025, s.h * 0.5, [0, 0.28, 0], '#6b4f2a', 0.9, 8);
      const leaves: [number, number, number, number][] = [
        [0, 0.82, 0, 0.2],
        [0.12, 0.7, 0.05, 0.14],
        [-0.1, 0.66, -0.06, 0.14],
        [0.03, 0.55, -0.12, 0.12],
        [-0.06, 0.9, 0.08, 0.12],
      ];
      for (const [x, y, z, r] of leaves)
        sphere(g, r, [x * (s.w / 0.45), y * (s.h / 1.1), z * (s.d / 0.45)], c(p));
    },
    draw: (p, s) => (
      <g>
        <C cx={0} cy={0} r={s.w / 2} fill="#bbf7d0" />
        <C cx={0.05} cy={-0.04} r={s.w / 3.2} fill="#86efac" />
        <C cx={0} cy={0} r={0.05} fill={c(p, 'potColor')} />
      </g>
    ),
  });
}

function rug(): CatalogEntry {
  return entry({
    id: 'rug',
    wallSnap: false,
    category: 'other',
    size: { w: 2.0, d: 1.4, h: 0.015 },
    props: [
      colorProp(),
      {
        key: 'shape',
        label: 'cprop.shape',
        kind: 'select',
        options: [
          { value: 'rect', label: 'cprop.rect' },
          { value: 'round', label: 'cprop.round' },
        ],
      },
    ],
    defaults: { color: '#b8a89a', shape: 'rect' },
    build: (g, p, s) => {
      if (p.shape === 'round') {
        const r = cyl(g, 0.5, 0.5, s.h, [0, 0.002, 0], c(p), 1, 40);
        r.scale.set(s.w, 1, s.d);
        const inner = cyl(g, 0.4, 0.4, s.h + 0.002, [0, 0.002, 0], '#ffffff', 1, 40, 0, 0.35);
        inner.scale.set(s.w, 1, s.d);
      } else {
        box(g, [s.w, s.h, s.d], [0, 0.002, 0], c(p), 1);
        box(g, [s.w - 0.2, s.h + 0.002, s.d - 0.2], [0, 0.002, 0], '#ffffff', 1, 0.35);
      }
    },
    draw: (p, s) =>
      p.shape === 'round' ? (
        <E cx={0} cy={0} rx={s.w / 2} ry={s.d / 2} fill="#e9e1d9" />
      ) : (
        <g>
          <R x={-s.w / 2} y={-s.d / 2} w={s.w} h={s.d} fill="#e9e1d9" dash="4 2" />
          <R
            x={-s.w / 2 + 0.1}
            y={-s.d / 2 + 0.1}
            w={s.w - 0.2}
            h={s.d - 0.2}
            fill="none"
            sw={0.5}
          />
        </g>
      ),
  });
}

function ceilingLight(): CatalogEntry {
  return entry({
    id: 'ceiling-light',
    category: 'other',
    size: { w: 0.4, d: 0.4, h: 0.08 },
    placement: 'ceiling',
    defaults: { color: '#fff7d6' },
    props: [colorProp('cprop.lightColor')],
    build: (g, p, s) => {
      const d = cyl(g, 0.5, 0.5, s.h, [0, 0, 0], '#e5e7eb', 0.4, 32);
      d.scale.set(s.w, 1, s.d);
      const l = cyl(g, 0.42, 0.42, 0.01, [0, -0.005, 0], c(p), 0.2, 32);
      l.scale.set(s.w, 1, s.d);
    },
    draw: (p, s) => (
      <g>
        <E cx={0} cy={0} rx={s.w / 2} ry={s.d / 2} fill={c(p)} />
        <L x1={-s.w / 2} y1={0} x2={s.w / 2} y2={0} dash="2 2" />
        <L x1={0} y1={-s.d / 2} x2={0} y2={s.d / 2} dash="2 2" />
      </g>
    ),
  });
}

function pendantLight(): CatalogEntry {
  return entry({
    id: 'pendant-light',
    category: 'other',
    size: { w: 0.45, d: 0.45, h: 0.9 },
    placement: 'ceiling',
    defaults: { color: '#f59e0b' },
    props: [colorProp('cprop.shadeColor')],
    build: (g, p, s) => {
      cyl(g, 0.004, 0.004, s.h - 0.25, [0, 0.25, 0], '#27272a', 0.5, 6);
      const shade = cyl(g, 0.06, 0.5, 0.25, [0, 0, 0], c(p), 0.5, 28);
      shade.scale.set(s.w, 1, s.d);
      sphere(g, 0.05, [0, 0.1, 0], '#fff7d6');
    },
    draw: (p, s) => (
      <g>
        <E cx={0} cy={0} rx={s.w / 2} ry={s.d / 2} fill={c(p)} />
        <C cx={0} cy={0} r={0.05} fill="#fff7d6" />
      </g>
    ),
  });
}

function floorLamp(): CatalogEntry {
  return entry({
    id: 'floor-lamp',
    category: 'other',
    size: { w: 0.4, d: 0.4, h: 1.6 },
    defaults: { color: '#f3e9d2' },
    props: [colorProp('cprop.shadeColor')],
    build: (g, p, s) => {
      cyl(g, 0.15, 0.17, 0.03, [0, 0, 0], '#27272a', 0.4, 24);
      cyl(g, 0.012, 0.012, s.h - 0.4, [0, 0.03, 0], '#27272a', 0.4, 8);
      const shade = cyl(g, 0.14, 0.2, 0.3, [0, s.h - 0.34, 0], c(p), 0.8, 24, 0, 0.9);
      shade.scale.set(s.w / 0.4, 1, s.d / 0.4);
    },
    draw: (p, s) => (
      <g>
        <C cx={0} cy={0} r={s.w / 2} fill={c(p)} />
        <C cx={0} cy={0} r={0.04} fill="#27272a" />
      </g>
    ),
  });
}

export const furnitureEntries = (): CatalogEntry[] => [
  sofa('sofa-2seat', 2, { w: 1.7, d: 0.9, h: 0.85 }),
  sofa('sofa-3seat', 3, { w: 2.2, d: 0.95, h: 0.85 }),
  sofaL(),
  sofa('armchair', 1, { w: 0.85, d: 0.85, h: 0.85 }),
  coffeeTable(),
  tvUnit(),
  bookshelf(),
  diningTable(4, { w: 1.2, d: 1.5, h: 0.95 }),
  diningTable(6, { w: 1.8, d: 1.6, h: 0.95 }),
  diningTable(8, { w: 2.4, d: 1.7, h: 0.95 }),
  diningChair(),
  bed('bed-single', 0.9),
  bed('bed-double', 1.4),
  bed('bed-queen', 1.6),
  bed('bed-king', 1.8),
  wardrobe(),
  drawerUnit('side-table', { w: 0.45, d: 0.4, h: 0.5 }, 1),
  drawerUnit('dresser', { w: 1.2, d: 0.5, h: 0.85 }, 3),
  desk(),
  officeChair(),
  washingMachine(),
  plant(),
  rug(),
  ceilingLight(),
  pendantLight(),
  floorLamp(),
];
