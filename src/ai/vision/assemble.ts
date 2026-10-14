import { classify, nameSimilarity, nameOf, parseSize, type Kind } from './labels';
import type { LabelsAnswer } from './protocol';

/** A box in picture pixels: [left, top, right, bottom]. */
export type Box = [number, number, number, number];
export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
}

const area = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const inter = (a: Box, b: Box): Box => [
  Math.max(a[0], b[0]),
  Math.max(a[1], b[1]),
  Math.min(a[2], b[2]),
  Math.min(a[3], b[3]),
];
export const iou = (a: Box, b: Box): number => {
  const i = area(inter(a, b));
  return i <= 0 ? 0 : i / (area(a) + area(b) - i);
};
const gap = (a: Box, b: Box): number =>
  Math.max(
    0,
    Math.max(a[0], b[0]) - Math.min(a[2], b[2]),
    Math.max(a[1], b[1]) - Math.min(a[3], b[3]),
  );

/**
 * Overlapping tiles that cover a picture. Vision models are weak at precise geometry on a large image, so the plan is
 * read piece by piece: each tile is at most `maxSide` pixels on a side, neighbours overlap by `overlap` of a tile.
 */
export function makeTiles(width: number, height: number, maxSide = 900, overlap = 0.2): Tile[] {
  const axis = (len: number): [number, number][] => {
    const n = Math.max(1, Math.ceil((len - maxSide * overlap) / (maxSide * (1 - overlap))));
    if (n === 1) return [[0, len]];
    const size = Math.min(len, Math.ceil(len / (n - (n - 1) * overlap)));
    const step = (len - size) / (n - 1);
    return Array.from({ length: n }, (_, i) => [Math.round(i * step), size]);
  };
  const xs = axis(width);
  const ys = axis(height);
  return ys.flatMap(([y, h]) => xs.map(([x, w]) => ({ x, y, w, h })));
}

/** A box in a tile's 0–1000 scale → picture pixels. */
export function tileBoxToImage(
  t: Tile,
  b: { x0: number; y0: number; x1: number; y1: number },
): Box {
  const x = (v: number) => t.x + (v / 1000) * t.w;
  const y = (v: number) => t.y + (v / 1000) * t.h;
  const [x0, x1] = [x(b.x0), x(b.x1)].sort((p, q) => p - q) as [number, number];
  const [y0, y1] = [y(b.y0), y(b.y1)].sort((p, q) => p - q) as [number, number];
  return [x0, y0, x1, y1];
}

export interface RegionHit {
  label: string;
  kind: Kind;
  box: Box;
  tile: number;
}

export interface MergedRegion {
  label: string;
  kind: Kind;
  box: Box;
  /** How many tiles saw it. */
  votes: number;
}

/** Hits from every tile → one region per room: duplicates averaged, pieces cut by a tile border joined. */
export function mergeRegions(hits: RegionHit[], tiles: Tile[]): MergedRegion[] {
  const items = hits.filter((h) => area(h.box) > 25).map((h) => ({ ...h, group: -1 }));
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const near = (a: (typeof items)[number], b: (typeof items)[number]): boolean => {
    if (a.tile === b.tile && a.label && b.label && nameSimilarity(a.label, b.label) >= 0.9) {
      // two boxes with the same name in one tile are two rooms ("Guest Room" twice) unless they are the same one
      return iou(a.box, b.box) >= 0.5;
    }
    const sameName =
      a.label && b.label ? nameSimilarity(a.label, b.label) >= 0.6 : !a.label || !b.label;
    if (!sameName) return false;
    if (iou(a.box, b.box) >= 0.4) return true;
    // a room cut by the edge of a tile continues in the next tile: the boxes touch
    const ta = tiles[a.tile];
    const tb = tiles[b.tile];
    if (!ta || !tb || a.tile === b.tile) return false;
    const tol = Math.min(ta.w, ta.h) * 0.04;
    return gap(a.box, b.box) <= tol && area(inter(a.box, b.box)) >= 0 && !!(a.label && b.label);
  };
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++)
      if (find(i) !== find(j) && near(items[i]!, items[j]!)) parent[find(j)] = find(i);

  const groups = new Map<number, typeof items>();
  items.forEach((it, i) => {
    const g = find(i);
    groups.set(g, [...(groups.get(g) ?? []), it]);
  });
  return [...groups.values()].map((g) => {
    // A side of a box that lies on the edge of its tile is where the tile cut the room off, not where the room ends:
    // for each side, trust the pieces that were not cut there (averaged); if all were cut, take the farthest.
    const cut = (it: (typeof items)[number]): [boolean, boolean, boolean, boolean] => {
      const t = tiles[it.tile];
      if (!t) return [false, false, false, false];
      const e = Math.max(2, 0.012 * Math.max(t.w, t.h));
      return [
        t.x > 0 && it.box[0] <= t.x + e,
        t.y > 0 && it.box[1] <= t.y + e,
        it.box[2] >= t.x + t.w - e && !!tiles.some((o) => o.x + o.w > t.x + t.w + 1),
        it.box[3] >= t.y + t.h - e && !!tiles.some((o) => o.y + o.h > t.y + t.h + 1),
      ];
    };
    const box = [0, 1, 2, 3].map((k) => {
      const vals = g.map((it) => ({ v: it.box[k]!, cut: cut(it)[k]! }));
      const sure = vals.filter((x) => !x.cut).map((x) => x.v);
      if (sure.length) return sure.reduce((p, q) => p + q, 0) / sure.length;
      const all = vals.map((x) => x.v);
      return k < 2 ? Math.min(...all) : Math.max(...all);
    }) as Box;
    const label = g.map((x) => x.label).sort((p, q) => q.length - p.length)[0] ?? '';
    return {
      label,
      kind: g[0]!.kind,
      box,
      votes: new Set(g.map((x) => x.tile)).size,
    };
  });
}

export interface LabelHit {
  /** The label as printed, size removed. */
  name: string;
  /** Size in feet as printed, if any. */
  size?: [number, number];
  /** The unit it was written in. */
  unit?: 'ft' | 'm';
  /** Position in picture pixels. */
  x: number;
  y: number;
}

/** The labels the model read → hits in picture pixels with sizes parsed. */
export function labelHits(answer: LabelsAnswer, width: number, height: number): LabelHit[] {
  const out: LabelHit[] = [];
  for (const l of answer.labels) {
    const text = `${l.name} ${l.size ?? ''}`.trim();
    const parsed = parseSize(l.size ?? '') ?? parseSize(l.name);
    const name = nameOf(l.name) || nameOf(text);
    if (!name || name.length > 60) continue;
    out.push({
      name,
      ...(parsed ? { size: parsed.size, unit: parsed.unit } : {}),
      x: (l.x / 1000) * width,
      y: (l.y / 1000) * height,
    });
  }
  // the same label read twice
  return out.filter(
    (a, i) =>
      !out.some(
        (b, j) =>
          j < i &&
          nameSimilarity(a.name, b.name) === 1 &&
          Math.hypot(a.x - b.x, a.y - b.y) < Math.max(width, height) * 0.03,
      ),
  );
}

export interface Candidate {
  id: string;
  name: string;
  kind: Kind;
  type: string;
  /** Where it is, in picture pixels. */
  box: Box;
  /** The size printed on the plan, in feet [width, depth]. */
  labelSize?: [number, number];
  /** 0–1: both the label and the box agree → high; one of them alone → low. */
  confidence: number;
  source: 'label+box' | 'box' | 'label';
}

const centre = (b: Box): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const contains = (b: Box, x: number, y: number, pad = 0) =>
  x >= b[0] - pad && x <= b[2] + pad && y >= b[1] - pad && y <= b[3] + pad;

/** Labels (pass 1) + regions (pass 2) → one candidate per room or area, with how sure we are. */
export function assemble(
  labels: LabelHit[],
  regions: MergedRegion[],
  pic: { width: number; height: number },
  /** Pixels per foot, when known: label-only rooms get a box from their printed size. */
  pxPerFt?: number,
): Candidate[] {
  const used = new Set<number>();
  const out: Candidate[] = [];
  const add = (c: Omit<Candidate, 'id'>) => out.push({ ...c, id: `c${out.length + 1}` });

  // 1. each region takes the label that names it
  regions.forEach((r) => {
    let best = -1;
    let bestScore = 0;
    labels.forEach((l, i) => {
      if (used.has(i)) return;
      const named = r.label ? nameSimilarity(l.name, r.label) : 0;
      const inside = contains(r.box, l.x, l.y, 0)
        ? 1
        : contains(r.box, l.x, l.y, 0.08 * Math.hypot(r.box[2] - r.box[0], r.box[3] - r.box[1]))
          ? 0.5
          : 0;
      const score = named >= 0.6 ? named + inside : r.label ? 0 : inside * 0.8;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    const l = best >= 0 ? labels[best]! : undefined;
    if (l && bestScore >= 0.6) used.add(best);
    const name = (l && bestScore >= 0.6 ? l.name : r.label) || '';
    const c = name
      ? classify(name)
      : { kind: r.kind, type: r.kind === 'zone' ? 'garden' : 'other' };
    const kind = c.type === 'other' ? r.kind : c.kind;
    add({
      name: name || (kind === 'zone' ? 'Outdoor area' : 'Room'),
      kind,
      type: c.type === 'other' && kind === 'zone' ? 'garden' : c.type,
      box: r.box,
      ...(l?.size ? { labelSize: l.size } : {}),
      confidence: Math.min(
        1,
        (l && bestScore >= 0.6 ? 0.7 : name ? 0.5 : 0.3) +
          Math.min(0.2, 0.1 * (r.votes - 1)) +
          (l?.size ? 0.1 : 0),
      ),
      source: l && bestScore >= 0.6 ? 'label+box' : 'box',
    });
  });

  // 2. labels no region claimed: a box from the printed size around the label, or nothing to draw
  labels.forEach((l, i) => {
    if (used.has(i)) return;
    const c = classify(l.name);
    if (!l.size || !pxPerFt) return;
    const w = l.size[0] * pxPerFt;
    const d = l.size[1] * pxPerFt;
    const box: Box = [
      Math.max(0, l.x - w / 2),
      Math.max(0, l.y - d / 2),
      Math.min(pic.width, l.x + w / 2),
      Math.min(pic.height, l.y + d / 2),
    ];
    // a label that sits inside a region that already has a (different) name is a caption, not a room
    if (out.some((o) => contains(o.box, l.x, l.y) && nameSimilarity(o.name, l.name) > 0.3)) return;
    add({
      name: l.name,
      kind: c.kind,
      type: c.type,
      box,
      labelSize: l.size,
      confidence: 0.3,
      source: 'label',
    });
  });
  void centre;
  return out;
}
