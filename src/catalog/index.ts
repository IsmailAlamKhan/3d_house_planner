import { furnitureEntries } from './entries/furniture';
import { kitchenBathEntries } from './entries/kitchenBath';
import { outdoorEntries } from './entries/outdoor';
import { decorEntries } from './entries/decor';
import { openingEntries } from './entries/openings';
import type { CatalogCategory, CatalogEntry, PropSpec, Size } from './types';
import type { OpeningKind } from '../model/types';
import { type TranslationKey, t } from '../i18n';

export * from './types';
export { catalogNames } from './names';

/** Every catalog entry, in the order they appear in the library. */
/** Light fixtures get adjustable brightness (lumens), colour temperature (kelvin) and, for spotlights, beam angle. */
function withLampProps(e: CatalogEntry): CatalogEntry {
  if (!e.lamp) return e;
  const beam = e.lamp.beam;
  const extra: PropSpec[] = [
    { key: 'lumens', label: 'cprop.lumens', kind: 'number', min: 50, max: 5000, step: 50 },
    { key: 'kelvin', label: 'cprop.kelvin', kind: 'number', min: 2000, max: 6500, step: 100 },
    ...(beam === undefined
      ? []
      : [
          {
            key: 'beam',
            label: 'cprop.beam',
            kind: 'number',
            min: 15,
            max: 120,
            step: 5,
          } as PropSpec,
        ]),
  ];
  return {
    ...e,
    props: [...e.props, ...extra],
    defaults: {
      ...e.defaults,
      lumens: e.lamp.lumens,
      kelvin: e.lamp.kelvin,
      ...(beam === undefined ? {} : { beam }),
    },
  };
}

export const CATALOG: CatalogEntry[] = [
  ...openingEntries(),
  ...furnitureEntries(),
  ...kitchenBathEntries(),
  ...outdoorEntries(),
  ...decorEntries(),
].map(withLampProps);

const byId = new Map(CATALOG.map((e) => [e.catalogId, e]));

/** Name of an entry as shown to the user: the user's own name for imported models, else the translation. */
export const entryName = (e: CatalogEntry, tr: (key: TranslationKey) => string = t): string =>
  e.customName ?? tr(e.nameKey as TranslationKey);

/** Replaces the user's imported models in the catalogue (they come from the server and can change at any time). */
export function registerCustomEntries(entries: CatalogEntry[]): void {
  for (let i = CATALOG.length - 1; i >= 0; i--)
    if (CATALOG[i]!.catalogId.startsWith('custom:')) {
      byId.delete(CATALOG[i]!.catalogId);
      CATALOG.splice(i, 1);
    }
  for (const e of entries) {
    CATALOG.push(e);
    byId.set(e.catalogId, e);
  }
}

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
