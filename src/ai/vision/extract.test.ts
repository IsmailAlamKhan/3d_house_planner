import { describe, expect, it } from 'vitest';
import { buildProject } from '../../reference/build';
import type { VisionClient } from './client';
import { extract } from './extract';
import { catalogFor, findItems } from './items';
import { initialReview, specFromReview } from './recreate';
import type { PictureSource } from './source';

/** A plan the fake model "sees": rooms as boxes in a 1000 × 1700 picture, with the labels printed in them. */
const TRUTH: {
  name: string;
  size?: string;
  kind: 'room' | 'zone';
  box: [number, number, number, number];
}[] = [
  { name: 'Living', size: "20' x 20'", kind: 'room', box: [100, 200, 400, 500] },
  { name: 'Kitchen', size: "14' x 10'", kind: 'room', box: [400, 200, 610, 350] },
  { name: 'Bedroom 1', size: "14' x 12'", kind: 'room', box: [400, 350, 610, 530] },
  { name: 'Foyer', size: "10' x 7'", kind: 'room', box: [100, 500, 250, 605] },
  { name: 'Bath', size: "9' x 7'", kind: 'room', box: [250, 500, 385, 605] },
  { name: 'Bedroom 2', size: "14' x 12'", kind: 'room', box: [100, 1000, 310, 1180] },
  { name: 'Front Garden', kind: 'zone', box: [100, 1250, 610, 1500] },
];

/** A picture source whose "images" are just the crop box, and a model that answers from the plan above. */
function fake() {
  const source: PictureSource = {
    width: 1000,
    height: 1700,
    crop: async (b, maxSide) => btoa(JSON.stringify({ ...b, maxSide })),
  };
  const calls: string[] = [];
  const client: VisionClient = {
    async ask(req) {
      const crop = JSON.parse(atob(req.images[0]!)) as {
        x: number;
        y: number;
        w: number;
        h: number;
      };
      const nx = (x: number) => Math.round(((x - crop.x) / crop.w) * 1000);
      const ny = (y: number) => Math.round(((y - crop.y) / crop.h) * 1000);
      if (/text label/.test(req.prompt)) {
        calls.push('labels');
        return JSON.stringify({
          labels: TRUTH.filter((t) => {
            const cx = (t.box[0] + t.box[2]) / 2;
            const cy = (t.box[1] + t.box[3]) / 2;
            return cx >= crop.x && cx <= crop.x + crop.w && cy >= crop.y && cy <= crop.y + crop.h;
          }).map((t) => ({
            name: t.name,
            ...(t.size ? { size: t.size } : {}),
            x: nx((t.box[0] + t.box[2]) / 2),
            y: ny((t.box[1] + t.box[3]) / 2),
          })),
        });
      }
      if (/part of a floor plan/.test(req.prompt)) {
        calls.push('regions');
        return JSON.stringify({
          regions: TRUTH.map((t) => {
            const x0 = Math.max(t.box[0], crop.x);
            const y0 = Math.max(t.box[1], crop.y);
            const x1 = Math.min(t.box[2], crop.x + crop.w);
            const y1 = Math.min(t.box[3], crop.y + crop.h);
            return x1 - x0 > 20 && y1 - y0 > 20
              ? { label: t.name, kind: t.kind, x0: nx(x0), y0: ny(y0), x1: nx(x1), y1: ny(y1) }
              : null;
          }).filter(Boolean),
        });
      }
      calls.push('items');
      return JSON.stringify({
        items: [
          { name: 'queen bed', x: 500, y: 400 },
          { name: 'potted plant', x: 150, y: 150 },
          { name: 'mystery object', x: 10, y: 10 },
        ],
      });
    },
  };
  return { source, client, calls };
}

describe('reading a picture (with a pretend model)', () => {
  it('finds every labelled room and area, with its size and box, across tiles', async () => {
    const { source, client } = fake();
    const progress: string[] = [];
    const x = await extract({
      client,
      source,
      ftPerPx: 0.05,
      onProgress: (p) => progress.push(`${p.phase}:${p.done}/${p.total}`),
    });
    const names = x.candidates.map((c) => c.name).sort();
    expect(names).toEqual([
      'Bath',
      'Bedroom 1',
      'Bedroom 2',
      'Foyer',
      'Front Garden',
      'Kitchen',
      'Living',
    ]);
    const living = x.candidates.find((c) => c.name === 'Living')!;
    expect(living.box.map(Math.round)).toEqual([100, 200, 400, 500]);
    expect(living).toMatchObject({ type: 'living', kind: 'room', source: 'label+box' });
    expect(living.labelSize).toEqual([20, 20]);
    expect(x.candidates.find((c) => c.name === 'Front Garden')).toMatchObject({
      kind: 'zone',
      type: 'lawn',
    });
    expect(x.notes).toEqual([]);
    expect(
      progress.some((p) => p.startsWith('labels:')) &&
        progress.some((p) => p.startsWith('regions:')),
    ).toBe(true);
  });

  it('survives a tile whose answer is garbage, and says so', async () => {
    const f = fake();
    let n = 0;
    const client: VisionClient = {
      ask: async (r) => (++n === 3 ? 'sorry, I cannot do that' : f.client.ask(r)),
    };
    const x = await extract({ client, source: f.source, ftPerPx: 0.05, labelPasses: 'whole' });
    expect(x.candidates.length).toBeGreaterThanOrEqual(5);
    expect(x.notes.length + x.candidates.length).toBeGreaterThan(0);
  });

  it('says why when the model fails on every call, instead of returning an empty plan', async () => {
    const f = fake();
    const client: VisionClient = {
      ask: async () => {
        throw new Error('model not installed');
      },
    };
    await expect(extract({ client, source: f.source })).rejects.toThrow('model not installed');
  });

  it('review → spec → exact project: every reviewed room is built, reachable, with a door in', async () => {
    const f = fake();
    const x = await extract({ client: f.client, source: f.source, ftPerPx: 0.05 });
    const { rooms } = initialReview(
      x.candidates.filter((c) => c.name !== 'Bedroom 2'),
      0.05,
    );
    for (const mode of ['exact', 'labelled', 'pictured'] as const) {
      const spec = specFromReview(rooms, mode, { ftPerPx: 0.05 });
      const { project, report } = buildProject(spec, { id: 'r' });
      const d = report.designs[0]!;
      expect(d.overlaps, mode).toEqual([]);
      expect(d.unreachable, mode).toEqual([]);
      expect(project.rooms.map((r) => r.name).sort(), mode).toEqual([
        'Bath',
        'Bedroom 1',
        'Foyer',
        'Kitchen',
        'Living',
      ]);
    }
    const both = buildProject(specFromReview(rooms, 'both', { ftPerPx: 0.05 }), { id: 'r' });
    expect(both.project.options.map((o) => o.letter)).toEqual(['B']);
  });

  it('labelled mode gives every room its printed size', () => {
    const f = fake();
    return extract({ client: f.client, source: f.source, ftPerPx: 0.05 }).then((x) => {
      const { rooms } = initialReview(x.candidates, 0.05);
      const spec = specFromReview(rooms, 'labelled', { ftPerPx: 0.05 });
      const living = spec.designs[0]!.rooms!.find((r) => r.name === 'Living')!;
      expect(living.rect![2]).toBeCloseTo(20, 1);
      expect(living.rect![3]).toBeCloseTo(20, 1);
    });
  });
});

describe('furniture pass', () => {
  it('maps the names the model uses to catalogue items', () => {
    expect(catalogFor('Queen bed')).toBe('bed-queen');
    expect(catalogFor('king-size bed')).toBe('bed-king');
    expect(catalogFor('L-shaped sofa')).toBe('sofa-l');
    expect(catalogFor('U-shaped sectional')).toBe('sofa-u');
    expect(catalogFor('white SUV')).toBe('car');
    expect(catalogFor('trampoline')).toBe('trampoline');
    expect(catalogFor('kitchen island')).toBe('kitchen-island');
    expect(catalogFor('potted plant')).toBe('plant-medium');
    expect(catalogFor('mystery object')).toBeNull();
  });

  it('keeps only known pieces, inside their room, and puts them in the built project', async () => {
    const f = fake();
    const x = await extract({ client: f.client, source: f.source, ftPerPx: 0.05 });
    const { items } = await findItems(x.candidates, f.source, f.client);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.catalog === 'bed-queen' || i.catalog === 'plant-medium')).toBe(
      true,
    );
    for (const it of items) {
      const c = x.candidates.find((k) => k.id === it.candidateId)!;
      expect(it.at[0]).toBeGreaterThanOrEqual(c.box[0]);
      expect(it.at[0]).toBeLessThanOrEqual(c.box[2] + 1);
    }
    const { rooms } = initialReview(
      x.candidates.filter((c) => c.name !== 'Bedroom 2'),
      0.05,
    );
    const spec = specFromReview(rooms, 'exact', { ftPerPx: 0.05, items });
    const { project } = buildProject(spec, { id: 'r' });
    expect(project.items.some((i) => i.catalogId === 'bed-queen')).toBe(true);
  });
});
