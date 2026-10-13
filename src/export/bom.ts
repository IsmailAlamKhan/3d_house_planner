import { clearArea } from '../checks/areas';
import { isVoidRoom } from '../checks/voidRoom';
import { entryName, getEntry } from '../catalog';
import { t } from '../i18n';
import { materialDefName, resolveDef } from '../materials';
import { wallHeight, wallLength } from '../model/integrity';
import type { Project } from '../model/types';

export type BomCategory =
  'walls' | 'floors' | 'ceilings' | 'openings' | 'furniture' | 'stairs' | 'columns';

export const BOM_CATEGORIES: BomCategory[] = [
  'walls',
  'floors',
  'ceilings',
  'openings',
  'furniture',
  'stairs',
  'columns',
];

export interface BomLine {
  /** Stable key — also where the unit cost is stored in `project.costs.unitCosts`. */
  key: string;
  category: BomCategory;
  label: string;
  unit: 'm²' | 'pcs';
  quantity: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

const materialLabel = (key: string): string => {
  const def = resolveDef(key);
  const name = materialDefName(def);
  return def.nameKey === 'mat.paint-custom' ? `${name} ${def.color}` : name;
};

/**
 * Quantities taken off the model: wall area per material (each face, minus the doors and windows cut through it),
 * floor and ceiling area per material, item / opening / column / stair counts. Wall areas use centre-line lengths,
 * so corners are counted once per face, which is close enough for ordering paint and tile.
 */
export function billOfMaterials(project: Project): BomLine[] {
  const acc = new Map<string, BomLine>();
  const add = (
    key: string,
    category: BomCategory,
    label: string,
    unit: BomLine['unit'],
    quantity: number,
  ) => {
    if (quantity <= 0) return;
    const cur = acc.get(key);
    if (cur) cur.quantity += quantity;
    else acc.set(key, { key, category, label, unit, quantity });
  };

  for (const wall of project.walls) {
    const cut = project.openings
      .filter((o) => o.wallId === wall.id)
      .reduce((s, o) => s + o.width * o.height, 0);
    const face = Math.max(0, wallLength(wall) * wallHeight(project, wall) - cut);
    for (const m of [wall.materialInside, wall.materialOutside])
      add(`wall:${m}`, 'walls', materialLabel(m), 'm²', face);
  }

  for (const room of project.rooms) {
    if (isVoidRoom(project, room)) continue;
    const area = clearArea(project, room);
    add(`floor:${room.floorMaterial}`, 'floors', materialLabel(room.floorMaterial), 'm²', area);
    if (!room.doubleHeight)
      add(
        `ceiling:${room.ceilingMaterial}`,
        'ceilings',
        materialLabel(room.ceilingMaterial),
        'm²',
        area,
      );
  }

  for (const o of project.openings) {
    const entry = getEntry(o.catalogId);
    add(`opening:${o.catalogId}`, 'openings', entry ? entryName(entry) : o.catalogId, 'pcs', 1);
  }
  for (const item of project.items) {
    const entry = getEntry(item.catalogId);
    add(`item:${item.catalogId}`, 'furniture', entry ? entryName(entry) : item.catalogId, 'pcs', 1);
  }
  for (const s of project.stairs)
    add(`stair:${s.type}`, 'stairs', `${t('bom.stair')} (${s.type})`, 'pcs', 1);
  for (const c of project.columns)
    add(`column:${c.shape}`, 'columns', `${t('bom.column')} (${c.shape})`, 'pcs', 1);

  return [...acc.values()]
    .map((l) => ({ ...l, quantity: l.unit === 'm²' ? r2(l.quantity) : l.quantity }))
    .sort(
      (a, b) =>
        BOM_CATEGORIES.indexOf(a.category) - BOM_CATEGORIES.indexOf(b.category) ||
        b.quantity - a.quantity ||
        a.label.localeCompare(b.label),
    );
}

export interface PricedLine extends BomLine {
  unitCost: number;
  total: number;
}

export interface PricedBom {
  currency: string;
  lines: PricedLine[];
  byCategory: Record<BomCategory, number>;
  total: number;
}

/** The bill of materials with the project's unit costs applied. Lines without a price count as 0. */
export function priceBom(project: Project, lines = billOfMaterials(project)): PricedBom {
  const byCategory = Object.fromEntries(BOM_CATEGORIES.map((c) => [c, 0])) as Record<
    BomCategory,
    number
  >;
  const priced = lines.map((l) => {
    const unitCost = project.costs.unitCosts[l.key] ?? 0;
    const total = r2(l.quantity * unitCost);
    byCategory[l.category] += total;
    return { ...l, unitCost, total };
  });
  for (const c of BOM_CATEGORIES) byCategory[c] = r2(byCategory[c]);
  return {
    currency: project.costs.currency,
    lines: priced,
    byCategory,
    total: r2(priced.reduce((s, l) => s + l.total, 0)),
  };
}

const csvCell = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of the priced bill of materials: one row per line, subtotals per category, grand total. */
export function bomCsv(project: Project): string {
  const bom = priceBom(project);
  const rows: (string | number)[][] = [
    [
      'Category',
      'Item',
      'Quantity',
      'Unit',
      `Unit cost (${bom.currency})`,
      `Total (${bom.currency})`,
    ],
  ];
  for (const c of BOM_CATEGORIES) {
    const lines = bom.lines.filter((l) => l.category === c);
    if (!lines.length) continue;
    for (const l of lines) rows.push([c, l.label, l.quantity, l.unit, l.unitCost, l.total]);
    rows.push([c, 'Subtotal', '', '', '', bom.byCategory[c]]);
  }
  rows.push(['', 'TOTAL', '', '', '', bom.total]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export const CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'INR',
  'BDT',
  'JPY',
  'CNY',
  'AUD',
  'CAD',
  'AED',
] as const;
