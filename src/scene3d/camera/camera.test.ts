import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { addView, deleteView, renameView } from '../../model/ops';
import { createSampleProject } from '../../model/sample';
import { ProjectSchema } from '../../model/schemas';
import { focusTarget, poseForFocus } from './focus';
import { roomFocus } from './isolation';
import { distance3, measurementLabel } from './measure';
import { fromMap, minimapFrame, toMap } from './minimapFrame';
import { FOV, PRESETS, fitDistance, modelBox, presetPose, smoothstep, topPose } from './views';

const project = createSampleProject();

describe('preset views', () => {
  it('every preset looks at the middle of the building from outside it', () => {
    const m = modelBox(project);
    for (const p of PRESETS) {
      const pose = presetPose(project, p);
      expect(pose.target[0]).toBeCloseTo(m.cx);
      expect(pose.target[2]).toBeCloseTo(m.cz);
      const dist = Math.hypot(pose.position[0] - m.cx, pose.position[2] - m.cz);
      expect(dist).toBeGreaterThan(Math.max(m.width, m.depth) / 2);
    }
  });

  it('front is on the +z side, back on −z, left on −x, right on +x', () => {
    const m = modelBox(project);
    expect(presetPose(project, 'front').position[2]).toBeGreaterThan(m.cz);
    expect(presetPose(project, 'back').position[2]).toBeLessThan(m.cz);
    expect(presetPose(project, 'left').position[0]).toBeLessThan(m.cx);
    expect(presetPose(project, 'right').position[0]).toBeGreaterThan(m.cx);
    expect(presetPose(project, 'iso').position[1]).toBeGreaterThan(m.top / 2);
  });

  it('every preset keeps all eight corners of the building in view at any window shape', () => {
    const m = modelBox(project);
    const t = Math.tan((FOV * Math.PI) / 360);
    for (const aspect of [0.6, 1, 1.6, 2.4])
      for (const p of PRESETS) {
        const { position, target } = presetPose(project, p, aspect);
        const f = [target[0] - position[0], target[1] - position[1], target[2] - position[2]];
        const fl = Math.hypot(...f);
        f.forEach((_, i) => (f[i] = f[i]! / fl));
        const right = [-f[2]!, 0, f[0]!];
        const rl = Math.hypot(...right);
        right.forEach((_, i) => (right[i] = right[i]! / rl));
        const up = [
          right[1]! * f[2]! - right[2]! * f[1]!,
          right[2]! * f[0]! - right[0]! * f[2]!,
          right[0]! * f[1]! - right[1]! * f[0]!,
        ];
        for (const x of [m.cx - m.width / 2, m.cx + m.width / 2])
          for (const y of [0, m.top])
            for (const z of [m.cz - m.depth / 2, m.cz + m.depth / 2]) {
              const rel = [x - position[0], y - position[1], z - position[2]];
              const depth = rel[0]! * f[0]! + rel[1]! * f[1]! + rel[2]! * f[2]!;
              const px = (rel[0]! * right[0]! + rel[1]! * right[1]! + rel[2]! * right[2]!) / depth;
              const py = (rel[0]! * up[0]! + rel[1]! * up[1]! + rel[2]! * up[2]!) / depth;
              expect(depth).toBeGreaterThan(0);
              expect(Math.abs(px)).toBeLessThanOrEqual(aspect * t + 1e-6);
              expect(Math.abs(py)).toBeLessThanOrEqual(t + 1e-6);
            }
      }
  });

  it('a wider window pulls the camera in closer', () => {
    expect(fitDistance(10, 6, 2)).toBeLessThan(fitDistance(10, 6, 0.8));
  });

  it('top view fits the footprint in the viewport', () => {
    const t = topPose(project, { width: 800, height: 600 });
    const m = modelBox(project);
    expect(m.width * t.zoom).toBeLessThanOrEqual(800);
    expect(m.depth * t.zoom).toBeLessThanOrEqual(600);
    expect(t.position[1]).toBeGreaterThan(m.top);
  });

  it('smoothstep eases between 0 and 1', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBeCloseTo(0.5);
    expect(smoothstep(0.25)).toBeLessThan(0.25);
  });
});

describe('focus on selection', () => {
  it('centres on a room, an item and a wall; nothing selected → null', () => {
    const room = project.rooms[0]!;
    const f = focusTarget(project, { type: 'room', ids: [room.id] })!;
    expect(f.radius).toBeGreaterThan(0.8);
    const item = project.items[0]!;
    const fi = focusTarget(project, { type: 'item', ids: [item.id] })!;
    expect(fi.center[0]).toBeCloseTo(item.position.x);
    expect(focusTarget(project, { type: 'wall', ids: [project.walls[0]!.id] })).not.toBeNull();
    expect(focusTarget(project, { type: null, ids: [] })).toBeNull();
    const pose = poseForFocus(fi, [20, 10, 20]);
    expect(pose.target).toEqual(fi.center);
    expect(
      Math.hypot(...(pose.position.map((v, i) => v - fi.center[i]!) as [number, number, number])),
    ).toBeGreaterThan(2);
  });
});

describe('isolation', () => {
  it('keeps the room, its walls, doors and furniture solid and ghosts the rest', () => {
    const room = project.rooms.find((r) => r.type === 'bedroom')!;
    const focus = roomFocus(project, room.id)!;
    expect(focus.walls.size).toBeGreaterThanOrEqual(3);
    const part = (type: 'room' | 'wall' | 'item' | 'opening', id: string) =>
      ({ id: 'x', layer: 'wall', entity: { type, id } }) as never;
    expect(focus.isSolid(part('room', room.id), room.levelId)).toBe(true);
    expect(focus.isSolid(part('room', 'other'), room.levelId)).toBe(false);
    expect(focus.isSolid(part('wall', [...focus.walls][0]!), room.levelId)).toBe(true);
    expect(focus.isSolid(part('wall', [...focus.walls][0]!), 'another-level')).toBe(false);
    const other = project.rooms.find((r) => r.levelId !== room.levelId)!;
    expect(roomFocus(project, other.id)!.levelId).not.toBe(room.levelId);
    expect(roomFocus(project, 'nope')).toBeNull();
  });
});

describe('3D measurement', () => {
  it('measures straight-line, horizontal and vertical distance', () => {
    expect(distance3([0, 0, 0], [3, 4, 0])).toBe(5);
    expect(measurementLabel({ a: [0, 0, 0], b: [2, 0, 0] }, 'metric')).toBe('2.00 m');
    const label = measurementLabel({ a: [0, 0, 0], b: [3, 4, 0] }, 'metric');
    expect(label).toContain('5.00 m');
    expect(label).toContain('3.00 m');
    expect(label).toContain('4.00 m');
  });
});

describe('minimap', () => {
  it('maps plan coordinates to the box and back', () => {
    const f = minimapFrame(project, { width: 160, height: 160 });
    expect(f.width).toBeLessThanOrEqual(160 + 1e-9);
    expect(f.height).toBeLessThanOrEqual(160 + 1e-9);
    const p = { x: 4.2, y: 7.7 };
    const q = fromMap(f, toMap(f, p));
    expect(q.x).toBeCloseTo(p.x);
    expect(q.y).toBeCloseTo(p.y);
  });
});

describe('saved views', () => {
  const view = {
    name: 'Kitchen from living room',
    mode: 'orbit' as const,
    position: [1, 2, 3] as [number, number, number],
    target: [4, 1, 0] as [number, number, number],
  };

  it('are stored in the project, uniquely named, renamable and deletable', () => {
    const p = produce(project, (d) => {
      addView(d, view);
      addView(d, view);
    });
    expect(p.views.map((v) => v.name)).toEqual([
      'Kitchen from living room',
      'Kitchen from living room 2',
    ]);
    const renamed = produce(p, (d) => renameView(d, d.views[0]!.id, 'Hall'));
    expect(renamed.views[0]!.name).toBe('Hall');
    expect(produce(renamed, (d) => deleteView(d, d.views[0]!.id)).views).toHaveLength(1);
    expect(() => produce(project, (d) => void addView(d, { ...view, name: '  ' }))).toThrow();
  });

  it('remember the section cuts that were on', () => {
    const section = {
      horizontal: { on: true, height: 1.5 },
      vertical: { on: true, axis: 'z' as const, pos: 6, flip: true },
    };
    const p = produce(project, (d) => void addView(d, { ...view, section }));
    expect(ProjectSchema.parse(JSON.parse(JSON.stringify(p))).views[0]!.section).toEqual(section);
  });

  it('persist in the project file (JSON round-trip) and older files without views still load', () => {
    const p = produce(
      project,
      (d) => void addView(d, { ...view, thumbnail: 'data:image/jpeg;base64,AAAA' }),
    );
    const back = ProjectSchema.parse(JSON.parse(JSON.stringify(p)));
    expect(back.views[0]).toMatchObject({
      name: view.name,
      position: view.position,
      thumbnail: 'data:image/jpeg;base64,AAAA',
    });
    const old = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
    delete old.views;
    expect(ProjectSchema.parse(old).views).toEqual([]);
  });
});
