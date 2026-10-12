import type { Project } from '../types';
import { ModelError } from './common';

/** Sets (or, for an empty/zero price, clears) the unit cost of a bill-of-materials line. */
export function setUnitCost(p: Project, key: string, value: number): void {
  if (!Number.isFinite(value) || value < 0)
    throw new ModelError('A unit cost must be zero or more', 'err.unitCost');
  if (value === 0) delete p.costs.unitCosts[key];
  else p.costs.unitCosts[key] = value;
}

export function setCurrency(p: Project, currency: string): void {
  if (!currency.trim()) throw new ModelError('Choose a currency', 'err.currency');
  p.costs.currency = currency.trim().toUpperCase();
}
