import { describe, expect, it } from 'vitest';
import { getLanguage, t } from './index';

describe('i18n', () => {
  it('defaults to English', () => {
    expect(getLanguage()).toBe('en');
    expect(t('view.3d')).toBe('3D');
  });
});

import { afterEach } from 'vitest';
import { bn } from './bn';
import { en } from './en';
import { fmtNum, setLanguage, tf } from './index';
import { formatArea, formatLength } from '../ui/units';

describe('Bengali', () => {
  afterEach(() => setLanguage('en'));

  it('translates every English string, with the same {placeholders}', () => {
    const missing = Object.keys(en).filter((k) => !(k in bn));
    expect(missing).toEqual([]);
    for (const [k, v] of Object.entries(en)) {
      const a = [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const b = [...bn[k as keyof typeof bn].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(b, k).toEqual(a);
    }
    // Nothing is left in English by mistake (a handful of strings are identical on purpose).
    const same = Object.keys(en).filter(
      (k) =>
        bn[k as keyof typeof bn] === en[k as keyof typeof en] &&
        /[A-Za-z]{4,}/.test(en[k as keyof typeof en].replace(/\{\w+\}/g, '')),
    );
    expect(same).toEqual([]);
  });

  it('switches the language of t() and tf()', () => {
    expect(t('topbar.undo')).toBe('Undo');
    setLanguage('bn');
    expect(getLanguage()).toBe('bn');
    expect(t('topbar.undo')).toBe('আনডু');
    expect(tf('notes.open', { n: 3 })).toContain('3');
    setLanguage('en');
    expect(t('topbar.undo')).toBe('Undo');
  });

  it('formats numbers and units per language', () => {
    expect(formatLength(3.456, 'metric')).toBe('3.46 m');
    expect(formatArea(12.34, 'metric')).toBe('12.3 m²');
    setLanguage('bn');
    expect(fmtNum(12.5, 1)).toBe('১২.৫');
    expect(formatLength(3.456, 'metric')).toBe('৩.৪৬ মি');
    expect(formatArea(12.34, 'metric')).toBe('১২.৩ মি²');
    expect(formatLength(3.3, 'imperial')).toBe('১০′ ১০″');
  });

  it('every Bengali string is written in Bengali script (digits, punctuation and brand names aside)', () => {
    const noBengali = Object.entries(bn).filter(
      ([k, v]) =>
        /\p{L}/u.test(v.replace(/\{\w+\}/g, '')) &&
        !/[ঀ-৿]/.test(v.replace(/\{\w+\}/g, '')) &&
        !/^(view\.|wiz\.ph|cmd\.lang|unit\.)/.test(k),
    );
    expect(noBengali.map(([k]) => k)).toEqual([]);
  });
});
