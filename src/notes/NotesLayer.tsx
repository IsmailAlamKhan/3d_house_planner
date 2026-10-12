import { notePin } from '../model/ops';
import type { Project } from '../model/types';
import type { View } from '../plan2d/view';

/** Pins on the plan: a numbered marker per note on this level, amber while open, grey when resolved. */
export function NotesLayer({
  project,
  levelId,
  view,
  activeId,
}: {
  project: Project;
  levelId: string;
  view: View;
  activeId: string | null;
}) {
  const pins = project.notes
    .map((n, i) => ({ n, i, pin: notePin(project, n) }))
    .filter((x) => x.pin.levelId === levelId);
  const k = 1 / view.scale;
  return (
    <g pointerEvents="none" data-testid="notes-layer">
      {pins.map(({ n, i, pin }) => (
        <g
          key={n.id}
          data-note={n.id}
          transform={`translate(${pin.position.x} ${pin.position.y}) scale(${k})`}
        >
          <path
            d="M0 0 C -7 -9 -11 -13 -11 -19 A 11 11 0 1 1 11 -19 C 11 -13 7 -9 0 0 Z"
            fill={n.resolved ? '#94a3b8' : '#f59e0b'}
            stroke={activeId === n.id ? '#0369a1' : '#78350f'}
            strokeWidth={activeId === n.id ? 3 : 1.5}
          />
          <text y={-15} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1c1917">
            {i + 1}
          </text>
        </g>
      ))}
    </g>
  );
}
