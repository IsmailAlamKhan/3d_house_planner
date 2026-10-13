import type { Project, Underlay } from '../model/types';
import { useRectified } from './useRectified';

/** One straightened reference picture, drawn in plan metres (the parent group scales plan metres to pixels). */
function UnderlayImage({ u }: { u: Underlay }) {
  const r = useRectified(u);
  if (r?.status !== 'ready') return null;
  return (
    <image
      href={r.url}
      x={r.bounds.x0}
      y={r.bounds.y0}
      width={r.bounds.x1 - r.bounds.x0}
      height={r.bounds.y1 - r.bounds.y0}
      preserveAspectRatio="none"
      opacity={u.opacity}
      pointerEvents="none"
      data-testid={`underlay-${u.id}`}
    />
  );
}

/**
 * The reference pictures of the project that belong on this level, back-most first. `onTop` selects the ones drawn
 * over the plan (to check alignment) instead of under it.
 */
export function UnderlayLayer({
  project,
  levelId,
  onTop,
}: {
  project: Project;
  levelId: string;
  onTop: boolean;
}) {
  const list = project.underlays.filter(
    (u) => u.visible && u.onTop === onTop && (!u.levelId || u.levelId === levelId),
  );
  if (list.length === 0) return null;
  return (
    <g pointerEvents="none" aria-hidden>
      {list.map((u) => (
        <UnderlayImage key={u.id} u={u} />
      ))}
    </g>
  );
}
