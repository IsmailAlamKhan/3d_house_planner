import type { EffectComposer } from 'postprocessing';

/** The live post-processing composer (while presentation effects are on), so exports can render through it. */
let current: EffectComposer | null = null;
export const setComposer = (c: EffectComposer | null): void => {
  current = c;
};
export const getComposer = (): EffectComposer | null => current;
