import { useEffect, useState } from 'react';
import type { Underlay } from '../model/types';
import { type Rectified, rectifyKey, rectifyUnderlay } from './rectify';
import { loadUnderlayBitmap } from './source';

const cache = new Map<string, Promise<Rectified>>();
const MAX_CACHED = 6;

/** The warped picture of an underlay (computed once per setup, shared by the plan, the 3D decal and the compare view). */
export function rectified(u: Underlay): Promise<Rectified> {
  const key = rectifyKey(u);
  let p = cache.get(key);
  if (!p) {
    p = loadUnderlayBitmap(u.source).then(async (bmp) => {
      try {
        return await rectifyUnderlay(u, bmp);
      } finally {
        bmp.close();
      }
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    while (cache.size > MAX_CACHED) {
      const oldest = cache.keys().next().value as string;
      void cache.get(oldest)?.then((r) => URL.revokeObjectURL(r.url));
      cache.delete(oldest);
    }
  }
  return p;
}

export type RectifiedState =
  { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & Rectified);

/** React hook: the warped picture for `u` (undefined = no picture). */
export function useRectified(u: Underlay | undefined): RectifiedState | undefined {
  const key = u ? rectifyKey(u) : '';
  const [state, setState] = useState<{ key: string; value: RectifiedState }>();
  useEffect(() => {
    if (!u) return;
    let live = true;
    rectified(u).then(
      (r) => live && setState({ key, value: { status: 'ready', ...r } }),
      (e: unknown) =>
        live &&
        setState({
          key,
          value: { status: 'error', message: e instanceof Error ? e.message : String(e) },
        }),
    );
    return () => {
      live = false;
    };
    // `u` is represented by its key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!u) return undefined;
  return state && state.key === key ? state.value : { status: 'loading' };
}
