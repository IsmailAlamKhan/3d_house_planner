import { furnitureEntries } from './entries/furniture';
import { kitchenBathEntries } from './entries/kitchenBath';
import { openingEntries } from './entries/openings';
import type { CatalogCategory, CatalogEntry, Size } from './types';
import type { OpeningKind } from '../model/types';

export * from './types';
export { catalogNames } from './names';

/** Every catalog entry, in the order they appear in the library. */
export const CATALOG: CatalogEntry[] = [
  ...openingEntries(),
  ...furnitureEntries(),
  ...kitchenBathEntries(),
];

const byId = new Map(CATALOG.map((e) => [e.catalogId, e]));

export const getEntry = (catalogId: string): CatalogEntry | undefined => byId.get(catalogId);

export const entriesByCategory = (category: CatalogCategory): CatalogEntry[] =>
  CATALOG.filter((e) => e.category === category);

/** Used when an opening refers to an id the catalog doesn't know (e.g. an imported file). */
const FALLBACK_BY_KIND: Record<OpeningKind, string> = {
  door: 'door-single',
  window: 'window-casement',
  archway: 'archway',
};
export const entryForOpening = (catalogId: string, kind: OpeningKind): CatalogEntry =>
  byId.get(catalogId) ?? byId.get(FALLBACK_BY_KIND[kind])!;

/** Styles a user can switch an opening to: every wall entry of the same kind. */
export const openingStyles = (kind: OpeningKind): CatalogEntry[] =>
  CATALOG.filter((e) => e.placement === 'wall' && e.openingKind === kind);

/** Actual footprint/height of an item: catalog default size × the item's scale (x = width, y = height, z = depth). */
export function itemSize(entry: CatalogEntry, scale: { x: number; y: number; z: number }): Size {
  return {
    w: entry.defaultSize.w * scale.x,
    h: entry.defaultSize.h * scale.y,
    d: entry.defaultSize.d * scale.z,
  };
}

/** The colour property that tints an item's main surface — what a library material replaces. */
export const surfaceKey = (entry: CatalogEntry): string | undefined =>
  entry.props.find((p) => p.kind === 'color')?.key;
