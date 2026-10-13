import type { TranslationKey } from '../i18n';
import { DesignIntentSchema, type DesignIntent } from '../ai/schemas';

export interface DuplexTemplate {
  id: 'compact-2br' | 'family-3br' | 'open-double-height' | 'home-office' | 'luxury-villa';
  /** Which kind of project it suits. */
  kind?: 'villa';
  nameKey: TranslationKey;
  descKey: TranslationKey;
  intent: DesignIntent;
}

const room = (type: string, name: string, targetArea: number, extra: object = {}) => ({
  type,
  name,
  targetArea,
  ...extra,
});

/**
 * Hand-built starting points. They only state wishes (rooms, rough areas, adjacency); the layout solver fits them to
 * whatever shell the user has, scaling areas and re-arranging so rooms never overlap.
 */
export const TEMPLATES: DuplexTemplate[] = [
  {
    id: 'compact-2br',
    nameKey: 'tpl.compact',
    descKey: 'tpl.compactDesc',
    intent: DesignIntentSchema.parse({
      title: 'Compact 2-bedroom duplex',
      levels: [
        {
          name: 'Ground floor',
          rooms: [
            room('living', 'Living room', 20, {
              adjacency: [{ room: 'Kitchen', connection: 'open' }],
            }),
            room('kitchen', 'Kitchen', 9, { needsPlumbing: true }),
            room('bathroom', 'Guest bath', 3.5, { needsPlumbing: true, exteriorWall: 'none' }),
          ],
        },
        {
          name: 'Upper floor',
          rooms: [
            room('bedroom', 'Master bedroom', 13, {
              adjacency: [{ room: 'Bath', connection: 'door' }],
            }),
            room('bathroom', 'Bath', 4.5, {
              needsPlumbing: true,
              exteriorWall: 'none',
              above: 'Guest bath',
            }),
            room('bedroom', 'Bedroom 2', 10),
          ],
        },
      ],
    }),
  },
  {
    id: 'family-3br',
    nameKey: 'tpl.family',
    descKey: 'tpl.familyDesc',
    intent: DesignIntentSchema.parse({
      title: '3-bedroom family duplex',
      levels: [
        {
          name: 'Ground floor',
          rooms: [
            room('living', 'Living room', 24, {
              adjacency: [{ room: 'Dining', connection: 'open' }],
            }),
            room('dining', 'Dining', 10, { adjacency: [{ room: 'Kitchen', connection: 'open' }] }),
            room('kitchen', 'Kitchen', 12, { needsPlumbing: true }),
            room('bathroom', 'Guest bath', 4.5, { needsPlumbing: true, exteriorWall: 'none' }),
            room('utility', 'Utility', 5, { needsPlumbing: true, exteriorWall: 'none' }),
          ],
        },
        {
          name: 'Upper floor',
          rooms: [
            room('bedroom', 'Master bedroom', 17, {
              adjacency: [{ room: 'Master bath', connection: 'door' }],
            }),
            room('bathroom', 'Master bath', 6, {
              needsPlumbing: true,
              exteriorWall: 'none',
              above: 'Guest bath',
            }),
            room('bedroom', 'Bedroom 2', 12.5),
            room('bedroom', 'Bedroom 3', 12),
            room('bathroom', 'Family bath', 5, { needsPlumbing: true, exteriorWall: 'none' }),
          ],
        },
      ],
    }),
  },
  {
    id: 'open-double-height',
    nameKey: 'tpl.double',
    descKey: 'tpl.doubleDesc',
    intent: DesignIntentSchema.parse({
      title: 'Open plan with double-height living',
      levels: [
        {
          name: 'Ground floor',
          rooms: [
            room('living', 'Living room', 36, {
              doubleHeight: true,
              exteriorWall: 'required',
              adjacency: [{ room: 'Kitchen', connection: 'open' }],
            }),
            room('kitchen', 'Kitchen', 12, { needsPlumbing: true }),
            room('dining', 'Dining', 10),
            room('bathroom', 'Guest bath', 4.5, { needsPlumbing: true, exteriorWall: 'none' }),
          ],
        },
        {
          name: 'Upper floor',
          rooms: [
            room('bedroom', 'Master bedroom', 17, {
              adjacency: [{ room: 'Master bath', connection: 'door' }],
            }),
            room('bathroom', 'Master bath', 6, {
              needsPlumbing: true,
              exteriorWall: 'none',
              above: 'Guest bath',
            }),
            room('bedroom', 'Bedroom 2', 12),
          ],
        },
      ],
    }),
  },
  {
    id: 'home-office',
    nameKey: 'tpl.office',
    descKey: 'tpl.officeDesc',
    intent: DesignIntentSchema.parse({
      title: 'Home-office duplex',
      levels: [
        {
          name: 'Ground floor',
          rooms: [
            room('study', 'Home office', 12, { exteriorWall: 'required' }),
            room('living', 'Living room', 22, {
              adjacency: [{ room: 'Kitchen', connection: 'open' }],
            }),
            room('kitchen', 'Kitchen', 10, { needsPlumbing: true }),
            room('bathroom', 'Guest bath', 4, { needsPlumbing: true, exteriorWall: 'none' }),
          ],
        },
        {
          name: 'Upper floor',
          rooms: [
            room('bedroom', 'Master bedroom', 15, {
              adjacency: [{ room: 'Bath', connection: 'door' }],
            }),
            room('bathroom', 'Bath', 5, {
              needsPlumbing: true,
              exteriorWall: 'none',
              above: 'Guest bath',
            }),
            room('bedroom', 'Bedroom 2', 11),
          ],
        },
      ],
    }),
  },
];

/** Villa starting point modelled on the reference plan: foyer, central hall, two wings, gym / sauna / spa, outdoor living. */
export const VILLA_TEMPLATE: DuplexTemplate = {
  id: 'luxury-villa',
  kind: 'villa',
  nameKey: 'tpl.villa',
  descKey: 'tpl.villaDesc',
  intent: DesignIntentSchema.parse({
    title: 'Luxury villa',
    strategy: 'wings',
    levels: [
      {
        name: 'Ground floor',
        rooms: [
          room('foyer', 'Foyer', 7, { needsWindow: false }),
          room('living', 'Living & Dining', 50, {
            exteriorWall: 'required',
            adjacency: [{ room: 'Kitchen', connection: 'open' }],
          }),
          room('kitchen', 'Kitchen', 16, { needsPlumbing: true }),
          room('laundry', 'Laundry', 6, { needsPlumbing: true, exteriorWall: 'none' }),
          room('bedroom', 'Master bedroom', 24, {
            exteriorWall: 'required',
            adjacency: [
              { room: 'Master bath', connection: 'door' },
              { room: 'Walk-in closet', connection: 'door' },
            ],
          }),
          room('bathroom', 'Master bath', 9, { needsPlumbing: true, exteriorWall: 'none' }),
          room('walk-in-closet', 'Walk-in closet', 7, { exteriorWall: 'none' }),
          room('bedroom', 'Bedroom 2', 15, {
            exteriorWall: 'required',
            adjacency: [{ room: 'Bath 2', connection: 'door' }],
          }),
          room('bathroom', 'Bath 2', 5.5, { needsPlumbing: true, exteriorWall: 'none' }),
          room('bedroom', 'Bedroom 3', 15, {
            exteriorWall: 'required',
            adjacency: [{ room: 'Bath 3', connection: 'door' }],
          }),
          room('bathroom', 'Bath 3', 5.5, { needsPlumbing: true, exteriorWall: 'none' }),
          room('game-room', 'Game room', 16),
          room('bedroom', 'Guest room', 14, {
            exteriorWall: 'required',
            adjacency: [{ room: 'Guest bath', connection: 'door' }],
          }),
          room('bathroom', 'Guest bath', 5, { needsPlumbing: true, exteriorWall: 'none' }),
          room('gym', 'Gym', 16, { adjacency: [{ room: 'Sauna', connection: 'door' }] }),
          room('sauna', 'Sauna', 5, { needsPlumbing: true, exteriorWall: 'none' }),
          room('spa', 'Spa', 9, { needsPlumbing: true, exteriorWall: 'none' }),
        ],
      },
    ],
    site: {
      cars: 2,
      zones: [
        { type: 'parking', side: 'front', covered: true, name: 'Covered parking' },
        { type: 'garden', side: 'front', name: 'Front garden' },
        { type: 'pool', side: 'back', name: 'Infinity pool' },
        { type: 'deck', side: 'back', name: 'Pool deck' },
        { type: 'patio', side: 'back', covered: true, name: 'Outdoor dining' },
        { type: 'lawn', side: 'back', name: 'Garden lounge' },
        { type: 'play', side: 'left', name: 'Kids play area' },
        { type: 'garden', side: 'right' },
      ],
    },
    style: { floor: 'herringbone', walls: 'cream' },
  }),
};

export const getTemplate = (id: DuplexTemplate['id']): DuplexTemplate =>
  [...TEMPLATES, VILLA_TEMPLATE].find((t) => t.id === id)!;
