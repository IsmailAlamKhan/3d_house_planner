import type { BriefFeature, DesignBrief, RoomType } from '../model/types';
import type { Emphasis } from '../ai/layout/weights';
import { type BriefOp, findRoom, regularBedrooms } from './brief';
import { TYPE_NAME, makeFeature } from './program';
import { styleFromWords } from './styles';
import { toEnglish } from './text';

/** What a spoken or typed change request turned into. */
export interface Command {
  /** Edits to the Design Brief. */
  ops: BriefOp[];
  /** Score emphasis for the next layout ("more light"). */
  emphasis: Emphasis;
  /** Geometry-level request (resize a wall, paint, move an item): left to the edit-operations pipeline. */
  geometric: boolean;
  /** Nothing in the request was understood. */
  unknown: boolean;
  /** Names of rooms the request is about (so the copilot can keep the rest). */
  about: string[];
}

const COUNT_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
};
const num = (s: string | undefined): number | undefined =>
  s === undefined ? undefined : Number.isFinite(Number(s)) ? Number(s) : COUNT_WORDS[s];

/** Room phrases → type and default name. Longest first. */
const ROOM_WORDS: [RegExp, RoomType, string?][] = [
  [/walk[- ]in closet|dressing room|wardrobe room/, 'walk-in-closet'],
  [/home theat(?:re|er)|cinema|media room/, 'home-theatre'],
  [/gam(?:e|es|ing) room/, 'game-room', 'Game room'],
  [/prayer room|puja room|pooja room|namaz room/, 'prayer'],
  [/guest (?:bed)?room|spare room/, 'bedroom', 'Guest room'],
  [/(?:play ?room|kids? room|nursery|children'?s room)/, 'other', 'Playroom'],
  [/home office|\boffice\b|\bstudy\b|library/, 'study'],
  [/master (?:bed)?room/, 'bedroom', 'Master bedroom'],
  [/bed ?rooms?/, 'bedroom'],
  [/bath ?rooms?|toilets?|\bwc\b|washrooms?/, 'bathroom'],
  [/living|lounge|family room|drawing room/, 'living', 'Living room'],
  [/dining(?: room| area)?/, 'dining', 'Dining'],
  [/kitchen/, 'kitchen'],
  [/laundry|utility/, 'utility', 'Utility'],
  [/pantry|store ?room/, 'pantry'],
  [/gym|fitness/, 'gym'],
  [/sauna|steam room/, 'sauna'],
  [/\bspa\b|jacuzzi/, 'spa'],
  [/balcony|terrace|veranda/, 'balcony'],
  [/foyer|entrance hall|lobby/, 'foyer'],
];

const FEATURE_WORDS: [RegExp, BriefFeature['type']][] = [
  [/swimming pool|\bpool\b/, 'pool'],
  [/garden|landscap|\byard\b/, 'garden'],
  [/lawn/, 'lawn'],
  [/parking|car ?port|garage|\bcars?\b/, 'parking'],
  [/patio|outdoor dining|gazebo|pergola|barbecue|\bbbq\b/, 'patio'],
  [/play area|playground/, 'play'],
  [/fountain|water feature/, 'water-feature'],
  [/\bdeck\b/, 'deck'],
];

const roomsOf = (t: string): { type: RoomType; name?: string; word: string }[] => {
  const out: { type: RoomType; name?: string; word: string }[] = [];
  for (const [re, type, name] of ROOM_WORDS) {
    const m = re.exec(t);
    if (m && !out.some((o) => o.type === type)) out.push({ type, name, word: m[0] });
  }
  return out;
};
const featuresOf = (t: string): BriefFeature['type'][] => [
  ...new Set(FEATURE_WORDS.filter(([re]) => re.test(t)).map(([, f]) => f)),
];

const BUDGET_UP: Record<DesignBrief['budget'], DesignBrief['budget']> = {
  low: 'mid',
  mid: 'high',
  high: 'luxury',
  luxury: 'luxury',
};
const BUDGET_DOWN: Record<DesignBrief['budget'], DesignBrief['budget']> = {
  low: 'low',
  mid: 'low',
  high: 'mid',
  luxury: 'high',
};

/**
 * Reads a change request ("bigger kitchen", "add a bedroom", "make it cheaper", "no gaming room", "2 storeys",
 * "add a room for my mother on the ground floor with its own bathroom") into brief edits. `selected` is the room or item
 * the person is pointing at: "this" and "it" mean that.
 */
function parseClause(
  t: string,
  brief: DesignBrief,
  inherit: { removing: boolean; adding: boolean },
): Command & { removing: boolean; adding: boolean } {
  const ops: BriefOp[] = [];
  const emphasis: Emphasis = {};
  const about: string[] = [];
  let geometric = false;
  const rooms = roomsOf(t);
  const room = rooms[0];

  // ── Removing ──
  const verbRemove =
    /\b(?:no|without|remove|delete|drop|skip|get rid of|don'?t (?:need|want)|cut)\b/.test(t);
  // ── Adding ──
  const verbAdd = /\b(?:add|include|want|need|with|plus|also|put in|build|give me|create)\b/.test(
    t,
  );
  // A clause with no verb of its own ("... the gym and sauna") follows the one before it.
  const sizing =
    /\b(?:bigger|larger|smaller|wider|narrower|expand|shrink|enlarge|reduce|increase|decrease)\b/.test(
      t,
    );
  const silent = !verbRemove && !verbAdd && !sizing && !/\d/.test(t);
  const removing = verbRemove || (silent && inherit.removing);
  const adding = verbAdd || (silent && inherit.adding);
  const bigger = /\b(?:bigger|larger|larger|more spacious|wider|expand|enlarge|increase)\b/.test(t);
  const smaller =
    /\b(?:smaller|compact|tighter|shrink|reduce|narrower|less spacious|decrease)\b/.test(t);

  // Levels: "2 storeys", "make it single storey", "add a floor".
  const lv = /(\d)\s*(?:storey|story|stories|storeys|floors?|levels?)/.exec(t);
  if (lv) ops.push({ op: 'setLevels', levels: Number(lv[1]) });
  else if (/\b(?:duplex|two[- ]stor\w+|double[- ]stor\w+)\b/.test(t))
    ops.push({ op: 'setLevels', levels: 2 });
  else if (/\b(?:three[- ]stor\w+|triplex)\b/.test(t)) ops.push({ op: 'setLevels', levels: 3 });
  else if (
    /\b(?:single[- ]stor\w+|one[- ]stor\w+|single floor|one floor|single level|bungalow)\b/.test(t)
  )
    ops.push({ op: 'setLevels', levels: 1 });
  else if (/add (?:a |another )?(?:floor|storey|story|level)/.test(t))
    ops.push({ op: 'setLevels', levels: brief.levels + 1 });

  // Counts: "4 bedrooms", "make it 3 bathrooms".
  const countRe =
    /(\d+|one|two|three|four|five|six|seven)\s*(?:more\s*)?(bed ?rooms?|bath ?rooms?)/g;
  const hasCount =
    /(\d+|one|two|three|four|five|six|seven)\s*(?:more\s*)?(bed ?rooms?|bath ?rooms?)/.test(t);
  for (const m of t.matchAll(countRe)) {
    const n = num(m[1]);
    const type: RoomType = m[2]!.startsWith('bed') ? 'bedroom' : 'bathroom';
    if (n === undefined) continue;
    const have = (
      type === 'bedroom'
        ? regularBedrooms(brief.program)
        : brief.program.filter((r) => r.type === type)
    ).length;
    const more =
      /more/.test(m[0]) ||
      (adding && /\b(?:add|another)\b/.test(t) && !/\bto\b|\bmake\b|\bhave\b/.test(t));
    const target = more ? have + n : n;
    if (type === 'bedroom') {
      ops.push({
        op: 'setBedrooms',
        count: target,
        ensuite: /en-?suite|attached|own bath/.test(t) ? true : undefined,
      });
    } else {
      for (let i = have; i < target; i++) ops.push({ op: 'addRoom', type, name: `Bath ${i + 1}` });
      for (let i = have; i > target; i--) {
        const last = [...brief.program].reverse().find((r) => r.type === type && !r.locked);
        if (last) ops.push({ op: 'removeRoom', room: last.name });
      }
    }
  }

  // "a room for my mother / father / parents / guests ... ground floor ... own bathroom"
  const forWho =
    /(?:room|bedroom|suite)\s+for\s+(?:my\s+)?(mother|mom|father|dad|parents|grandparents?|grandma|grandpa|guests?|in-laws|maid|help|nanny|son|daughter|kids?)/.exec(
      t,
    );
  if (forWho) {
    const who = forWho[1]!;
    const name = `${who.charAt(0).toUpperCase()}${who.slice(1)}'s room`
      .replace("Parents's", "Parents'")
      .replace("Guests's", 'Guest')
      .replace('Guest room', 'Guest room');
    const ground =
      /ground|downstairs|lower|first floor|no stairs/.test(t) ||
      /mother|father|parents|grand|in-laws|mom|dad/.test(who);
    const bath = /(?:own|attached|private|en-?suite|with a)\s*bath/.test(t) || /bathroom/.test(t);
    ops.push({
      op: 'addRoom',
      type: 'bedroom',
      name: /guest/.test(who) ? 'Guest room' : name,
      area: 14,
      level: ground ? 0 : null,
      next: bath ? [`${/guest/.test(who) ? 'Guest room' : name} bath`] : undefined,
    });
    if (bath)
      ops.push({
        op: 'addRoom',
        type: 'bathroom',
        name: `${/guest/.test(who) ? 'Guest room' : name} bath`,
        area: 5,
        level: ground ? 0 : null,
        next: [/guest/.test(who) ? 'Guest room' : name],
      });
    about.push(name);
  } else if (room && !hasCount) {
    // Every room named in the clause ("the gym and sauna") gets the same treatment.
    for (const rm of removing || adding ? rooms : [room]) {
      const sameType = brief.program.filter((r) => r.type === rm.type);
      const target =
        sameType.length === 1
          ? sameType[0]
          : (findRoom(brief, rm.name ?? rm.word) ??
            sameType.find(
              (r) => rm.name && r.name.toLowerCase().includes(rm.name.toLowerCase().split(' ')[0]!),
            ));
      if (removing) {
        if (target) {
          ops.push({ op: 'removeRoom', room: target.name });
          about.push(target.name);
        }
      } else if (bigger || smaller) {
        if (target) {
          const sqm = /(\d+(?:\.\d+)?)\s*(?:sq\.?\s*m|sqm|m2|m²|square met\w+)/.exec(t);
          ops.push(
            sqm
              ? { op: 'resizeRoom', room: target.name, area: Number(sqm[1]) }
              : { op: 'resizeRoom', room: target.name, factor: bigger ? 1.3 : 0.75 },
          );
          about.push(target.name);
        }
      } else if (
        adding &&
        (!target ||
          rm.type === 'bedroom' ||
          rm.type === 'bathroom' ||
          /\b(?:another|second|extra|one more)\b/.test(t))
      ) {
        ops.push({
          op: 'addRoom',
          type: rm.type,
          name: target ? undefined : rm.name,
          priority: /\bnice|maybe|if (?:possible|there)/.test(t) ? 'nice' : 'must',
        });
      } else {
        const sqm = /(\d+(?:\.\d+)?)\s*(?:sq\.?\s*m|sqm|m2|m²)/.exec(t);
        if (target && sqm) ops.push({ op: 'resizeRoom', room: target.name, area: Number(sqm[1]) });
        if (target && /\b(?:nice to have|optional|if possible)\b/.test(t))
          ops.push({ op: 'setPriority', room: target.name, priority: 'nice' });
        if (target && /\b(?:must|essential|need)\b/.test(t))
          ops.push({ op: 'setPriority', room: target.name, priority: 'must' });
      }
    }
  }

  // ── Outdoor features ──
  const carsN = /(\d+|one|two|three|four|five)[- ]*(?:car|cars)\b/.exec(t);
  for (const feat of featuresOf(t)) {
    if (removing) ops.push({ op: 'removeFeature', type: feat });
    else if (bigger || smaller)
      ops.push({ op: 'resizeFeature', type: feat, factor: bigger ? 1.3 : 0.75 });
    else if (adding || !rooms.length) ops.push({ op: 'addFeature', type: feat });
  }
  if (carsN && !removing) ops.push({ op: 'setCars', cars: num(carsN[1]) ?? 2 });
  else if (featuresOf(t).includes('parking') && adding && !removing)
    ops.push({ op: 'setCars', cars: brief.cars || 2 });

  // ── Budget and style ──
  if (
    /\b(?:cheaper|less expensive|low(?:er)? cost|save money|reduce (?:the )?cost|affordable|budget)\b/.test(
      t,
    )
  ) {
    ops.push(
      { op: 'setBudget', budget: BUDGET_DOWN[brief.budget] },
      { op: 'addPriority', priority: 'cost' },
    );
  }
  if (/\b(?:luxur\w+|premium|high[- ]end|upscale|more expensive|fancier|lavish)\b/.test(t)) {
    ops.push(
      { op: 'setBudget', budget: BUDGET_UP[brief.budget] },
      { op: 'setStyle', preset: 'modern-luxury' },
    );
  }
  const style = styleFromWords(t.replace(/\bluxur\w*/g, ''));
  if (style && /\b(?:style|look|feel|make it|more|go|theme|design)\b/.test(t) && !removing)
    ops.push({ op: 'setStyle', preset: style.id });

  // ── Vague wishes ──
  if (
    /\b(?:more )?open(?:er)?\b|open[- ]plan|feel(?:s)? (?:more )?open|airy|spacious/.test(t) &&
    !room
  ) {
    ops.push({ op: 'addPriority', priority: 'open-plan' });
    emphasis.straight = 2;
  }
  if (/\b(?:more )?(?:light|bright|sunlit|daylight|windows?)\b/.test(t)) {
    ops.push({ op: 'addPriority', priority: 'light' });
    emphasis.daylight = 3;
    if (room) about.push(room.name ?? room.word);
  }
  if (/\b(?:more )?(?:privacy|private|quiet|secluded)\b/.test(t)) {
    ops.push({ op: 'addPriority', priority: 'privacy' });
    emphasis.privacy = 3;
  }
  if (/\b(?:more )?storage\b|\bcupboards?\b|\bwardrobes?\b/.test(t) && !room) {
    ops.push(
      { op: 'addPriority', priority: 'storage' },
      { op: 'addRoom', type: 'utility', name: 'Store room', area: 6 },
    );
  }
  if (/\b(?:less|fewer|smaller) corridors?\b|\bwaste\b/.test(t)) emphasis.corridor = 3;
  if (/\bstraight(?:er)?\b|\bsimpler?\b|\bcleaner\b/.test(t)) emphasis.straight = 3;
  if (/\b(?:plumbing|pipes?)\b/.test(t)) emphasis.wet = 3;
  if (/\b(?:garden view|view of the garden|open to the garden)\b/.test(t)) emphasis.view = 3;

  // ── Geometry-level requests belong to the edit pipeline ──
  if (
    /\b(?:move|rotate|paint|colou?r|swap|rename|wall|door|window|stair|furniture|sofa|bed\b|rug|lamp|plant|material|floor(?:ing)?)\b/.test(
      t,
    ) &&
    ops.length === 0 &&
    Object.keys(emphasis).length === 0
  )
    geometric = true;

  const unknown = ops.length === 0 && Object.keys(emphasis).length === 0 && !geometric;
  return { ops, emphasis, geometric, unknown, about, removing, adding };
}

/**
 * Reads a change request ("bigger kitchen", "add a bedroom", "make it cheaper", "no gaming room", "2 storeys",
 * "add a room for my mother on the ground floor with its own bathroom") into brief edits. Several wishes in one
 * sentence ("2 storeys, 4 bedrooms, no gaming room, smaller pool") are read one by one. `selected` is the room or item
 * the person is pointing at: "this" and "it" mean that.
 */
export function parseCommand(input: string, brief: DesignBrief, selected?: string): Command {
  const raw = toEnglish(input);
  let text = ` ${raw.toLowerCase().replace(/[.!?]/g, ' ').replace(/\s+/g, ' ')} `;
  if (selected) text = text.replace(/\b(?:this|it|that)\b/g, ` ${selected.toLowerCase()} `);
  const clauses = text
    .split(
      /\s*(?:,|;|\bbut\b|\bthen\b|\bwith\b(?= no\b)|\band\b(?= (?:no|without|remove|add|a |an |more |bigger|smaller|make|\d)))\s*/,
    )
    .map((c) => ` ${c.trim()} `)
    .filter((c) => c.trim());
  const out: Command = { ops: [], emphasis: {}, geometric: false, unknown: true, about: [] };
  let inherit = { removing: false, adding: false };
  // One clause: parse it whole. Several: each on its own, polarity carried to clauses without a verb.
  const parts = clauses.length ? clauses : [text];
  for (const c of parts) {
    const r = parseClause(c, brief, inherit);
    if (r.removing || r.adding) inherit = { removing: r.removing, adding: r.adding };
    for (const o of r.ops)
      if (!out.ops.some((x) => JSON.stringify(x) === JSON.stringify(o))) out.ops.push(o);
    Object.assign(out.emphasis, r.emphasis);
    out.about.push(...r.about);
    out.geometric ||= r.geometric;
  }
  out.unknown = out.ops.length === 0 && Object.keys(out.emphasis).length === 0 && !out.geometric;
  return out;
}

/** The quick chips under the chat, as the requests they stand for. */
export const CHAT_CHIPS: { id: string; request: string; key: `copilot.chip.${string}` }[] = [
  { id: 'kitchen', request: 'bigger kitchen', key: 'copilot.chip.kitchen' },
  { id: 'bedroom', request: 'add a bedroom', key: 'copilot.chip.bedroom' },
  { id: 'light', request: 'more light', key: 'copilot.chip.light' },
  { id: 'privacy', request: 'more privacy', key: 'copilot.chip.privacy' },
  { id: 'cheaper', request: 'cheaper finishes', key: 'copilot.chip.cheaper' },
  { id: 'luxury', request: 'make it luxurious', key: 'copilot.chip.luxury' },
  { id: 'pool', request: 'add a pool', key: 'copilot.chip.pool' },
  { id: 'parking', request: 'add parking for 2 cars', key: 'copilot.chip.parking' },
];

export { TYPE_NAME, makeFeature };

/** The room type a label on a sketch names ("Master BR", "kitchen", "লিভিং"), or undefined. */
export function roomTypeOfLabel(label: string): RoomType | undefined {
  const t = ` ${toEnglish(label).toLowerCase()} `
    .replace(/\bbr\b|\bbed\b/g, ' bedroom ')
    .replace(/\bliv\b|\blounge\b/g, ' living room ')
    .replace(/\bwc\b|\btoilet\b|\bbath\b|\blavatory\b/g, ' bathroom ')
    .replace(/\bkit\b/g, ' kitchen ');
  return roomsOf(t)[0]?.type;
}
