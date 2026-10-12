import { useSyncExternalStore } from 'react';
import { bn } from './bn';
import { en, type TranslationKey, type Translations } from './en';

/** The languages the app speaks. */
const dictionaries: Record<string, Translations> = { en, bn };

let current = 'en';
const listeners = new Set<() => void>();

export function setLanguage(lang: string): void {
  if (!dictionaries[lang] || lang === current) return;
  current = lang;
  listeners.forEach((l) => l());
}

export function registerLanguage(lang: string, dict: Translations): void {
  dictionaries[lang] = dict;
}

export function getLanguage(): string {
  return current;
}

export function t(key: TranslationKey): string {
  return dictionaries[current]?.[key] ?? en[key];
}

/** Translates a key and fills `{name}` placeholders. */
export function tf(key: TranslationKey, vars: Record<string, string | number>): string {
  return t(key).replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** React hook: re-renders when the language changes and returns `t`. */
export function useT(): typeof t {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
  return t;
}

export type { TranslationKey, Translations };

const LOCALES: Record<string, string> = { en: 'en-US', bn: 'bn-BD' };
const formatters = new Map<string, Intl.NumberFormat>();

/** BCP-47 tag of the current language (Bengali numerals come from `bn-BD`). */
export const localeTag = (): string => LOCALES[current] ?? 'en-US';

/** A number in the current language: "12.5" or "১২.৫", with a fixed number of decimals. */
export function fmtNum(value: number, digits = 1): string {
  const key = `${localeTag()}:${digits}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(localeTag(), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formatters.set(key, f);
  }
  return f.format(value);
}
