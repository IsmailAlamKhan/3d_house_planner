import { REGIONS } from '../../src/render/regions';
import type { Raster } from './png';

/** Grey values (Rec. 709 weights) of a raster, 0–255. */
export function toGrey(r: Raster): Float32Array {
  const out = new Float32Array(r.width * r.height);
  const c = r.channels;
  for (let i = 0; i < out.length; i++) {
    const p = i * c;
    out[i] =
      c >= 3 ? 0.2126 * r.data[p]! + 0.7152 * r.data[p + 1]! + 0.0722 * r.data[p + 2]! : r.data[p]!;
  }
  return out;
}

/** The raster scaled so its long side is `longSide` (a multiple of 8, as the image model likes). Area average, or nearest for masks. */
export function resizeLong(r: Raster, longSide: number, mode: 'area' | 'nearest' = 'area'): Raster {
  const scale = longSide / Math.max(r.width, r.height);
  const width = Math.max(8, Math.round((r.width * scale) / 8) * 8);
  const height = Math.max(8, Math.round((r.height * scale) / 8) * 8);
  return resizeTo(r, width, height, mode);
}

export function resizeTo(
  r: Raster,
  width: number,
  height: number,
  mode: 'area' | 'nearest' = 'area',
): Raster {
  if (width === r.width && height === r.height) return r;
  const c = r.channels;
  const data = new Uint8Array(width * height * c);
  const sx = r.width / width;
  const sy = r.height / height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mode === 'nearest') {
        const px = Math.min(r.width - 1, Math.floor((x + 0.5) * sx));
        const py = Math.min(r.height - 1, Math.floor((y + 0.5) * sy));
        for (let k = 0; k < c; k++)
          data[(y * width + x) * c + k] = r.data[(py * r.width + px) * c + k]!;
        continue;
      }
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(r.width, Math.ceil((x + 1) * sx)));
      const y0 = Math.floor(y * sy);
      const y1 = Math.max(y0 + 1, Math.min(r.height, Math.ceil((y + 1) * sy)));
      const n = (x1 - x0) * (y1 - y0);
      for (let k = 0; k < c; k++) {
        let s = 0;
        for (let yy = y0; yy < y1; yy++)
          for (let xx = x0; xx < x1; xx++) s += r.data[(yy * r.width + xx) * c + k]!;
        data[(y * width + x) * c + k] = Math.round(s / n);
      }
    }
  }
  return { width, height, channels: c, data };
}

/** Sobel gradient magnitude of a grey image. */
export function sobel(grey: Float32Array, w: number, h: number): Float32Array {
  const m = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -grey[i - w - 1]! -
        2 * grey[i - 1]! -
        grey[i + w - 1]! +
        grey[i - w + 1]! +
        2 * grey[i + 1]! +
        grey[i + w + 1]!;
      const gy =
        -grey[i - w - 1]! -
        2 * grey[i - w]! -
        grey[i - w + 1]! +
        grey[i + w - 1]! +
        2 * grey[i + w]! +
        grey[i + w + 1]!;
      m[i] = Math.hypot(gx, gy);
    }
  return m;
}

/** A binary map of the strongest `share` (0–1) of the gradient magnitudes. */
export function strongest(mag: Float32Array, share: number): Uint8Array {
  const sorted = Float32Array.from(mag).sort();
  const t = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * (1 - share)))]!;
  const out = new Uint8Array(mag.length);
  const floor = Math.max(t, 1e-3);
  for (let i = 0; i < mag.length; i++) out[i] = mag[i]! >= floor ? 1 : 0;
  return out;
}

/** Grows a binary map by `r` pixels (square neighbourhood). */
export function dilate(map: Uint8Array, w: number, h: number, r: number): Uint8Array {
  let src = map;
  for (let pass = 0; pass < r; pass++) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let dy = -1; dy <= 1 && !v; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy >= 0 && yy < h && xx >= 0 && xx < w && src[yy * w + xx]) {
              v = 1;
              break;
            }
          }
        out[y * w + x] = v;
      }
    src = out;
  }
  return src;
}

/**
 * How well a result keeps the layout of its source: the share of the source's strong edges (walls, furniture outlines) that
 * are still there, within 2 pixels, in the result's edges. 1 = nothing moved. The result is scaled to the source's size first
 * (upscaled results are compared at the source's resolution).
 */
export function layoutScore(source: Raster, result: Raster): number {
  const res = resizeTo(result, source.width, source.height);
  const w = source.width;
  const h = source.height;
  const a = strongest(sobel(toGrey(source), w, h), 0.06);
  const b = dilate(strongest(sobel(toGrey(res), w, h), 0.16), w, h, 2);
  let total = 0;
  let kept = 0;
  for (let i = 0; i < a.length; i++)
    if (a[i]) {
      total++;
      if (b[i]) kept++;
    }
  return total ? kept / total : 1;
}

/** Share of the picture each region (by id) covers, and the ids found. */
export function regionAreas(regions: Raster): Map<number, number> {
  const counts = new Map<number, number>();
  const c = regions.channels;
  for (let i = 0; i < regions.width * regions.height; i++) {
    const v = regions.data[i * c]!;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const total = regions.width * regions.height;
  const out = new Map<number, number>();
  for (const [k, n] of counts) out.set(k, n / total);
  return out;
}

/** One white-on-black mask (RGB, so ComfyUI's image loader keeps it) per region id; `sky` is id 0. */
export function regionMasks(regions: Raster, ids: number[], blur = 1): Map<number, Raster> {
  const w = regions.width;
  const h = regions.height;
  const c = regions.channels;
  const out = new Map<number, Raster>();
  for (const id of ids) {
    const map = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) map[i] = regions.data[i * c] === id ? 1 : 0;
    // a pixel of softness at the borders, so regions blend instead of showing seams
    const soft = new Uint8Array(w * h * 3);
    const grown = blur > 0 ? dilate(map, w, h, blur) : map;
    for (let i = 0; i < w * h; i++) {
      const v = map[i] ? 255 : grown[i] ? 128 : 0;
      soft[i * 3] = soft[i * 3 + 1] = soft[i * 3 + 2] = v;
    }
    out.set(id, { width: w, height: h, channels: 3, data: soft });
  }
  return out;
}

/**
 * How much a region's prompt matters to the look, per unit of picture it covers (the pool, cars and bedding change the
 * picture most, floors and walls hardly at all): used to pick the few regions that get their own prompt.
 */
const IMPORTANCE: Record<number, number> = {
  5: 3,
  9: 2,
  8: 2,
  10: 1.5,
  4: 1,
  1: 1,
  6: 1,
  7: 0.5,
  11: 0.5,
};

/**
 * The regions that get their own prompt: those that cover at least `minShare` of the picture and have a prompt, at most
 * `maxCount`, the ones that matter most first. Every masked prompt is one more conditioning the image model evaluates at
 * every step, so a handful keeps a step quick and the 16 GB card out of trouble.
 */
export function promptedRegions(regions: Raster, minShare = 0.004, maxCount = 4): number[] {
  const areas = regionAreas(regions);
  return REGIONS.filter((r) => r.prompt && (areas.get(r.id) ?? 0) >= minShare)
    .sort(
      (a, b) =>
        areas.get(b.id)! * (IMPORTANCE[b.id] ?? 1) - areas.get(a.id)! * (IMPORTANCE[a.id] ?? 1),
    )
    .slice(0, maxCount)
    .map((r) => r.id)
    .sort((a, b) => a - b);
}

/**
 * A mask of the places where room labels will be drawn: a box around each label's anchor, `scale` of the picture's height
 * tall. The image model is told those places are plain (it must not try to write there).
 */
export function labelMask(
  width: number,
  height: number,
  labels: { x: number; y: number; chars: number }[],
  fontShare: number,
): Raster {
  const data = new Uint8Array(width * height * 3);
  const px = Math.max(8, fontShare * height);
  for (const l of labels) {
    const bw = Math.min(width, px * 0.62 * Math.max(8, l.chars));
    const bh = px * 2.6;
    const x0 = Math.max(0, Math.floor(l.x - bw / 2));
    const x1 = Math.min(width, Math.ceil(l.x + bw / 2));
    const y0 = Math.max(0, Math.floor(l.y - bh / 2));
    const y1 = Math.min(height, Math.ceil(l.y + bh / 2));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) data.fill(255, (y * width + x) * 3, (y * width + x) * 3 + 3);
  }
  return { width, height, channels: 3, data };
}
