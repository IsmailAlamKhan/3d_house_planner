import { create } from 'zustand';
import { setLanguage } from '../i18n';

export type Language = 'en' | 'bn';
export type ThemeChoice = 'system' | 'light' | 'dark';
export type MotionChoice = 'system' | 'reduce' | 'full';

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'bn', label: 'বাংলা' },
];

const KEY = 'duplex-designer:prefs';

export interface Prefs {
  language: Language;
  theme: ThemeChoice;
  motion: MotionChoice;
  /** The first-run tour has been shown (or skipped). */
  tourSeen: boolean;
}

const defaults: Prefs = { language: 'en', theme: 'system', motion: 'system', tourSeen: false };

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Prefs>) } : defaults;
  } catch {
    return defaults;
  }
}

interface PrefsState extends Prefs {
  set: (patch: Partial<Prefs>) => void;
}

export const usePrefs = create<PrefsState>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    const { language, theme, motion, tourSeen } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ language, theme, motion, tourSeen }));
    } catch {
      // Preferences are a convenience only.
    }
  },
}));

const media = (q: string) =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(q)
    : null;

/** The theme actually shown ('system' follows the operating system). */
export const resolveTheme = (choice: ThemeChoice): 'light' | 'dark' =>
  choice === 'system'
    ? media('(prefers-color-scheme: dark)')?.matches
      ? 'dark'
      : 'light'
    : choice;

/** Whether animations should be skipped ('system' follows the operating system). */
export const resolveMotion = (choice: MotionChoice): 'reduce' | 'full' =>
  choice === 'system'
    ? media('(prefers-reduced-motion: reduce)')?.matches
      ? 'reduce'
      : 'full'
    : choice;

/** Puts language, theme and motion on <html> (CSS and fonts key off these attributes). */
export function applyPrefs(p: Prefs = usePrefs.getState()): void {
  const root = document.documentElement;
  root.lang = p.language;
  root.dataset.theme = resolveTheme(p.theme);
  root.dataset.motion = resolveMotion(p.motion);
  setLanguage(p.language);
}

export const prefersReducedMotion = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduce';

/** Applies the saved preferences and keeps them applied (also when the OS theme or motion setting changes). */
export function initPrefs(): () => void {
  applyPrefs();
  const unsubscribe = usePrefs.subscribe((s) => applyPrefs(s));
  const queries = [
    media('(prefers-color-scheme: dark)'),
    media('(prefers-reduced-motion: reduce)'),
  ];
  const onChange = () => applyPrefs();
  queries.forEach((q) => q?.addEventListener('change', onChange));
  return () => {
    unsubscribe();
    queries.forEach((q) => q?.removeEventListener('change', onChange));
  };
}
