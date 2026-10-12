import { useSyncExternalStore } from 'react';
import { en, type TranslationKey, type Translations } from './en';

/** Register additional languages here (prompt 11 adds one). */
const dictionaries: Record<string, Translations> = { en };

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
