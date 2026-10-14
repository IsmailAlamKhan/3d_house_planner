/**
 * Which real models of the asset pack have arrived. Kept in its own tiny module (no imports) so the scene builder can
 * read it without pulling in the whole pack loader.
 */
const epochs = new Map<string, number>();

/** Changes when the real model of a catalogue item arrives, so cached scene parts of that item are rebuilt. */
export const packEpoch = (catalogId: string): number => epochs.get(catalogId) ?? 0;

export const bumpPackEpoch = (catalogId: string): void => {
  epochs.set(catalogId, packEpoch(catalogId) + 1);
};
