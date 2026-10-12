import { useModel } from '../model/store';
import { usePlanStore } from '../plan2d/planStore';
import { fitBounds } from '../plan2d/view';
import type { CheckIssue } from './types';

/** Jumps to an issue: switches level, selects the element, shows the plan and pulses the spot. */
export function focusIssue(issue: CheckIssue): void {
  const m = useModel.getState();
  const { levelId, selection, rect } = issue.target;
  if (levelId) m.setActiveLevel(levelId);
  m.setSelection(selection ?? { type: null, ids: [] });
  if (m.viewMode === '3d') m.setViewMode('split');
  const plan = usePlanStore.getState();
  if (rect) {
    const w = rect.max.x - rect.min.x;
    const h = rect.max.y - rect.min.y;
    // Zoom so the spot is clearly visible without losing the surroundings.
    const pad = Math.max(3, Math.max(w, h) * 1.2);
    if (plan.size.w > 0) {
      plan.setView(
        fitBounds(
          { x: rect.min.x - pad, y: rect.min.y - pad },
          { x: rect.max.x + pad, y: rect.max.y + pad },
          plan.size,
          16,
        ),
      );
    }
    plan.setFlash(rect);
    setTimeout(() => {
      const cur = usePlanStore.getState().flash;
      if (cur && cur.min === rect.min) usePlanStore.getState().setFlash(null);
    }, 2600);
  }
}
