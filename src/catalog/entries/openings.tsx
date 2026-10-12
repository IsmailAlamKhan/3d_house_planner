import { type Group } from 'three';
import { box, cyl, group } from '../three';
import { L, P, R } from '../svg';
import type { BuildCtx, CatalogEntry, Props, PropSpec, Size } from '../types';

const J = 0.05; // jamb width
const GLASS = '#a5d8ff';

const frameProps: PropSpec[] = [{ key: 'frameColor', label: 'cprop.frameColor', kind: 'color' }];
const doorProps: PropSpec[] = [
  ...frameProps,
  { key: 'leafColor', label: 'cprop.leafColor', kind: 'color' },
];

const hingeAtStart = (ctx: BuildCtx = {}): boolean =>
  ((ctx.swing ?? 'left') === 'right') === !!ctx.flip;

/** Two jambs + head, sized to the opening. */
function frame(g: Group, s: Size, color: string, sill = false): void {
  const t = s.d + 0.02;
  box(g, [J, s.h, t], [-s.w / 2 + J / 2, 0, 0], color, 0.5);
  box(g, [J, s.h, t], [s.w / 2 - J / 2, 0, 0], color, 0.5);
  box(g, [s.w - 2 * J, J, t], [0, s.h - J, 0], color, 0.5);
  if (sill) box(g, [s.w + 0.08, J, t + 0.08], [0, 0, 0.02], color, 0.5);
}

/** A leaf hinged on one jamb, optionally ajar (swung toward +z). */
function hingedLeaf(
  g: Group,
  s: Size,
  ctx: BuildCtx,
  color: string,
  opts: { width?: number; atStart?: boolean; glass?: boolean } = {},
): void {
  const lw = opts.width ?? s.w - 2 * J;
  const lh = s.h - J;
  const atStart = opts.atStart ?? hingeAtStart(ctx);
  const pivot = group();
  pivot.position.set(atStart ? -s.w / 2 + J : s.w / 2 - J, 0, 0);
  const dir = atStart ? 1 : -1;
  box(pivot, [lw, lh, 0.04], [(dir * lw) / 2, 0.0, 0], color, 0.6);
  if (opts.glass) {
    box(pivot, [lw * 0.5, lh * 0.35, 0.05], [(dir * lw) / 2, lh * 0.45, 0], GLASS, 0.05, 0.5);
  }
  // Handle
  cyl(pivot, 0.012, 0.012, 0.12, [dir * (lw - 0.08), lh * 0.45, 0.04], '#9ca3af', 0.3, 8, 0.8);
  if (ctx.open && (ctx.swing ?? 'left') !== 'none')
    pivot.rotation.y = ((atStart ? -1 : 1) * 18 * Math.PI) / 180;
  g.add(pivot);
}

function doorArc(x: number, hingeStart: boolean, lw: number): ReturnType<typeof P> {
  const s = hingeStart ? 1 : -1;
  return (
    <P d={`M ${x},${lw} A ${lw},${lw} 0 0 ${hingeStart ? 0 : 1} ${x + s * lw},0`} dash="3 2" />
  );
}

const gap = (s: Size) => (
  <R x={-s.w / 2} y={-s.d / 2 - 0.01} w={s.w} h={s.d + 0.02} fill="#ffffff" sw={0} />
);

function doorSingle(): CatalogEntry {
  return {
    catalogId: 'door-single',
    nameKey: 'catalog.door-single',
    category: 'doors',
    placement: 'wall',
    openingKind: 'door',
    defaultSize: { w: 0.9, d: 0.15, h: 2.1 },
    props: doorProps,
    defaults: { frameColor: '#e5e7eb', leafColor: '#b9814e' },
    build3D(p: Props, s, ctx = {}) {
      const g = group();
      frame(g, s, String(p.frameColor));
      hingedLeaf(g, s, ctx, String(p.leafColor));
      return g;
    },
    draw2D(_p, s, ctx = {}) {
      const atStart = hingeAtStart(ctx);
      const lw = s.w - 2 * J;
      const hx = atStart ? -s.w / 2 + J : s.w / 2 - J;
      const dir = atStart ? 1 : -1;
      return (
        <g>
          {gap(s)}
          <R x={Math.min(hx, hx + dir * lw)} y={-0.02} w={lw} h={0.04} fill="#e2e8f0" />
          {ctx.swing !== 'none' && (
            <>
              <L x1={hx} y1={0} x2={hx} y2={lw} />
              {doorArc(hx, atStart, lw)}
            </>
          )}
        </g>
      );
    },
  };
}

function doorDouble(): CatalogEntry {
  return {
    catalogId: 'door-double',
    nameKey: 'catalog.door-double',
    category: 'doors',
    placement: 'wall',
    openingKind: 'door',
    defaultSize: { w: 1.6, d: 0.15, h: 2.1 },
    props: doorProps,
    defaults: { frameColor: '#e5e7eb', leafColor: '#b9814e' },
    build3D(p, s, ctx = {}) {
      const g = group();
      frame(g, s, String(p.frameColor));
      const lw = (s.w - 2 * J) / 2;
      hingedLeaf(g, s, ctx, String(p.leafColor), { width: lw, atStart: true });
      hingedLeaf(g, s, ctx, String(p.leafColor), { width: lw, atStart: false });
      return g;
    },
    draw2D(_p, s) {
      const lw = (s.w - 2 * J) / 2;
      const a = -s.w / 2 + J;
      const b = s.w / 2 - J;
      return (
        <g>
          {gap(s)}
          <R x={a} y={-0.02} w={lw} h={0.04} fill="#e2e8f0" />
          <R x={b - lw} y={-0.02} w={lw} h={0.04} fill="#e2e8f0" />
          <L x1={a} y1={0} x2={a} y2={lw} />
          <L x1={b} y1={0} x2={b} y2={lw} />
          {doorArc(a, true, lw)}
          {doorArc(b, false, lw)}
        </g>
      );
    },
  };
}

function doorSliding(): CatalogEntry {
  return {
    catalogId: 'door-sliding',
    nameKey: 'catalog.door-sliding',
    category: 'doors',
    placement: 'wall',
    openingKind: 'door',
    defaultSize: { w: 1.8, d: 0.15, h: 2.1 },
    props: [...doorProps, { key: 'glazed', label: 'cprop.glazed', kind: 'boolean' }],
    defaults: { frameColor: '#d1d5db', leafColor: '#b9814e', glazed: true },
    build3D(p, s, ctx = {}) {
      const g = group();
      frame(g, s, String(p.frameColor));
      const lw = s.w / 2 - J / 2;
      const flip = ctx.flip ? -1 : 1;
      // Two panels on parallel tracks, one slid half-open.
      const slide = ctx.open ? lw * 0.6 : 0;
      for (const [i, z] of [0.03, -0.03].entries()) {
        const x = (i === 0 ? -1 : 1) * (lw / 2 + 0.0) * flip + (i === 0 ? slide : 0) * flip;
        box(g, [lw, s.h - J, 0.035], [x, 0, z], String(p.leafColor), 0.6);
        if (p.glazed) box(g, [lw - 0.12, s.h - 0.3, 0.04], [x, 0.12, z], GLASS, 0.05, 0.45);
      }
      box(g, [s.w, 0.04, 0.12], [0, s.h - 0.04, 0], '#9ca3af', 0.4, 1, 0.5); // track
      return g;
    },
    draw2D(_p, s) {
      const lw = s.w / 2;
      return (
        <g>
          {gap(s)}
          <R x={-s.w / 2} y={-0.05} w={lw} h={0.03} fill="#e2e8f0" />
          <R x={0} y={0.02} w={lw} h={0.03} fill="#e2e8f0" />
          <L x1={-s.w / 2 + 0.1} y1={0.0} x2={s.w / 2 - 0.1} y2={0.0} dash="2 2" />
        </g>
      );
    },
  };
}

function doorPocket(): CatalogEntry {
  return {
    catalogId: 'door-pocket',
    nameKey: 'catalog.door-pocket',
    category: 'doors',
    placement: 'wall',
    openingKind: 'door',
    defaultSize: { w: 0.9, d: 0.15, h: 2.1 },
    props: doorProps,
    defaults: { frameColor: '#e5e7eb', leafColor: '#b9814e' },
    build3D(p, s, ctx = {}) {
      const g = group();
      frame(g, s, String(p.frameColor));
      // The leaf slides into the wall: only a sliver and the pull stay visible.
      const lw = s.w - 2 * J;
      const x = (ctx.flip ? -1 : 1) * (s.w / 2 + lw / 2 - (ctx.open ? 0.12 : lw));
      box(g, [lw, s.h - J, 0.04], [x, 0, 0], String(p.leafColor), 0.6);
      return g;
    },
    draw2D(_p, s, ctx = {}) {
      const dir = ctx.flip ? -1 : 1;
      return (
        <g>
          {gap(s)}
          <R
            x={dir > 0 ? s.w / 2 : -s.w / 2 - s.w}
            y={-0.02}
            w={s.w}
            h={0.04}
            fill="none"
            dash="3 2"
          />
          <L x1={-s.w / 2} y1={0} x2={s.w / 2} y2={0} dash="1 2" />
        </g>
      );
    },
  };
}

function doorEntrance(): CatalogEntry {
  return {
    catalogId: 'door-entrance',
    nameKey: 'catalog.door-entrance',
    category: 'doors',
    placement: 'wall',
    openingKind: 'door',
    defaultSize: { w: 1.0, d: 0.3, h: 2.2 },
    props: doorProps,
    defaults: { frameColor: '#4b5563', leafColor: '#5b3a29' },
    build3D(p, s, ctx = {}) {
      const g = group();
      frame(g, s, String(p.frameColor));
      hingedLeaf(g, s, ctx, String(p.leafColor), { glass: true });
      box(
        g,
        [s.w + 0.1, 0.03, 0.25],
        [0, 0, (ctx.outward ?? -1) * (s.d / 2 + 0.05)],
        '#9ca3af',
        0.8,
      ); // doorstep
      return g;
    },
    draw2D(_p, s, ctx = {}) {
      const atStart = hingeAtStart(ctx);
      const lw = s.w - 2 * J;
      const hx = atStart ? -s.w / 2 + J : s.w / 2 - J;
      const dir = atStart ? 1 : -1;
      return (
        <g>
          {gap(s)}
          <R x={Math.min(hx, hx + dir * lw)} y={-0.03} w={lw} h={0.06} fill="#cbd5e1" sw={1.5} />
          <L x1={hx} y1={0} x2={hx} y2={lw} />
          {doorArc(hx, atStart, lw)}
        </g>
      );
    },
  };
}

function archway(): CatalogEntry {
  return {
    catalogId: 'archway',
    nameKey: 'catalog.archway',
    category: 'doors',
    placement: 'wall',
    openingKind: 'archway',
    defaultSize: { w: 1.2, d: 0.15, h: 2.1 },
    props: [],
    defaults: {},
    build3D: () => group(),
    draw2D: (_p, s) => (
      <g>
        {gap(s)}
        <L x1={-s.w / 2} y1={-s.d / 2} x2={s.w / 2} y2={-s.d / 2} dash="3 2" />
        <L x1={-s.w / 2} y1={s.d / 2} x2={s.w / 2} y2={s.d / 2} dash="3 2" />
      </g>
    ),
  };
}

/** Glass pane: thin translucent box. */
const glass = (g: Group, w: number, h: number, x: number, y: number, z: number) =>
  box(g, [w, h, 0.012], [x, y, z], GLASS, 0.05, 0.35);

function windowCasement(): CatalogEntry {
  return {
    catalogId: 'window-casement',
    nameKey: 'catalog.window-casement',
    category: 'windows',
    placement: 'wall',
    openingKind: 'window',
    defaultSize: { w: 1.2, d: 0.15, h: 1.2 },
    sill: 0.9,
    props: frameProps,
    defaults: { frameColor: '#f3f4f6' },
    build3D(p, s) {
      const g = group();
      const c = String(p.frameColor);
      frame(g, s, c, true);
      const inner = s.w - 2 * J;
      glass(g, inner, s.h - 2 * J, 0, J, 0);
      box(g, [0.04, s.h - 2 * J, 0.05], [0, J, 0], c, 0.5); // mullion between the two sashes
      box(g, [inner, 0.03, 0.04], [0, s.h / 2, 0], c, 0.5);
      return g;
    },
    draw2D: (_p, s) => (
      <g>
        {gap(s)}
        <R x={-s.w / 2} y={-0.04} w={s.w} h={0.08} fill="#e0f2fe" />
        <L x1={-s.w / 2} y1={0} x2={s.w / 2} y2={0} />
        <L x1={0} y1={-0.04} x2={0} y2={0.04} />
      </g>
    ),
  };
}

function windowSliding(): CatalogEntry {
  return {
    catalogId: 'window-sliding',
    nameKey: 'catalog.window-sliding',
    category: 'windows',
    placement: 'wall',
    openingKind: 'window',
    defaultSize: { w: 1.5, d: 0.15, h: 1.1 },
    sill: 0.9,
    props: frameProps,
    defaults: { frameColor: '#d1d5db' },
    build3D(p, s) {
      const g = group();
      const c = String(p.frameColor);
      frame(g, s, c, true);
      const pw = (s.w - 2 * J) / 2 + 0.03;
      for (const [x, z] of [
        [-pw / 2 + 0.015, 0.025],
        [pw / 2 - 0.015, -0.025],
      ] as const) {
        box(g, [pw, 0.03, 0.04], [x, J, z], c, 0.5);
        box(g, [pw, 0.03, 0.04], [x, s.h - J - 0.03, z], c, 0.5);
        glass(g, pw - 0.04, s.h - 2 * J - 0.06, x, J + 0.03, z);
      }
      return g;
    },
    draw2D: (_p, s) => (
      <g>
        {gap(s)}
        <R x={-s.w / 2} y={-0.05} w={s.w} h={0.1} fill="#e0f2fe" />
        <L x1={-s.w / 2} y1={-0.02} x2={0.05} y2={-0.02} />
        <L x1={-0.05} y1={0.02} x2={s.w / 2} y2={0.02} />
      </g>
    ),
  };
}

function windowFixed(): CatalogEntry {
  return {
    catalogId: 'window-fixed',
    nameKey: 'catalog.window-fixed',
    category: 'windows',
    placement: 'wall',
    openingKind: 'window',
    defaultSize: { w: 1.2, d: 0.15, h: 1.0 },
    sill: 1.0,
    props: frameProps,
    defaults: { frameColor: '#374151' },
    build3D(p, s) {
      const g = group();
      frame(g, s, String(p.frameColor), false);
      box(g, [s.w - 2 * J, J, s.d + 0.02], [0, 0, 0], String(p.frameColor), 0.5);
      glass(g, s.w - 2 * J, s.h - 2 * J, 0, J, 0);
      return g;
    },
    draw2D: (_p, s) => (
      <g>
        {gap(s)}
        <R x={-s.w / 2} y={-0.03} w={s.w} h={0.06} fill="#e0f2fe" />
      </g>
    ),
  };
}

function windowFull(): CatalogEntry {
  return {
    catalogId: 'window-full',
    nameKey: 'catalog.window-full',
    category: 'windows',
    placement: 'wall',
    openingKind: 'window',
    defaultSize: { w: 2.0, d: 0.15, h: 2.4 },
    sill: 0,
    props: frameProps,
    defaults: { frameColor: '#1f2937' },
    build3D(p, s) {
      const g = group();
      const c = String(p.frameColor);
      frame(g, s, c);
      const panes = Math.max(1, Math.round(s.w / 0.9));
      const pw = (s.w - 2 * J) / panes;
      for (let i = 0; i < panes; i++) {
        const x = -s.w / 2 + J + pw * (i + 0.5);
        glass(g, pw - 0.02, s.h - J - 0.02, x, 0.01, 0);
        if (i > 0) box(g, [0.035, s.h - J, 0.05], [-s.w / 2 + J + pw * i, 0, 0], c, 0.5);
      }
      return g;
    },
    draw2D: (_p, s) => (
      <g>
        {gap(s)}
        <R x={-s.w / 2} y={-0.035} w={s.w} h={0.07} fill="#e0f2fe" />
        <L x1={-s.w / 2} y1={0} x2={s.w / 2} y2={0} />
      </g>
    ),
  };
}

function windowBay(): CatalogEntry {
  return {
    catalogId: 'window-bay',
    nameKey: 'catalog.window-bay',
    category: 'windows',
    placement: 'wall',
    openingKind: 'window',
    defaultSize: { w: 1.8, d: 0.15, h: 1.3 },
    sill: 0.7,
    props: frameProps,
    defaults: { frameColor: '#f3f4f6' },
    build3D(p, s, ctx = {}) {
      const g = group();
      const c = String(p.frameColor);
      const out = ctx.outward ?? -1;
      const proj = 0.45;
      const front = out * (s.d / 2 + proj);
      const sideW = s.w * 0.28;
      // Center pane parallel to the wall, two angled side panes back to the wall.
      frame(g, s, c, false);
      box(g, [s.w - 0.5, J, 0.08], [0, 0, front], c, 0.5);
      box(g, [s.w - 0.5, J, 0.08], [0, s.h - J, front], c, 0.5);
      glass(g, s.w - 0.5, s.h - 2 * J, 0, J, front);
      for (const side of [-1, 1]) {
        const pane = group();
        pane.position.set(side * (s.w / 2 - sideW / 2), 0, out * (s.d / 2 + proj / 2));
        pane.rotation.y = side * Math.atan2(out * proj, sideW);
        glass(pane, Math.hypot(sideW, proj), s.h - 2 * J, 0, J, 0);
        box(pane, [Math.hypot(sideW, proj), J, 0.05], [0, 0, 0], c, 0.5);
        box(pane, [Math.hypot(sideW, proj), J, 0.05], [0, s.h - J, 0], c, 0.5);
        g.add(pane);
      }
      box(g, [s.w, 0.04, proj + 0.1], [0, s.h, out * (s.d / 2 + proj / 2)], '#9ca3af', 0.8); // little roof
      return g;
    },
    draw2D: (_p, s, ctx = {}) => {
      const out = ctx.outward ?? -1;
      const proj = 0.45;
      const sw = s.w * 0.28;
      const y0 = out * (s.d / 2);
      const y1 = out * (s.d / 2 + proj);
      return (
        <g>
          {gap(s)}
          <P
            d={`M ${-s.w / 2},${y0} L ${-s.w / 2 + sw},${y1} L ${s.w / 2 - sw},${y1} L ${s.w / 2},${y0}`}
            fill="#e0f2fe"
          />
          <L x1={-s.w / 2} y1={0} x2={s.w / 2} y2={0} dash="2 2" />
        </g>
      );
    },
  };
}

export const openingEntries = (): CatalogEntry[] => [
  doorSingle(),
  doorDouble(),
  doorSliding(),
  doorPocket(),
  doorEntrance(),
  archway(),
  windowCasement(),
  windowSliding(),
  windowFixed(),
  windowFull(),
  windowBay(),
];
