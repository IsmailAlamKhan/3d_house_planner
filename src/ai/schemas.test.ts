import { describe, expect, it } from 'vitest';
import { DesignIntentSchema, EditResponseSchema, jsonSchemaOf } from './schemas';

const room = (over = {}) => ({ type: 'living', name: 'Living', targetArea: 24, ...over });

describe('DesignIntent schema', () => {
  it('accepts a minimal intent and fills defaults', () => {
    const r = DesignIntentSchema.parse({ levels: [{ name: 'Ground', rooms: [room()] }] });
    expect(r.furnish).toBe(true);
    expect(r.stair).toEqual({ type: 'straight', position: 'near-entrance' });
    expect(r.levels[0]!.rooms[0]!.adjacency).toEqual([]);
    expect(r.levels[0]!.rooms[0]!.exteriorWall).toBe('preferred');
  });

  it('coerces numeric strings (small models do this) and rejects nonsense', () => {
    const ok = DesignIntentSchema.safeParse({
      levels: [{ name: 'G', rooms: [room({ targetArea: '18.5' })] }],
    });
    expect(ok.success && ok.data.levels[0]!.rooms[0]!.targetArea).toBe(18.5);
    expect(DesignIntentSchema.safeParse({ levels: [] }).success).toBe(false);
    expect(
      DesignIntentSchema.safeParse({ levels: [{ name: 'G', rooms: [room({ type: 'ballroom' })] }] })
        .success,
    ).toBe(false);
    expect(
      DesignIntentSchema.safeParse({ levels: [{ name: 'G', rooms: [room({ targetArea: 900 })] }] })
        .success,
    ).toBe(false);
    expect(
      DesignIntentSchema.safeParse({
        levels: Array.from({ length: 4 }, () => ({ name: 'x', rooms: [room()] })),
      }).success,
    ).toBe(false);
  });
});

describe('EditOperation schema', () => {
  it('accepts every operation kind', () => {
    const r = EditResponseSchema.safeParse({
      operations: [
        { op: 'resizeRoom', room: 'Kitchen', dimension: 'width', delta: 1 },
        { op: 'moveWall', room: 'Kitchen', side: 'east', distance: 0.5 },
        {
          op: 'addRoom',
          name: 'Pantry',
          type: 'utility',
          from: 'Kitchen',
          side: 'south',
          size: 1.5,
        },
        { op: 'removeRoom', room: 'Study', mergeInto: 'Living' },
        { op: 'renameRoom', room: 'Study', name: 'Office' },
        { op: 'changeMaterial', target: 'floor', room: 'Living', material: 'floor-oak' },
        { op: 'addItem', catalogId: 'plant', room: 'Living' },
        { op: 'removeItem', catalogId: 'plant', room: 'Living' },
        { op: 'moveItem', catalogId: 'sofa-3seat', dx: 1 },
        { op: 'addOpening', kind: 'window', room: 'Living', side: 'north' },
        { op: 'changeStairType', type: 'L' },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.operations.find((o) => o.op === 'addItem')).toMatchObject({
      catalogId: 'plant',
      room: 'Living',
    });
  });
  it('rejects unknown operations and empty lists', () => {
    expect(EditResponseSchema.safeParse({ operations: [{ op: 'explode' }] }).success).toBe(false);
    expect(EditResponseSchema.safeParse({ operations: [] }).success).toBe(false);
  });
});

describe('JSON schema for constrained decoding', () => {
  it('is generated from the Zod schemas without $schema and keeps defaulted fields optional', () => {
    const js = jsonSchemaOf(DesignIntentSchema) as {
      $schema?: string;
      required?: string[];
      properties: Record<string, unknown>;
    };
    expect(js.$schema).toBeUndefined();
    expect(js.required).toEqual(['levels']);
    expect(Object.keys(js.properties)).toEqual(
      expect.arrayContaining(['levels', 'stair', 'style', 'furnish']),
    );
    const edit = JSON.stringify(jsonSchemaOf(EditResponseSchema));
    expect(edit).toContain('resizeRoom');
    expect(edit).toContain('changeStairType');
  });
});
