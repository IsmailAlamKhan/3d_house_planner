import { t } from '../i18n';
import { rng } from './layout/rect';
import { DesignIntentSchema, type DesignIntent, type RoomIntent } from './schemas';

const WORDS: Record<string, number> = {
  a: 1,
  one: 1,
  single: 1,
  two: 2,
  double: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
};

const num = (s: string | undefined): number | undefined => {
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : WORDS[s];
};

const COUNT = '(\\d+|a|one|single|two|double|three|four|five|six|seven|eight)';

export interface OfflineResult {
  intent: DesignIntent;
  /** What the brief was understood to say (shown to the user). */
  understood: string[];
}

/** Reads a simple English brief into a DesignIntent with keyword rules and duplex templates — no model needed. */
export function offlineIntent(brief: string, variation = 0): OfflineResult {
  const text = ` ${brief.toLowerCase().replace(/[,;.]/g, ' ')} `;
  const understood: string[] = [];
  const has = (re: RegExp) => re.test(text);

  // ── Counts ──
  let bedrooms: number | undefined;
  const bed = new RegExp(`${COUNT}[\\s-]*(?:bed(?:room)?s?|br|bhk)\\b`).exec(text);
  if (bed) bedrooms = num(bed[1]);
  const people = new RegExp(`for ${COUNT} (?:people|persons|adults|of us)`).exec(text);
  if (bedrooms === undefined && people)
    bedrooms = Math.max(1, Math.ceil((num(people[1]) ?? 2) / 2));
  if (bedrooms === undefined && has(/\bcouple\b|\bfor two\b|\bfor 2\b/)) bedrooms = 1;
  if (bedrooms === undefined && has(/\bfamily\b|\bkids?\b|\bchildren\b/)) bedrooms = 3;
  const studio = has(/\bstudio\b/) && bedrooms === undefined;
  bedrooms = studio ? 0 : Math.min(6, Math.max(1, bedrooms ?? 2));

  let baths: number | undefined;
  const bath = new RegExp(`${COUNT}[\\s-]*(?:bath(?:room)?s?|wc|toilets?|en-?suites?)\\b`).exec(
    text,
  );
  if (bath) baths = num(bath[1]);
  const ensuite = has(/en-?suite|attached bath|own bath|private bath/);
  baths = Math.min(6, Math.max(1, baths ?? (bedrooms >= 4 ? 3 : bedrooms >= 2 ? 2 : 1)));

  const open = has(
    /open[\s-]*(plan|concept)|open kitchen|kitchen (?:open|flows|connected)|living (?:and|&|with) kitchen/,
  );
  const wantsDining = has(/\bdining\b/) || bedrooms >= 3;
  const study = has(/\bstudy\b|\boffice\b|work(?:ing)? from home|\bwfh\b/);
  const utility = has(/\butility\b|\blaundry\b|\bwashing\b/);
  const balcony = has(/\bbalcon(?:y|ies)\b|\bterrace\b/);
  const guestRoom = has(/guest (?:bed)?room/);
  const furnish = !has(/\bunfurnished\b|\bempty\b|no furniture|without furniture/);

  understood.push(
    studio ? t('ai.offline.studio') : t('ai.offline.beds').replace('{n}', String(bedrooms)),
  );
  understood.push(t('ai.offline.baths').replace('{n}', String(baths)));
  if (open) understood.push(t('ai.offline.open'));
  if (study) understood.push(t('ai.offline.study'));
  if (utility) understood.push(t('ai.offline.utility'));
  if (balcony) understood.push(t('ai.offline.balcony'));
  if (guestRoom) understood.push(t('ai.offline.guest'));

  // ── Style ──
  let floor: NonNullable<DesignIntent['style']>['floor'];
  let walls: NonNullable<DesignIntent['style']>['walls'];
  const setStyle = (f: typeof floor, w: typeof walls) => {
    floor = f;
    walls = w;
  };
  if (has(/scandi|nordic/)) setStyle('light-wood', 'white');
  else if (has(/industrial|loft/)) setStyle('concrete', 'grey');
  else if (has(/luxur|elegant|classic|marble/))
    setStyle(has(/marble/) ? 'marble' : 'herringbone', 'cream');
  else if (has(/cozy|cosy|warm/)) setStyle('dark-wood', 'cream');
  else if (has(/modern|minimal|contemporary/)) setStyle('light-wood', 'white');
  if (has(/\bdark\b|moody/)) setStyle(floor ?? 'dark-wood', 'charcoal');
  if (has(/\bsage\b|\bgreen\b/)) walls = 'sage';
  else if (has(/\bblue\b/)) walls = 'blue';
  else if (has(/terracotta|earthy/)) walls = 'terracotta';
  if (has(/herringbone/)) floor = 'herringbone';
  else if (has(/\btiles?\b/)) floor = has(/\bwhite\b/) ? 'tile-white' : 'tile-grey';
  if (floor || walls) understood.push(t('ai.offline.style'));

  let stairType: DesignIntent['stair']['type'] = 'straight';
  if (has(/spiral/)) stairType = 'spiral';
  else if (has(/\bl[\s-]*shaped (?:stair|staircase)|\bl stairs?\b/)) stairType = 'L';
  else if (has(/\bu[\s-]*shaped (?:stair|staircase)|\bu stairs?\b/)) stairType = 'U';

  // ── Variation: gentle, deterministic changes so "3 variations" differ ──
  const rnd = rng(7919 * (variation + 1));
  const jitter = (a: number) =>
    Math.round(a * (variation === 0 ? 1 : 0.88 + rnd() * 0.26) * 10) / 10;
  const room = (
    r: Omit<RoomIntent, 'adjacency' | 'exteriorWall'> &
      Partial<Pick<RoomIntent, 'adjacency' | 'exteriorWall'>>,
  ): RoomIntent =>
    ({
      adjacency: [],
      exteriorWall: 'preferred',
      ...r,
      targetArea: jitter(r.targetArea),
    }) as RoomIntent;

  // ── Ground floor ──
  const ground: RoomIntent[] = [];
  const kitchenOpen = open && variation !== 2;
  ground.push(
    room({
      type: 'living',
      name: 'Living room',
      targetArea: studio ? 30 : 26,
      exteriorWall: 'required',
      adjacency: [
        { room: 'Kitchen', connection: kitchenOpen ? 'open' : 'door' },
        ...(wantsDining ? [{ room: 'Dining', connection: 'open' as const }] : []),
      ],
    }),
  );
  ground.push(
    room({
      type: 'kitchen',
      name: 'Kitchen',
      targetArea: 12,
      needsPlumbing: true,
      exteriorWall: 'preferred',
      adjacency: wantsDining ? [{ room: 'Dining', connection: kitchenOpen ? 'open' : 'door' }] : [],
    }),
  );
  if (wantsDining) ground.push(room({ type: 'dining', name: 'Dining', targetArea: 10 }));
  if (!studio)
    ground.push(
      room({
        type: 'bathroom',
        name: 'Guest bath',
        targetArea: 4.5,
        needsPlumbing: true,
        exteriorWall: 'none',
      }),
    );
  if (guestRoom)
    ground.push(
      room({ type: 'bedroom', name: 'Guest room', targetArea: 12, exteriorWall: 'required' }),
    );
  // The study goes downstairs in the base design and upstairs in variation 1.
  const studyUp = study && variation === 1;
  if (study && !studyUp)
    ground.push(room({ type: 'study', name: 'Study', targetArea: 9, exteriorWall: 'required' }));
  if (utility)
    ground.push(
      room({
        type: 'utility',
        name: 'Utility',
        targetArea: 5,
        needsPlumbing: true,
        exteriorWall: 'none',
      }),
    );

  const levels: DesignIntent['levels'] = [{ name: 'Ground floor', rooms: ground }];

  // ── Upper floor(s) ──
  const upstairsBeds = Math.max(0, bedrooms - (guestRoom ? 1 : 0));
  if (!studio && upstairsBeds > 0) {
    const upper: RoomIntent[] = [];
    const upBaths = Math.max(1, baths - 1);
    for (let i = 0; i < upstairsBeds; i++) {
      const master = i === 0;
      const name = master ? 'Master bedroom' : `Bedroom ${i + 1}`;
      upper.push(
        room({
          type: 'bedroom',
          name,
          targetArea: master ? 17 : 12.5,
          exteriorWall: 'required',
          adjacency:
            master && (ensuite || upBaths >= 1)
              ? [{ room: 'Master bath', connection: 'door' }]
              : [],
        }),
      );
    }
    for (let i = 0; i < upBaths && upper.length < 12; i++) {
      const name = i === 0 ? 'Master bath' : upBaths === 2 ? 'Family bath' : `Bath ${i + 1}`;
      upper.push(
        room({
          type: 'bathroom',
          name,
          targetArea: i === 0 ? 6 : 5,
          needsPlumbing: true,
          exteriorWall: 'none',
          above: i === 0 ? 'Guest bath' : undefined,
        }),
      );
    }
    if (studyUp)
      upper.push(room({ type: 'study', name: 'Study', targetArea: 9, exteriorWall: 'required' }));
    if (balcony)
      upper.push(
        room({
          type: 'balcony',
          name: 'Balcony',
          targetArea: 5,
          exteriorWall: 'required',
          needsWindow: false,
        }),
      );
    levels.push({ name: 'Upper floor', rooms: upper });
  } else if (!studio) {
    levels.push({
      name: 'Upper floor',
      rooms: [room({ type: 'study', name: 'Study', targetArea: 14, exteriorWall: 'required' })],
    });
  }

  const intent = DesignIntentSchema.parse({
    title: brief.trim().slice(0, 80) || t('ai.offline.defaultTitle'),
    levels,
    stair: { type: stairType, position: 'near-entrance' },
    style: floor || walls ? { floor, walls } : undefined,
    furnish,
  });
  return { intent, understood };
}
