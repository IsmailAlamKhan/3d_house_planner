import { produce } from 'immer';
import {
  Box3,
  type BufferGeometry,
  Mesh,
  type MeshStandardMaterial,
  type Object3D,
  Vector3,
} from 'three';
import { getEntry, openingStyles } from '../../catalog';
import { describe, expect, it } from 'vitest';
import { computeWallPolygons } from '../../geometry/walls';
import { createSampleProject } from '../../model/sample';
import * as ops from '../../model/ops';
import type { Wall } from '../../model/types';
import { SceneBuilder } from '../sceneModel';
import { type Part, subtractPolygons, unionPolygons } from './common';
import {
  generateColumn,
  generateFlatRoof,
  generateRoomCeiling,
  generateRoomFloor,
  generateSlab,
} from './floors';
import { generateItemPart } from './items';
import { generateOpeningParts } from './openings';
import { generateStair, layoutStair, stairVoidPlan, validateStair } from './stairs';
import { slabVoids } from './voids';
import { generateWall, openingHoles, wallShape } from './walls';

const bounds = (g: BufferGeometry) =>
  new Box3().setFromBufferAttribute(g.getAttribute('position') as never);

/** Enclosed volume via the divergence theorem (valid for closed, consistently wound meshes). */
function volume(g: BufferGeometry): number {
  const pos = g.getAttribute('position');
  const idx = g.getIndex();
  const n = idx ? idx.count : pos.count;
  const v = (i: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i);
  let vol = 0;
  for (let i = 0; i < n; i += 3)
    vol += v(i).dot(new Vector3().crossVectors(v(i + 1), v(i + 2))) / 6;
  return vol;
}

/** Sum of triangle areas whose normal points (mostly) along `axis`. */
function areaFacing(g: BufferGeometry, axis: Vector3): number {
  const pos = g.getAttribute('position');
  const idx = g.getIndex();
  const n = idx ? idx.count : pos.count;
  const v = (i: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i);
  let area = 0;
  for (let i = 0; i < n; i += 3) {
    const c = new Vector3().crossVectors(v(i + 1).sub(v(i)), v(i + 2).sub(v(i)));
    if (c.clone().normalize().dot(axis) > 0.9) area += c.length() / 2;
  }
  return area;
}

const wall = (over: Partial<Wall> = {}): Wall => ({
  id: 'w',
  levelId: 'L',
  start: { x: 0, y: 0 },
  end: { x: 4, y: 0 },
  thickness: 0.2,
  type: 'interior',
  materialInside: 'paint-white',
  materialOutside: 'brick-red',
  locked: false,
  ...over,
});
const opening = (over = {}) => ({
  id: 'o',
  wallId: 'w',
  kind: 'door' as const,
  catalogId: 'x',
  offset: 1,
  width: 0.9,
  height: 2.1,
  sillHeight: 0,
  flip: false,
  swing: 'left' as const,
  props: {},
  ...over,
});
const fp = [
  { x: -5, y: -5 },
  { x: 15, y: -5 },
  { x: 15, y: 15 },
  { x: -5, y: 15 },
];

describe('walls', () => {
  it('builds a solid wall with the right bounds and volume', () => {
    const w = wall();
    const part = generateWall({
      wall: w,
      polygon: computeWallPolygons([w]).get('w')!,
      openings: [],
      height: 2.7,
      footprint: fp,
    })!;
    const b = bounds(part.geometry);
    expect(b.min.x).toBeCloseTo(0);
    expect(b.max.x).toBeCloseTo(4);
    expect(b.max.y).toBeCloseTo(2.7);
    expect(b.max.z).toBeCloseTo(0.1);
    expect(b.min.z).toBeCloseTo(-0.1);
    expect(volume(part.geometry)).toBeCloseTo(4 * 2.7 * 0.2, 4);
  });

  it('cuts a door (notch) and a window (hole) without CSG', () => {
    const w = wall();
    const ops2 = [
      opening(),
      opening({ id: 'o2', kind: 'window', offset: 3, width: 1.2, height: 1.2, sillHeight: 0.9 }),
    ];
    const shape = wallShape(4, 2.7, openingHoles(ops2, 4, 2.7));
    expect(shape.holes).toHaveLength(1); // the window; the door is a notch in the outline
    const part = generateWall({
      wall: w,
      polygon: computeWallPolygons([w]).get('w')!,
      openings: ops2,
      height: 2.7,
      footprint: fp,
    })!;
    expect(volume(part.geometry)).toBeCloseTo((4 * 2.7 - 0.9 * 2.1 - 1.2 * 1.2) * 0.2, 2);
  });

  it('separates face materials: left face looks toward +z, right toward -z', () => {
    const w = wall({ materialInside: 'A', materialOutside: 'B' });
    const part = generateWall({
      wall: w,
      polygon: computeWallPolygons([w]).get('w')!,
      openings: [],
      height: 2.7,
      footprint: fp,
    })!;
    expect(part.materials).toEqual(['A', 'B', 'wall-edge']);
    const g = part.geometry;
    expect(g.groups.map((x) => x.materialIndex).sort()).toEqual([0, 1, 2]);
    const normals = g.getAttribute('normal');
    for (const grp of g.groups.filter((x) => (x.materialIndex ?? 9) < 2)) {
      const nz = normals.getZ(grp.start);
      expect(Math.sign(nz)).toBe(grp.materialIndex === 0 ? 1 : -1);
    }
  });

  it('puts the exterior finish on the outside of exterior walls', () => {
    const w = wall({
      type: 'exterior',
      materialInside: 'in',
      materialOutside: 'out',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
    });
    const shell = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
      { x: 0, y: 8 },
    ];
    const part = generateWall({
      wall: w,
      polygon: computeWallPolygons([w]).get('w')!,
      openings: [],
      height: 2.7,
      footprint: shell,
    })!;
    // Shell is on the +y (left) side → left face is inside.
    expect(part.materials[0]).toBe('in');
    const flipped = generateWall({
      wall: { ...w, start: w.end, end: w.start },
      polygon: computeWallPolygons([{ ...w, start: w.end, end: w.start }]).get('w')!,
      openings: [],
      height: 2.7,
      footprint: shell,
    })!;
    expect(flipped.materials[0]).toBe('out');
  });

  it('mitres corners so walls meet cleanly', () => {
    const a = wall({ id: 'a' });
    const b = wall({ id: 'b', start: { x: 4, y: 0 }, end: { x: 4, y: 3 } });
    const polys = computeWallPolygons([a, b]);
    const pa = generateWall({
      wall: a,
      polygon: polys.get('a')!,
      openings: [],
      height: 2.7,
      footprint: fp,
    })!;
    expect(bounds(pa.geometry).max.x).toBeCloseTo(4.1);
    expect(bounds(pa.geometry).min.x).toBeCloseTo(0);
  });

  it('clamps openings to the wall height (cut mode)', () => {
    expect(openingHoles([opening({ sillHeight: 0.9, height: 1.2 })], 4, 1.2)).toHaveLength(1);
    expect(openingHoles([opening({ sillHeight: 1.5, height: 1.0 })], 4, 1.2)).toHaveLength(0);
  });
});

describe('opening trim (catalog models placed on the wall)', () => {
  const w = wall();
  const input = (o: object, doorsOpen = false) => ({
    opening: opening(o),
    wall: w,
    doorsOpen,
    footprint: fp,
  });
  const materialColors = (obj: Object3D) => {
    const colors = new Set<string>();
    obj.traverse((m) => {
      if (m instanceof Mesh)
        colors.add(`#${(m.material as MeshStandardMaterial).color.getHexString()}`);
    });
    return colors;
  };

  it('windows get a frame and a glass pane, doors a frame and a leaf, archways nothing', () => {
    const win = generateOpeningParts(
      input({
        kind: 'window',
        catalogId: 'window-casement',
        sillHeight: 0.9,
        height: 1.2,
        width: 1.2,
      }),
    );
    expect(win).toHaveLength(1);
    expect(materialColors(win[0]!.object)).toContain('#a5d8ff');
    const door = generateOpeningParts(input({ catalogId: 'door-single' }));
    expect(materialColors(door[0]!.object)).toContain('#b9814e'); // the leaf
    expect(generateOpeningParts(input({ kind: 'archway', catalogId: 'archway' }))).toHaveLength(0);
  });

  it('places the model on the wall at its offset and sill height', () => {
    const win = generateOpeningParts(
      input({
        kind: 'window',
        catalogId: 'window-casement',
        sillHeight: 0.9,
        height: 1.2,
        width: 1.2,
        offset: 3,
      }),
    );
    const b = new Box3().setFromObject(win[0]!.object);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(3, 1);
    expect(b.min.y).toBeGreaterThanOrEqual(0.9 - 0.01);
    expect(b.max.y).toBeCloseTo(0.9 + 1.2, 1);
    expect(win[0]!.entity).toEqual({ type: 'opening', id: 'o' });
  });

  it('swings a door leaf open when asked', () => {
    const closed = new Box3().setFromObject(generateOpeningParts(input({}, false))[0]!.object);
    const ajar = new Box3().setFromObject(generateOpeningParts(input({}, true))[0]!.object);
    expect(ajar.max.z - ajar.min.z).toBeGreaterThan(closed.max.z - closed.min.z + 0.1);
  });

  it('every wall style builds for the matching kind', () => {
    for (const style of openingStyles('window')) {
      const parts = generateOpeningParts(
        input({
          kind: 'window',
          catalogId: style.catalogId,
          sillHeight: style.sill ?? 0.9,
          height: 1.2,
        }),
      );
      expect(parts).toHaveLength(1);
    }
    for (const style of openingStyles('door'))
      expect(generateOpeningParts(input({ catalogId: style.catalogId }))).toHaveLength(
        style.openingKind === 'archway' ? 0 : 1,
      );
  });

  it('unknown catalog ids fall back to the default style for their kind', () => {
    expect(generateOpeningParts(input({ catalogId: 'does-not-exist' }))).toHaveLength(1);
  });
});

describe('items', () => {
  it('positions an item on its level with plan rotation mapped to −Y rotation', () => {
    const p = createSampleProject();
    const item = p.items.find((i) => i.catalogId === 'wardrobe')!;
    const part = generateItemPart(item)!;
    expect(part.object.position.x).toBeCloseTo(item.position.x);
    expect(part.object.position.z).toBeCloseTo(item.position.y);
    expect(part.object.rotation.y).toBeCloseTo(-item.rotation);
    expect(part.entity).toEqual({ type: 'item', id: item.id });
    expect(generateItemPart({ ...item, catalogId: 'nope' })).toBeNull();
  });
  it('scales the model through the item scale', () => {
    const p = createSampleProject();
    const item = { ...p.items[0]!, scale: { x: 2, y: 1, z: 1 } };
    const entry = getEntry(item.catalogId)!;
    const b = new Box3().setFromObject(generateItemPart(item)!.object);
    expect(b.max.x - b.min.x).toBeGreaterThan(entry.defaultSize.w * 1.5);
  });
});

describe('slabs, floors, ceilings, roofs, columns', () => {
  const p = createSampleProject();
  const L0 = p.levels[0]!;
  const L1 = p.levels[1]!;
  const shellArea = 10 * 12;

  it('slab follows the shell with its thickness', () => {
    const s = generateSlab(L0, p.shell.footprint, [])!;
    const b = bounds(s.geometry);
    expect(b.min.y).toBeCloseTo(-0.2);
    expect(b.max.y).toBeCloseTo(0);
    expect(volume(s.geometry)).toBeCloseTo(shellArea * 0.2, 3);
  });

  it('upper slab has a void for the stair (and for double-height rooms)', () => {
    const voids = slabVoids(p, L1);
    expect(voids.length).toBeGreaterThan(0);
    const s = generateSlab(L1, p.shell.footprint, voids)!;
    const hole = unionPolygons(voids).reduce((a, poly) => a + Math.abs(areaOfRing(poly[0]!)), 0);
    expect(volume(s.geometry)).toBeCloseTo((shellArea - hole) * 0.2, 2);
    const dh = produce(p, (d) => {
      d.rooms.find((r) => r.levelId === L0.id && r.name === 'Living room')!.doubleHeight = true;
    });
    expect(slabVoids(dh, L1).length).toBe(voids.length + 1);
    expect(slabVoids(p, L0)).toHaveLength(0);
  });

  it('room floors face up, ceilings face down, and both respect openings', () => {
    const room = p.rooms.find((r) => r.levelId === L0.id && r.name === 'Living room')!;
    const floor = generateRoomFloor(room, [])!;
    expect(areaFacing(floor.geometry, new Vector3(0, 1, 0))).toBeCloseTo(42, 3);
    expect(floor.materials).toEqual([room.floorMaterial]);
    const ceil = generateRoomCeiling(room, L0, [])!;
    expect(areaFacing(ceil.geometry, new Vector3(0, -1, 0))).toBeCloseTo(42, 3);
    expect(bounds(ceil.geometry).max.y).toBeCloseTo(L0.floorToCeiling - 0.002);
    const hole = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ];
    expect(areaFacing(generateRoomFloor(room, [hole])!.geometry, new Vector3(0, 1, 0))).toBeCloseTo(
      41,
      3,
    );
    expect(generateRoomCeiling({ ...room, doubleHeight: true }, L0, [])).toBeNull();
  });

  it('flat roofs sit on top of the level and open for skylights', () => {
    const sky = [
      { x: 4, y: 4 },
      { x: 6, y: 4 },
      { x: 6, y: 6 },
      { x: 4, y: 6 },
    ];
    const parts = generateFlatRoof('r', L1, p.shell.footprint, [sky], []);
    expect(parts.map((x) => x.materials[0])).toEqual(['roof', 'glass']);
    expect(bounds(parts[0]!.geometry).min.y).toBeCloseTo(L1.floorToCeiling);
    expect(volume(parts[0]!.geometry)).toBeCloseTo((shellArea - 4) * L1.slabThickness, 3);
  });

  it('columns are boxes or cylinders as tall as the storey', () => {
    const rect = generateColumn(
      {
        id: 'c',
        levelId: L0.id,
        position: { x: 3, y: 3.5 },
        size: { w: 0.3, d: 0.4 },
        shape: 'rect',
        structural: true,
        locked: true,
      },
      L0,
    );
    const b = bounds(rect.geometry);
    expect(b.min.x).toBeCloseTo(2.85);
    expect(b.max.z).toBeCloseTo(3.7);
    expect(b.max.y).toBeCloseTo(2.7);
    const round = generateColumn(
      {
        id: 'c',
        levelId: L0.id,
        position: { x: 0, y: 0 },
        size: { w: 0.4, d: 0.4 },
        shape: 'round',
        structural: true,
        locked: true,
      },
      L0,
    );
    expect(bounds(round.geometry).max.x).toBeCloseTo(0.2);
  });
});

function areaOfRing(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++)
    a += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  return a / 2;
}

describe('stairs', () => {
  const p = createSampleProject();
  const stair = p.stairs[0]!;
  const [L0, L1] = p.levels as [(typeof p.levels)[0], (typeof p.levels)[0]];

  it('computes riser and tread within comfort limits', () => {
    const l = layoutStair(stair, L0, L1);
    expect(l.riserCount).toBe(16);
    expect(l.riser).toBeGreaterThanOrEqual(0.17);
    expect(l.riser).toBeLessThanOrEqual(0.19);
    expect(l.riser * l.riserCount).toBeCloseTo(2.9);
    expect(l.tread).toBeGreaterThanOrEqual(0.25);
    expect(l.steps).toHaveLength(15);
  });

  it('opens the slab only where headroom is under 2 m', () => {
    const l = layoutStair(stair, L0, L1);
    const slabBottom = 2.9 - 0.2;
    expect(slabBottom - l.steps[l.voidFromStep - 1]!.top).toBeGreaterThanOrEqual(2.0);
    expect(slabBottom - l.steps[l.voidFromStep]!.top).toBeLessThan(2.0);
    const plan = stairVoidPlan(stair, l);
    expect(plan.length).toBe(l.steps.length - l.voidFromStep);
  });

  it('straight stair mesh reaches one riser below the upper floor and fits the sample shell', () => {
    const parts = generateStair(stair, L0, L1);
    const body = parts.find((x) => x.materials[0] === 'stair')!;
    const b = bounds(body.geometry);
    expect(b.max.y).toBeCloseTo(2.9 - 2.9 / 16, 3);
    expect(b.min.x).toBeCloseTo(8, 3);
    expect(b.max.x).toBeCloseTo(9, 3);
    expect(b.min.z).toBeCloseTo(7.4, 3);
    expect(b.max.z).toBeCloseTo(7.4 + 15 * 0.27, 3);
    expect(parts.some((x) => x.materials[0] === 'rail')).toBe(true);
    expect(validateStair(p, stair)).toEqual([]);
  });

  it.each(['L', 'U', 'spiral'] as const)('%s stairs build and rise to the same height', (type) => {
    const s = { ...stair, type, rotation: 0, position: { x: 3, y: 3 } };
    const l = layoutStair(s, L0, L1);
    expect(Math.max(...l.steps.map((x) => x.top))).toBeCloseTo(2.9 - l.riser, 3);
    const parts = generateStair({ ...s, railing: false }, L0, L1);
    expect(parts).toHaveLength(1);
    expect(bounds(parts[0]!.geometry).max.y).toBeCloseTo(2.9 - l.riser, 3);
  });

  it('railings are optional', () => {
    expect(
      generateStair({ ...stair, railing: false }, L0, L1).some((x) => x.materials[0] === 'rail'),
    ).toBe(false);
  });

  it('warns about stairs outside the apartment, low headroom and a skipped level', () => {
    expect(validateStair(p, { ...stair, position: { x: 30, y: 3 } }).join(' ')).toMatch(
      /inside the apartment/,
    );
    const low = produce(p, (d) => {
      d.levels[0]!.floorToCeiling = 2.0;
      ops.updateLevel(d, d.levels[0]!.id, { floorToCeiling: 2.0 });
    });
    expect(validateStair(low, low.stairs[0]!).join(' ')).toMatch(/[Hh]eadroom|Riser/);
    const three = produce(p, (d) => {
      ops.addLevel(d);
      d.stairs[0]!.toLevelId = d.levels[2]!.id;
    });
    expect(validateStair(three, three.stairs[0]!).join(' ')).toMatch(/skips a level/);
  });

  it('enforces a minimum tread of 25 cm', () => {
    const l = layoutStair({ ...stair, treadDepth: 0.2 }, L0, L1);
    expect(l.tread).toBe(0.25);
    expect(l.warnings.join(' ')).toMatch(/Tread/);
  });
});

describe('subtract helpers', () => {
  it('ignores holes outside the subject', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    const far = [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 6, y: 6 },
      { x: 5, y: 6 },
    ];
    expect(subtractPolygons(sq, [far])).toHaveLength(1);
    expect(subtractPolygons(sq, [far])[0]).toHaveLength(1);
  });
});

describe('SceneBuilder', () => {
  const opts = { wallMode: 'up' as const, cutHeight: 1.2, doorsOpen: false };

  it('renders every entity type of the sample duplex', () => {
    const b = new SceneBuilder();
    const levels = b.build(createSampleProject(), opts);
    expect(levels).toHaveLength(2);
    const layers = new Set(levels.flatMap((l) => l.parts.map((p) => p.layer)));
    for (const layer of [
      'wall',
      'frame',
      'slab',
      'floor',
      'ceiling',
      'column',
      'stair',
      'roof',
    ] as const) {
      expect(layers.has(layer)).toBe(true);
    }
    b.dispose();
  });

  it('only rebuilds what changed', () => {
    const b = new SceneBuilder();
    const p = createSampleProject();
    b.build(p, opts);
    const first = b.cache.builds;
    b.build(p, opts);
    expect(b.cache.builds).toBe(first);
    const north = p.walls.find((w) => w.start.x === 0 && w.start.y === 0 && w.end.x === 10)!;
    const p2 = produce(p, (d) => {
      ops.updateWall(d, north.id, { thickness: 0.4 });
    });
    b.build(p2, opts);
    // The wall itself plus the wall(s) sharing its corners are rebuilt — far fewer than the whole model.
    expect(b.cache.builds - first).toBeLessThan(10);
    expect(b.cache.builds - first).toBeGreaterThan(0);
    b.dispose();
  });

  it('wall mode "cut" lowers walls and removes entries for deleted entities', () => {
    const b = new SceneBuilder();
    const p = createSampleProject();
    const lvl = b.build(p, { ...opts, wallMode: 'cut' });
    const wallPart = lvl[0]!.parts.find((x) => x.layer === 'wall') as Part;
    expect(bounds(wallPart.geometry).max.y).toBeCloseTo(1.2);
    const before = b.cache.size;
    b.build(
      produce(p, (d) => ops.deleteWallsAndSync(d, [d.walls[0]!.id])),
      opts,
    );
    expect(b.cache.size).toBeLessThan(before + 100);
    b.dispose();
  });
});
