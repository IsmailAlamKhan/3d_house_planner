import type { RoomType } from '../../model/types';
import type { DesignIntent } from '../schemas';

export interface TypeDefaults {
  /** Narrowest comfortable width (m). */
  minWidth: number;
  /** How much bigger than requested a room of this type may grow when the shell has spare area. */
  maxScale: number;
  window: boolean;
  wet: boolean;
  floor: string;
  /** Preferred share of leftover space (higher = grows first). */
  growth: number;
}

export const TYPE_DEFAULTS: Record<RoomType, TypeDefaults> = {
  living: { minWidth: 3.0, maxScale: 2.2, window: true, wet: false, floor: 'floor-oak', growth: 5 },
  kitchen: {
    minWidth: 2.1,
    maxScale: 1.9,
    window: true,
    wet: true,
    floor: 'floor-tile-white',
    growth: 3,
  },
  dining: { minWidth: 2.4, maxScale: 1.9, window: true, wet: false, floor: 'floor-oak', growth: 3 },
  bedroom: {
    minWidth: 2.6,
    maxScale: 1.9,
    window: true,
    wet: false,
    floor: 'floor-oak',
    growth: 4,
  },
  bathroom: {
    minWidth: 1.5,
    maxScale: 1.5,
    window: false,
    wet: true,
    floor: 'floor-tile-grey',
    growth: 1,
  },
  study: { minWidth: 2.0, maxScale: 1.9, window: true, wet: false, floor: 'floor-oak', growth: 2 },
  utility: {
    minWidth: 1.2,
    maxScale: 1.4,
    window: false,
    wet: true,
    floor: 'floor-tile-grey',
    growth: 0.5,
  },
  balcony: {
    minWidth: 1.2,
    maxScale: 1.5,
    window: false,
    wet: false,
    floor: 'floor-tile-grey',
    growth: 0.5,
  },
  corridor: {
    minWidth: 1.0,
    maxScale: 1.6,
    window: false,
    wet: false,
    floor: 'floor-tile-large',
    growth: 0.5,
  },
  stair: {
    minWidth: 1.0,
    maxScale: 1.2,
    window: false,
    wet: false,
    floor: 'floor-tile-large',
    growth: 0,
  },
  other: {
    minWidth: 1.5,
    maxScale: 1.7,
    window: true,
    wet: false,
    floor: 'floor-oak',
    growth: 1.5,
  },
};

export const FLOOR_STYLE: Record<
  NonNullable<NonNullable<DesignIntent['style']>['floor']>,
  string
> = {
  'light-wood': 'floor-oak',
  'dark-wood': 'floor-walnut',
  herringbone: 'floor-herringbone',
  'tile-grey': 'floor-tile-grey',
  'tile-white': 'floor-tile-white',
  concrete: 'floor-concrete',
  marble: 'floor-marble',
};

export const WALL_STYLE: Record<
  NonNullable<NonNullable<DesignIntent['style']>['walls']>,
  string
> = {
  white: 'paint-white',
  cream: 'paint-cream',
  grey: 'paint-grey',
  sage: 'paint-sage',
  blue: 'paint-blue',
  terracotta: 'paint-terracotta',
  charcoal: 'paint-charcoal',
};

/** Floor for a room type given the style: wet rooms and halls keep tile/stone; the rest follow the chosen floor. */
export function floorFor(type: RoomType, style: DesignIntent['style']): string {
  const base = TYPE_DEFAULTS[type].floor;
  const chosen = style?.floor ? FLOOR_STYLE[style.floor] : undefined;
  if (!chosen) return base;
  return type === 'bathroom' || type === 'utility' || type === 'balcony' ? base : chosen;
}

export const wallFor = (style: DesignIntent['style']): string =>
  style?.walls ? WALL_STYLE[style.walls] : 'paint-white';
