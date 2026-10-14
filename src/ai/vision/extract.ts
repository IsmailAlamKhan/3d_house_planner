import { ProviderError } from '../provider';
import {
  type Box,
  type Candidate,
  type LabelHit,
  type MergedRegion,
  type RegionHit,
  assemble,
  labelHits,
  makeTiles,
  mergeRegions,
  tileBoxToImage,
} from './assemble';
import { type VisionClient, jsonOf } from './client';
import { classify, nameSimilarity } from './labels';
import {
  LABELS_JSON_SCHEMA,
  LABELS_PROMPT,
  LabelsAnswerSchema,
  REGIONS_JSON_SCHEMA,
  RegionsAnswerSchema,
  SYSTEM_PROMPT,
  regionsPrompt,
} from './protocol';
import type { PictureSource } from './source';

export interface ExtractProgress {
  phase: 'labels' | 'regions';
  done: number;
  total: number;
}

export interface ExtractOptions {
  client: VisionClient;
  source: PictureSource;
  /** Feet per pixel of the rectified picture, when the real size is known. */
  ftPerPx?: number;
  onProgress?: (p: ExtractProgress) => void;
  signal?: AbortSignal;
  /** Longest side of a tile sent to the model (pixels). */
  tileSide?: number;
  /** Read labels from the whole picture, from every tile, or both (default). */
  labelPasses?: 'whole' | 'tiles' | 'both';
}

export interface Extraction {
  picture: { width: number; height: number };
  labels: LabelHit[];
  regions: MergedRegion[];
  candidates: Candidate[];
  /** Everything the model said that could not be used. */
  notes: string[];
}

/** Asks, parses, and asks once more with a reminder if the answer is not usable. */
async function askJson<T>(
  opts: ExtractOptions,
  req: { prompt: string; schema: Record<string, unknown>; image: string },
  parse: (v: unknown) => T,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await opts.client.ask({
      system: SYSTEM_PROMPT,
      prompt: attempt ? `${req.prompt}\nAnswer with the JSON object only.` : req.prompt,
      images: [req.image],
      schema: req.schema,
      temperature: 0,
      signal: opts.signal,
    });
    try {
      return parse(jsonOf(text));
    } catch (e) {
      last = e;
      if (opts.signal?.aborted) throw e;
    }
  }
  throw last instanceof Error ? last : new ProviderError('The model did not answer usably.');
}

const clip = (b: Box, w: number, h: number): Box => [
  Math.max(0, Math.min(w, b[0])),
  Math.max(0, Math.min(h, b[1])),
  Math.max(0, Math.min(w, b[2])),
  Math.max(0, Math.min(h, b[3])),
];

/** Pass 1 (labels) and pass 2 (boxes per tile), merged and put together. Nothing here changes the project. */
export async function extract(opts: ExtractOptions): Promise<Extraction> {
  const { source } = opts;
  const { width, height } = source;
  const tileSide = opts.tileSide ?? 900;
  const tiles = makeTiles(width, height, tileSide);
  const notes: string[] = [];
  let firstError: Error | undefined;
  const failed = (what: string, e: unknown) => {
    firstError ??= e instanceof Error ? e : new Error(String(e));
    notes.push(`${what}: ${(e as Error).message}`);
  };
  const mode = opts.labelPasses ?? 'both';
  const labelCalls = (mode !== 'tiles' ? 1 : 0) + (mode !== 'whole' ? tiles.length : 0);
  let done = 0;

  // ── pass 1: labels ──
  const labels: LabelHit[] = [];
  const addLabels = (hits: LabelHit[], at: { x: number; y: number; w: number; h: number }) => {
    for (const h of hits) {
      const g = { ...h, x: at.x + h.x, y: at.y + h.y };
      const dup = labels.some(
        (l) =>
          nameSimilarity(l.name, g.name) === 1 &&
          Math.hypot(l.x - g.x, l.y - g.y) < Math.max(width, height) * 0.04,
      );
      if (!dup) labels.push(g);
    }
  };
  const readLabels = async (
    area: { x: number; y: number; w: number; h: number },
    side: number,
    what: string,
  ) => {
    try {
      const image = await source.crop(area, side);
      const a = await askJson(
        opts,
        { prompt: LABELS_PROMPT, schema: LABELS_JSON_SCHEMA, image },
        (v) => LabelsAnswerSchema.parse(v),
      );
      addLabels(labelHits(a, area.w, area.h), area);
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      failed(`Reading the labels of ${what} failed`, e);
    }
    opts.onProgress?.({ phase: 'labels', done: ++done, total: labelCalls });
  };
  if (mode !== 'tiles')
    await readLabels({ x: 0, y: 0, w: width, h: height }, 1600, 'the whole picture');
  if (mode !== 'whole') for (const t of tiles) await readLabels(t, tileSide, 'one tile');

  // ── pass 2: boxes per tile ──
  const hits: RegionHit[] = [];
  done = 0;
  for (const [i, t] of tiles.entries()) {
    try {
      const image = await source.crop(t, tileSide);
      const a = await askJson(
        opts,
        { prompt: regionsPrompt(), schema: REGIONS_JSON_SCHEMA, image },
        (v) => RegionsAnswerSchema.parse(v),
      );
      for (const r of a.regions) {
        const c = r.label ? classify(r.label) : null;
        hits.push({
          label: r.label,
          kind: c && c.type !== 'other' ? c.kind : r.kind,
          box: clip(tileBoxToImage(t, r), width, height),
          tile: i,
        });
      }
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      failed('Reading the rooms of one tile failed', e);
    }
    opts.onProgress?.({ phase: 'regions', done: ++done, total: tiles.length });
  }
  // nothing at all came back and the model kept failing: say why instead of showing an empty review
  if (!labels.length && !hits.length && firstError) throw firstError;
  const regions = mergeRegions(hits, tiles);
  const candidates = assemble(
    labels,
    regions,
    { width, height },
    opts.ftPerPx ? 1 / opts.ftPerPx : undefined,
  );
  return { picture: { width, height }, labels, regions, candidates, notes };
}
