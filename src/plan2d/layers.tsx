import type { ReactNode } from 'react';
import { labelPoint, polygonArea, polygonBounds } from '../geometry/polygon';
import { type Vec2 } from '../geometry/vec';
import type { Column, Room, RoomType, Units } from '../model/types';
import { formatArea, formatLength } from '../ui/units';
import { gridSpacing, type View } from './view';

export const ROOM_FILL: Record<RoomType, string> = {
  living: '#fef3c7',
  kitchen: '#fed7aa',
  bedroom: '#e0e7ff',
  bathroom: '#cffafe',
  dining: '#fde68a',
  study: '#ddd6fe',
  utility: '#e5e7eb',
  balcony: '#d9f99d',
  corridor: '#f1f5f9',
  stair: '#fbcfe8',
  other: '#f1f5f9',
};

const pts = (poly: Vec2[]) => poly.map((p) => `${p.x},${p.y}`).join(' ');

export function Grid({ view, size }: { view: View; size: { w: number; h: number } }) {
  const { minor, major } = gridSpacing(view.scale);
  const x0 = -view.tx / view.scale;
  const y0 = -view.ty / view.scale;
  const x1 = (size.w - view.tx) / view.scale;
  const y1 = (size.h - view.ty) / view.scale;
  const minorPath: string[] = [];
  const majorPath: string[] = [];
  const eps = minor / 1000;
  const lines = (from: number, to: number, horizontal: boolean) => {
    for (let k = Math.ceil(from / minor); k * minor <= to; k++) {
      const v = k * minor;
      const isMajor = Math.abs(v / major - Math.round(v / major)) < eps / major;
      const d = horizontal ? `M${x0},${v}H${x1}` : `M${v},${y0}V${y1}`;
      (isMajor ? majorPath : minorPath).push(d);
    }
  };
  lines(x0, x1, false);
  lines(y0, y1, true);
  return (
    <g pointerEvents="none">
      <path
        d={minorPath.join('')}
        stroke="#e2e8f0"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        fill="none"
      />
      <path
        d={majorPath.join('')}
        stroke="#cbd5e1"
        strokeWidth={1.2}
        vectorEffect="non-scaling-stroke"
        fill="none"
      />
    </g>
  );
}

export function ShellLayer({ footprint }: { footprint: Vec2[] }) {
  return (
    <polygon
      points={pts(footprint)}
      fill="#ffffff"
      stroke="#64748b"
      strokeWidth={2}
      strokeDasharray="8 4"
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />
  );
}

export function ColumnsLayer({
  columns,
  view,
  selected,
}: {
  columns: Column[];
  view: View;
  selected: Set<string>;
}) {
  const hatch = 5 / view.scale;
  return (
    <g>
      <defs>
        <pattern
          id="col-hatch"
          width={hatch}
          height={hatch}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width={hatch} height={hatch} fill="#94a3b8" />
          <line x1="0" y1="0" x2="0" y2={hatch} stroke="#1e293b" strokeWidth={hatch / 2.2} />
        </pattern>
      </defs>
      {columns.map((c) => {
        const common = {
          fill: 'url(#col-hatch)',
          stroke: selected.has(c.id) ? '#0ea5e9' : '#1e293b',
          strokeWidth: selected.has(c.id) ? 3 : 1.5,
          vectorEffect: 'non-scaling-stroke' as const,
        };
        return c.shape === 'round' ? (
          <ellipse
            key={c.id}
            cx={c.position.x}
            cy={c.position.y}
            rx={c.size.w / 2}
            ry={c.size.d / 2}
            {...common}
          />
        ) : (
          <rect
            key={c.id}
            x={c.position.x - c.size.w / 2}
            y={c.position.y - c.size.d / 2}
            width={c.size.w}
            height={c.size.d}
            {...common}
          />
        );
      })}
    </g>
  );
}

export function RoomsLayer({
  rooms,
  selected,
  view,
  units,
  labels = true,
}: {
  rooms: Pick<Room, 'id' | 'polygon' | 'type' | 'name'>[];
  selected: Set<string>;
  view: View;
  units: Units;
  labels?: boolean;
}) {
  const fs = 12 / view.scale;
  return (
    <g>
      {rooms.map((r) => (
        <polygon
          key={r.id}
          points={pts(r.polygon)}
          fill={ROOM_FILL[r.type]}
          fillOpacity={0.85}
          stroke={selected.has(r.id) ? '#0ea5e9' : 'none'}
          strokeWidth={3}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {labels &&
        rooms.map((r) => {
          // Skip labels that would not fit inside a small room at this zoom level.
          const b = polygonBounds(r.polygon);
          if ((b.max.x - b.min.x) * view.scale < 70 || (b.max.y - b.min.y) * view.scale < 36)
            return null;
          const c = labelPoint(r.polygon);
          return (
            <text
              key={`l${r.id}`}
              x={c.x}
              y={c.y}
              textAnchor="middle"
              fontSize={fs}
              fill="#334155"
              pointerEvents="none"
            >
              <tspan x={c.x} fontWeight={600}>
                {r.name}
              </tspan>
              <tspan x={c.x} dy={fs * 1.25} fill="#64748b">
                {formatArea(polygonArea(r.polygon), units)}
              </tspan>
            </text>
          );
        })}
    </g>
  );
}

/** A length label placed beside a segment, always readable (never upside down). */
export function DimensionLabel({
  a,
  b,
  offset,
  view,
  units,
  color = '#0369a1',
}: {
  a: Vec2;
  b: Vec2;
  offset: number;
  view: View;
  units: Units;
  color?: string;
}): ReactNode {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (ang > 90) ang -= 180;
  if (ang < -90) ang += 180;
  const nx = -dy / len;
  const ny = dx / len;
  const sign = ny > 0 || (ny === 0 && nx > 0) ? -1 : 1; // keep label above the line on screen
  const px = (a.x + b.x) / 2 + nx * sign * offset;
  const py = (a.y + b.y) / 2 + ny * sign * offset;
  const fs = 11 / view.scale;
  return (
    <text
      x={px}
      y={py}
      fontSize={fs}
      textAnchor="middle"
      dominantBaseline="middle"
      fill={color}
      transform={`rotate(${ang} ${px} ${py})`}
      pointerEvents="none"
      style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 / view.scale }}
    >
      {formatLength(len, units)}
    </text>
  );
}
