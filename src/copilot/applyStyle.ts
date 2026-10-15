import { FLOOR_STYLE, WALL_STYLE, floorFor } from '../ai/layout/defaults';
import { priceBom } from '../export/bom';
import type { DesignBrief, Project } from '../model/types';
import { autoDecorateProject } from '../present/decorate';
import { STYLE_PRESETS, type StylePreset, finishes, styleById } from './styles';

export interface StyleResult {
  preset: StylePreset;
  rooms: number;
  walls: number;
  kitchenItems: number;
  decor: number;
  /** The 3D lighting preset this style goes with (the app sets it). */
  lighting: StylePreset['lighting'];
}

/**
 * Applies a style to a design in one step (call it inside one `apply`, so it is one undo): floors by room type,
 * wall paint inside, the outside material, the kitchen's cabinet and counter colours, then auto-decorate (plants,
 * rugs, art, lamps). The budget decides the grade of finish (low budgets use tile where a style asks for marble).
 */
export function applyStylePreset(
  p: Project,
  styleId: string,
  budget: DesignBrief['budget'],
): StyleResult {
  const preset = styleById(styleId) ?? STYLE_PRESETS[1]!;
  const fin = finishes(preset, budget);
  const style = { floor: fin.floor, walls: fin.walls };
  let rooms = 0;
  for (const r of p.rooms) {
    const material = floorFor(r.type, style);
    if (r.floorMaterial !== material && r.type !== 'outdoor') {
      r.floorMaterial = material;
      rooms++;
    }
  }
  const paint = WALL_STYLE[fin.walls];
  let walls = 0;
  for (const w of p.walls) {
    w.materialInside = paint;
    if (w.type === 'exterior') w.materialOutside = preset.exterior;
    walls++;
  }
  let kitchenItems = 0;
  for (const i of p.items) {
    if (
      i.catalogId === 'kitchen-base-run' ||
      i.catalogId === 'kitchen-island' ||
      i.catalogId === 'kitchen-wall-cabinet'
    ) {
      i.props = { ...i.props, front: fin.kitchen.front, counter: fin.kitchen.counter };
      kitchenItems++;
    }
  }
  const decor = autoDecorateProject(p);
  return { preset, rooms, walls, kitchenItems, decor, lighting: preset.lighting };
}

/** The floor material key a style would use for living areas (for previews). */
export const livingFloorOf = (id: string, budget: DesignBrief['budget']): string => {
  const preset = styleById(id) ?? STYLE_PRESETS[1]!;
  return FLOOR_STYLE[finishes(preset, budget).floor];
};

/** A short finish-level note and, when the person has entered unit costs, the current estimate of the design. */
export function budgetNote(
  project: Project,
  budget: DesignBrief['budget'],
): { level: DesignBrief['budget']; estimate?: { total: number; currency: string } } {
  const priced = priceBom(project);
  const hasPrices = Object.keys(project.costs.unitCosts).length > 0 && priced.total > 0;
  return {
    level: budget,
    estimate: hasPrices ? { total: priced.total, currency: priced.currency } : undefined,
  };
}
