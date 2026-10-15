import type { DesignIntent } from './schemas';

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

const asNumber = (s: string): number | undefined =>
  /^\d+$/.test(s) ? Number(s) : WORD_NUMBERS[s.toLowerCase()];

/**
 * Things the brief clearly asks for that the model's design leaves out (it sometimes returns a single floor for a
 * "duplex" or fewer bedrooms than requested). The lines are written for the model's repair round-trip.
 */
export function briefProblems(brief: string, intent: DesignIntent): string[] {
  const out: string[] = [];
  const wantsTwoLevels =
    /\b(duplex|upstairs|two[- ]stor(?:e)?y|2[- ]stor(?:e)?y|two floors?|2 floors?|two levels?|2 levels?)\b/i.test(
      brief,
    );
  if (wantsTwoLevels && intent.levels.length < 2)
    out.push(
      'levels: the brief asks for a duplex, so give exactly 2 levels — living areas on the ground floor, bedrooms upstairs.',
    );
  const m = /\b(\d+|one|two|three|four|five|six)[- ]*(?:bed(?:room)?s?)\b/i.exec(brief);
  const wanted = m ? asNumber(m[1]!) : undefined;
  if (wanted !== undefined) {
    const have = intent.levels.flatMap((l) => l.rooms).filter((r) => r.type === 'bedroom').length;
    if (have < wanted)
      out.push(`rooms: the brief asks for ${wanted} bedrooms but the design has only ${have}.`);
  }
  return out;
}

/**
 * A model's design sometimes forgets the outdoor features the brief names (the pool or the garage never appeared on
 * the plot). For a villa, every outdoor zone the keyword reader finds in the brief but the design lacks is added,
 * and the car count follows the brief.
 */
export function completeSite(intent: DesignIntent, fromBrief: DesignIntent): DesignIntent {
  const wanted = fromBrief.site;
  if (!wanted) return intent;
  const have = intent.site?.zones ?? [];
  const missing = wanted.zones.filter((z) => !have.some((h) => h.type === z.type));
  const cars = wanted.cars ?? intent.site?.cars;
  if (!missing.length && cars === intent.site?.cars) return intent;
  return {
    ...intent,
    strategy: intent.strategy,
    site: { zones: [...have, ...missing], cars },
  };
}
