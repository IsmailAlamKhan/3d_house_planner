import type { Units } from '../model/types';

const FT = 0.3048;
const IN = 0.0254;

export const metersToFeet = (m: number): number => m / FT;

/** Formats a length: `3.45 m` or `11′ 4″`. */
export function formatLength(m: number, units: Units, digits = 2): string {
  if (units === 'metric') return `${m.toFixed(digits)} m`;
  const totalIn = Math.round(m / IN);
  const sign = totalIn < 0 ? '-' : '';
  const abs = Math.abs(totalIn);
  return `${sign}${Math.floor(abs / 12)}′ ${abs % 12}″`;
}

/** Formats an area: `12.0 m²` or `129 ft²`. */
export function formatArea(m2: number, units: Units): string {
  return units === 'metric' ? `${m2.toFixed(1)} m²` : `${Math.round(m2 / (FT * FT))} ft²`;
}

/**
 * Parses what a person types as a length and returns meters (or null if unreadable).
 * Metric: `3.5`, `3,5`, `350cm`, `3.5m`. Imperial: `10`, `10.5ft`, `10'6"`, `10' 6`, `126in`.
 * A bare number means meters (metric) or feet (imperial).
 */
export function parseLength(text: string, units: Units): number | null {
  const s = text.trim().toLowerCase().replace(',', '.').replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  if (!s) return null;
  let m = /^(-?\d*\.?\d+)\s*cm$/.exec(s);
  if (m) return Number(m[1]) / 100;
  m = /^(-?\d*\.?\d+)\s*mm$/.exec(s);
  if (m) return Number(m[1]) / 1000;
  m = /^(-?\d*\.?\d+)\s*m$/.exec(s);
  if (m) return Number(m[1]);
  m = /^(-?\d*\.?\d+)\s*(?:in|")$/.exec(s);
  if (m) return Number(m[1]) * IN;
  m = /^(-?\d*\.?\d+)\s*(?:ft|')\s*(?:(\d*\.?\d+)\s*(?:in|")?)?$/.exec(s);
  if (m) return (Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0)) * FT;
  m = /^-?\d*\.?\d+$/.exec(s);
  if (m) return units === 'metric' ? Number(s) : Number(s) * FT;
  return null;
}

/** Small lengths (wall thickness): centimeters or inches. */
export const smallUnitLabel = (units: Units): string => (units === 'metric' ? 'cm' : 'in');
export const metersToSmall = (m: number, units: Units): number =>
  units === 'metric' ? Math.round(m * 1000) / 10 : Math.round((m / IN) * 10) / 10;
export const smallToMeters = (v: number, units: Units): number =>
  units === 'metric' ? v / 100 : v * IN;
