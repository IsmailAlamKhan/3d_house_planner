import {
  type Matrix3,
  invertMatrix3,
  multiplyMatrix3,
  rectifyFromCorners,
  rectifyRaster,
} from '../../geometry/homography';
import type { Vec2 } from '../../geometry/vec';
import { type VisionClient, jsonOf } from './client';
import { SYSTEM_PROMPT } from './protocol';
import { type PictureSource, canvasSource } from './source';

const M_PER_FT = 0.3048;

/** Draws a bitmap into raster data (at most `max` pixels on the long side). */
function toRaster(bitmap: ImageBitmap, max = 3000) {
  const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bitmap.width * k));
  c.height = Math.max(1, Math.round(bitmap.height * k));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot draw pictures.');
  ctx.drawImage(bitmap, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return { data: d.data, width: c.width, height: c.height, k };
}

export interface Rectified {
  source: PictureSource;
  canvas: HTMLCanvasElement;
  /** Feet per pixel of the straightened picture; undefined when the real size is not known. */
  ftPerPx?: number;
}

/**
 * Straightens the picture with four corners (top-left, top-right, bottom-right, bottom-left, in picture pixels) of a
 * rectangle whose real size is `width` × `depth` feet — the same perspective correction the reference underlay uses.
 */
export function rectifyWithCorners(
  bitmap: ImageBitmap,
  corners: readonly Vec2[],
  widthFt: number,
  depthFt: number,
  maxSide = 1800,
): Rectified {
  const raster = toRaster(bitmap);
  const W = widthFt * M_PER_FT;
  const D = depthFt * M_PER_FT;
  const h = rectifyFromCorners(corners, W, D, { x: 0, y: 0 });
  const inv = h && invertMatrix3(h);
  if (!inv) throw new Error('The four corners cannot be used (they are in a line).');
  const scale: Matrix3 = [raster.k, 0, 0, 0, raster.k, 0, 0, 0, 1];
  const ppm = maxSide / Math.max(W, D);
  const out = rectifyRaster(
    { data: raster.data, width: raster.width, height: raster.height },
    multiplyMatrix3(scale, inv),
    { x0: 0, y0: 0, x1: W, y1: D },
    ppm,
  );
  const canvas = document.createElement('canvas');
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw pictures.');
  // transparent corners become white paper, as a plan has no transparency
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tmp = document.createElement('canvas');
  tmp.width = out.width;
  tmp.height = out.height;
  tmp
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0);
  ctx.drawImage(tmp, 0, 0);
  return { source: canvasSource(canvas), canvas, ftPerPx: 1 / ppm / M_PER_FT };
}

/** The picture as it is, cut to `box` (picture pixels) — no perspective correction, scale unknown. */
export function cropOnly(
  bitmap: ImageBitmap,
  box: { x: number; y: number; w: number; h: number },
  maxSide = 1800,
): Rectified {
  const k = Math.min(1, maxSide / Math.max(box.w, box.h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(box.w * k));
  canvas.height = Math.max(1, Math.round(box.h * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw pictures.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height);
  return { source: canvasSource(canvas), canvas };
}

/**
 * "Automatic guess" for the plan's outline: the model says where the drawn plan (not the page around it) is. Falls back to
 * the whole picture when it does not answer usably.
 */
export async function locatePlan(
  client: VisionClient,
  fullPicture: PictureSource,
  signal?: AbortSignal,
): Promise<{ x: number; y: number; w: number; h: number }> {
  const whole = { x: 0, y: 0, w: fullPicture.width, h: fullPicture.height };
  try {
    const image = await fullPicture.crop(whole, 1200);
    const text = await client.ask({
      system: SYSTEM_PROMPT,
      prompt:
        'This picture contains a floor plan seen from above, possibly with a phone status bar, captions, buttons or ' +
        'black or white margins around it. Give the bounding box of the plan drawing itself, from its outermost ' +
        'wall or boundary: "x0", "y0" (top-left) and "x1", "y1" (bottom-right) in the 0 to 1000 scale of this picture.',
      images: [image],
      schema: {
        type: 'object',
        properties: {
          x0: { type: 'integer' },
          y0: { type: 'integer' },
          x1: { type: 'integer' },
          y1: { type: 'integer' },
        },
        required: ['x0', 'y0', 'x1', 'y1'],
      },
      signal,
    });
    const j = jsonOf(text) as Record<string, number>;
    const x0 = Math.min(j.x0!, j.x1!) / 1000;
    const x1 = Math.max(j.x0!, j.x1!) / 1000;
    const y0 = Math.min(j.y0!, j.y1!) / 1000;
    const y1 = Math.max(j.y0!, j.y1!) / 1000;
    if (x1 - x0 < 0.25 || y1 - y0 < 0.25) return whole;
    return { x: x0 * whole.w, y: y0 * whole.h, w: (x1 - x0) * whole.w, h: (y1 - y0) * whole.h };
  } catch {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    return whole;
  }
}
