import { describe, expect, it } from 'vitest';
import {
  IDENTITY,
  applyHomography,
  homographyFrom4,
  invertMatrix3,
  multiplyMatrix3,
  rectifyFromCorners,
  rectifyRaster,
  scaleFromTwoPoints,
} from './homography';

const close = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-6) => {
  expect(a.x).toBeCloseTo(b.x, 5 - Math.log10(1 / eps) + 5);
  expect(a.y).toBeCloseTo(b.y, 5 - Math.log10(1 / eps) + 5);
};

describe('homography from four points', () => {
  it('is the identity for identical point sets', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ];
    const h = homographyFrom4(sq, sq)!;
    for (let i = 0; i < 9; i++) expect(h[i]).toBeCloseTo(IDENTITY[i]!, 9);
  });

  it('maps every source corner exactly onto its target, and the centre sensibly', () => {
    // A trapezoid as seen from a slight angle → a 10 × 20 rectangle.
    const picture = [
      { x: 120, y: 80 },
      { x: 680, y: 60 },
      { x: 700, y: 1000 },
      { x: 90, y: 1010 },
    ];
    const plan = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ];
    const h = homographyFrom4(picture, plan)!;
    picture.forEach((p, i) => close(applyHomography(h, p), plan[i]!));
    const c = applyHomography(h, { x: 400, y: 540 });
    expect(c.x).toBeGreaterThan(4);
    expect(c.x).toBeLessThan(6);
    expect(c.y).toBeGreaterThan(9);
    expect(c.y).toBeLessThan(11);
  });

  it('keeps straight lines straight (three collinear picture points stay collinear)', () => {
    const picture = [
      { x: 100, y: 50 },
      { x: 600, y: 80 },
      { x: 640, y: 700 },
      { x: 60, y: 720 },
    ];
    const plan = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 12 },
      { x: 0, y: 12 },
    ];
    const h = homographyFrom4(picture, plan)!;
    const a = applyHomography(h, { x: 100, y: 50 });
    const b = applyHomography(h, { x: 350, y: 65 }); // midway along the top edge
    const c = applyHomography(h, { x: 600, y: 80 });
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    expect(Math.abs(cross)).toBeLessThan(1e-9);
    expect(a.y).toBeCloseTo(0, 9);
    expect(b.y).toBeCloseTo(0, 9);
  });

  it('refuses degenerate input (three points in a line, wrong counts)', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ];
    expect(homographyFrom4(line, line)).toBeNull();
    expect(homographyFrom4(line.slice(0, 3), line.slice(0, 3))).toBeNull();
  });
});

describe('matrix helpers', () => {
  it('inverts and multiplies', () => {
    const h = homographyFrom4(
      [
        { x: 0, y: 0 },
        { x: 100, y: 5 },
        { x: 95, y: 120 },
        { x: -4, y: 110 },
      ],
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 6 },
        { x: 0, y: 6 },
      ],
    )!;
    const inv = invertMatrix3(h)!;
    const id = multiplyMatrix3(h, inv);
    for (let i = 0; i < 9; i++) expect(id[i]).toBeCloseTo(IDENTITY[i]!, 8);
    const p = { x: 33, y: 71 };
    close(applyHomography(inv, applyHomography(h, p)), p);
    expect(invertMatrix3([1, 2, 3, 2, 4, 6, 1, 1, 1])).toBeNull();
  });
});

describe('2-point scale mode', () => {
  it('scales the picture so two points are the real distance apart', () => {
    const h = scaleFromTwoPoints({ x: 100, y: 100 }, { x: 400, y: 500 }, 12.5, { x: 2, y: 3 })!;
    const a = applyHomography(h, { x: 100, y: 100 });
    const b = applyHomography(h, { x: 400, y: 500 });
    close(a, { x: 2, y: 3 });
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(12.5, 9);
    expect(scaleFromTwoPoints({ x: 1, y: 1 }, { x: 1, y: 1 }, 5)).toBeNull();
    expect(scaleFromTwoPoints({ x: 0, y: 0 }, { x: 1, y: 0 }, -1)).toBeNull();
  });
});

describe('rectifying a picture', () => {
  it('maps a marked rectangle onto its real size', () => {
    const corners = [
      { x: 10, y: 20 },
      { x: 410, y: 10 },
      { x: 420, y: 610 },
      { x: 0, y: 600 },
    ];
    const h = rectifyFromCorners(corners, 6, 9, { x: 1, y: 2 })!;
    close(applyHomography(h, corners[0]!), { x: 1, y: 2 });
    close(applyHomography(h, corners[2]!), { x: 7, y: 11 });
    expect(rectifyFromCorners(corners, 0, 9)).toBeNull();
  });

  it('warps pixels: a skewed picture of a coloured square comes out axis-aligned', () => {
    // 200 × 200 picture: a red square (plan 4 × 4 m) seen as a parallelogram, on a blue background.
    const W = 200;
    const H = 200;
    const data = new Uint8ClampedArray(W * H * 4);
    const quad = [
      { x: 40, y: 30 },
      { x: 150, y: 50 },
      { x: 140, y: 160 },
      { x: 30, y: 140 },
    ];
    const pointInQuad = (px: number, py: number) => {
      let sign = 0;
      for (let i = 0; i < 4; i++) {
        const a = quad[i]!;
        const b = quad[(i + 1) % 4]!;
        const cr = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
        if (Math.sign(cr) !== 0) {
          if (sign === 0) sign = Math.sign(cr);
          else if (sign !== Math.sign(cr)) return false;
        }
      }
      return true;
    };
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        const red = pointInQuad(x + 0.5, y + 0.5);
        data[o] = red ? 255 : 0;
        data[o + 1] = 0;
        data[o + 2] = red ? 0 : 255;
        data[o + 3] = 255;
      }
    const pictureToPlan = rectifyFromCorners(quad, 4, 4)!;
    const planToPicture = invertMatrix3(pictureToPlan)!;
    // Plan window 6 × 6 m around the 4 × 4 m square, 20 px per metre.
    const out = rectifyRaster(
      { data, width: W, height: H },
      planToPicture,
      { x0: -1, y0: -1, x1: 5, y1: 5 },
      20,
    );
    expect(out.width).toBe(120);
    expect(out.height).toBe(120);
    const at = (mx: number, my: number) => {
      const i = Math.floor((mx + 1) * 20);
      const j = Math.floor((my + 1) * 20);
      const o = (j * out.width + i) * 4;
      return [out.data[o]!, out.data[o + 2]!];
    };
    // Inside the square (plan 2,2) is red; just outside the corners it is blue.
    expect(at(2, 2)[0]).toBeGreaterThan(240);
    expect(at(0.3, 0.3)[0]).toBeGreaterThan(240);
    expect(at(3.7, 3.7)[0]).toBeGreaterThan(240);
    expect(at(-0.5, 2)[1]).toBeGreaterThan(240);
    expect(at(4.5, 2)[1]).toBeGreaterThan(240);
    // The rectified square edge sits at 0 and 4 m to within one output pixel (5 cm).
    let first = -1;
    let last = -1;
    const row = Math.floor((2 + 1) * 20);
    for (let i = 0; i < out.width; i++) {
      if (out.data[(row * out.width + i) * 4]! > 128) {
        if (first < 0) first = i;
        last = i;
      }
    }
    expect(first / 20 - 1).toBeCloseTo(0, 1);
    expect((last + 1) / 20 - 1).toBeCloseTo(4, 1);
  });

  it('is transparent where the plan lies outside the picture', () => {
    const src = { data: new Uint8ClampedArray(4 * 4 * 4).fill(255), width: 4, height: 4 };
    const out = rectifyRaster(src, IDENTITY, { x0: -4, y0: -4, x1: 8, y1: 8 }, 1);
    const a = (x: number, y: number) => out.data[(y * out.width + x) * 4 + 3]!;
    expect(a(0, 0)).toBe(0); // plan (-4,-4)
    expect(a(5, 5)).toBe(255); // plan (1,1), inside the 4 × 4 picture
    expect(a(11, 11)).toBe(0);
  });
});
