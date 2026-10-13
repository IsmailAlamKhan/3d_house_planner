/**
 * An edge ("line") pass for the canny ControlNet, computed from the normal image and the depth image of the same view:
 * white lines on black where the surface direction or the distance changes sharply. Pure; works on RGBA bytes.
 */
export function computeEdges(
  width: number,
  height: number,
  normals: Uint8ClampedArray,
  depth: Uint8ClampedArray | null,
  threshold = 0.18,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4);
  const lum = (img: Uint8ClampedArray, x: number, y: number, c: number) =>
    img[
      (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4 + c
    ]! / 255;
  const grad = (img: Uint8ClampedArray, x: number, y: number, c: number) => {
    const gx =
      -lum(img, x - 1, y - 1, c) -
      2 * lum(img, x - 1, y, c) -
      lum(img, x - 1, y + 1, c) +
      lum(img, x + 1, y - 1, c) +
      2 * lum(img, x + 1, y, c) +
      lum(img, x + 1, y + 1, c);
    const gy =
      -lum(img, x - 1, y - 1, c) -
      2 * lum(img, x, y - 1, c) -
      lum(img, x + 1, y - 1, c) +
      lum(img, x - 1, y + 1, c) +
      2 * lum(img, x, y + 1, c) +
      lum(img, x + 1, y + 1, c);
    return Math.hypot(gx, gy);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let g = Math.max(grad(normals, x, y, 0), grad(normals, x, y, 1), grad(normals, x, y, 2));
      if (depth) g = Math.max(g, grad(depth, x, y, 0) * 2.5);
      const v = g > threshold ? 255 : 0;
      const i = (y * width + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}
