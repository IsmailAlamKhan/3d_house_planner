import { ROOM_FILL } from '../plan2d/layers';
import type { LayoutPlan } from './layout/plan';

/** Tiny SVG preview of one level of a layout plan (rooms, walls, windows, stair). */
export function PlanThumb({
  plan,
  level,
  width = 104,
}: {
  plan: LayoutPlan;
  level: number;
  width?: number;
}) {
  const { shell } = plan;
  const pad = 0.3;
  const vw = shell.w + pad * 2;
  const vh = shell.h + pad * 2;
  const height = Math.round((width * vh) / vw);
  const rooms = plan.rooms.filter((r) => r.level === level);
  const stairHere = level < plan.levelNames.length - 1 || level > 0;
  return (
    <svg
      viewBox={`${shell.x - pad} ${shell.y - pad} ${vw} ${vh}`}
      width={width}
      height={height}
      role="img"
      aria-label={plan.levelNames[level]}
      className="rounded border border-slate-200 bg-white"
    >
      {rooms.map((r) => (
        <rect
          key={r.key}
          x={r.rect.x}
          y={r.rect.y}
          width={r.rect.w}
          height={r.rect.h}
          fill={ROOM_FILL[r.type]}
        />
      ))}
      {plan.walls
        .filter((w) => w.level === level)
        .map((w, i) => (
          <line
            key={i}
            x1={w.start.x}
            y1={w.start.y}
            x2={w.end.x}
            y2={w.end.y}
            stroke="#334155"
            strokeWidth={w.type === 'exterior' ? 0.28 : 0.14}
            strokeLinecap="square"
          />
        ))}
      {plan.openings
        .filter((o) => o.level === level)
        .map((o, i) => {
          const horizontal = plan.walls.some(
            (w) =>
              w.level === level &&
              w.start.y === w.end.y &&
              Math.abs(w.start.y - o.at.y) < 1e-3 &&
              Math.min(w.start.x, w.end.x) - 1e-3 <= o.at.x &&
              Math.max(w.start.x, w.end.x) + 1e-3 >= o.at.x,
          );
          const hw = o.width / 2;
          return (
            <line
              key={i}
              x1={horizontal ? o.at.x - hw : o.at.x}
              x2={horizontal ? o.at.x + hw : o.at.x}
              y1={horizontal ? o.at.y : o.at.y - hw}
              y2={horizontal ? o.at.y : o.at.y + hw}
              stroke={o.kind === 'window' ? '#38bdf8' : '#ffffff'}
              strokeWidth={o.kind === 'window' ? 0.2 : 0.3}
            />
          );
        })}
      {stairHere && (
        <rect
          x={plan.stair.roomRect.x + 0.2}
          y={plan.stair.roomRect.y + 0.2}
          width={Math.max(plan.stair.roomRect.w - 0.4, 0.1)}
          height={Math.max(plan.stair.roomRect.h - 0.4, 0.1)}
          fill="none"
          stroke="#be185d"
          strokeWidth={0.1}
          strokeDasharray="0.3 0.2"
        />
      )}
    </svg>
  );
}
