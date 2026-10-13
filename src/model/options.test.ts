import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import {
  addNote,
  allDesigns,
  deleteDesign,
  duplicateDesign,
  deleteNote,
  notePin,
  projectForDesign,
  renameDesign,
  setNoteResolved,
  switchDesign,
  updateNoteText,
  addGate,
  addWall,
  addZone,
  setPlot,
} from './ops';
import { createSampleProject } from './sample';
import { ProjectSchema } from './schemas';

const base = createSampleProject();
const wallCount = (p: typeof base) => p.walls.length;

describe('design options', () => {
  it('duplicating keeps the original aside and switches to the copy (Option A)', () => {
    const p = produce(base, (d) => void duplicateDesign(d));
    expect(p.currentOption.letter).toBe('A');
    expect(p.options).toHaveLength(1);
    expect(p.options[0]!.letter).toBeNull();
    expect(wallCount(p)).toBe(wallCount(base));
    expect(allDesigns(p).map((d) => d.letter)).toEqual([null, 'A']);
  });

  it('edits to one option never touch the other; switching round-trips exactly', () => {
    let p = produce(base, (d) => void duplicateDesign(d));
    const lvl = p.levels[0]!.id;
    p = produce(p, (d) => {
      addWall(d, { levelId: lvl, start: { x: 1, y: 1 }, end: { x: 1, y: 3 } });
    });
    expect(wallCount(p)).toBe(wallCount(base) + 1);
    const mainId = p.options[0]!.id;
    const onMain = produce(p, (d) => void switchDesign(d, mainId));
    expect(wallCount(onMain)).toBe(wallCount(base));
    expect(onMain.currentOption.letter).toBeNull();
    const back = produce(onMain, (d) => void switchDesign(d, p.currentOption.id));
    expect(back.walls).toEqual(p.walls);
    expect(back.rooms).toEqual(p.rooms);
  });

  it('letters go A, B, C … and the original is always listed first', () => {
    let p = base;
    for (let i = 0; i < 3; i++) p = produce(p, (d) => void duplicateDesign(d));
    expect(allDesigns(p).map((d) => d.letter)).toEqual([null, 'A', 'B', 'C']);
    // Deleting B frees nothing in use: the next copy is D? No — B is free again.
    const b = p.options.find((o) => o.letter === 'B')!;
    p = produce(p, (d) => void deleteDesign(d, b.id));
    p = produce(p, (d) => void duplicateDesign(d));
    expect(allDesigns(p).map((d) => d.letter)).toEqual([null, 'A', 'B', 'C']);
  });

  it('can rename, cannot delete the design being edited, and can build a project for any design', () => {
    let p = produce(base, (d) => void duplicateDesign(d));
    p = produce(p, (d) => void renameDesign(d, d.currentOption.id, 'Open kitchen'));
    expect(p.currentOption.name).toBe('Open kitchen');
    expect(() => produce(p, (d) => void deleteDesign(d, d.currentOption.id))).toThrow();
    const mainId = p.options[0]!.id;
    expect(projectForDesign(p, mainId)!.walls).toEqual(base.walls);
    expect(projectForDesign(p, p.currentOption.id)).toBe(p);
    expect(projectForDesign(p, 'nope')).toBeNull();
  });

  it('is saved in the project file and old files load as a single design', () => {
    const p = produce(base, (d) => void duplicateDesign(d));
    const back = ProjectSchema.parse(JSON.parse(JSON.stringify(p)));
    expect(back.options).toHaveLength(1);
    expect(back.currentOption.letter).toBe('A');
    const old = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    delete old.options;
    delete old.currentOption;
    const parsed = ProjectSchema.parse(old);
    expect(parsed.options).toEqual([]);
    expect(parsed.currentOption).toEqual({ id: 'main', letter: null, name: null });
  });
});

describe('design options and the site', () => {
  const plot = [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 40 },
    { x: 0, y: 40 },
  ];
  const withSite = produce(base, (d) => {
    setPlot(d, plot);
    addZone(d, {
      name: 'Lawn A',
      type: 'lawn',
      polygon: [
        { x: 1, y: 1 },
        { x: 8, y: 1 },
        { x: 8, y: 8 },
      ],
    });
    addGate(d, { kind: 'pedestrian', position: { x: 15, y: 40 }, direction: Math.PI / 2 });
  });

  it('outdoor zones and gates belong to the design: each option keeps its own', () => {
    const a = produce(withSite, (d) => void duplicateDesign(d));
    const b = produce(a, (d) => {
      d.site.zones = [];
      addZone(d, {
        name: 'Pool B',
        type: 'pool',
        polygon: [
          { x: 2, y: 2 },
          { x: 9, y: 2 },
          { x: 9, y: 6 },
        ],
      });
      d.site.gates = [];
    });
    expect(b.site.zones.map((z) => z.name)).toEqual(['Pool B']);
    const back = produce(b, (d) => void switchDesign(d, b.options[0]!.id));
    expect(back.site.zones.map((z) => z.name)).toEqual(['Lawn A']);
    expect(back.site.gates).toHaveLength(1);
    const again = produce(back, (d) => void switchDesign(d, back.options[0]!.id));
    expect(again.site.zones.map((z) => z.name)).toEqual(['Pool B']);
    expect(again.site.gates).toHaveLength(0);
    // A design shown for comparison carries its zones too.
    expect(projectForDesign(b, b.options[0]!.id)!.site.zones.map((z) => z.name)).toEqual([
      'Lawn A',
    ]);
  });

  it('a design saved before zones were part of it leaves the site as it is', () => {
    const a = produce(withSite, (d) => void duplicateDesign(d));
    const old = produce(a, (d) => {
      delete d.options[0]!.design.zones;
      delete d.options[0]!.design.gates;
    });
    const switched = produce(old, (d) => void switchDesign(d, old.options[0]!.id));
    expect(switched.site.zones.map((z) => z.name)).toEqual(['Lawn A']);
    expect(ProjectSchema.safeParse(old).success).toBe(true);
  });
});

describe('notes', () => {
  it('pin to a spot or to an entity (the pin follows the entity), resolve, edit and delete', () => {
    const level = base.levels[0]!.id;
    let p = produce(
      base,
      (d) =>
        void addNote(d, {
          levelId: level,
          position: { x: 2, y: 3 },
          text: 'Ask about window size here',
        }),
    );
    const spot = p.notes[0]!;
    expect(notePin(p, spot)).toEqual({ levelId: level, position: { x: 2, y: 3 } });

    const item = base.items.find((i) => i.levelId === level)!;
    p = produce(
      p,
      (d) =>
        void addNote(d, {
          levelId: level,
          position: { x: 0, y: 0 },
          entity: { type: 'item', id: item.id },
        }),
    );
    const attached = p.notes[1]!;
    expect(notePin(p, attached).position).toEqual(item.position);
    const moved = produce(
      p,
      (d) => void (d.items.find((i) => i.id === item.id)!.position = { x: 9, y: 9 }),
    );
    expect(notePin(moved, moved.notes[1]!).position).toEqual({ x: 9, y: 9 });
    // Deleting the thing leaves the pin where it was dropped.
    const gone = produce(p, (d) => void (d.items = d.items.filter((i) => i.id !== item.id)));
    expect(notePin(gone, gone.notes[1]!).position).toEqual({ x: 0, y: 0 });

    p = produce(p, (d) => {
      updateNoteText(d, spot.id, 'Changed');
      setNoteResolved(d, spot.id, true);
    });
    expect(p.notes[0]).toMatchObject({ text: 'Changed', resolved: true });
    p = produce(p, (d) => void deleteNote(d, spot.id));
    expect(p.notes).toHaveLength(1);
  });

  it('are saved in the project file; files without notes still load', () => {
    const p = produce(
      base,
      (d) => void addNote(d, { levelId: base.levels[0]!.id, position: { x: 1, y: 1 }, text: 'hi' }),
    );
    expect(ProjectSchema.parse(JSON.parse(JSON.stringify(p))).notes[0]!.text).toBe('hi');
    const old = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    delete old.notes;
    expect(ProjectSchema.parse(old).notes).toEqual([]);
    expect(() =>
      produce(base, (d) => void addNote(d, { levelId: 'nope', position: { x: 0, y: 0 } })),
    ).toThrow();
  });
});
