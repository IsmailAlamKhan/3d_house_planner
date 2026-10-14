import type { ReferenceSpecInput } from '../../reference/spec';
import type { Candidate } from './assemble';
import { type PlanRect, cleanup } from './cleanup';
import type { FoundItem } from './items';
import { specOrigin, toSpec } from './toSpec';

/** The rooms of the review screen: what the model found, tidied, as editable rectangles in feet. */
export function initialReview(
  candidates: Candidate[],
  ftPerPx: number,
): { rooms: PlanRect[]; notes: string[] } {
  const { rects, notes } = cleanup(candidates, { ftPerPx, fit: 'pictured' });
  return { rooms: rects, notes };
}

/** A review room back as a candidate (its box in "pixels" of 1 foot) so it can be cleaned up and fitted again. */
const asCandidate = (r: PlanRect): Candidate => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  type: r.type,
  box: [r.rect[0], r.rect[1], r.rect[0] + r.rect[2], r.rect[1] + r.rect[3]],
  ...(r.labelSize ? { labelSize: r.labelSize } : {}),
  confidence: r.confidence,
  source: r.source,
});

export type BuildMode = 'exact' | 'labelled' | 'pictured' | 'both';

/**
 * The reviewed rooms → a reference spec.
 *  - `exact`: the rectangles exactly as they are on the screen (the user's own edits are the truth);
 *  - `labelled`: every room at the size printed on its label; `pictured`: as drawn;
 *  - `both`: Option A (labelled) and Option B (pictured) in one project.
 * Furniture found in the picture follows its room (same place relative to the room's rectangle).
 */
export function specFromReview(
  rooms: PlanRect[],
  mode: BuildMode,
  opts: { items?: FoundItem[]; ftPerPx: number; name?: string },
): ReferenceSpecInput {
  return specAndOrigin(rooms, mode, opts).spec;
}

/** The same, and where the spec's (0, 0) is in the review's feet (to put the picture under the plan). */
export function specAndOrigin(
  rooms: PlanRect[],
  mode: BuildMode,
  opts: { items?: FoundItem[]; ftPerPx: number; name?: string },
): { spec: ReferenceSpecInput; origin: [number, number] } {
  const cands = rooms.map(asCandidate);
  const fit = (m: 'labelled' | 'pictured'): PlanRect[] =>
    cleanup(cands, { ftPerPx: 1, fit: m, grid: 0.25 }).rects;
  const designs: { letter: string; name: string; description: string; rects: PlanRect[] }[] =
    mode === 'exact'
      ? [
          {
            letter: 'A',
            name: 'As reviewed',
            description: 'The rooms exactly as reviewed.',
            rects: rooms,
          },
        ]
      : mode === 'labelled'
        ? [
            {
              letter: 'A',
              name: 'As labelled',
              description: 'Every room at the size printed on its label.',
              rects: fit('labelled'),
            },
          ]
        : mode === 'pictured'
          ? [
              {
                letter: 'A',
                name: 'As pictured',
                description: 'Proportions measured from the picture.',
                rects: fit('pictured'),
              },
            ]
          : [
              {
                letter: 'A',
                name: 'As labelled',
                description: 'Every room at the size printed on its label.',
                rects: fit('labelled'),
              },
              {
                letter: 'B',
                name: 'As pictured',
                description: 'Proportions measured from the picture.',
                rects: fit('pictured'),
              },
            ];
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const withItems = designs.map((d) => ({
    ...d,
    items: (opts.items ?? []).flatMap((it) => {
      const from = byId.get(it.candidateId);
      const to = d.rects.find((r) => r.id === it.candidateId);
      if (!from || !to) return [];
      const px = it.at[0] * opts.ftPerPx;
      const py = it.at[1] * opts.ftPerPx;
      // where in the room it stood (as drawn), carried over to the room's final rectangle
      const fx = Math.min(
        0.95,
        Math.max(0.05, (px - from.pictured[0]) / Math.max(0.5, from.pictured[2])),
      );
      const fy = Math.min(
        0.95,
        Math.max(0.05, (py - from.pictured[1]) / Math.max(0.5, from.pictured[3])),
      );
      return [
        {
          catalog: it.catalog,
          at: [to.rect[0] + fx * to.rect[2], to.rect[1] + fy * to.rect[3]] as [number, number],
        },
      ];
    }),
  }));
  const input = { options: withItems, name: opts.name };
  return { spec: toSpec(input), origin: specOrigin(input) };
}
