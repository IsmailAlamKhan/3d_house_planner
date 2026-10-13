import { produce } from 'immer';
import { applyPlan } from '../ai/layout/apply';
import { largestInnerRect } from '../ai/layout/rect';
import { solveLayout } from '../ai/layout/solve';
import type { LayoutPlan } from '../ai/layout/plan';
import type { Project } from '../model/types';
import { type DuplexTemplate } from '../templates';

/** Lays a template out inside the project's shell (deterministic) and returns the plan. */
export function planTemplate(project: Project, template: DuplexTemplate, seed = 1): LayoutPlan {
  const first = project.levels[0]?.id;
  return solveLayout({
    intent: { ...template.intent, furnish: true },
    footprint: project.shell.footprint,
    entrance: project.shell.entrance,
    plumbing: project.shell.fixedPlumbingPoints,
    columns: project.columns
      .filter((c) => c.levelId === first)
      .map((c) => ({ position: c.position, size: c.size })),
    maxHeight: project.shell.maxHeight,
    plot: project.kind === 'villa' ? project.site.plot : undefined,
    seed,
  });
}

/** A new project with the template applied. */
export function projectWithTemplate(project: Project, template: DuplexTemplate): Project {
  const plan = planTemplate(project, template);
  return produce(project, (d) => void applyPlan(d, plan, template.intent.style));
}

export const innerRectOf = (project: Project) => largestInnerRect(project.shell.footprint).rect;
