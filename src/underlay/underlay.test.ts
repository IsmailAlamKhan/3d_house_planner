import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { rectifyFromCorners, scaleFromTwoPoints } from '../geometry/homography';
import {
  addUnderlay,
  bringUnderlayToFront,
  deleteUnderlay,
  sendUnderlayToBack,
  updateUnderlay,
} from '../model/ops';
import { createSampleProject } from '../model/sample';
import { ProjectSchema } from '../model/schemas';
import {
  baseBounds,
  focusRect,
  pictureDistance,
  pictureToPlan,
  planToPicture,
  underlayBounds,
  underlayMatrix,
} from './matrix';

const base = createSampleProject();

/** A 1000 × 2000 px picture whose four corners are a 10 × 20 m rectangle on the plan, top-left at (2, 3). */
const transform = rectifyFromCorners(
  [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 2000 },
    { x: 0, y: 2000 },
  ],
  10,
  20,
  { x: 2, y: 3 },
)!;
const picture = {
  imageWidth: 1000,
  imageHeight: 2000,
  transform,
  offset: { x: 0, y: 0 },
  rotation: 0,
};
const input = {
  name: 'Reference',
  source: { kind: 'url' as const, url: 'reference/x.png' },
  imageWidth: 1000,
  imageHeight: 2000,
  transform,
};

describe('underlay matrix', () => {
  it('without adjustments it is the rectification', () => {
    const a = pictureToPlan(picture, { x: 500, y: 1000 });
    expect(a.x).toBeCloseTo(7, 9);
    expect(a.y).toBeCloseTo(13, 9);
    const b = baseBounds(picture);
    expect([b.x0, b.y0, b.x1, b.y1].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([2, 3, 12, 23]);
    expect(underlayBounds(picture)).toEqual(expect.objectContaining({ x0: expect.closeTo(2, 9) }));
  });

  it('moves with the offset and turns about the picture centre', () => {
    const moved = { ...picture, offset: { x: 1.5, y: -2 } };
    const p = pictureToPlan(moved, { x: 0, y: 0 });
    expect(p.x).toBeCloseTo(3.5, 9);
    expect(p.y).toBeCloseTo(1, 9);

    const turned = { ...picture, rotation: Math.PI / 2 };
    const centre = pictureToPlan(turned, { x: 500, y: 1000 });
    expect(centre.x).toBeCloseTo(7, 9); // the centre does not move
    expect(centre.y).toBeCloseTo(13, 9);
    const a = pictureToPlan(turned, { x: 0, y: 0 });
    const b = pictureToPlan(turned, { x: 1000, y: 0 });
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(10, 9); // lengths are kept
    // a quarter turn: the 10 × 20 picture now covers a 20 × 10 area around the same centre
    const bb = underlayBounds(turned);
    expect(bb.x1 - bb.x0).toBeCloseTo(20, 9);
    expect(bb.y1 - bb.y0).toBeCloseTo(10, 9);
  });

  it('maps plan points back onto the picture and measures real lengths on it', () => {
    const pic = planToPicture(picture, { x: 7, y: 13 })!;
    expect(pic.x).toBeCloseTo(500, 6);
    expect(pic.y).toBeCloseTo(1000, 6);
    expect(pictureDistance(picture, { x: 0, y: 0 }, { x: 1000, y: 0 })).toBeCloseTo(10, 9);
    expect(pictureDistance(picture, { x: 0, y: 0 }, { x: 0, y: 2000 })).toBeCloseTo(20, 9);
    // the 2-point mode measures too
    const t2 = scaleFromTwoPoints({ x: 100, y: 100 }, { x: 600, y: 100 }, 5)!;
    expect(
      pictureDistance({ ...picture, transform: t2 }, { x: 100, y: 100 }, { x: 600, y: 100 }),
    ).toBeCloseTo(5, 9);
  });

  it('matrix is the identity-composed transform when nothing is adjusted', () => {
    const m = underlayMatrix(picture);
    for (let i = 0; i < 9; i++) expect(m[i]).toBeCloseTo(transform[i]!, 9);
  });
});

describe('the part of the plan a picture was set up on', () => {
  it('is the marked rectangle, moved with the picture; the whole picture without one', () => {
    const setup = { mode: 'corners', size: [10, 20], origin: { x: 2, y: 3 } };
    expect(focusRect({ ...picture, setup })).toEqual({ x0: 2, y0: 3, x1: 12, y1: 23 });
    const moved = focusRect({ ...picture, offset: { x: 1, y: -1 }, setup });
    expect([moved.x0, moved.y0, moved.x1, moved.y1]).toEqual([3, 2, 13, 22]);
    // turned or set up with two points: the whole straightened picture
    expect(focusRect({ ...picture, rotation: 0.3, setup })).toEqual(
      underlayBounds({ ...picture, rotation: 0.3 }),
    );
    expect(
      focusRect({ ...picture, setup: { mode: 'two-point', size: [5], origin: { x: 0, y: 0 } } }),
    ).toEqual(underlayBounds(picture));
  });
});

describe('underlay operations', () => {
  it('adds, adjusts, reorders and deletes a reference picture', () => {
    let p = produce(base, (d) => void addUnderlay(d, input));
    expect(p.underlays).toHaveLength(1);
    const id = p.underlays[0]!.id;
    expect(p.underlays[0]).toMatchObject({
      opacity: 0.5,
      visible: true,
      locked: false,
      onTop: false,
      show3d: false,
    });

    p = produce(p, (d) => {
      updateUnderlay(d, id, { opacity: 3, offset: { x: 1, y: 2 }, rotation: 0.1, onTop: true });
    });
    expect(p.underlays[0]!.opacity).toBe(1); // clamped
    expect(p.underlays[0]!.offset).toEqual({ x: 1, y: 2 });

    const second = produce(p, (d) => void addUnderlay(d, { ...input, name: 'Second' }));
    expect(second.underlays.map((u) => u.name)).toEqual(['Reference', 'Second']);
    const back = produce(second, (d) => void sendUnderlayToBack(d, second.underlays[1]!.id));
    expect(back.underlays.map((u) => u.name)).toEqual(['Second', 'Reference']);
    const front = produce(back, (d) => void bringUnderlayToFront(d, back.underlays[0]!.id));
    expect(front.underlays.map((u) => u.name)).toEqual(['Reference', 'Second']);

    const gone = produce(front, (d) => void deleteUnderlay(d, id));
    expect(gone.underlays.map((u) => u.name)).toEqual(['Second']);
    expect(() => produce(gone, (d) => void deleteUnderlay(d, id))).toThrow();
  });

  it('refuses a picture setup that cannot be inverted (corners in a line)', () => {
    expect(() =>
      produce(
        base,
        (d) => void addUnderlay(d, { ...input, transform: [1, 2, 3, 2, 4, 6, 0, 0, 1] }),
      ),
    ).toThrow(/cannot be used/);
  });

  it('a locked picture cannot be moved, but can be unlocked, hidden and faded', () => {
    const p = produce(base, (d) => void addUnderlay(d, { ...input, locked: true }));
    const id = p.underlays[0]!.id;
    expect(() => produce(p, (d) => void updateUnderlay(d, id, { offset: { x: 5, y: 5 } }))).toThrow(
      /Unlock/,
    );
    const ok = produce(p, (d) => void updateUnderlay(d, id, { opacity: 0.2, visible: false }));
    expect(ok.underlays[0]).toMatchObject({ opacity: 0.2, visible: false, locked: true });
    const unlocked = produce(p, (d) => void updateUnderlay(d, id, { locked: false }));
    expect(() =>
      produce(unlocked, (d) => void updateUnderlay(d, id, { offset: { x: 5, y: 5 } })),
    ).not.toThrow();
  });

  it('is saved with the project; old files without pictures still load', () => {
    const p = produce(base, (d) => void addUnderlay(d, input));
    const parsed = ProjectSchema.parse(JSON.parse(JSON.stringify(p)));
    expect(parsed.underlays).toHaveLength(1);
    const { underlays, ...old } = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    void underlays;
    expect(ProjectSchema.parse(old).underlays).toEqual([]);
  });
});
