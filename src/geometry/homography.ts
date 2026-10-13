import type { Vec2 } from './vec';

/**
 * Perspective maths for the reference-image underlay: the picture of a plan is usually shot at a slight angle, so the
 * user marks four corners of a known rectangle and a homography maps picture pixels onto plan metres.
 * A 3 × 3 matrix is stored row-major in a 9-element array.
 */
export type Matrix3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export const IDENTITY: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Solves A·x = b (n × n, Gaussian elimination with partial pivoting). Returns null for a singular system. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    for (let r = col + 1; r < n; r++) {
      const f = m[r]![col]! / m[col]![col]!;
      for (let c = col; c <= n; c++) m[r]![c] = m[r]![c]! - f * m[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r]![n]!;
    for (let c = r + 1; c < n; c++) s -= m[r]![c]! * x[c]!;
    x[r] = s / m[r]![r]!;
  }
  return x;
}

/**
 * The homography that maps each `from[i]` onto `to[i]` (four point pairs, no three of them in a line).
 * Returns null when the points are degenerate.
 */
export function homographyFrom4(from: readonly Vec2[], to: readonly Vec2[]): Matrix3 | null {
  if (from.length !== 4 || to.length !== 4) return null;
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]!;
    const { x: u, y: v } = to[i]!;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(a, b);
  return h ? ([h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1] as const) : null;
}

/** Applies a homography to a point. */
export function applyHomography(h: Matrix3, p: Vec2): Vec2 {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

/** Inverse of a 3 × 3 matrix (null when singular). */
export function invertMatrix3(m: Matrix3): Matrix3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-14) return null;
  const k = 1 / det;
  return [
    A * k,
    -(b * i - c * h) * k,
    (b * f - c * e) * k,
    B * k,
    (a * i - c * g) * k,
    -(a * f - c * d) * k,
    C * k,
    -(a * h - b * g) * k,
    (a * e - b * d) * k,
  ];
}

/** `a` applied after `b` (a · b). */
export function multiplyMatrix3(a: Matrix3, b: Matrix3): Matrix3 {
  const r = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i * 3 + j]! += a[i * 3 + k]! * b[k * 3 + j]!;
  return r as unknown as Matrix3;
}

/**
 * The simple 2-point mode: two picture points `a`, `b` that are `realDistance` metres apart. The picture is only
 * scaled (no perspective, no rotation); picture point `a` lands on the plan point `origin`.
 */
export function scaleFromTwoPoints(
  a: Vec2,
  b: Vec2,
  realDistance: number,
  origin: Vec2 = { x: 0, y: 0 },
): Matrix3 | null {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-9 || !(realDistance > 0)) return null;
  const s = realDistance / len;
  return [s, 0, origin.x - s * a.x, 0, s, origin.y - s * a.y, 0, 0, 1];
}

/**
 * The homography picture pixels → plan metres, from the four picture corners (in order: top-left, top-right,
 * bottom-right, bottom-left of the marked rectangle) and the real width and depth of that rectangle. The rectangle's
 * top-left corner lands on `origin` in the plan.
 */
export function rectifyFromCorners(
  corners: readonly Vec2[],
  width: number,
  depth: number,
  origin: Vec2 = { x: 0, y: 0 },
): Matrix3 | null {
  if (!(width > 0) || !(depth > 0)) return null;
  const plan: Vec2[] = [
    { x: origin.x, y: origin.y },
    { x: origin.x + width, y: origin.y },
    { x: origin.x + width, y: origin.y + depth },
    { x: origin.x, y: origin.y + depth },
  ];
  return homographyFrom4(corners, plan);
}

/** RGBA pixels (row-major, 4 bytes per pixel), as in `ImageData`. */
export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Warps a picture onto the plan: the output covers `bounds` (plan metres) at `pixelsPerMetre`; each output pixel is
 * looked up in the source through `planToPicture` (bilinear). Pixels that fall outside the source are transparent.
 */
export function rectifyRaster(
  src: Raster,
  planToPicture: Matrix3,
  bounds: { x0: number; y0: number; x1: number; y1: number },
  pixelsPerMetre: number,
): Raster {
  const w = Math.max(1, Math.round((bounds.x1 - bounds.x0) * pixelsPerMetre));
  const h = Math.max(1, Math.round((bounds.y1 - bounds.y0) * pixelsPerMetre));
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = (bounds.x1 - bounds.x0) / w;
  const sy = (bounds.y1 - bounds.y0) / h;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const p = applyHomography(planToPicture, {
        x: bounds.x0 + (i + 0.5) * sx,
        y: bounds.y0 + (j + 0.5) * sy,
      });
      const fx = p.x - 0.5;
      const fy = p.y - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      if (x0 < -1 || y0 < -1 || x0 >= src.width || y0 >= src.height) continue;
      const tx = fx - x0;
      const ty = fy - y0;
      const o = (j * w + i) * 4;
      // Colour: weighted average over the neighbours that exist. Alpha: out-of-picture neighbours count as transparent,
      // so the picture's edge fades out instead of stretching.
      const acc = [0, 0, 0, 0];
      let wsum = 0;
      for (let dy = 0; dy <= 1; dy++)
        for (let dx = 0; dx <= 1; dx++) {
          const xx = x0 + dx;
          const yy = y0 + dy;
          if (xx < 0 || yy < 0 || xx >= src.width || yy >= src.height) continue;
          const wgt = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
          const k = (yy * src.width + xx) * 4;
          for (let c = 0; c < 4; c++) acc[c]! += wgt * src.data[k + c]!;
          wsum += wgt;
        }
      if (wsum <= 0) continue;
      for (let c = 0; c < 3; c++) out[o + c] = acc[c]! / wsum;
      out[o + 3] = acc[3]!; // already weighted by wsum <= 1 (missing neighbours contribute 0)
    }
  }
  return { data: out, width: w, height: h };
}
