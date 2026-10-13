import { polygonArea, polygonBounds, labelPoint } from '../geometry/polygon';
import type { Vec2 } from '../geometry/vec';
import type { Project, ZoneType } from '../model/types';
import { formatArea } from '../ui/units';
import type { View } from './view';

export const ZONE_FILL: Record<ZoneType, string> = {
  garden: '#86efac',
  lawn: '#bbf7d0',
  pool: '#7dd3fc',
  deck: '#d6b88a',
  patio: '#e7e5e4',
  parking: '#cbd5e1',
  play: '#fde68a',
  path: '#e7e5e4',
  'water-feature': '#67e8f9',
};

const pts = (poly: Vec2[]) => poly.map((p) => `${p.x},${p.y}`).join(' ');

/**
 * The plot, its outdoor zones and gates, drawn beneath the building (villa projects). `dim` fades it when another level
 * is being edited; `nameOf` gives a zone its label.
 */
export function SiteLayer({
  project,
  view,
  selected,
  dim,
  draft,
}: {
  project: Project;
  view: View;
  selected: Set<string>;
  dim: boolean;
  /** The polygon being drawn with the zone/plot tool. */
  draft: Vec2[];
}) {
  const { plot, zones, gates, setback } = project.site;
  const fs = 12 / view.scale;
  const k = 1 / view.scale;
  return (
    <g opacity={dim ? 0.35 : 1} data-testid="site-layer">
      {plot.length >= 3 && (
        <>
          <polygon
            points={pts(plot)}
            fill="#dcfce7"
            stroke="#166534"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
          <SetbackLine plot={plot} setback={setback} />
        </>
      )}
      {zones.map((z) => (
        <g key={z.id} data-zone={z.id}>
          <polygon
            points={pts(z.polygon)}
            fill={ZONE_FILL[z.type]}
            fillOpacity={0.9}
            stroke={selected.has(z.id) ? '#0ea5e9' : z.type === 'pool' ? '#0369a1' : '#78716c'}
            strokeWidth={selected.has(z.id) ? 3 : 1.2}
            strokeDasharray={z.covered ? '6 3' : undefined}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
          {zoneLabelFits(z.polygon, view.scale) && (
            <text
              x={labelPoint(z.polygon).x}
              y={labelPoint(z.polygon).y}
              fontSize={fs}
              textAnchor="middle"
              fill="#1e293b"
              pointerEvents="none"
            >
              <tspan x={labelPoint(z.polygon).x} fontWeight={600}>
                {z.name}
              </tspan>
              <tspan x={labelPoint(z.polygon).x} dy={fs * 1.25} fill="#475569">
                {formatArea(polygonArea(z.polygon), project.units)}
              </tspan>
            </text>
          )}
        </g>
      ))}
      {gates.map((g) => {
        const sel = selected.has(g.id);
        const ang = (g.direction * 180) / Math.PI;
        const vehicle = g.kind === 'vehicle';
        return (
          <g
            key={g.id}
            data-gate={g.id}
            transform={`translate(${g.position.x} ${g.position.y}) rotate(${ang})`}
            pointerEvents="none"
          >
            {/* Local frame: x = outward, y = along the boundary. */}
            <rect
              x={-0.1}
              y={-g.width / 2}
              width={0.2}
              height={g.width}
              fill={vehicle ? '#334155' : '#78350f'}
              stroke={sel ? '#0ea5e9' : '#0f172a'}
              strokeWidth={sel ? 3 : 1}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={`M 0.3 0 L 0.9 0 M 0.65 -0.2 L 0.9 0 L 0.65 0.2`}
              fill="none"
              stroke="#0f172a"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
            <g transform={`rotate(${-ang}) scale(${k})`}>
              <text y={-14} textAnchor="middle" fontSize={11} fill="#0f172a" fontWeight={600}>
                {vehicle ? '🚗' : '🚪'}
              </text>
            </g>
          </g>
        );
      })}
      {draft.length >= 2 && (
        <polyline
          points={pts(draft)}
          fill="#0ea5e922"
          stroke="#0ea5e9"
          strokeWidth={2}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
    </g>
  );
}

function zoneLabelFits(poly: Vec2[], scale: number): boolean {
  const b = polygonBounds(poly);
  return (b.max.x - b.min.x) * scale > 60 && (b.max.y - b.min.y) * scale > 34;
}

/** A dashed line `setback` metres inside the plot (approximated per edge: inset along the inward normal). */
function SetbackLine({ plot, setback }: { plot: Vec2[]; setback: number }) {
  if (setback <= 0) return null;
  // Inset by moving each edge inward and intersecting neighbours; good enough for the convex-ish plots we draw.
  const n = plot.length;
  const area = plot.reduce(
    (s, p, i) => s + (p.x * plot[(i + 1) % n]!.y - plot[(i + 1) % n]!.x * p.y),
    0,
  );
  const sign = area >= 0 ? 1 : -1;
  const lines = plot.map((a, i) => {
    const b = plot[(i + 1) % n]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = (-(b.y - a.y) / len) * sign;
    const ny = ((b.x - a.x) / len) * sign;
    return {
      p: { x: a.x + nx * setback, y: a.y + ny * setback },
      d: { x: (b.x - a.x) / len, y: (b.y - a.y) / len },
    };
  });
  const corner = (l1: (typeof lines)[number], l2: (typeof lines)[number]): Vec2 | null => {
    const den = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / den;
    return { x: l1.p.x + l1.d.x * t, y: l1.p.y + l1.d.y * t };
  };
  const inner = lines
    .map((l, i) => corner(lines[(i - 1 + n) % n]!, l))
    .filter((p): p is Vec2 => p !== null);
  if (inner.length < 3) return null;
  return (
    <polygon
      points={pts(inner)}
      fill="none"
      stroke="#166534"
      strokeWidth={1}
      strokeDasharray="8 5"
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />
  );
}
