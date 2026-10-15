import type { Emphasis } from './weights';

/** The quick "improve this" choices offered under a candidate. */
export const IMPROVE_CHIPS: { id: keyof Emphasis; key: `layout.improve.${string}` }[] = [
  { id: 'daylight', key: 'layout.improve.daylight' },
  { id: 'corridor', key: 'layout.improve.corridor' },
  { id: 'straight', key: 'layout.improve.straight' },
  { id: 'privacy', key: 'layout.improve.privacy' },
  { id: 'wet', key: 'layout.improve.wet' },
  { id: 'view', key: 'layout.improve.view' },
];

const RULES: [keyof Emphasis, RegExp][] = [
  ['daylight', /\b(light|bright|window|sun|daylight|dark|gloomy)/i],
  ['corridor', /\b(corridor|passage|circulation|waste|hallway|less hall)/i],
  [
    'straight',
    /\b(straight|simple|clean|regular|boxy|rectang|thin|narrow room|proportion|long and)/i,
  ],
  ['privacy', /\b(privat|quiet|away from|far from|peaceful|noise)/i],
  ['wet', /\b(plumb|pipe|bathroom.*(together|stack|above)|wet room|stack)/i],
  ['view', /\b(garden|view|pool|lawn|outlook|open to)/i],
  ['adjacency', /\b(next to|beside|adjacent|attached|en-?suite|connected|close to)/i],
  ['area', /\b(bigger|larger|spacious|roomy|size|area)/i],
];

/**
 * Reads what a person wants improved ("more daylight in the bedrooms", "less wasted corridor") into score-term
 * emphasis. Several things can be asked at once; an empty result means nothing was recognised.
 */
export function parseImprove(text: string): Emphasis {
  const out: Emphasis = {};
  for (const [key, re] of RULES) if (re.test(text)) out[key] = 3;
  return out;
}

/** Adds a new request to what was asked before (asking twice makes it count more). */
export function mergeEmphasis(before: Emphasis | undefined, more: Emphasis): Emphasis {
  const out: Emphasis = { ...before };
  for (const [k, v] of Object.entries(more) as [keyof Emphasis, number][])
    out[k] = Math.min(12, (out[k] ?? 1) * (v ?? 1));
  return out;
}
