import { COMPACT_SQUARE, DUPLEX_LOFT, DUPLEX_STACKED } from './compact';
import { VILLA_COURTYARD, VILLA_L_GARDEN } from './courtyard';
import { APARTMENT_DOUBLE, LINEAR_DOUBLE, LINEAR_SINGLE } from './linear';
import { DUPLEX_SPLIT } from './split';
import type { Archetype, ArchetypeInput, Candidate } from './types';
import { VILLA_WINGS } from './wings';

export type { Archetype, ArchetypeInput, Candidate, SkeletonRoom } from './types';
export { hallCandidates } from './compact';
export { wingsCandidate } from './wings';

/**
 * The plan types the layout engine chooses between. Each declares which building shapes, sizes and level counts it
 * suits and where the entrance, parking and garden go (see docs/ARCHITECTURE.md); `skeletons` asks the ones that
 * apply for their zone skeletons and the optimiser fills them with rooms.
 */
export const ARCHETYPES: Archetype[] = [
  DUPLEX_STACKED,
  DUPLEX_LOFT,
  DUPLEX_SPLIT,
  COMPACT_SQUARE,
  VILLA_WINGS,
  VILLA_COURTYARD,
  VILLA_L_GARDEN,
  LINEAR_DOUBLE,
  LINEAR_SINGLE,
  APARTMENT_DOUBLE,
];

export const archetypeById = (id: string): Archetype | undefined =>
  ARCHETYPES.find((a) => a.id === id);

/** Every skeleton the applicable archetypes propose for this shell. */
export function skeletons(input: ArchetypeInput, only?: string[]): Candidate[] {
  const out: Candidate[] = [];
  for (const a of ARCHETYPES) {
    if (only && !only.includes(a.id)) continue;
    if (!a.suits(input)) continue;
    out.push(...a.candidates(input));
  }
  return out;
}
