import { beforeEach, describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sample';
import { useModel } from '../model/store';
import { entityLevelId, selectFrom3d } from './select';

describe('selectFrom3d', () => {
  beforeEach(() => useModel.getState().loadProject(createSampleProject()));

  it('selects the entity and switches the active level to where it lives', () => {
    const { project } = useModel.getState();
    const upperWall = project.walls.find((w) => w.levelId === project.levels[1]!.id)!;
    selectFrom3d({ type: 'wall', id: upperWall.id }, false);
    const s = useModel.getState();
    expect(s.selection).toEqual({ type: 'wall', ids: [upperWall.id] });
    expect(s.activeLevelId).toBe(project.levels[1]!.id);
  });

  it('shift adds and removes, and clicking empty space clears', () => {
    const { project } = useModel.getState();
    const [a, b] = project.walls.filter((w) => w.levelId === project.levels[0]!.id) as [
      (typeof project.walls)[0],
      (typeof project.walls)[0],
    ];
    selectFrom3d({ type: 'wall', id: a.id }, false);
    selectFrom3d({ type: 'wall', id: b.id }, true);
    expect(useModel.getState().selection.ids).toEqual([a.id, b.id]);
    selectFrom3d({ type: 'wall', id: a.id }, true);
    expect(useModel.getState().selection.ids).toEqual([b.id]);
    selectFrom3d(undefined, false);
    expect(useModel.getState().selection.type).toBeNull();
  });

  it('knows the level of every entity type', () => {
    const p = useModel.getState().project;
    expect(entityLevelId(p, { type: 'room', id: p.rooms[0]!.id })).toBe(p.rooms[0]!.levelId);
    expect(entityLevelId(p, { type: 'stair', id: p.stairs[0]!.id })).toBe(p.stairs[0]!.fromLevelId);
    expect(entityLevelId(p, { type: 'opening', id: p.openings[0]!.id })).toBeDefined();
    expect(entityLevelId(p, { type: 'column', id: p.columns[0]!.id })).toBe(p.columns[0]!.levelId);
    expect(entityLevelId(p, { type: 'roof', id: p.roofs[0]!.id })).toBe(p.roofs[0]!.levelId);
  });
});
