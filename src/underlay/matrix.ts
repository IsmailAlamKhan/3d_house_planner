import {
  type Matrix3,
  applyHomography,
  invertMatrix3,
  multiplyMatrix3,
} from '../geometry/homography';
import type { Vec2 } from '../geometry/vec';

/** What the maths needs of an underlay (a plain 3 × 3 matrix is accepted as well as the stored tuple). */
export interface UnderlayGeometry {
  imageWidth: number;
  imageHeight: number;
  transform: Matrix3;
  offset: Vec2;
  rotation: number;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The four corners of the picture, in picture pixels. */
const corners = (u: Pick<UnderlayGeometry, 'imageWidth' | 'imageHeight'>): Vec2[] => [
  { x: 0, y: 0 },
  { x: u.imageWidth, y: 0 },
  { x: u.imageWidth, y: u.imageHeight },
  { x: 0, y: u.imageHeight },
];

const boundsOf = (pts: Vec2[]): Bounds => ({
  x0: Math.min(...pts.map((p) => p.x)),
  y0: Math.min(...pts.map((p) => p.y)),
  x1: Math.max(...pts.map((p) => p.x)),
  y1: Math.max(...pts.map((p) => p.y)),
});

/** Where the picture lies on the plan before the user's fine adjustments (its straightened outline). */
export function baseBounds(
  u: Pick<UnderlayGeometry, 'imageWidth' | 'imageHeight' | 'transform'>,
): Bounds {
  return boundsOf(corners(u).map((c) => applyHomography(u.transform, c)));
}

const translation = (x: number, y: number): Matrix3 => [1, 0, x, 0, 1, y, 0, 0, 1];
const rotationAbout = (c: Vec2, a: number): Matrix3 => {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [cos, -sin, c.x - cos * c.x + sin * c.y, sin, cos, c.y - sin * c.x - cos * c.y, 0, 0, 1];
};

/** Picture pixel → plan metre, including the user's rotation (about the picture's centre) and offset. */
export function underlayMatrix(u: UnderlayGeometry): Matrix3 {
  const b = baseBounds(u);
  const centre = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
  return multiplyMatrix3(
    translation(u.offset.x, u.offset.y),
    multiplyMatrix3(rotationAbout(centre, u.rotation), u.transform),
  );
}

/** Where the (rectified) picture covers the plan, in metres. */
export function underlayBounds(u: UnderlayGeometry): Bounds {
  const m = underlayMatrix(u);
  return boundsOf(corners(u).map((c) => applyHomography(m, c)));
}

/** A picture pixel on the plan. */
export const pictureToPlan = (u: UnderlayGeometry, p: Vec2): Vec2 =>
  applyHomography(underlayMatrix(u), p);

/** A plan point on the picture (pixels), or null when the matrix cannot be inverted. */
export function planToPicture(u: UnderlayGeometry, p: Vec2): Vec2 | null {
  const inv = invertMatrix3(underlayMatrix(u));
  return inv ? applyHomography(inv, p) : null;
}

/** Straight-line distance, in metres, between two picture pixels as they lie on the plan. */
export function pictureDistance(u: UnderlayGeometry, a: Vec2, b: Vec2): number {
  const pa = pictureToPlan(u, a);
  const pb = pictureToPlan(u, b);
  return Math.hypot(pb.x - pa.x, pb.y - pa.y);
}
