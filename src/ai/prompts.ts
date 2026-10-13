import { CATALOG } from '../catalog';
import { ROOM_TYPES } from '../model/schemas';
import { MATERIALS } from '../materials';

/** Prompts are short on purpose: small local models follow a few clear rules and examples far better than long text. */

const GEN_EXAMPLE_1 = {
  title: '2-bedroom duplex, open kitchen',
  levels: [
    {
      name: 'Ground floor',
      rooms: [
        {
          type: 'living',
          name: 'Living room',
          targetArea: 26,
          exteriorWall: 'required',
          adjacency: [{ room: 'Kitchen', connection: 'open' }],
        },
        { type: 'kitchen', name: 'Kitchen', targetArea: 12, needsPlumbing: true },
        { type: 'dining', name: 'Dining', targetArea: 10 },
        {
          type: 'bathroom',
          name: 'Guest bath',
          targetArea: 4.5,
          needsPlumbing: true,
          exteriorWall: 'none',
        },
      ],
    },
    {
      name: 'Upper floor',
      rooms: [
        {
          type: 'bedroom',
          name: 'Master bedroom',
          targetArea: 17,
          exteriorWall: 'required',
          adjacency: [{ room: 'Master bath', connection: 'door' }],
        },
        {
          type: 'bathroom',
          name: 'Master bath',
          targetArea: 6,
          needsPlumbing: true,
          exteriorWall: 'none',
          above: 'Guest bath',
        },
        { type: 'bedroom', name: 'Bedroom 2', targetArea: 12.5, exteriorWall: 'required' },
        {
          type: 'bathroom',
          name: 'Family bath',
          targetArea: 5,
          needsPlumbing: true,
          exteriorWall: 'none',
        },
      ],
    },
  ],
  stair: { type: 'straight', position: 'near-entrance' },
  style: { floor: 'light-wood', walls: 'white' },
  furnish: true,
};

const GEN_EXAMPLE_2 = {
  title: 'Cozy home for two with an office',
  levels: [
    {
      name: 'Ground floor',
      rooms: [
        {
          type: 'living',
          name: 'Living room',
          targetArea: 24,
          exteriorWall: 'required',
          adjacency: [{ room: 'Kitchen', connection: 'door' }],
        },
        { type: 'kitchen', name: 'Kitchen', targetArea: 11, needsPlumbing: true },
        { type: 'study', name: 'Home office', targetArea: 10, exteriorWall: 'required' },
        {
          type: 'bathroom',
          name: 'Guest bath',
          targetArea: 4,
          needsPlumbing: true,
          exteriorWall: 'none',
        },
      ],
    },
    {
      name: 'Upper floor',
      rooms: [
        {
          type: 'bedroom',
          name: 'Bedroom',
          targetArea: 18,
          exteriorWall: 'required',
          adjacency: [{ room: 'Bath', connection: 'door' }],
        },
        {
          type: 'bathroom',
          name: 'Bath',
          targetArea: 6,
          needsPlumbing: true,
          exteriorWall: 'none',
          above: 'Guest bath',
        },
        { type: 'other', name: 'Walk-in wardrobe', targetArea: 6, exteriorWall: 'none' },
      ],
    },
  ],
  stair: { type: 'straight', position: 'near-entrance' },
  style: { floor: 'dark-wood', walls: 'cream', mood: 'cozy' },
  furnish: true,
};

export interface ShellInfo {
  /** East-west and north-south size of the usable rectangle (m). */
  width: number;
  depth: number;
  levels?: number;
  /** The project is a villa on a plot: ask for the one-level wings design and outdoor zones. */
  villa?: boolean;
}

export function generateSystemPrompt(shell: ShellInfo): string {
  if (shell.villa) return generateVillaSystemPrompt(shell);
  const perLevel = Math.round(shell.width * shell.depth - 7);
  return `You are an architect's assistant. Design a duplex home as ONE JSON object that matches the given schema. Reply with JSON only — no prose, no markdown.

Rules:
- "levels": ground floor first; a duplex has 2 levels. Each level has "name" and "rooms".
- Room "type" is one of: ${ROOM_TYPES.join(', ')}. "name" must be unique on its level.
- "targetArea" is in square metres. Typical: living 22-30, kitchen 9-14, dining 9-12, master bedroom 15-18, bedroom 10-13, bathroom 4-7, study 8-11, utility 4-6.
- The shell is ${shell.width.toFixed(1)} m × ${shell.depth.toFixed(1)} m = ${Math.round(shell.width * shell.depth)} m² per level. The rooms of a level should add up to about ${perLevel} m² (the staircase hall takes about 7 m²).
- Do NOT add stairs, hallways or corridors; the staircase and hall are added automatically.
- "adjacency": names of rooms on the SAME level that must share a wall with this room. Use connection "open" for open-plan links (kitchen with living or dining), otherwise "door". Attach a bathroom to a bedroom only when an en-suite is wanted.
- Kitchen and bathrooms need plumbing ("needsPlumbing": true). Put upstairs bathrooms above downstairs bathrooms or the kitchen ("above": name of the room below).
- "exteriorWall": "required" for living spaces and bedrooms (they need windows), "none" for bathrooms and utility.
- "style": floor one of light-wood, dark-wood, herringbone, tile-grey, tile-white, concrete, marble; walls one of white, cream, grey, sage, blue, terracotta, charcoal.
- Never include more than 8 rooms per level.
- ALWAYS give exactly 2 levels ("Ground floor" then "Upper floor") unless the brief says single-storey. Living areas go on the ground floor, bedrooms upstairs.
- Honour counts in the brief: "3 bedrooms" means three separate rooms with type "bedroom" (master + two others), "4 baths" four bathrooms. If a brief gives no count, choose 2-3 bedrooms.
- A vague brief ("cozy", "as many as fit") still needs a complete design: living, kitchen, at least one bedroom and one bathroom.

Example brief: "2 bedroom duplex with open kitchen"
${JSON.stringify(GEN_EXAMPLE_1)}

Example brief: "something cozy for 2 people with a home office"
${JSON.stringify(GEN_EXAMPLE_2)}`;
}

export const generateUserPrompt = (brief: string): string =>
  `Brief: ${brief.trim()}\nReply with the JSON object only.`;

export function editSystemPrompt(): string {
  const items = CATALOG.filter((c) => c.placement !== 'wall')
    .map((c) => c.catalogId)
    .join(', ');
  const mats = MATERIALS.filter((m) => m.categories.length)
    .map((m) => m.id)
    .join(', ');
  return `You edit a floor plan. Turn the user's command into a JSON object {"summary": "...", "operations": [...]} — JSON only, no prose.

Operations ("op"):
- resizeRoom {room, dimension: "width"|"depth", delta (metres, + grows) OR to (new size), anchor? (side that stays: north|south|east|west)} — width = east-west, depth = north-south.
- moveWall {room, side: north|south|east|west, distance (metres, + pushes the wall outward)}.
- addRoom {name, type, from (room to carve it from), side, size (depth in metres)}.
- removeRoom {room, mergeInto?}.
- renameRoom {room, name?, type?}.
- changeMaterial {target: "floor"|"walls"|"ceiling", room? or level?, material}. Materials: ${mats}, or "paint:#rrggbb" for any colour.
- addItem {catalogId, room, count?}. Ids: ${items}.
- removeItem {catalogId, room?}; moveItem {catalogId, room?, dx?, dy?} (metres; east/south positive).
- addOpening {kind: door|window|archway, room, side}.
- changeStairType {type: straight|L|U|spiral}.

Use room names exactly as listed in the project summary. North is the top of the plan, east is the right. Use as few operations as needed.

Examples:
"make the kitchen 1 meter wider" → {"summary":"Widen the kitchen by 1 m","operations":[{"op":"resizeRoom","room":"Kitchen","dimension":"width","delta":1}]}
"paint the living room sage green and use dark wood on the floor" → {"summary":"Sage walls, dark floor","operations":[{"op":"changeMaterial","target":"walls","room":"Living room","material":"paint-sage"},{"op":"changeMaterial","target":"floor","room":"Living room","material":"floor-walnut"}]}
"add a plant and a bookshelf to the study" → {"summary":"Add plant and bookshelf","operations":[{"op":"addItem","catalogId":"plant","room":"Study"},{"op":"addItem","catalogId":"bookshelf","room":"Study"}]}`;
}

export const editUserPrompt = (summary: string, command: string): string =>
  `Project:\n${summary}\n\nCommand: ${command.trim()}\nReply with the JSON object only.`;

export const repairPrompt = (errors: string[]): string =>
  `Your reply was not valid:\n${errors.map((e) => `- ${e}`).join('\n')}\nReply again with ONLY the corrected JSON object.`;

const VILLA_EXAMPLE = {
  title: 'Luxury villa with pool, garden and 2-car parking',
  strategy: 'wings',
  levels: [
    {
      name: 'Ground floor',
      rooms: [
        { type: 'foyer', name: 'Foyer', targetArea: 7 },
        {
          type: 'living',
          name: 'Living & Dining',
          targetArea: 48,
          exteriorWall: 'required',
          adjacency: [{ room: 'Kitchen', connection: 'open' }],
        },
        { type: 'kitchen', name: 'Kitchen', targetArea: 16, needsPlumbing: true },
        {
          type: 'bedroom',
          name: 'Master bedroom',
          targetArea: 24,
          exteriorWall: 'required',
          adjacency: [
            { room: 'Master bath', connection: 'door' },
            { room: 'Walk-in closet', connection: 'door' },
          ],
        },
        {
          type: 'bathroom',
          name: 'Master bath',
          targetArea: 9,
          needsPlumbing: true,
          exteriorWall: 'none',
        },
        { type: 'walk-in-closet', name: 'Walk-in closet', targetArea: 7, exteriorWall: 'none' },
        { type: 'bedroom', name: 'Bedroom 2', targetArea: 15, exteriorWall: 'required' },
        {
          type: 'bathroom',
          name: 'Bath 2',
          targetArea: 5.5,
          needsPlumbing: true,
          exteriorWall: 'none',
        },
        { type: 'gym', name: 'Gym', targetArea: 16 },
        { type: 'sauna', name: 'Sauna', targetArea: 5, needsPlumbing: true, exteriorWall: 'none' },
      ],
    },
  ],
  site: {
    cars: 2,
    zones: [
      { type: 'parking', side: 'front', covered: true },
      { type: 'garden', side: 'front' },
      { type: 'pool', side: 'back' },
      { type: 'deck', side: 'back' },
      { type: 'patio', side: 'back', covered: true, name: 'Outdoor dining' },
      { type: 'lawn', side: 'back' },
      { type: 'play', side: 'left' },
    ],
  },
  style: { floor: 'herringbone', walls: 'cream' },
  furnish: true,
};

function generateVillaSystemPrompt(shell: ShellInfo): string {
  return `You are an architect's assistant. Design a single-storey villa on a plot as ONE JSON object that matches the given schema. Reply with JSON only — no prose, no markdown.

Rules:
- Set "strategy": "wings" and give exactly ONE level ("Ground floor"). The plan is: a "Foyer" at the front, a central open "Living & Dining" hall (type "living"), and the other rooms split between a left and a right wing.
- Room "type" is one of: ${ROOM_TYPES.join(', ')}. "name" must be unique.
- "targetArea" is in square metres. Typical: living & dining 40-55, kitchen 14-18, master bedroom 22-26, bedroom 13-16, bathroom 5-9, walk-in-closet 6-8, gym 14-18, sauna 4-6, spa 8-10, game-room 14-18, home-theatre 16-20, foyer 6-8.
- The building is about ${shell.width.toFixed(1)} m × ${shell.depth.toFixed(1)} m = ${Math.round(shell.width * shell.depth)} m². The rooms should add up to about ${Math.round(shell.width * shell.depth * 0.9)} m².
- Do NOT add corridors or stairs. Never more than 18 rooms.
- "adjacency": names of rooms that must share a wall. Put a bathroom next to its bedroom (connection "door"). Kitchen is "open" to Living & Dining.
- Kitchen, bathrooms, sauna and spa need plumbing ("needsPlumbing": true).
- "site.zones": outdoor areas, each with "type" (garden, lawn, pool, deck, patio, parking, play, water-feature) and "side" (front, back, left, right; the front faces the entrance). Parking goes at the front with "covered": true; the pool and deck at the back. Set "site.cars" to the number of cars.
- Honour counts in the brief ("3 bedrooms" = three rooms of type "bedroom").

Example brief: "luxury villa with pool, garden, 2-car garage, gym and sauna"
${JSON.stringify(VILLA_EXAMPLE)}`;
}
