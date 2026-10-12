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
}

export function generateSystemPrompt(shell: ShellInfo): string {
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
