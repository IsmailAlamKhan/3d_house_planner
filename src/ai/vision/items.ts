import type { Candidate } from './assemble';
import { type VisionClient, jsonOf } from './client';
import { ITEMS_JSON_SCHEMA, ItemsAnswerSchema, SYSTEM_PROMPT, itemsPrompt } from './protocol';
import type { PictureSource } from './source';

/** What a person (or a model) calls a piece → the catalogue item that stands for it. The first match wins. */
const SYNONYMS: [RegExp, string][] = [
  [/\bu[- ]?shaped\b.*(sofa|sectional)|\bsectional\b/, 'sofa-u'],
  [/\bl[- ]?shaped\b.*(sofa|couch)|corner (sofa|couch)/, 'sofa-l'],
  [/\b(sofa|couch|loveseat|settee)\b/, 'sofa-3seat'],
  [/\barm ?chair\b|\brecliner\b/, 'armchair'],
  [/\bcoffee table\b|\bcent(re|er) table\b/, 'coffee-table'],
  [/\bdining table\b|\bdining\b.*\btable\b/, 'dining-table-6'],
  [/\b(kitchen )?island\b/, 'kitchen-island'],
  [/\bking\b.*\bbed\b|\bbed\b.*\bking\b/, 'bed-king'],
  [/\bsingle bed\b/, 'bed-single'],
  [/\bbed\b/, 'bed-queen'],
  [/\bwardrobe\b|\bcupboard\b/, 'wardrobe'],
  [/\bdresser\b|\bchest of drawers\b/, 'dresser'],
  [/\bbedside\b|\bnight ?stand\b|\bside table\b/, 'side-table'],
  [/\btv\b|\btelevision\b|\bmedia unit\b/, 'tv-unit'],
  [/\bbookshelf\b|\bbookcase\b|\bshelving\b/, 'bookshelf'],
  [/\bgaming (desk|setup|station)\b/, 'gaming-desk'],
  [/\bdesk\b|\bworkstation\b/, 'desk'],
  [/\boffice chair\b/, 'office-chair'],
  [/\bchair\b|\bstool\b/, 'chair'],
  [/\bfridge\b|\brefrigerator\b/, 'fridge'],
  [/\bstove\b|\bcooktop\b|\bhob\b|\bcooker\b/, 'stove'],
  [/\boven\b/, 'oven'],
  [/\bkitchen (sink|counter|cabinet)\b|\bcounter\b/, 'kitchen-base-run'],
  [/\bwashing machine\b|\bwasher\b|\bdryer\b/, 'washing-machine'],
  [/\btoilet\b|\bwc\b/, 'wc'],
  [/\bbath ?tub\b|\bbath\b/, 'bathtub'],
  [/\bshower\b/, 'shower'],
  [/\bsink\b|\bbasin\b|\bvanity\b/, 'basin'],
  [/\bspa tub\b|\bjacuzzi\b|\bhot tub\b/, 'hot-tub'],
  [/\btreadmill\b/, 'treadmill'],
  [/\bgym bench\b|\bweight bench\b/, 'gym-bench'],
  [/\bweight rack\b|\bsquat rack\b|\bgym rack\b|\bbarbell\b/, 'gym-rack'],
  [/\bsauna bench\b/, 'sauna-bench'],
  [/\bpalm\b/, 'tree-palm'],
  [/\btree\b/, 'tree-broad'],
  [/\bhedge\b/, 'hedge'],
  [/\bshrub\b|\bbush\b/, 'shrub'],
  [/\bflower ?bed\b/, 'flower-bed'],
  [/\bplant\b|\bfern\b|\bpotted\b/, 'plant-medium'],
  [/\bsun ?lounger\b|\bdeck chair\b|\blounge chair\b/, 'sun-lounger'],
  [/\bpergola\b/, 'pergola'],
  [/\bparasol\b|\bumbrella\b/, 'parasol'],
  [/\bfire ?pit\b/, 'fire-pit'],
  [/\bbbq\b|\bbarbecue\b|\bgrill\b/, 'bbq'],
  [/\btrampoline\b/, 'trampoline'],
  [/\bplay (tower|frame|house|structure)\b|\bslide\b|\bswing\b/, 'play-frame'],
  [/\bfountain\b/, 'fountain'],
  [/\bcar\b|\bsuv\b|\bvehicle\b/, 'car'],
  [/\brug\b|\bcarpet\b/, 'rug'],
  [/\bfloor lamp\b|\bstanding lamp\b/, 'floor-lamp'],
  [/\blamp\b/, 'table-lamp'],
];

/** The catalogue item for a name the model used, or null when nothing fits. */
export function catalogFor(name: string): string | null {
  const n = name.toLowerCase();
  for (const [re, id] of SYNONYMS) if (re.test(n)) return id;
  return null;
}

export interface FoundItem {
  /** The candidate (room or zone) it stands in. */
  candidateId: string;
  catalog: string;
  /** Picture pixels (centre). */
  at: [number, number];
  name: string;
}

/**
 * The optional items pass: look into each big enough room or area on its own and note its main furniture. Only pieces
 * with a catalogue match are kept; positions are the model's rough ones, so they are clamped into the room.
 */
export async function findItems(
  candidates: Candidate[],
  source: PictureSource,
  client: VisionClient,
  opts: {
    signal?: AbortSignal;
    minSidePx?: number;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<{ items: FoundItem[]; notes: string[] }> {
  const items: FoundItem[] = [];
  const notes: string[] = [];
  const min = opts.minSidePx ?? 60;
  const todo = candidates.filter((c) => c.box[2] - c.box[0] >= min && c.box[3] - c.box[1] >= min);
  let n = 0;
  for (const c of todo) {
    const pad = 0.04 * Math.max(c.box[2] - c.box[0], c.box[3] - c.box[1]);
    const x = Math.max(0, c.box[0] - pad);
    const y = Math.max(0, c.box[1] - pad);
    const w = Math.min(source.width, c.box[2] + pad) - x;
    const h = Math.min(source.height, c.box[3] + pad) - y;
    try {
      const image = await source.crop({ x, y, w, h }, 900);
      const text = await client.ask({
        system: SYSTEM_PROMPT,
        prompt: itemsPrompt(c.name),
        images: [image],
        schema: ITEMS_JSON_SCHEMA as unknown as Record<string, unknown>,
        temperature: 0,
        signal: opts.signal,
      });
      const a = ItemsAnswerSchema.parse(jsonOf(text));
      for (const it of a.items) {
        const catalog = catalogFor(it.name);
        if (!catalog) continue;
        const px = Math.min(c.box[2], Math.max(c.box[0], x + (it.x / 1000) * w));
        const py = Math.min(c.box[3], Math.max(c.box[1], y + (it.y / 1000) * h));
        const copies = Math.max(1, Math.min(8, Math.round(it.count ?? 1)));
        for (let k = 0; k < copies; k++)
          items.push({ candidateId: c.id, catalog, at: [px + k * 14, py], name: it.name });
      }
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      notes.push(`Looking into "${c.name}" failed: ${(e as Error).message}`);
    }
    opts.onProgress?.(++n, todo.length);
  }
  return { items, notes };
}
