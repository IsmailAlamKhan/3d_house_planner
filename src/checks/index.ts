import type { Project } from '../model/types';
import { doorRules, placementRules, reachabilityRules, roomRules, stairRules } from './rules';
import type { CheckIssue } from './types';

export * from './types';
export { beamPolygon, doorSwingPolygon } from './rules';
export { areaSchedule } from './areas';

/** Runs every rule; errors first, then warnings. Pure and fast enough to run on every change. */
export function runChecks(project: Project): CheckIssue[] {
  const issues = [
    ...stairRules(project),
    ...reachabilityRules(project),
    ...roomRules(project),
    ...placementRules(project),
    ...doorRules(project),
  ];
  return issues.sort((a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'));
}
