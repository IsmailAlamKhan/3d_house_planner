import type { ReactNode } from 'react';

export const STROKE = '#475569';
export const FILL = '#f8fafc';

const base = { stroke: STROKE, strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const };

interface RectProps {
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  rx?: number;
  sw?: number;
  dash?: string;
}

/** Rectangle given by its top-left corner. */
export function R({ x, y, w, h, fill = FILL, rx = 0, sw = 1, dash }: RectProps): ReactNode {
  return (
    <rect
      x={x}
      y={y}
      width={Math.max(w, 0)}
      height={Math.max(h, 0)}
      rx={rx}
      fill={fill}
      {...base}
      strokeWidth={sw}
      strokeDasharray={dash}
    />
  );
}

/** Rectangle centered on (cx, cy). */
export const RC = ({
  cx,
  cy,
  w,
  h,
  ...rest
}: {
  cx: number;
  cy: number;
  w: number;
  h: number;
  fill?: string;
  rx?: number;
  sw?: number;
  dash?: string;
}): ReactNode => <R x={cx - w / 2} y={cy - h / 2} w={w} h={h} {...rest} />;

export const C = ({
  cx,
  cy,
  r,
  fill = FILL,
  sw = 1,
}: {
  cx: number;
  cy: number;
  r: number;
  fill?: string;
  sw?: number;
}): ReactNode => <circle cx={cx} cy={cy} r={r} fill={fill} {...base} strokeWidth={sw} />;

export const E = ({
  cx,
  cy,
  rx,
  ry,
  fill = FILL,
}: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill?: string;
}): ReactNode => <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={fill} {...base} />;

export const L = ({
  x1,
  y1,
  x2,
  y2,
  dash,
  sw = 1,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dash?: string;
  sw?: number;
}): ReactNode => (
  <line x1={x1} y1={y1} x2={x2} y2={y2} {...base} strokeWidth={sw} strokeDasharray={dash} />
);

export const P = ({
  d,
  fill = 'none',
  sw = 1,
  dash,
}: {
  d: string;
  fill?: string;
  sw?: number;
  dash?: string;
}): ReactNode => <path d={d} fill={fill} {...base} strokeWidth={sw} strokeDasharray={dash} />;
