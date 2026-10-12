/** Briefs used to judge how well a local model follows the DesignIntent schema (`npm run ai:eval`). */
export interface EvalBrief {
  id: string;
  text: string;
  /** Rough expectations, used only to flag answers that ignore the brief. */
  expect?: { bedrooms?: number; levels?: number };
}

export const EVAL_BRIEFS: EvalBrief[] = [
  {
    id: 'simple-2br',
    text: '2 bedroom duplex with open kitchen',
    expect: { bedrooms: 2, levels: 2 },
  },
  {
    id: 'simple-3br',
    text: '3 bedroom duplex with a living room and kitchen downstairs, bedrooms upstairs',
    expect: { bedrooms: 3, levels: 2 },
  },
  { id: 'office', text: '3 bedrooms, home office, modern style', expect: { bedrooms: 3 } },
  { id: 'vague-cozy', text: 'something cozy for 2 people with a home office' },
  { id: 'dark-wood', text: '4 bedrooms and 3 baths, dark wood floors', expect: { bedrooms: 4 } },
  {
    id: 'family',
    text: 'family home for 5: big kitchen with dining, a playroom downstairs, 3 bedrooms upstairs',
    expect: { bedrooms: 3, levels: 2 },
  },
  {
    id: 'master-suite',
    text: 'master bedroom with attached bath upstairs, two smaller bedrooms, open living and kitchen below',
    expect: { bedrooms: 3, levels: 2 },
  },
  {
    id: 'guest-down',
    text: 'a guest room and bathroom downstairs for my parents, two bedrooms upstairs',
    expect: { bedrooms: 3 },
  },
  {
    id: 'studio-ish',
    text: 'one bedroom, small and efficient, balcony if possible',
    expect: { bedrooms: 1 },
  },
  {
    id: 'entertainer',
    text: 'I love hosting dinners: large open kitchen, dining for 8, living room, two bedrooms',
    expect: { bedrooms: 2 },
  },
  {
    id: 'study-utility',
    text: '2 bedrooms, a study, a utility room with laundry, one bathroom downstairs and one upstairs',
    expect: { bedrooms: 2 },
  },
  { id: 'minimal', text: 'duplex', expect: { levels: 2 } },
  { id: 'vague-big', text: 'as many bedrooms as will fit, but keep a nice living room' },
  {
    id: 'style-light',
    text: 'bright scandinavian style, 2 bedrooms, light oak floors, white walls',
    expect: { bedrooms: 2 },
  },
  {
    id: 'double-height',
    text: '3 bedroom house with a double-height living room open to the floor above',
    expect: { bedrooms: 3, levels: 2 },
  },
];
