import { produce } from 'immer';
import { newId } from './ops/common';
import { addLevel } from './ops/levels';
import { SCHEMA_VERSION } from './schemas';
import type { Project } from './types';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

export function createEmptyProject(name = 'Untitled home'): Project {
  const now = new Date().toISOString();
  const base: Project = {
    id: newId(),
    name,
    units: 'metric',
    shell: {
      footprint: rect(0, 0, 10, 12),
      maxHeight: 6,
      entrance: { position: { x: 10, y: 9.5 }, direction: 0 },
      fixedPlumbingPoints: [],
      notes: '',
    },
    levels: [],
    walls: [],
    openings: [],
    rooms: [],
    stairs: [],
    items: [],
    columns: [],
    roofs: [],
    materials: {},
    settings: { defaultWallThickness: 0.15 },
    createdAt: now,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
  };
  return produce(base, (p) => {
    addLevel(p, { name: 'Ground floor' });
  });
}
