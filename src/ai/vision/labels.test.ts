import { describe, expect, it } from 'vitest';
import { classify, nameOf, nameSimilarity, parseSize, slug } from './labels';

const near = (a: [number, number], b: [number, number], tol = 0.01) => {
  expect(a[0]).toBeCloseTo(b[0], 1);
  expect(a[1]).toBeCloseTo(b[1], 1);
  void tol;
};

describe('label sizes', () => {
  it('reads feet written the way the picture writes them', () => {
    for (const t of [
      "14' x 12'",
      '14′ × 12′',
      '14 x 12 ft',
      '14ft x 12ft',
      "Kitchen 14' x 12'",
      '14 X 12 feet',
    ])
      near(parseSize(t)!.size, [14, 12]);
    expect(parseSize("14' x 12'")!.unit).toBe('ft');
  });

  it('reads feet and inches', () => {
    near(parseSize(`14'6" x 12'`)!.size, [14.5, 12]);
    near(parseSize(`10' 3" x 8' 6"`)!.size, [10.25, 8.5]);
  });

  it('reads metres and converts to feet', () => {
    const s = parseSize('4.2 × 3.6 m')!;
    near(s.size, [13.78, 11.81]);
    expect(s.unit).toBe('m');
    near(parseSize('4,2m x 3,6m')!.size, [13.78, 11.81]);
    near(parseSize('4200 x 3600 mm')!.size, [13.78, 11.81]);
    near(parseSize('420 x 360 cm')!.size, [13.78, 11.81]);
  });

  it('does not invent a size from other text', () => {
    expect(parseSize('Bedroom 2')).toBeNull();
    expect(parseSize('Bath 2 8 x 6')).toBeNull(); // no unit: not safe to guess
    expect(parseSize('')).toBeNull();
  });

  it('separates the name from the size', () => {
    expect(nameOf("Bedroom 1 14' x 12'")).toBe('Bedroom 1');
    expect(nameOf("Garden Lounge 18' x 14'")).toBe('Garden Lounge');
    expect(nameOf('Kitchen')).toBe('Kitchen');
    expect(nameOf('Living & Dining Area 28 x 18 ft')).toBe('Living & Dining Area');
  });
});

describe('what a label names', () => {
  it.each([
    ['Bedroom 1', 'room', 'bedroom'],
    ['Guest Room', 'room', 'bedroom'],
    ['Bath 2', 'room', 'bathroom'],
    ['Walk-in Closet', 'room', 'walk-in-closet'],
    ['Kitchen', 'room', 'kitchen'],
    ['Living & Dining Area', 'room', 'living'],
    ['Foyer', 'room', 'foyer'],
    ['Gym', 'room', 'gym'],
    ['Sauna', 'room', 'sauna'],
    ['Spa', 'room', 'spa'],
    ['Gaming Room', 'room', 'game-room'],
    ['Utility', 'room', 'utility'],
    ['Infinity Pool (Organic Shape)', 'zone', 'pool'],
    ['Covered Car Parking', 'zone', 'parking'],
    ['Kids Play Area', 'zone', 'play'],
    ['Outdoor Dining', 'zone', 'patio'],
    ['Garden Lounge', 'zone', 'lawn'],
    ['Front Garden', 'zone', 'lawn'],
    ['Fire-Pit Deck', 'zone', 'deck'],
    ['Entrance Path and Steps', 'zone', 'path'],
    ['Roof Terrace', 'room', 'outdoor'],
    ['Something odd', 'room', 'other'],
  ])('%s → %s %s', (name, kind, type) => {
    expect(classify(name)).toEqual({ kind, type });
  });

  it('compares names loosely', () => {
    expect(nameSimilarity('Bedroom 1', 'bedroom 1')).toBe(1);
    expect(nameSimilarity('Bedroom 1', 'Bedroom 2')).toBeLessThan(0.5);
    expect(nameSimilarity('Infinity Pool (Organic Shape)', 'Infinity Pool')).toBe(1);
    expect(nameSimilarity('Master Bedroom', 'Bedroom')).toBeGreaterThan(0.4);
    expect(nameSimilarity('Kitchen', 'Gym')).toBe(0);
    expect(slug('Living & Dining Area')).toBe('living-dining');
  });
});
