import { t } from '../i18n';
import { rng } from './layout/rect';
import {
  DesignIntentSchema,
  type DesignIntent,
  type RoomIntent,
  type SiteZoneIntent,
} from './schemas';

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
};
const COUNT = '(\\d+|a|one|single|two|double|three|four|five|six)';
const num = (s: string | undefined): number | undefined =>
  s === undefined ? undefined : Number.isFinite(Number(s)) ? Number(s) : WORDS[s];

/** Does the brief ask for a villa-style home (a plot with outdoor areas) rather than a duplex? */
export const isVillaBrief = (brief: string): boolean =>
  /\bvilla\b|bungalow|mansion|\bpool\b|\bgarage\b|\bparking\b|\bplot\b|\blawn\b|\bsauna\b|\bgym\b/i.test(
    brief,
  );

interface Understood {
  intent: DesignIntent;
  understood: string[];
}

/**
 * Reads a villa brief ("luxury villa with pool, garden, 2-car garage, gym and sauna") into a single-level
 * "wings" design — foyer, a central hall, rooms in two wings — plus the outdoor zones around it.
 */
export function offlineVilla(brief: string, variation = 0): Understood {
  const text = ` ${brief.toLowerCase().replace(/[,;.]/g, ' ')} `;
  const has = (re: RegExp) => re.test(text);
  const understood: string[] = [t('ai.offline.villa')];

  const bed = new RegExp(`${COUNT}[\\s-]*(?:bed(?:room)?s?|br|bhk)\\b`).exec(text);
  const bedrooms = Math.min(5, Math.max(2, num(bed?.[1]) ?? (has(/luxur|mansion/) ? 3 : 3)));
  const bath = new RegExp(`${COUNT}[\\s-]*(?:bath(?:room)?s?|wc|toilets?)\\b`).exec(text);
  const baths = Math.min(6, Math.max(2, num(bath?.[1]) ?? bedrooms));
  understood.push(t('ai.offline.beds').replace('{n}', String(bedrooms)));
  understood.push(t('ai.offline.baths').replace('{n}', String(baths)));

  const luxury = has(/luxur|mansion|premium|elegant/);
  const wants = {
    gym: has(/\bgym\b|fitness|workout/),
    sauna: has(/\bsauna\b/),
    spa: has(/\bspa\b|hot tub|jacuzzi/),
    game: has(/game|gaming/),
    guest: has(/guest/),
    closet: has(/closet|wardrobe|dressing/) || luxury,
    theatre: has(/theat(?:re|er)|cinema|media room/),
    prayer: has(/prayer|puja|meditation/),
    study: has(/\bstudy\b|\boffice\b|work(?:ing)? from home/),
    laundry: has(/laundry|utility/) || luxury,
    pantry: has(/pantry/),
    garageRoom: has(/(?:attached|indoor|integrated) garage|garage room/),
  };
  const pool = has(/\bpool\b|swimming/);
  const garden = has(/garden|lawn|landscap|green|yard/) || luxury || pool;
  const parkingMention = has(/garage|parking|car port|carport|\bcars?\b/);
  const carsMatch = new RegExp(`${COUNT}[\\s-]*cars?\\b`).exec(text);
  const cars = parkingMention ? Math.min(6, Math.max(1, num(carsMatch?.[1]) ?? 2)) : 0;
  const play = has(/play|kids?|children|swing|slide/);
  const dining = has(/outdoor dining|pergola|gazebo|alfresco|bbq|barbecue/) || luxury;
  const fountain = has(/fountain|water feature/);

  const extras: string[] = [];
  if (wants.gym) extras.push(t('ai.offline.gym'));
  if (wants.sauna) extras.push(t('ai.offline.sauna'));
  if (wants.spa) extras.push(t('ai.offline.spa'));
  if (wants.game) extras.push(t('ai.offline.game'));
  if (wants.theatre) extras.push(t('ai.offline.theatre'));
  if (wants.guest) extras.push(t('ai.offline.guest'));
  if (extras.length) understood.push(extras.join(', '));
  if (pool) understood.push(t('ai.offline.pool'));
  if (garden) understood.push(t('ai.offline.garden'));
  if (cars) understood.push(t('ai.offline.cars').replace('{n}', String(cars)));

  const rnd = rng(7919 * (variation + 1));
  const jitter = (a: number) =>
    Math.round(a * (variation === 0 ? 1 : 0.9 + rnd() * 0.22) * 10) / 10;
  const room = (
    r: Partial<RoomIntent> & Pick<RoomIntent, 'type' | 'name' | 'targetArea'>,
  ): RoomIntent =>
    ({
      adjacency: [],
      exteriorWall: 'preferred',
      ...r,
      targetArea: jitter(r.targetArea),
    }) as RoomIntent;

  const rooms: RoomIntent[] = [];
  rooms.push(
    room({
      type: 'foyer',
      name: 'Foyer',
      targetArea: 7,
      exteriorWall: 'preferred',
      needsWindow: false,
    }),
  );
  rooms.push(
    room({
      type: 'living',
      name: 'Living & Dining',
      targetArea: 48,
      exteriorWall: 'required',
      adjacency: [{ room: 'Kitchen', connection: 'open' }],
    }),
  );
  rooms.push(
    room({
      type: 'kitchen',
      name: 'Kitchen',
      targetArea: 16,
      needsPlumbing: true,
      adjacency: wants.pantry ? [{ room: 'Pantry', connection: 'door' }] : [],
    }),
  );
  if (wants.pantry)
    rooms.push(room({ type: 'pantry', name: 'Pantry', targetArea: 4, exteriorWall: 'none' }));
  if (wants.laundry)
    rooms.push(
      room({
        type: 'laundry',
        name: 'Laundry',
        targetArea: 6,
        needsPlumbing: true,
        exteriorWall: 'none',
      }),
    );
  for (let i = 0; i < bedrooms; i++) {
    const master = i === 0;
    const name = master ? 'Master bedroom' : `Bedroom ${i + 1}`;
    const bathName = master ? 'Master bath' : `Bath ${i + 1}`;
    const adj: RoomIntent['adjacency'] = [];
    if (i < baths) adj.push({ room: bathName, connection: 'door' });
    if (master && wants.closet) adj.push({ room: 'Walk-in closet', connection: 'door' });
    rooms.push(
      room({
        type: 'bedroom',
        name,
        targetArea: master ? 24 : 15,
        exteriorWall: 'required',
        adjacency: adj,
      }),
    );
    if (i < baths)
      rooms.push(
        room({
          type: 'bathroom',
          name: bathName,
          targetArea: master ? 9 : 5.5,
          needsPlumbing: true,
          exteriorWall: 'none',
        }),
      );
  }
  if (wants.closet)
    rooms.push(
      room({ type: 'walk-in-closet', name: 'Walk-in closet', targetArea: 7, exteriorWall: 'none' }),
    );
  if (baths > bedrooms)
    for (let i = bedrooms; i < baths && i < 6; i++)
      rooms.push(
        room({
          type: 'bathroom',
          name: `Bath ${i + 1}`,
          targetArea: 4.5,
          needsPlumbing: true,
          exteriorWall: 'none',
        }),
      );
  if (wants.guest)
    rooms.push(
      room({
        type: 'bedroom',
        name: 'Guest room',
        targetArea: 14,
        exteriorWall: 'required',
        adjacency: [{ room: 'Guest bath', connection: 'door' }],
      }),
    );
  if (wants.guest)
    rooms.push(
      room({
        type: 'bathroom',
        name: 'Guest bath',
        targetArea: 5,
        needsPlumbing: true,
        exteriorWall: 'none',
      }),
    );
  if (wants.game)
    rooms.push(
      room({ type: 'game-room', name: 'Game room', targetArea: 16, exteriorWall: 'preferred' }),
    );
  if (wants.theatre)
    rooms.push(
      room({ type: 'home-theatre', name: 'Home theatre', targetArea: 18, exteriorWall: 'none' }),
    );
  if (wants.gym)
    rooms.push(room({ type: 'gym', name: 'Gym', targetArea: 16, exteriorWall: 'preferred' }));
  if (wants.sauna)
    rooms.push(
      room({
        type: 'sauna',
        name: 'Sauna',
        targetArea: 5,
        needsPlumbing: true,
        exteriorWall: 'none',
        adjacency: wants.gym ? [{ room: 'Gym', connection: 'door' }] : [],
      }),
    );
  if (wants.spa)
    rooms.push(
      room({ type: 'spa', name: 'Spa', targetArea: 9, needsPlumbing: true, exteriorWall: 'none' }),
    );
  if (wants.study)
    rooms.push(room({ type: 'study', name: 'Study', targetArea: 11, exteriorWall: 'required' }));
  if (wants.prayer)
    rooms.push(
      room({ type: 'prayer', name: 'Prayer room', targetArea: 6, exteriorWall: 'preferred' }),
    );
  if (wants.garageRoom)
    rooms.push(
      room({
        type: 'garage',
        name: 'Garage',
        targetArea: 26,
        exteriorWall: 'required',
        needsWindow: false,
      }),
    );

  // ── Outdoors ──
  const zones: SiteZoneIntent[] = [];
  if (cars) zones.push({ type: 'parking', side: 'front', covered: true, name: 'Covered parking' });
  if (garden) zones.push({ type: 'garden', side: 'front', name: 'Front garden' });
  if (pool) {
    zones.push({ type: 'pool', side: 'back', name: 'Swimming pool' });
    zones.push({ type: 'deck', side: 'back', name: 'Pool deck' });
  }
  if (dining) zones.push({ type: 'patio', side: 'back', covered: true, name: 'Outdoor dining' });
  if (garden) zones.push({ type: 'lawn', side: 'back', name: 'Garden lounge' });
  if (play) zones.push({ type: 'play', side: 'left', name: 'Kids play area' });
  else if (garden) zones.push({ type: 'garden', side: 'left' });
  if (garden) zones.push({ type: 'lawn', side: 'right' });
  if (fountain) zones.push({ type: 'water-feature', side: 'front', name: 'Fountain' });

  const intent = DesignIntentSchema.parse({
    title: brief.trim().slice(0, 80) || t('ai.offline.villaTitle'),
    levels: [{ name: 'Ground floor', rooms: rooms.slice(0, 20) }],
    strategy: 'wings',
    site: { zones, cars: cars || undefined },
    style: luxury ? { floor: has(/marble/) ? 'marble' : 'herringbone', walls: 'cream' } : undefined,
    furnish: !has(/\bunfurnished\b|\bempty\b/),
  });
  return { intent, understood };
}
