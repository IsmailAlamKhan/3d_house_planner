import { formatLength } from '../../ui/units';
import type { Units } from '../../model/types';
import type { Vec3 } from './views';

export const distance3 = (a: Vec3, b: Vec3): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const midpoint3 = (a: Vec3, b: Vec3): Vec3 => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
  (a[2] + b[2]) / 2,
];

export interface Measurement {
  a: Vec3;
  b: Vec3;
}

/** Label for a 3D measurement: the straight-line distance, plus its horizontal and vertical parts when they differ. */
export function measurementLabel(m: Measurement, units: Units): string {
  const total = distance3(m.a, m.b);
  const horizontal = Math.hypot(m.a[0] - m.b[0], m.a[2] - m.b[2]);
  const vertical = Math.abs(m.a[1] - m.b[1]);
  const main = formatLength(total, units);
  if (horizontal < 0.02 || vertical < 0.02) return main;
  return `${main} (↔ ${formatLength(horizontal, units)}, ↕ ${formatLength(vertical, units)})`;
}
