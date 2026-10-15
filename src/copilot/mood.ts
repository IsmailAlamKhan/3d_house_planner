import { z } from 'zod';
import { type VisionClient, jsonOf } from '../ai/vision/client';
import { STYLE_IDS } from '../model/schemas';
import type { BriefOp } from './brief';
import { STYLE_PRESETS, styleById } from './styles';

/** The main colours of a picture: RGBA pixels (e.g. from a canvas) → a few `#rrggbb` swatches, biggest first. */
export function dominantColors(rgba: Uint8ClampedArray | number[], count = 5): string[] {
  // Quantise to 4 bits per channel and count: simple, deterministic, plenty for a mood.
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < rgba.length; i += 16) {
    // every 4th pixel
    if (rgba[i + 3]! < 128) continue;
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += r;
    e.g += g;
    e.b += b;
    bins.set(k, e);
  }
  const sorted = [...bins.values()].sort((a, b) => b.n - a.n);
  const out: { r: number; g: number; b: number }[] = [];
  for (const e of sorted) {
    const c = { r: e.r / e.n, g: e.g / e.n, b: e.b / e.n };
    // Skip a colour too close to one already taken, so the swatches differ.
    if (out.some((o) => Math.hypot(o.r - c.r, o.g - c.g, o.b - c.b) < 48)) continue;
    out.push(c);
    if (out.length >= count) break;
  }
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return out.map((c) => `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`);
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s, l };
}

/** Which style a palette points at: green and bright → tropical, grey and dark → industrial, warm and pale → warm minimal … */
export function styleFromPalette(palette: string[]): (typeof STYLE_IDS)[number] {
  if (!palette.length) return 'warm-minimal';
  const c = palette.map(hsl);
  const avgL = c.reduce((s, x) => s + x.l, 0) / c.length;
  const avgS = c.reduce((s, x) => s + x.s, 0) / c.length;
  const greens = c.filter((x) => x.h > 70 && x.h < 170 && x.s > 0.25).length / c.length;
  const warm = c.filter((x) => (x.h < 50 || x.h > 330) && x.s > 0.12).length / c.length;
  if (greens >= 0.3) return 'tropical';
  if (avgS < 0.12 && avgL < 0.5) return 'industrial';
  if (avgL < 0.4 && warm >= 0.3) return 'classic';
  if (avgL > 0.62 && avgS < 0.3) return warm >= 0.3 ? 'warm-minimal' : 'modern-luxury';
  if (warm >= 0.4) return 'classic';
  return avgL > 0.5 ? 'warm-minimal' : 'modern-luxury';
}

export interface MoodResult {
  ops: BriefOp[];
  summary: string[];
  source: 'model' | 'colours';
}

export const MoodAnswerSchema = z.object({
  style: z.enum(STYLE_IDS),
  keywords: z.array(z.string()).max(10).default([]),
  palette: z.array(z.string()).max(6).default([]),
  materials: z.array(z.string()).max(8).default([]),
  features: z.array(z.string()).max(8).default([]),
});
export type MoodAnswer = z.infer<typeof MoodAnswerSchema>;

const MOOD_SCHEMA = {
  type: 'object',
  properties: {
    style: { type: 'string', enum: [...STYLE_IDS] },
    keywords: { type: 'array', items: { type: 'string' } },
    palette: { type: 'array', items: { type: 'string' } },
    materials: { type: 'array', items: { type: 'string' } },
    features: { type: 'array', items: { type: 'string' } },
  },
  required: ['style'],
};

const MOOD_PROMPT = `These pictures show interiors or exteriors a client likes. Describe the look they share.
Answer with JSON: "style" is the closest of ${STYLE_IDS.join(', ')}; "keywords" are 3-8 words for the mood; "palette" are 3-5 main colours as #rrggbb; "materials" are visible materials (oak floor, marble, brick, concrete, rattan...); "features" are notable features (double-height living room, large windows, pergola, courtyard...). JSON only.`;

/**
 * Style from mood pictures: the vision model reads style, materials, colours and features; without it (or if it fails)
 * the colours alone decide. The result goes into the brief's style section — never into the layout.
 */
export async function moodFromImages(
  images: string[],
  palettes: string[][],
  opts: { client: VisionClient | null; signal?: AbortSignal },
): Promise<MoodResult> {
  const colours = [...new Set(palettes.flat())].slice(0, 8);
  const fromColours = styleFromPalette(colours);
  if (opts.client && images.length) {
    try {
      const text = await opts.client.ask({
        prompt: MOOD_PROMPT,
        images: images.slice(0, 4),
        schema: MOOD_SCHEMA,
        temperature: 0,
        signal: opts.signal,
      });
      const a = MoodAnswerSchema.parse(jsonOf(text));
      const palette = (a.palette.length ? a.palette : colours).filter((p) =>
        /^#[0-9a-f]{6}$/i.test(p),
      );
      return {
        ops: [
          {
            op: 'setStyle',
            preset: a.style,
            keywords: [...a.keywords, ...a.materials, ...a.features],
            palette,
          },
        ],
        summary: [
          styleById(a.style)?.id ?? a.style,
          ...a.materials.slice(0, 4),
          ...a.features.slice(0, 3),
        ],
        source: 'model',
      };
    } catch (e) {
      if (opts.signal?.aborted) throw e;
    }
  }
  return {
    ops: [{ op: 'setStyle', preset: fromColours, palette: colours }],
    summary: [fromColours],
    source: 'colours',
  };
}

export const STYLE_ORDER = STYLE_PRESETS.map((s) => s.id);
