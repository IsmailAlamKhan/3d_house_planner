import type { Group } from 'three';
import type { ReactNode } from 'react';
import type { TranslationKey } from '../i18n';
import type { OpeningKind } from '../model/types';

export type CatalogCategory =
  | 'doors'
  | 'windows'
  | 'living'
  | 'dining'
  | 'bedroom'
  | 'kitchen'
  | 'bathroom'
  | 'outdoor'
  | 'decor'
  | 'custom'
  | 'other';

export const CATEGORIES: CatalogCategory[] = [
  'doors',
  'windows',
  'living',
  'dining',
  'bedroom',
  'kitchen',
  'bathroom',
  'outdoor',
  'decor',
  'custom',
  'other',
];

/**
 * - `wall`: doors and windows — become `Opening`s that cut the wall.
 * - `floor`: stand on the floor (`Item`).
 * - `wall-mounted`: hang on a wall at `mountHeight` (`Item`, always back-to-wall).
 * - `ceiling`: fixed to the ceiling (`Item`).
 */
export type Placement = 'wall' | 'floor' | 'ceiling' | 'wall-mounted';

export type PropValue = string | number | boolean;
export type Props = Record<string, PropValue>;

export interface Size {
  /** Width (plan x, along the item's own x axis). */
  w: number;
  /** Depth (plan y). */
  d: number;
  /** Height (up). */
  h: number;
}

export interface PropOption {
  value: string;
  label: TranslationKey;
}

/** Schema of one user-adjustable property. */
export type PropSpec =
  | { key: string; label: TranslationKey; kind: 'color' }
  | { key: string; label: TranslationKey; kind: 'select'; options: PropOption[] }
  | { key: string; label: TranslationKey; kind: 'boolean' }
  | { key: string; label: TranslationKey; kind: 'number'; min: number; max: number; step: number };

/** Extra context for wall-hosted entries (doors/windows). */
export interface BuildCtx {
  swing?: 'left' | 'right' | 'none';
  flip?: boolean;
  /** Show door leaves ajar. */
  open?: boolean;
  /** Which side of the wall (local z sign) is the building exterior (bay windows project that way). */
  outward?: 1 | -1;
}

export interface CatalogEntry {
  catalogId: string;
  nameKey: TranslationKey;
  /** The user's own name for an imported model (shown instead of the translated `nameKey`). */
  customName?: string;
  /** Imported models: resolves when the model file has been loaded (its thumbnail can be drawn then). */
  ready?: Promise<unknown>;
  category: CatalogCategory;
  placement: Placement;
  /** For wall entries: the opening kind this creates. */
  openingKind?: OpeningKind;
  /** Natural size. Items scale relative to this; openings use it as the default width/height (d = wall thickness). */
  defaultSize: Size;
  /** Default sill height for windows (m). */
  sill?: number;
  /** Height above the floor at which wall-mounted items hang (m). */
  mountHeight?: number;
  /** Floor items normally snap back-to-wall when dropped near one; set false for free-standing pieces. */
  wallSnap?: boolean;
  /**
   * A light fixture. `y` is the light height above the item's origin; `lumens` and `kelvin` are the defaults (an item
   * can override them with its own `lumens` / `kelvin` / `beam` props); `beam` (degrees) makes it a spotlight.
   */
  lamp?: { y: (size: Size) => number; lumens: number; kelvin: number; beam?: number };
  /** Resizing limits as multiples of the default size. */
  minScale?: number;
  maxScale?: number;
  props: PropSpec[];
  defaults: Props;
  /**
   * Builds the 3D model. Origin = bottom-center of the footprint, x = width, z = depth (front faces +z), y = up.
   * For wall entries the origin is the bottom-center of the opening and `d` is the wall thickness.
   */
  build3D(props: Props, size: Size, ctx?: BuildCtx): Group;
  /** 2D plan symbol in meters, origin at the center, x = width, y = depth (front toward +y). */
  draw2D(props: Props, size: Size, ctx?: BuildCtx): ReactNode;
}

/** Fills in default prop values for anything the item doesn't override. */
export const withDefaults = (entry: CatalogEntry, props: Props): Props => ({
  ...entry.defaults,
  ...props,
});
