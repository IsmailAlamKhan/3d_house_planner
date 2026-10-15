import type { DesignBrief } from '../model/types';

type Budget = DesignBrief['budget'];
type FloorStyle =
  'light-wood' | 'dark-wood' | 'herringbone' | 'tile-grey' | 'tile-white' | 'concrete' | 'marble';
type WallStyle = 'white' | 'cream' | 'grey' | 'sage' | 'blue' | 'terracotta' | 'charcoal';

/**
 * A look for the whole home in one step: floors and walls, the kitchen's cabinet and counter colours, the outside,
 * the lighting preset, planting and decor. Budget level (below) adjusts the finishes inside each style.
 */
export interface StylePreset {
  id: NonNullable<DesignBrief['style']['preset']>;
  floor: FloorStyle;
  walls: WallStyle;
  /** Kitchen cabinet fronts and counter top (hex). */
  kitchen: { front: string; counter: string };
  /** Outside wall material key. */
  exterior: string;
  /** Lighting preset for the 3D view. */
  lighting: 'noon' | 'evening' | 'dusk' | 'marketing';
  /** Plants around the house and in the rooms. */
  green: 'lush' | 'some' | 'little';
  /** Words in a brief that point at this style. */
  words: RegExp;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'modern-luxury',
    floor: 'marble',
    walls: 'cream',
    kitchen: { front: '#f5f5f4', counter: '#27272a' },
    exterior: 'paint-white',
    lighting: 'dusk',
    green: 'some',
    words: /modern luxur|luxur|premium|high[- ]end|elegant|marble|contemporary|modern(?! minimal)/i,
  },
  {
    id: 'warm-minimal',
    floor: 'light-wood',
    walls: 'white',
    kitchen: { front: '#e7e0d4', counter: '#a8a29e' },
    exterior: 'paint-cream',
    lighting: 'evening',
    green: 'some',
    words: /minimal|scandi|nordic|warm|cozy|cosy|simple|light wood/i,
  },
  {
    id: 'tropical',
    floor: 'tile-white',
    walls: 'sage',
    kitchen: { front: '#d9e4d3', counter: '#78716c' },
    exterior: 'paint-sage',
    lighting: 'noon',
    green: 'lush',
    words: /tropical|resort|bali|palm|breezy|garden living/i,
  },
  {
    id: 'classic',
    floor: 'herringbone',
    walls: 'cream',
    kitchen: { front: '#e8dcc8', counter: '#57534e' },
    exterior: 'brick-red',
    lighting: 'evening',
    green: 'some',
    words: /classic|traditional|colonial|heritage|vintage|old[- ]world/i,
  },
  {
    id: 'industrial',
    floor: 'concrete',
    walls: 'grey',
    kitchen: { front: '#3f3f46', counter: '#a1a1aa' },
    exterior: 'concrete',
    lighting: 'dusk',
    green: 'little',
    words: /industrial|loft|raw|exposed|concrete|urban/i,
  },
];

export const styleById = (id: string | undefined): StylePreset | undefined =>
  STYLE_PRESETS.find((s) => s.id === id);

/** The style a few words ask for (first match), or undefined. */
export function styleFromWords(text: string): StylePreset | undefined {
  return STYLE_PRESETS.find((s) => s.words.test(text));
}

/** What each budget level means for the finishes (the numbers feed the cost estimate's unit costs). */
export interface BudgetFinish {
  level: Budget;
  /** Floors in living areas replace the preset's when the budget is lower than the style assumes. */
  floor?: FloorStyle;
  /** Multiplier on the unit costs of the bill of materials. */
  costFactor: number;
}

export const BUDGETS: BudgetFinish[] = [
  { level: 'low', floor: 'tile-grey', costFactor: 0.6 },
  { level: 'mid', costFactor: 1 },
  { level: 'high', costFactor: 1.5 },
  { level: 'luxury', costFactor: 2.4 },
];

export const budgetFinish = (b: Budget): BudgetFinish => BUDGETS.find((x) => x.level === b)!;

/** Floor, wall and kitchen finishes for a style at a budget (low budgets drop marble and herringbone for tile). */
export function finishes(
  style: StylePreset,
  budget: Budget,
): {
  floor: FloorStyle;
  walls: WallStyle;
  kitchen: StylePreset['kitchen'];
} {
  let floor = style.floor;
  if (budget === 'low' && (floor === 'marble' || floor === 'herringbone')) floor = 'tile-grey';
  if (budget === 'luxury' && floor === 'light-wood') floor = 'herringbone';
  return { floor, walls: style.walls, kitchen: style.kitchen };
}
