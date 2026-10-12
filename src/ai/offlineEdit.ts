import type { EditOperation, Side } from './schemas';
import { STAIR_TYPES_LIST } from './stairTypes';
import { exactRoomName, resolveRoomName } from './roomNames';
import type { Project } from '../model/types';

const SIDE_WORDS: Record<string, Side> = {
  north: 'north',
  top: 'north',
  south: 'south',
  bottom: 'south',
  east: 'east',
  right: 'east',
  west: 'west',
  left: 'west',
};

function metres(n: string, unit: string | undefined): number {
  const v = Number(n.replace(',', '.'));
  return /^(ft|feet|foot|')/.test(unit ?? '') ? v * 0.3048 : /^cm/.test(unit ?? '') ? v / 100 : v;
}

/** Splits "living room walls sage green" into the room ("Living room") and what is left ("walls sage green"). */
function splitRoom(phrase: string, project: Project): { name?: string; rest: string } {
  const words = phrase.split(/\s+/);
  // A prefix that is exactly a room's name wins (longest first); only then accept a looser match.
  for (let i = words.length - 1; i >= 1; i--) {
    const name = exactRoomName(project, words.slice(0, i).join(' '));
    if (name) return { name, rest: words.slice(i).join(' ') };
  }
  for (let i = words.length - 1; i >= 1; i--) {
    const name = resolveRoomName(project, words.slice(0, i).join(' '));
    if (name) return { name, rest: words.slice(i).join(' ') };
  }
  return { rest: phrase };
}

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, half: 0.5, a: 1 };

/**
 * A tiny rule-based reader for the most common edit commands, used when no language model is reachable.
 * Returns null when it does not understand the command.
 */
export function offlineEdit(command: string, project: Project): EditOperation[] | null {
  const text = command
    .toLowerCase()
    .replace(/[.!?]+$/, '')
    .trim();
  const room = (s: string | undefined) => (s ? resolveRoomName(project, s) : undefined);
  const NUM = '(\\d+(?:[.,]\\d+)?|one|two|three|half|a)';
  const UNIT = '(m|meters?|metres?|cm|ft|feet|foot)?';

  // "make the kitchen 1 meter wider"
  let m = new RegExp(
    `(?:make|resize|extend|enlarge|expand)\\s+(?:the\\s+)?(.+?)\\s+${NUM}\\s*${UNIT}\\s*(wider|broader|narrower|longer|shorter|deeper|bigger|larger|smaller)`,
  ).exec(text);
  if (m) {
    const name = room(m[1]);
    if (name) {
      const raw = m[2]!;
      const amount = WORD_NUM[raw] ?? metres(raw, m[3]);
      const dir = m[4]!;
      const shrink = /narrower|shorter|smaller/.test(dir);
      const dimension = /deeper|longer|shorter/.test(dir) ? 'depth' : 'width';
      return [{ op: 'resizeRoom', room: name, dimension, delta: shrink ? -amount : amount }];
    }
  }
  // "widen the kitchen by 1 m"
  m = new RegExp(
    `(widen|narrow|lengthen|shorten|deepen)\\s+(?:the\\s+)?(.+?)\\s+by\\s+${NUM}\\s*${UNIT}`,
  ).exec(text);
  if (m) {
    const name = room(m[2]);
    if (name) {
      const amount = WORD_NUM[m[3]!] ?? metres(m[3]!, m[4]);
      const shrink = /narrow|shorten/.test(m[1]!);
      return [
        {
          op: 'resizeRoom',
          room: name,
          dimension: /lengthen|shorten|deepen/.test(m[1]!) ? 'depth' : 'width',
          delta: shrink ? -amount : amount,
        },
      ];
    }
  }
  // "rename the study to library"
  m = /rename\s+(?:the\s+)?(.+?)\s+(?:to|as)\s+(.+)/.exec(text);
  if (m && room(m[1]))
    return [
      { op: 'renameRoom', room: room(m[1])!, name: m[2]!.replace(/\b\w/g, (c) => c.toUpperCase()) },
    ];
  // "change the floor in the living room to oak" / "paint the bedroom walls sage green"
  m =
    /(?:change|set|make|put)\s+(?:the\s+)?(floor|floors|walls?|ceiling)\s+(?:in|of)\s+(?:the\s+)?(.+?)\s+(?:to|with|into)\s+(.+)/.exec(
      text,
    );
  if (m && room(m[2]))
    return [
      {
        op: 'changeMaterial',
        target: /floor/.test(m[1]!) ? 'floor' : /ceiling/.test(m[1]!) ? 'ceiling' : 'walls',
        room: room(m[2])!,
        material: m[3]!,
      },
    ];
  m = /(?:paint|colou?r|repaint)\s+(?:all\s+)?(?:the\s+)?(.+)/.exec(text);
  if (m) {
    const { name, rest } = splitRoom(m[1]!, project);
    const material = rest
      .replace(/^(?:walls?|in|with|to)\s+/, '')
      .replace(/^(?:walls?|in|with|to)\s+/, '')
      .replace(/\s+walls?$/, '');
    if (name && material) return [{ op: 'changeMaterial', target: 'walls', room: name, material }];
    if (!name && /^walls?\b/.test(m[1]!))
      return [
        {
          op: 'changeMaterial',
          target: 'walls',
          material: m[1]!.replace(/^walls?\s+(?:in|with|to)?\s*/, ''),
        },
      ];
  }
  m = /(?:floors?|flooring)\s+(?:in|of)\s+(?:the\s+)?(.+?)\s+(?:to|should be|as)\s+(.+)/.exec(text);
  if (m && room(m[1]))
    return [{ op: 'changeMaterial', target: 'floor', room: room(m[1])!, material: m[2]! }];
  // "add a window to the north wall of the bedroom"
  m =
    /add\s+(?:a\s+)?(window|door|archway)\s+(?:to|on|in)\s+(?:the\s+)?(north|south|east|west|top|bottom|left|right)\s+(?:wall\s+)?(?:of|in)\s+(?:the\s+)?(.+)/.exec(
      text,
    );
  if (m && room(m[3]))
    return [
      {
        op: 'addOpening',
        kind: m[1] as 'window' | 'door' | 'archway',
        room: room(m[3])!,
        side: SIDE_WORDS[m[2]!]!,
      },
    ];
  // "add a plant to the study" / "put 2 chairs in the dining room"
  m = new RegExp(
    `(?:add|put|place|include)\\s+${NUM}?\\s*(.+?)\\s+(?:to|in|into|inside)\\s+(?:the\\s+)?(.+)`,
  ).exec(text);
  if (m && room(m[3])) {
    const count = m[1] ? (WORD_NUM[m[1]] ?? Number(m[1])) : 1;
    const item = m[2]!.replace(/^(a|an|some)\s+/, '').replace(/s$/, '');
    return [
      {
        op: 'addItem',
        catalogId: item,
        room: room(m[3])!,
        count: Math.min(6, Math.max(1, Math.round(count))),
      },
    ];
  }
  // "remove the plant from the study"
  m = /(?:remove|delete|take out)\s+(?:the\s+)?(.+?)\s+(?:from|in)\s+(?:the\s+)?(.+)/.exec(text);
  if (m && room(m[2])) return [{ op: 'removeItem', catalogId: m[1]!, room: room(m[2])! }];
  // "make the stairs L-shaped" / "change the stair to spiral"
  m =
    /(?:stairs?|staircase)\b.*\b(straight|l[- ]?shaped|u[- ]?shaped|spiral)|\b(straight|l[- ]?shaped|u[- ]?shaped|spiral)\s+(?:stairs?|staircase)/.exec(
      text,
    );
  if (m) {
    const w = (m[1] ?? m[2])!.replace(/[- ]?shaped/, '');
    const type = STAIR_TYPES_LIST.find((t) => t.toLowerCase() === w);
    if (type) return [{ op: 'changeStairType', type }];
  }
  return null;
}
