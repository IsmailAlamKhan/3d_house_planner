import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

const css = readFileSync('src/theme.css', 'utf8');

function tokens(selector: string): Map<string, [number, number, number]> {
  const block = css.slice(css.indexOf(selector));
  const body = block.slice(block.indexOf('{') + 1, block.indexOf('}'));
  const out = new Map<string, [number, number, number]>();
  for (const m of body.matchAll(/--([\w-]+):\s*(\d+) (\d+) (\d+);/g))
    out.set(m[1]!, [Number(m[2]), Number(m[3]), Number(m[4])]);
  return out;
}

const luminance = ([r, g, b]: [number, number, number]) => {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const themes = { light: tokens(':root {'), dark: tokens(":root[data-theme='dark']") };

/** [text colour, background] pairs that the interface actually puts together (small text needs 4.5:1, WCAG AA). */
const PAIRS: [string, string][] = [];
for (const bg of ['white', 'slate-50', 'slate-100', 'slate-200'])
  for (const fg of ['slate-500', 'slate-600', 'slate-700', 'slate-800']) PAIRS.push([fg, bg]);
PAIRS.push(
  ['sky-700', 'white'],
  ['sky-700', 'sky-100'],
  ['sky-700', 'sky-50'],
  ['sky-800', 'sky-100'],
  ['sky-800', 'sky-50'],
  ['red-600', 'white'],
  ['red-700', 'white'],
  ['red-700', 'red-50'],
  ['red-900', 'red-50'],
  ['amber-700', 'white'],
  ['amber-800', 'amber-50'],
  ['amber-800', 'amber-100'],
  ['amber-900', 'amber-50'],
  ['amber-900', 'amber-100'],
  ['green-700', 'white'],
  ['green-800', 'green-50'],
  ['emerald-800', 'emerald-100'],
  ['orange-700', 'white'],
  ['white', 'sky-700'],
  ['white', 'sky-800'],
  ['white', 'slate-700'],
  ['white', 'slate-800'],
  ['white', 'red-700'],
  ['white', 'amber-700'],
  ['white', 'orange-700'],
);

describe('colour themes', () => {
  it('define the same tokens in light and dark', () => {
    expect([...themes.dark.keys()].sort()).toEqual([...themes.light.keys()].sort());
    expect(themes.light.get('white')).toEqual([255, 255, 255]);
  });

  for (const theme of ['light', 'dark'] as const)
    it(`${theme}: text/background pairs meet WCAG AA (4.5:1)`, () => {
      const t = themes[theme];
      const failures = PAIRS.map(([fg, bg]) => {
        const r = contrast(t.get(fg)!, t.get(bg)!);
        return r >= 4.5 ? null : `${fg} on ${bg}: ${r.toFixed(2)}`;
      }).filter(Boolean);
      expect(failures).toEqual([]);
    });
});
