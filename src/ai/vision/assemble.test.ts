import { describe, expect, it } from 'vitest';
import {
  type Box,
  assemble,
  iou,
  labelHits,
  makeTiles,
  mergeRegions,
  tileBoxToImage,
} from './assemble';
import { LabelsAnswerSchema } from './protocol';

describe('tiles', () => {
  it('cover the whole picture, overlap their neighbours and stay within the size limit', () => {
    const tiles = makeTiles(1000, 1700, 900, 0.2);
    expect(tiles.length).toBe(6); // 2 × 3
    for (const t of tiles) {
      expect(t.w).toBeLessThanOrEqual(900 + 1);
      expect(t.h).toBeLessThanOrEqual(900 + 1);
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x + t.w).toBeLessThanOrEqual(1000);
      expect(t.y + t.h).toBeLessThanOrEqual(1700);
    }
    const covered = (x: number, y: number) =>
      tiles.some((t) => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h);
    for (const x of [0, 250, 500, 999])
      for (const y of [0, 400, 850, 1300, 1699]) expect(covered(x, y)).toBe(true);
    // neighbours share a strip
    const [a, b] = tiles;
    expect(a!.x + a!.w).toBeGreaterThan(b!.x);
    expect(makeTiles(600, 500).length).toBe(1);
  });

  it('turns a box in a tile into picture pixels', () => {
    const t = { x: 100, y: 200, w: 500, h: 400 };
    expect(tileBoxToImage(t, { x0: 0, y0: 0, x1: 1000, y1: 1000 })).toEqual([100, 200, 600, 600]);
    expect(tileBoxToImage(t, { x0: 500, y0: 500, x1: 250, y1: 0 })).toEqual([225, 200, 350, 400]); // corners in any order
  });
});

describe('merging what the tiles saw', () => {
  const hit = (label: string, box: Box, tile: number) => ({
    label,
    kind: 'room' as const,
    box,
    tile,
  });
  const tiles = makeTiles(1000, 1700, 900, 0.2);

  it('averages the same room seen in two overlapping tiles', () => {
    const m = mergeRegions(
      [hit('Kitchen', [460, 100, 540, 250], 0), hit('Kitchen', [464, 98, 544, 254], 1)],
      tiles,
    );
    expect(m).toHaveLength(1);
    expect(m[0]!.box[0]).toBeCloseTo(462, 5);
    expect(m[0]!.votes).toBe(2);
  });

  it('joins a room cut by a tile border into one box', () => {
    const top = tiles[0]!;
    const bottom = tiles[2]!;
    const m = mergeRegions(
      [
        hit('Living Room', [100, 400, 400, top.y + top.h], 0),
        hit('Living Room', [102, bottom.y + 2, 398, 900], 2),
      ],
      tiles,
    );
    expect(m).toHaveLength(1);
    expect(m[0]!.box[1]).toBe(400);
    expect(m[0]!.box[3]).toBe(900);
  });

  it('keeps two rooms with the same name apart', () => {
    const m = mergeRegions(
      [hit('Guest Room', [50, 100, 250, 300], 0), hit('Guest Room', [600, 100, 800, 300], 0)],
      tiles,
    );
    expect(m).toHaveLength(2);
  });

  it('drops specks', () => {
    expect(mergeRegions([hit('x', [0, 0, 3, 3], 0)], tiles)).toHaveLength(0);
    expect(iou([0, 0, 10, 10], [5, 0, 15, 10])).toBeCloseTo(1 / 3, 5);
  });
});

describe('putting labels and regions together', () => {
  const pic = { width: 1000, height: 1000 };
  const labels = labelHits(
    LabelsAnswerSchema.parse({
      labels: [
        { name: 'Kitchen', size: "16' x 12'", x: 200, y: 200 },
        { name: 'Bedroom 1', size: "14' x 12'", x: 700, y: 200 },
        { name: 'Bedroom 1', size: "14' x 12'", x: 702, y: 201 }, // read twice
        { name: 'Gym', size: '14 x 12 ft', x: 500, y: 800 },
        { name: 'Pedestrian Gate', x: 500, y: 990 },
      ],
    }),
    pic.width,
    pic.height,
  );

  it('reads sizes and drops a label that was read twice', () => {
    expect(labels.map((l) => l.name)).toEqual(['Kitchen', 'Bedroom 1', 'Gym', 'Pedestrian Gate']);
    expect(labels[0]!.size).toEqual([16, 12]);
  });

  it('a label inside a region that bears its name makes a confident candidate; a lone box and a lone label are doubtful', () => {
    const regions = [
      { label: 'Kitchen', kind: 'room' as const, box: [100, 100, 300, 300] as Box, votes: 2 },
      { label: '', kind: 'room' as const, box: [650, 100, 850, 300] as Box, votes: 1 },
      { label: 'Garage thing', kind: 'room' as const, box: [10, 600, 100, 700] as Box, votes: 1 },
    ];
    const c = assemble(labels, regions, pic, 5);
    const kitchen = c.find((x) => x.name === 'Kitchen')!;
    expect(kitchen).toMatchObject({
      type: 'kitchen',
      kind: 'room',
      source: 'label+box',
      labelSize: [16, 12],
    });
    expect(kitchen.confidence).toBeGreaterThan(0.8);
    // the unnamed box takes the label that sits in it
    const bed = c.find((x) => x.name === 'Bedroom 1')!;
    expect(bed).toMatchObject({ type: 'bedroom', source: 'label+box' });
    // a label with a size and no region gets a box of that size around it
    const gym = c.find((x) => x.name === 'Gym')!;
    expect(gym.source).toBe('label');
    expect(gym.box[2] - gym.box[0]).toBeCloseTo(70, 5);
    expect(gym.confidence).toBeLessThan(0.5);
    // a lone box
    expect(c.find((x) => x.name === 'Garage thing')!.source).toBe('box');
    // a label without a size and without a region (a gate) is not a room
    expect(c.find((x) => x.name === 'Pedestrian Gate')).toBeUndefined();
  });
});
