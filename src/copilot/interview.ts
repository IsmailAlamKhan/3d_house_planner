import type { DesignBrief } from '../model/types';
import { type BriefOp, applyBriefOps } from './brief';
import { parseCommand } from './commands';
import type { Known } from './text';
import { fitProgramToSize } from './program';
import { textToBrief } from './text';

export type QuestionId =
  'size' | 'levels' | 'household' | 'rooms' | 'features' | 'style' | 'budget' | 'priorities';

export interface Chip {
  id: string;
  /** Text key (`copilot.q.<question>.<chip>`). */
  key: string;
  /** What choosing it does to the brief. */
  ops: BriefOp[];
}

export interface Question {
  id: QuestionId;
  known: Known;
  /** The person may tick several chips. */
  multi: boolean;
  chips: Chip[];
  /** "Draw it": the person wants to draw the plot or shell instead of typing a size. */
  draw?: boolean;
}

const chip = (q: QuestionId, id: string, ops: BriefOp[] = []): Chip => ({
  id,
  key: `copilot.q.${q}.${id}`,
  ops,
});

/** The interview, in the order a person thinks about it. Each question is one tap or a few words. */
export const QUESTIONS: Question[] = [
  {
    id: 'size',
    known: 'size',
    multi: false,
    draw: true,
    chips: [
      chip('size', 'small', [{ op: 'setSize', width: 9, depth: 11, of: 'building' }]),
      chip('size', 'medium', [{ op: 'setSize', width: 12, depth: 14, of: 'building' }]),
      chip('size', 'large', [{ op: 'setSize', width: 16, depth: 18, of: 'building' }]),
    ],
  },
  {
    id: 'levels',
    known: 'levels',
    multi: false,
    chips: [
      chip('levels', 'one', [{ op: 'setLevels', levels: 1 }]),
      chip('levels', 'two', [{ op: 'setLevels', levels: 2 }]),
      chip('levels', 'three', [{ op: 'setLevels', levels: 3 }]),
    ],
  },
  {
    id: 'household',
    known: 'household',
    multi: false,
    chips: [
      chip('household', 'couple', [
        { op: 'setHousehold', adults: 2, children: 0 },
        { op: 'setBedrooms', count: 2 },
      ]),
      chip('household', 'family', [
        { op: 'setHousehold', adults: 2, children: 2 },
        { op: 'setBedrooms', count: 4 },
      ]),
      chip('household', 'elderly', [
        { op: 'setHousehold', adults: 2, elderly: 2 },
        {
          op: 'addRoom',
          type: 'bedroom',
          name: 'Parents room',
          area: 14,
          level: 0,
          next: ['Parents room bath'],
        },
        {
          op: 'addRoom',
          type: 'bathroom',
          name: 'Parents room bath',
          area: 5,
          level: 0,
          next: ['Parents room'],
        },
      ]),
      chip('household', 'guests', [
        { op: 'setHousehold', guests: true },
        { op: 'addRoom', type: 'bedroom', name: 'Guest room', area: 12, level: 0 },
      ]),
    ],
  },
  {
    id: 'rooms',
    known: 'rooms',
    multi: true,
    chips: [
      chip('rooms', 'office', [{ op: 'addRoom', type: 'study', name: 'Home office' }]),
      chip('rooms', 'gym', [{ op: 'addRoom', type: 'gym' }]),
      chip('rooms', 'prayer', [{ op: 'addRoom', type: 'prayer' }]),
      chip('rooms', 'theatre', [{ op: 'addRoom', type: 'home-theatre' }]),
      chip('rooms', 'game', [{ op: 'addRoom', type: 'game-room' }]),
      chip('rooms', 'utility', [{ op: 'addRoom', type: 'utility', name: 'Utility' }]),
    ],
  },
  {
    id: 'features',
    known: 'features',
    multi: true,
    chips: [
      chip('features', 'pool', [
        { op: 'addFeature', type: 'pool' },
        { op: 'addFeature', type: 'deck' },
      ]),
      chip('features', 'garden', [
        { op: 'addFeature', type: 'garden', side: 'front' },
        { op: 'addFeature', type: 'lawn' },
      ]),
      chip('features', 'parking1', [{ op: 'setCars', cars: 1 }]),
      chip('features', 'parking2', [{ op: 'setCars', cars: 2 }]),
      chip('features', 'parking3', [{ op: 'setCars', cars: 3 }]),
      chip('features', 'play', [{ op: 'addFeature', type: 'play' }]),
      chip('features', 'dining', [{ op: 'addFeature', type: 'patio', covered: true }]),
    ],
  },
  {
    id: 'style',
    known: 'style',
    multi: false,
    chips: ['modern-luxury', 'warm-minimal', 'tropical', 'classic', 'industrial'].map((id) =>
      chip('style', id, [{ op: 'setStyle', preset: id }]),
    ),
  },
  {
    id: 'budget',
    known: 'budget',
    multi: false,
    chips: (['low', 'mid', 'high', 'luxury'] as const).map((b) =>
      chip('budget', b, [{ op: 'setBudget', budget: b }]),
    ),
  },
  {
    id: 'priorities',
    known: 'priorities',
    multi: true,
    chips: [
      chip('priorities', 'light', [{ op: 'addPriority', priority: 'light' }]),
      chip('priorities', 'privacy', [{ op: 'addPriority', priority: 'privacy' }]),
      chip('priorities', 'open', [{ op: 'addPriority', priority: 'open-plan' }]),
      chip('priorities', 'storage', [{ op: 'addPriority', priority: 'storage' }]),
      chip('priorities', 'garden', [{ op: 'addPriority', priority: 'garden' }]),
      chip('priorities', 'cost', [
        { op: 'addPriority', priority: 'cost' },
        { op: 'setBudget', budget: 'low' },
      ]),
    ],
  },
];

export interface InterviewState {
  known: Known[];
  answered: QuestionId[];
}

export const newInterview = (known: Known[] = []): InterviewState => ({ known, answered: [] });

/** The next question: anything the person already said (or answered) is skipped; outdoor questions only for villas. */
export function nextQuestion(state: InterviewState, brief: DesignBrief): Question | null {
  void brief;
  return (
    QUESTIONS.find((q) => !state.known.includes(q.known) && !state.answered.includes(q.id)) ?? null
  );
}

/** How many questions are left to ask (for a progress bar). */
export const questionsLeft = (state: InterviewState, brief: DesignBrief): number => {
  let n = 0;
  const s = { ...state, answered: [...state.answered] };
  for (let q = nextQuestion(s, brief); q; q = nextQuestion(s, brief)) {
    n++;
    s.answered.push(q.id);
  }
  return n;
};

/** Answers a question with the chips the person ticked and/or a few words. */
export function answer(
  state: InterviewState,
  brief: DesignBrief,
  q: Question,
  chosen: string[],
  text?: string,
): { state: InterviewState; brief: DesignBrief; notes: string[] } {
  const ops: BriefOp[] = [];
  for (const id of chosen) ops.push(...(q.chips.find((c) => c.id === id)?.ops ?? []));
  let b = brief;
  const notes: string[] = [];
  const free = text?.trim();
  if (free) {
    const read = textToBrief(free);
    const cmd = parseCommand(free, b);
    ops.push(...cmd.ops);
    if (q.id === 'size' && read.brief.size) ops.push({ op: 'setSize', ...read.brief.size });
    if (q.id === 'style' && read.brief.style.preset)
      ops.push({ op: 'setStyle', preset: read.brief.style.preset });
    if (q.id === 'budget' && read.known.includes('budget'))
      ops.push({ op: 'setBudget', budget: read.brief.budget });
    if (q.id === 'levels' && read.known.includes('levels'))
      ops.push({ op: 'setLevels', levels: read.brief.levels });
    if (q.id === 'household' && read.brief.household)
      ops.push({ op: 'setHousehold', ...read.brief.household });
    b = { ...b, source: `${b.source ?? ''}\n${free}`.trim() };
  }
  const applied = applyBriefOps(b, ops);
  notes.push(...applied.notes);
  // The size just chosen decides how many bedrooms a home that said nothing about them gets.
  const fitted = q.id === 'size' ? fitProgramToSize(applied.brief) : applied.brief;
  return {
    state: { ...state, answered: [...state.answered, q.id] },
    brief: {
      ...fitted,
      assumptions: fitted.assumptions.filter((a) => a.key !== q.id),
    },
    notes,
  };
}
