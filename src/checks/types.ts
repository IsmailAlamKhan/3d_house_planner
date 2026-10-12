import type { Point, RoomType, Selection } from '../model/types';

export type Severity = 'error' | 'warning';

export type RuleId =
  | 'stair-headroom'
  | 'stair-comfort'
  | 'stair-fit'
  | 'unreachable'
  | 'entrance'
  | 'bedroom-window'
  | 'drain'
  | 'column-obstructed'
  | 'min-area'
  | 'door-swing'
  | 'beam-headroom';

/** Where an issue is, so the panel can jump to it and highlight it. */
export interface IssueTarget {
  levelId?: string;
  /** Entity to select (rooms, items, openings, stairs …). */
  selection?: Selection;
  /** Region to bring into view and pulse (plan metres). Used when there is no entity to select (beams, the entrance). */
  rect?: { min: Point; max: Point };
}

export interface CheckIssue {
  id: string;
  rule: RuleId;
  severity: Severity;
  message: string;
  target: IssueTarget;
}

/** Built-in minimum areas (m²) per room type. A project can override them in `settings.checks.minAreas`. */
export const DEFAULT_MIN_AREAS: Partial<Record<RoomType, number>> = {
  bedroom: 7.5,
  bathroom: 2.5,
  kitchen: 5,
  living: 12,
  dining: 6,
  study: 5,
  utility: 1.5,
};
