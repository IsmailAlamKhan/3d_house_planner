import { produce } from 'immer';
import { Matrix4, OrthographicCamera, PerspectiveCamera } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog';
import { createSampleProject } from '../model/sample';
import * as ops from '../model/ops';
import { generateRoomCeiling } from '../scene3d/generators/floors';
import { autoDecorateProject } from './decorate';
import { projectLabels, roomDimensions, roomLabels } from './labels';
import { cutawayPose, lightingFor } from './presets';
import { usePresent } from './presentStore';
import { interiorLightsOn } from '../scene3d/lighting';
import { edit, undo, useModel } from '../model/store';
import type { Room } from '../model/types';

const room = (w: number, d: number): Room => ({
  id: 'r',
  levelId: 'l',
  name: 'Living',
  type: 'living',
  polygon: [
    { x: 1, y: 2 },
    { x: 1 + w, y: 2 },
    { x: 1 + w, y: 2 + d },
    { x: 1, y: 2 + d },
  ],
  floorMaterial: 'floor-oak',
  ceilingMaterial: 'paint-white',
  doubleHeight: false,
});

describe('room labels', () => {
  it('writes sizes in feet-inches or metres like the project units', () => {
    expect(roomDimensions(room(4.2672, 3.6576), 'imperial')).toBe("14' x 12'");
    expect(roomDimensions(room(4.3, 3.7), 'imperial')).toBe(`14'1" x 12'2"`);
    expect(roomDimensions(room(4.34, 3.7), 'metric')).toMatch(/4[.,]3 × 3[.,]7/);
  });

  it('builds one label per room with name, size and/or area, skipping hidden rooms and other levels', () => {
    const p = createSampleProject();
    const first = p.rooms[0] ? p : produce(p, (d) => void ops.syncRooms(d, d.levels[0]!.id));
    const all = roomLabels(first, { mode: 'both', hidden: new Set(), levelIds: null });
    expect(all.length).toBe(first.rooms.filter((r) => r.name !== 'Open to below').length);
    expect(all[0]!.detail).toContain('·');
    const hidden = roomLabels(first, {
      mode: 'dims',
      hidden: new Set([first.rooms[0]!.id]),
      levelIds: null,
    });
    expect(hidden.length).toBe(all.length - 1);
    const none = roomLabels(first, {
      mode: 'dims',
      hidden: new Set(),
      levelIds: new Set(['nope']),
    });
    expect(none).toHaveLength(0);
  });

  it('projects a label at the middle of the picture when the camera looks straight at it', () => {
    const cam = new PerspectiveCamera(45, 2, 0.1, 100);
    cam.position.set(5, 10, 5);
    cam.lookAt(5, 0, 5);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    const vp = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const labels = [
      { roomId: 'a', title: 'A', detail: '', world: { x: 5, y: 0, z: 5 } },
      { roomId: 'b', title: 'B', detail: '', world: { x: 5, y: 0, z: 500 } }, // far outside the picture
      { roomId: 'c', title: 'C', detail: '', world: { x: 5, y: 40, z: 5 } }, // behind the camera
    ];
    const out = projectLabels(labels, vp, 1000, 500);
    expect(out).toHaveLength(1);
    expect(out[0]!.sx).toBeCloseTo(500, 0);
    expect(out[0]!.sy).toBeCloseTo(250, 0);
  });

  it('puts +x to the right and plan +y (south) towards the bottom for a top-down orthographic view', () => {
    const cam = new OrthographicCamera(-10, 10, 5, -5, 0.1, 100);
    cam.position.set(0, 20, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    const vp = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const [a, b] = projectLabels(
      [
        { roomId: 'a', title: '', detail: '', world: { x: 4, y: 0, z: 0 } },
        { roomId: 'b', title: '', detail: '', world: { x: 0, y: 0, z: 3 } },
      ],
      vp,
      800,
      400,
    );
    expect(a!.sx).toBeGreaterThan(400);
    expect(b!.sy).toBeGreaterThan(200);
  });
});

describe('presets and looks', () => {
  it('frames the chosen level: higher levels are framed higher, and the building stays in view', () => {
    const p = createSampleProject();
    const ground = cutawayPose(p, 'cutaway-top', p.levels[0]!.id, 1.6);
    const upper = cutawayPose(p, 'cutaway-top', p.levels[1]!.id, 1.6);
    expect(upper.target[1] - ground.target[1]).toBeCloseTo(p.levels[1]!.elevation);
    expect(ground.position[1]).toBeGreaterThan(ground.target[1] + 5); // from above
    const three = cutawayPose(p, 'cutaway-34', p.levels[0]!.id, 1.6);
    const dy = three.position[1] - three.target[1];
    const dh = Math.hypot(three.position[0] - three.target[0], three.position[2] - three.target[2]);
    expect(Math.atan2(dy, dh) * (180 / Math.PI)).toBeGreaterThan(50);
    expect(Math.atan2(dy, dh) * (180 / Math.PI)).toBeLessThan(60);
  });

  it('dusk and night switch the lamps on, daylight does not', () => {
    expect(interiorLightsOn(lightingFor('dusk'))).toBe(true);
    expect(interiorLightsOn(lightingFor('night'))).toBe(true);
    expect(interiorLightsOn(lightingFor('daylight'))).toBe(false);
  });

  it('remembers the label settings', () => {
    usePresent.getState().setLabels({ mode: 'both', size: 0.03 });
    expect(JSON.parse(localStorage.getItem('duplex-designer:present')!).labels).toMatchObject({
      mode: 'both',
      size: 0.03,
    });
    usePresent.getState().setLabels({ mode: 'dims', size: 0.02 });
  });
});

describe('decor catalog', () => {
  it('has plants in three sizes with four species, art, lamps, outdoor and spa items', () => {
    const ids = CATALOG.map((e) => e.catalogId);
    for (const id of [
      'plant-small',
      'plant-medium',
      'plant-large',
      'wall-art',
      'table-lamp',
      'vase-bowl',
      'tv-wall-unit',
      'spa-tub',
      'planter-box',
      'tree-small',
      'grass-patch',
      'fire-pit',
      'plunge-pool',
      'balustrade',
      'gate-pedestrian',
      'gate-vehicle',
      'fountain',
      'pergola',
      'lounge-set',
      'outdoor-dining',
      'sun-lounger',
      'car',
      'treadmill',
      'gym-bench',
      'gym-rack',
      'gaming-desk',
    ])
      expect(ids).toContain(id);
    const plant = CATALOG.find((e) => e.catalogId === 'plant-large')!;
    const species = plant.props.find((p) => p.key === 'species');
    expect(species && species.kind === 'select' ? species.options.length : 0).toBe(4);
    const rug = CATALOG.find((e) => e.catalogId === 'rug')!;
    const pattern = rug.props.find((p) => p.key === 'pattern');
    expect(pattern && pattern.kind === 'select' ? pattern.options.length : 0).toBe(4);
  });
});

describe('outdoor rooms', () => {
  it('have no ceiling and can take a low parapet instead of full walls', () => {
    const base = createSampleProject();
    const level = base.levels[0]!;
    const p = produce(base, (d) => {
      const lvl = d.levels[0]!.id;
      const sq = [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 2 },
        { x: 0, y: 2 },
      ];
      sq.forEach((a, i) =>
        ops.addWall(d, {
          levelId: lvl,
          start: a,
          end: sq[(i + 1) % 4]!,
          type: 'exterior',
          thickness: 0.2,
        }),
      );
      const id = ops.addRoom(d, { levelId: lvl, polygon: sq, type: 'outdoor', name: 'Terrace' });
      ops.setRoomParapet(d, id, true);
    });
    const terrace = p.rooms.find((r) => r.name === 'Terrace')!;
    expect(generateRoomCeiling(terrace, level, [])).toBeNull();
    const around = p.walls.filter((w) => w.thickness === 0.2);
    expect(around.every((w) => w.height === 1)).toBe(true);
    const back = produce(p, (d) => void ops.setRoomParapet(d, terrace.id, false));
    expect(back.walls.filter((w) => w.thickness === 0.2).every((w) => w.height === undefined)).toBe(
      true,
    );
  });
});

describe('auto-decorate', () => {
  beforeEach(() => useModel.getState().loadProject(createSampleProject()));

  it('furnishes the rooms of a designed home with decor, respecting clearances', async () => {
    const { offlineIntent } = await import('../ai/offline');
    const { solveLayout } = await import('../ai/layout/solve');
    const { applyPlan } = await import('../ai/layout/apply');
    const base = createSampleProject();
    const { intent } = offlineIntent('3 bedroom duplex with open kitchen');
    const plan = solveLayout({
      intent,
      footprint: base.shell.footprint,
      entrance: base.shell.entrance,
      plumbing: base.shell.fixedPlumbingPoints,
      columns: [],
      maxHeight: base.shell.maxHeight,
    });
    useModel.getState().loadProject(produce(base, (d) => void applyPlan(d, plan, intent.style)));
    const before = useModel.getState().project.items.length;
    const n = useModel.getState().apply((p) => autoDecorateProject(p));
    const after = useModel.getState().project;
    expect(n).toBeGreaterThan(5);
    expect(after.items.length).toBe(before + n);
    const kinds = new Set(after.items.map((i) => i.catalogId));
    expect(kinds.has('wall-art') || kinds.has('plant-medium') || kinds.has('plant-large')).toBe(
      true,
    );
    // Every living room / bedroom with seating or a bed got a rug.
    expect(after.items.some((i) => i.catalogId === 'rug')).toBe(true);
    // Running it again adds nothing: rooms that already have decor are skipped.
    const again = useModel.getState().apply((p) => autoDecorateProject(p));
    expect(again).toBe(0);
  });

  it('is one undo step', () => {
    const base = createSampleProject();
    const before = base.items.length;
    useModel.getState().loadProject(base);
    let n = 0;
    edit((p) => void (n = autoDecorateProject(p)));
    expect(useModel.getState().project.items.length).toBe(before + n);
    undo();
    expect(useModel.getState().project.items.length).toBe(before);
  });
});

describe('auto exposure', () => {
  it('brings dark pictures up and bright ones down, within ±1.5 EV', async () => {
    const { evFor, meanBrightness } = await import('./render');
    expect(evFor(0.42)).toBeCloseTo(0);
    expect(evFor(0.2)).toBeGreaterThan(0.5);
    expect(evFor(0.7)).toBeLessThan(-0.5);
    expect(evFor(0.001)).toBe(1.5);
    expect(evFor(0.02)).toBe(1.5);
    expect(evFor(0.99)).toBe(-1.5);
    const grey = new Uint8ClampedArray(4 * 4).fill(128);
    expect(meanBrightness({ data: grey, width: 2, height: 2 })).toBeCloseTo(128 / 255, 3);
  });
});
