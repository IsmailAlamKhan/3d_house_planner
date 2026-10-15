import { TEMPLATES, VILLA_TEMPLATE } from '../templates';
import type { DesignBrief, Project } from '../model/types';
import { applyBriefOps, intentToBrief, projectToBrief } from './brief';
import { parseCommand } from './commands';
import { emptyBrief, makeFeature, makeRoom } from './program';

/**
 * The Reference Villa (reference/villa-reference.png, traced in prompt 18) as a brief: one level, a foyer and a
 * large living & dining hall in the middle, bedroom suites in one wing, kitchen, gym, sauna and spa in the other,
 * a pool with a deck, a covered outdoor dining area, a play area, a garden and covered parking for two cars.
 */
export function referenceBrief(): DesignBrief {
  const r = makeRoom;
  const program = [
    r('foyer', { area: 7.4 }),
    r('living', { name: 'Living & dining', area: 46.8, next: ['Kitchen'] }),
    r('kitchen', { area: 17.8, next: ['Living & dining'] }),
    r('utility', { area: 4.5 }),
    r('bedroom', { name: 'Master bedroom', area: 15.6, next: ['Master bath', 'Walk-in closet'] }),
    r('bathroom', { name: 'Master bath', area: 4.5, next: ['Master bedroom'] }),
    r('walk-in-closet', { name: 'Walk-in closet', area: 4.5, next: ['Master bedroom'] }),
    r('bedroom', { name: 'Bedroom 2', area: 15.6, next: ['Bath 2'] }),
    r('bathroom', { name: 'Bath 2', area: 4.5, next: ['Bedroom 2'] }),
    r('bedroom', { name: 'Bedroom 3', area: 15.6, next: ['Bath 3'] }),
    r('bathroom', { name: 'Bath 3', area: 4.5, next: ['Bedroom 3'] }),
    r('bedroom', { name: 'Guest room', area: 14.3, next: ['Guest bath'] }),
    r('bathroom', { name: 'Guest bath', area: 3.7, next: ['Guest room'] }),
    r('game-room', { name: 'Gaming room', area: 17.8 }),
    r('gym', { area: 15.6 }),
    r('sauna', { area: 4.5 }),
    r('spa', { area: 4.5 }),
  ];
  return emptyBrief({
    title: 'Like the reference villa',
    levels: 1,
    kind: 'villa',
    program,
    features: [
      makeFeature('garden', { side: 'front' }),
      makeFeature('lawn', { side: 'back' }),
      makeFeature('pool'),
      makeFeature('deck'),
      makeFeature('patio', { covered: true, name: 'Outdoor dining' }),
      makeFeature('play', { name: 'Kids play area' }),
      makeFeature('parking', { covered: true }),
    ],
    cars: 2,
    style: { preset: 'modern-luxury', keywords: ['warm', 'reference villa'], palette: [] },
    budget: 'high',
    priorities: ['light', 'garden', 'open-plan'],
    assumptions: [
      {
        key: 'reference',
        text: 'The reference villa: a foyer, central hall, three suites, gym, sauna, spa and a pool',
      },
    ],
  });
}

export type BaseKind = 'project' | 'reference' | 'template';

/** The starting brief for "like this, but …". */
export function baseBrief(
  kind: BaseKind,
  opts: { project?: Project; templateId?: string } = {},
): DesignBrief {
  if (kind === 'reference') return referenceBrief();
  if (kind === 'template') {
    const tpl =
      [...TEMPLATES, VILLA_TEMPLATE].find((t) => t.id === opts.templateId) ?? TEMPLATES[0]!;
    return intentToBrief(tpl.intent, { villa: tpl.kind === 'villa' });
  }
  return opts.project ? projectToBrief(opts.project) : emptyBrief();
}

/** The base with the person's changes applied ("but 2 storeys, 4 bedrooms, no gaming room, smaller pool"). */
export function likeThisBut(
  base: DesignBrief,
  request: string,
): { brief: DesignBrief; notes: string[]; understood: boolean } {
  const cmd = parseCommand(request, base);
  const applied = applyBriefOps(base, cmd.ops);
  return {
    brief: { ...applied.brief, source: request, assumptions: [] },
    notes: applied.notes,
    understood: !cmd.unknown,
  };
}
