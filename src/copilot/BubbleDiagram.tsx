import { useMemo, useRef, useState } from 'react';
import type { Rect } from '../ai/layout/plan';
import { useT } from '../i18n';
import type { BriefRoom, DesignBrief, Point } from '../model/types';

const ZONE: Record<string, { fill: string; label: 'public' | 'private' | 'service' | 'wellness' }> =
  {
    living: { fill: '#fde68a', label: 'public' },
    dining: { fill: '#fde68a', label: 'public' },
    kitchen: { fill: '#fde68a', label: 'public' },
    foyer: { fill: '#fde68a', label: 'public' },
    study: { fill: '#fde68a', label: 'public' },
    bedroom: { fill: '#bfdbfe', label: 'private' },
    bathroom: { fill: '#bfdbfe', label: 'private' },
    'walk-in-closet': { fill: '#bfdbfe', label: 'private' },
    utility: { fill: '#e2e8f0', label: 'service' },
    laundry: { fill: '#e2e8f0', label: 'service' },
    pantry: { fill: '#e2e8f0', label: 'service' },
    garage: { fill: '#e2e8f0', label: 'service' },
    gym: { fill: '#ddd6fe', label: 'wellness' },
    sauna: { fill: '#ddd6fe', label: 'wellness' },
    spa: { fill: '#ddd6fe', label: 'wellness' },
    'game-room': { fill: '#ddd6fe', label: 'wellness' },
    'home-theatre': { fill: '#ddd6fe', label: 'wellness' },
  };
const zoneOf = (r: BriefRoom) => ZONE[r.type] ?? { fill: '#d1fae5', label: 'public' as const };

/** Starting positions: zones in columns (public left, private right, service and wellness at the back), so there is something to drag. */
function autoPositions(rooms: BriefRoom[], shell: Rect): Record<string, Point> {
  const cols: Record<string, BriefRoom[]> = { public: [], private: [], service: [], wellness: [] };
  for (const r of rooms) cols[zoneOf(r).label]!.push(r);
  const out: Record<string, Point> = {};
  const colX = { public: 0.2, private: 0.8, service: 0.5, wellness: 0.5 } as const;
  for (const [label, list] of Object.entries(cols)) {
    list.forEach((r, i) => {
      const n = list.length;
      const y = label === 'service' ? 0.12 : label === 'wellness' ? 0.88 : (i + 0.5) / n;
      const x =
        label === 'service' || label === 'wellness'
          ? (i + 1) / (n + 1)
          : colX[label as 'public' | 'private'];
      out[r.id] = { x: shell.x + shell.w * x, y: shell.y + shell.h * (0.08 + 0.84 * y) };
    });
  }
  return out;
}

/**
 * The program as draggable bubbles on the building outline: size = area, lines = adjacency wishes, colour = zone.
 * Dragging one sets a placement hint for the layout engine, so "kitchen here, bedrooms over there" can be said
 * before any wall exists.
 */
export function BubbleDiagram({
  brief,
  shell,
  onHint,
}: {
  brief: DesignBrief;
  shell: Rect;
  onHint: (roomId: string, at: Point | null) => void;
}) {
  const t = useT();
  const rooms = brief.program.filter((r) => r.priority === 'must' || true);
  const auto = useMemo(() => autoPositions(rooms, shell), [rooms, shell]);
  const [drag, setDrag] = useState<{ id: string; at: Point } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pos = (r: BriefRoom): Point =>
    drag?.id === r.id ? drag.at : (brief.hints[r.id] ?? auto[r.id]!);
  const pad = 1.2;
  const vb = `${shell.x - pad} ${shell.y - pad} ${shell.w + pad * 2} ${shell.h + pad * 2}`;
  const toPlan = (e: React.PointerEvent): Point => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return {
      x: Math.min(shell.x + shell.w, Math.max(shell.x, p.x)),
      y: Math.min(shell.y + shell.h, Math.max(shell.y, p.y)),
    };
  };
  const radius = (r: BriefRoom) => Math.max(0.6, Math.sqrt(r.area / Math.PI) * 0.62);
  const byName = new Map(rooms.map((r) => [r.name.toLowerCase(), r]));
  return (
    <figure className="space-y-1" data-testid="bubble-diagram">
      <svg
        ref={svgRef}
        viewBox={vb}
        role="img"
        aria-label={t('copilot.bubbles.title')}
        className="w-full touch-none rounded border border-slate-200 bg-white"
        style={{ aspectRatio: `${shell.w + pad * 2} / ${shell.h + pad * 2}` }}
      >
        <rect
          x={shell.x}
          y={shell.y}
          width={shell.w}
          height={shell.h}
          fill="#f8fafc"
          stroke="#334155"
          strokeWidth={0.12}
        />
        {rooms.flatMap((r) =>
          r.next
            .map((n) => byName.get(n.toLowerCase()))
            .filter((o): o is BriefRoom => !!o && o.id > r.id)
            .map((o) => (
              <line
                key={`${r.id}-${o.id}`}
                x1={pos(r).x}
                y1={pos(r).y}
                x2={pos(o).x}
                y2={pos(o).y}
                stroke="#94a3b8"
                strokeWidth={0.08}
                strokeDasharray="0.3 0.2"
              />
            )),
        )}
        {rooms.map((r) => {
          const p = pos(r);
          const z = zoneOf(r);
          return (
            <g
              key={r.id}
              data-testid="bubble"
              data-room={r.name}
              transform={`translate(${p.x} ${p.y})`}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => {
                (e.target as Element).setPointerCapture(e.pointerId);
                setDrag({ id: r.id, at: toPlan(e) });
              }}
              onPointerMove={(e) => drag?.id === r.id && setDrag({ id: r.id, at: toPlan(e) })}
              onPointerUp={() => {
                if (drag?.id === r.id) onHint(r.id, drag.at);
                setDrag(null);
              }}
              onDoubleClick={() => onHint(r.id, null)}
            >
              <circle
                r={radius(r)}
                fill={z.fill}
                stroke={r.priority === 'nice' ? '#94a3b8' : '#334155'}
                strokeWidth={0.08}
                strokeDasharray={r.priority === 'nice' ? '0.25 0.2' : undefined}
                opacity={0.92}
              />
              {brief.hints[r.id] && (
                <circle r={0.16} cx={radius(r) - 0.2} cy={-radius(r) + 0.2} fill="#0369a1" />
              )}
              <text
                textAnchor="middle"
                fontSize={Math.max(0.55, radius(r) * 0.42)}
                dy="0.2em"
                fill="#0f172a"
                pointerEvents="none"
              >
                {r.name.length > 14 ? `${r.name.slice(0, 13)}…` : r.name}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap gap-x-3 text-[10px] text-slate-500">
        {(['public', 'private', 'service', 'wellness'] as const).map((z) => (
          <span key={z} className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                background: {
                  public: '#fde68a',
                  private: '#bfdbfe',
                  service: '#e2e8f0',
                  wellness: '#ddd6fe',
                }[z],
              }}
            />
            {t(`copilot.zone.${z}` as 'copilot.zone.public')}
          </span>
        ))}
        <span>{t('copilot.bubbles.hint')}</span>
      </figcaption>
    </figure>
  );
}
