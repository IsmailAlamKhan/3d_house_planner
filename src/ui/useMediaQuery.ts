import { useSyncExternalStore } from 'react';

/** Re-renders when a CSS media query starts or stops matching (false where matchMedia does not exist). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m =
        typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query) : null;
      m?.addEventListener('change', cb);
      return () => m?.removeEventListener('change', cb);
    },
    () =>
      typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false,
    () => false,
  );
}
