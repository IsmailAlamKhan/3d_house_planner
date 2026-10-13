import {
  type Matrix3,
  invertMatrix3,
  multiplyMatrix3,
  rectifyRaster,
} from '../geometry/homography';
import type { Underlay } from '../model/types';
import { type Bounds, underlayBounds, underlayMatrix } from './matrix';

export interface Rectified {
  /** The picture warped onto the plan: object URL of a PNG, ready to draw at `bounds`. */
  url: string;
  bounds: Bounds;
  /** Pixels per metre of the warped picture. */
  pixelsPerMetre: number;
}

/** Everything that changes how the warped picture looks (a cache key). */
export const rectifyKey = (u: Underlay): string =>
  JSON.stringify([u.source, u.transform, u.offset, u.rotation, u.imageWidth, u.imageHeight]);

/**
 * Warps the picture onto the plan (perspective corrected, in metres) so it can be drawn as an ordinary image in the
 * plan: the output covers `underlayBounds` at up to `maxSide` pixels. Colours and alpha are bilinear.
 */
export async function rectifyUnderlay(
  u: Underlay,
  bitmap: ImageBitmap,
  maxSide = 2048,
): Promise<Rectified> {
  // Decode at most 3000 px on the long side; the matrix is in the original pixels, so it is scaled to match.
  const shrink = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height));
  const sw = Math.max(1, Math.round(bitmap.width * shrink));
  const sh = Math.max(1, Math.round(bitmap.height * shrink));
  const src = document.createElement('canvas');
  src.width = sw;
  src.height = sh;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  if (!sctx) throw new Error('This browser cannot draw pictures.');
  sctx.drawImage(bitmap, 0, 0, sw, sh);
  const raster = sctx.getImageData(0, 0, sw, sh);

  const bounds = underlayBounds(u);
  const w = bounds.x1 - bounds.x0;
  const h = bounds.y1 - bounds.y0;
  const toPicture = invertMatrix3(underlayMatrix(u));
  if (!toPicture || !(w > 0) || !(h > 0)) throw new Error('The picture setup is not valid.');
  const scale: Matrix3 = [sw / bitmap.width, 0, 0, 0, sh / bitmap.height, 0, 0, 0, 1];
  const ppm = Math.min(maxSide / Math.max(w, h), 200);
  const out = rectifyRaster(
    { data: raster.data, width: sw, height: sh },
    multiplyMatrix3(scale, toPicture),
    bounds,
    ppm,
  );
  const canvas = document.createElement('canvas');
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw pictures.');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('The picture could not be prepared.'))),
      'image/png',
    ),
  );
  return { url: URL.createObjectURL(blob), bounds, pixelsPerMetre: out.width / w };
}
